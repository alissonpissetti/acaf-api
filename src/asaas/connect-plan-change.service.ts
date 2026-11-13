import { BadRequestException, Injectable } from '@nestjs/common';
import { normalizeHolderKey } from '../partner/checkIn';
import {
  computePlanChangeAmounts,
  resolveConnectPlanQuote,
  type PlanChangeKind,
} from '../partner/connect-plan-pricing';
import {
  findConnectMember,
  getConnectMemberProfile,
  toConnectMemberProfile,
  upsertConnectSubscription,
  type ConnectMemberProfile,
} from '../partner/connectMember';
import { loadStore, updateStore } from '../partner/store';
import type { ConnectPlanId } from '../partner/types';
import {
  AsaasClient,
  asaasPaymentPending,
  asaasPaymentSucceeded,
  connectPaymentOutcomeFromAsaasStatus,
  type ConnectPaymentOutcome,
} from './asaas.client';
import { CONNECT_RECEIVABLE_CATEGORY_UPGRADE } from './connect-finance-receivable';
import { ConnectFinanceSyncService } from './connect-finance-sync.service';
import { buildConnectAsaasPaymentExternalReference } from './connect-asaas-external-ref';

export type ConnectPlanChangeInput = {
  holderName: string;
  connectPlanId: ConnectPlanId;
};

export type ConnectPlanChangeResult = {
  profile: ConnectMemberProfile;
  change: {
    kind: PlanChangeKind;
    fromPlanId: ConnectPlanId;
    toPlanId: ConnectPlanId;
    oldMonthlyAmount: number;
    newMonthlyAmount: number;
    upgradeChargeNow: number;
    downgradeReceivable: number;
    cycleRemainingFraction: number;
  };
  gateway?: {
    upgradePaymentId?: string | null;
    upgradePaymentStatus?: string | null;
    subscriptionId?: string | null;
  };
  finance?: {
    receivableId?: string | null;
  };
  /** Upgrade: só `confirmed` altera o plano na loja; downgrade sempre `confirmed` (crédito a receber, sem cobrança). */
  payment?: {
    id: string | null;
    outcome: ConnectPaymentOutcome;
    gatewayStatus: string | null;
  };
};

@Injectable()
export class ConnectPlanChangeService {
  constructor(
    private readonly asaas: AsaasClient,
    private readonly connectFinance: ConnectFinanceSyncService,
  ) {}

  async changePlan(input: ConnectPlanChangeInput): Promise<ConnectPlanChangeResult> {
    const holderName = input.holderName.trim();
    if (!holderName) {
      throw new BadRequestException('Informe o nome do titular.');
    }

    const store = loadStore();
    const member = findConnectMember(store, holderName);
    if (!member?.active) {
      throw new BadRequestException(
        'Não encontramos um plano app ativo para este cadastro. Assine um plano ou confira se o benefício da empresa já foi liberado.',
      );
    }

    const fromPlanId = member.connectPlanId;
    const toPlanId = input.connectPlanId;
    if (fromPlanId === toPlanId) {
      throw new BadRequestException('Selecione um plano diferente do atual.');
    }

    const oldQuote = resolveConnectPlanQuote(fromPlanId);
    const newQuote = resolveConnectPlanQuote(toPlanId);
    const amounts = computePlanChangeAmounts(
      oldQuote.monthlyAmount,
      newQuote.monthlyAmount,
      member.since,
    );

    if (amounts.kind === 'upgrade') {
      return this.applyUpgrade(holderName, member, fromPlanId, toPlanId, oldQuote, newQuote, amounts);
    }

    return this.applyDowngrade(holderName, member, fromPlanId, toPlanId, oldQuote, newQuote, amounts);
  }

  private async applyUpgrade(
    holderName: string,
    member: NonNullable<ReturnType<typeof findConnectMember>>,
    fromPlanId: ConnectPlanId,
    toPlanId: ConnectPlanId,
    oldQuote: ReturnType<typeof resolveConnectPlanQuote>,
    newQuote: ReturnType<typeof resolveConnectPlanQuote>,
    amounts: ReturnType<typeof computePlanChangeAmounts>,
  ): Promise<ConnectPlanChangeResult> {
    if (!member.asaasSubscriptionId || !member.asaasCustomerId) {
      throw new BadRequestException(
        'Assinatura sem gateway Asaas. Conclua o checkout com cartão antes de fazer upgrade.',
      );
    }
    if (!this.asaas.isConfigured()) {
      throw new BadRequestException('Pagamento indisponível: gateway Asaas não configurado.');
    }

    const charge = amounts.upgradeChargeNow;
    if (!(charge > 0)) {
      throw new BadRequestException('Valor de upgrade inválido.');
    }

    const holderKey = normalizeHolderKey(holderName);
    let upgradePaymentId: string | null = null;
    let upgradePaymentStatus = 'SKIPPED';

    if (charge >= 0.01) {
      const payment = await this.asaas.createCustomerCreditCardPayment({
        customerId: member.asaasCustomerId,
        value: charge,
        description: `Movly — upgrade ${oldQuote.name} → ${newQuote.name} (pró-rata)`,
        externalReference: buildConnectAsaasPaymentExternalReference(
          `${holderKey}:upgrade:${toPlanId}`,
          member.userId,
        ),
      });
      upgradePaymentId = payment.id;
      const settled = await this.waitForPaymentResult(payment.id);
      upgradePaymentStatus = settled?.status ?? payment.status;
      const outcome = connectPaymentOutcomeFromAsaasStatus(upgradePaymentStatus);

      if (outcome === 'failed') {
        throw new BadRequestException(
          `Cobrança do upgrade não autorizada (${upgradePaymentStatus}). Verifique o cartão cadastrado.`,
        );
      }

      if (outcome === 'pending_payment') {
        const profile = getConnectMemberProfile(holderName) ?? toConnectMemberProfile(member);
        return {
          profile,
          change: {
            kind: 'upgrade',
            fromPlanId,
            toPlanId,
            oldMonthlyAmount: oldQuote.monthlyAmount,
            newMonthlyAmount: newQuote.monthlyAmount,
            upgradeChargeNow: charge,
            downgradeReceivable: 0,
            cycleRemainingFraction: amounts.cycleRemainingFraction,
          },
          gateway: {
            upgradePaymentId,
            upgradePaymentStatus,
            subscriptionId: member.asaasSubscriptionId,
          },
          payment: {
            id: upgradePaymentId,
            outcome,
            gatewayStatus: upgradePaymentStatus,
          },
        };
      }

      const paymentForReceivable = settled ?? payment;
      await this.connectFinance.syncAsaasPayment({
        payment: paymentForReceivable,
        holderName,
        holderKey,
        platformUserId: member.userId,
        cpf: member.holderCpf,
        mobilePhone: member.holderPhone,
        companyName: member.companyName,
        category: CONNECT_RECEIVABLE_CATEGORY_UPGRADE,
        description: `Movly — upgrade ${oldQuote.name} → ${newQuote.name} — ${holderName}`,
        notes: `Upgrade pró-rata Asaas (${paymentForReceivable.id}).`,
      });
    }

    await this.asaas.updateSubscription(member.asaasSubscriptionId, {
      value: newQuote.monthlyAmount,
      description: `Movly — ${newQuote.name}`,
      externalReference: `${holderKey}:${toPlanId}`,
    });

    const profile = upsertConnectSubscription({
      holderName,
      connectPlanId: toPlanId,
      active: true,
    });

    this.touchPlanChangeMetadata(holderName, fromPlanId, toPlanId, {
      planChangeReceivableAmount: undefined,
      planChangeReceivableId: undefined,
    });

    return {
      profile,
      change: {
        kind: 'upgrade',
        fromPlanId,
        toPlanId,
        oldMonthlyAmount: oldQuote.monthlyAmount,
        newMonthlyAmount: newQuote.monthlyAmount,
        upgradeChargeNow: charge,
        downgradeReceivable: 0,
        cycleRemainingFraction: amounts.cycleRemainingFraction,
      },
      gateway: {
        upgradePaymentId,
        upgradePaymentStatus,
        subscriptionId: member.asaasSubscriptionId,
      },
      payment: {
        id: upgradePaymentId,
        outcome: connectPaymentOutcomeFromAsaasStatus(
          upgradePaymentStatus === 'SKIPPED' ? 'CONFIRMED' : upgradePaymentStatus,
        ),
        gatewayStatus: upgradePaymentStatus === 'SKIPPED' ? null : upgradePaymentStatus,
      },
    };
  }

  private async applyDowngrade(
    holderName: string,
    member: NonNullable<ReturnType<typeof findConnectMember>>,
    fromPlanId: ConnectPlanId,
    toPlanId: ConnectPlanId,
    oldQuote: ReturnType<typeof resolveConnectPlanQuote>,
    newQuote: ReturnType<typeof resolveConnectPlanQuote>,
    amounts: ReturnType<typeof computePlanChangeAmounts>,
  ): Promise<ConnectPlanChangeResult> {
    const holderKey = normalizeHolderKey(holderName);

    if (member.asaasSubscriptionId && this.asaas.isConfigured()) {
      await this.asaas.updateSubscription(member.asaasSubscriptionId, {
        value: newQuote.monthlyAmount,
        description: `Movly — ${newQuote.name}`,
        externalReference: `${holderKey}:${toPlanId}`,
      });
    }

    const receivableAmount = amounts.downgradeReceivable;
    const receivableId = await this.registerDowngradeReceivable({
      holderName,
      holderKey,
      member,
      fromPlan: oldQuote,
      toPlan: newQuote,
      amount: receivableAmount,
    });

    const profile = upsertConnectSubscription({
      holderName,
      connectPlanId: toPlanId,
      active: true,
    });

    this.touchPlanChangeMetadata(holderName, fromPlanId, toPlanId, {
      planChangeReceivableAmount: receivableAmount > 0 ? receivableAmount : undefined,
      planChangeReceivableId: receivableId ?? undefined,
    });

    return {
      profile,
      change: {
        kind: 'downgrade',
        fromPlanId,
        toPlanId,
        oldMonthlyAmount: oldQuote.monthlyAmount,
        newMonthlyAmount: newQuote.monthlyAmount,
        upgradeChargeNow: 0,
        downgradeReceivable: receivableAmount,
        cycleRemainingFraction: amounts.cycleRemainingFraction,
      },
      gateway: {
        subscriptionId: member.asaasSubscriptionId ?? null,
      },
      finance: {
        receivableId: receivableId ?? null,
      },
      payment: {
        id: null,
        outcome: 'confirmed',
        gatewayStatus: null,
      },
    };
  }

  private touchPlanChangeMetadata(
    holderName: string,
    fromPlanId: ConnectPlanId,
    toPlanId: ConnectPlanId,
    extra: {
      planChangeReceivableAmount?: number;
      planChangeReceivableId?: string;
    },
  ) {
    const holderKey = normalizeHolderKey(holderName);
    const now = new Date().toISOString();
    updateStore((s) => {
      const members = s.connectMembers ?? [];
      const idx = members.findIndex((m) => m.holderKey === holderKey);
      if (idx < 0) return;
      members[idx] = {
        ...members[idx],
        ...extra,
        lastPlanChangeAt: now,
        lastPlanChangeFromPlanId: fromPlanId,
        connectPlanId: toPlanId,
      };
    });
  }

  private async registerDowngradeReceivable(input: {
    holderName: string;
    holderKey: string;
    member: NonNullable<ReturnType<typeof findConnectMember>>;
    fromPlan: ReturnType<typeof resolveConnectPlanQuote>;
    toPlan: ReturnType<typeof resolveConnectPlanQuote>;
    amount: number;
  }): Promise<string | null> {
    const description = `Movly — downgrade ${input.fromPlan.name} → ${input.toPlan.name} — ${input.holderName}`;
    return this.connectFinance.createDowngradeReceivable({
      holderName: input.holderName,
      holderKey: input.holderKey,
      amount: input.amount,
      description,
      notes: `Receita reconhecida do ciclo corrente após troca para plano ${input.toPlan.name}. Sem estorno ao titular.`,
      platformUserId: input.member.userId,
      cpf: input.member.holderCpf,
      mobilePhone: input.member.holderPhone,
      companyName: input.member.companyName,
    });
  }

  private async waitForPaymentResult(paymentId: string) {
    const delays = [0, 800, 1500, 2500, 4000, 6000];
    let last = await this.asaas.getPayment(paymentId);
    for (const ms of delays) {
      if (ms > 0) await sleep(ms);
      last = await this.asaas.getPayment(paymentId);
      const status = last.status;
      if (asaasPaymentSucceeded(status) || !asaasPaymentPending(status)) {
        return last;
      }
    }
    return last;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
