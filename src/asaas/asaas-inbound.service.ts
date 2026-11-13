import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { normalizeHolderKey } from '../partner/checkIn';
import {
  findConnectMember,
  findConnectMemberByAsaasSubscriptionId,
} from '../partner/connectMember';
import { getDomain } from '../partner/store';
import { loadStore } from '../partner/store';
import type { ConnectPlanId } from '../partner/types';
import { AsaasClient } from './asaas.client';
import {
  CONNECT_RECEIVABLE_CATEGORY_SUBSCRIPTION,
  CONNECT_RECEIVABLE_CATEGORY_UPGRADE,
} from './connect-finance-receivable';
import { ConnectFinanceSyncService } from './connect-finance-sync.service';
import type { AsaasPayment } from './asaas.types';
import {
  parseConnectAsaasUserIdFromReference,
  stripConnectAsaasUserRefSuffix,
} from './connect-asaas-external-ref';

const PAYMENT_EVENTS = new Set([
  'PAYMENT_CONFIRMED',
  'PAYMENT_RECEIVED',
  'PAYMENT_UPDATED',
  'PAYMENT_OVERDUE',
  'PAYMENT_REFUNDED',
  'PAYMENT_DELETED',
  'PAYMENT_RESTORED',
]);

type AsaasWebhookBody = {
  event?: string;
  payment?: AsaasPayment;
};

@Injectable()
export class AsaasInboundService {
  private readonly log = new Logger(AsaasInboundService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly asaas: AsaasClient,
    private readonly connectFinance: ConnectFinanceSyncService,
  ) {}

  assertWebhookAuthorized(accessToken?: string): void {
    const expected = this.config.get<string>('ASAAS_WEBHOOK_ACCESS_TOKEN')?.trim();
    if (!expected) return;
    const received = accessToken?.trim() ?? '';
    if (received !== expected) {
      throw new ForbiddenException('Webhook Asaas não autorizado.');
    }
  }

  async handleWebhook(body: AsaasWebhookBody): Promise<{ ok: true; synced?: boolean }> {
    const event = (body.event ?? '').trim().toUpperCase();
    if (!PAYMENT_EVENTS.has(event)) {
      return { ok: true };
    }

    let payment = body.payment;
    if (!payment?.id) {
      return { ok: true };
    }

    if (!payment.status && this.asaas.isConfigured()) {
      try {
        payment = await this.asaas.getPayment(payment.id);
      } catch (error) {
        this.log.warn(
          `Webhook Asaas: não foi possível carregar pagamento ${payment.id}: ${error instanceof Error ? error.message : error}`,
        );
      }
    }

    const synced = await this.syncPaymentToReceivable(payment, event);
    return { ok: true, synced };
  }

  async syncPaymentToReceivable(payment: AsaasPayment, webhookEvent?: string): Promise<boolean> {
    const context = this.resolveConnectContext(payment);
    if (!context) {
      return false;
    }

    const result = await this.connectFinance.syncAsaasPayment({
      payment,
      holderName: context.holderName,
      holderKey: context.holderKey,
      platformUserId: context.platformUserId,
      cpf: context.cpf,
      mobilePhone: context.mobilePhone,
      companyName: context.companyName,
      category: context.category,
      description: context.description,
      notes: context.notes,
      webhookEvent: webhookEvent?.trim() || null,
    });
    return Boolean(result.receivableId || result.payableId);
  }

  private resolveConnectContext(payment: AsaasPayment): {
    holderName: string;
    holderKey: string;
    platformUserId?: string | null;
    cpf?: string | null;
    mobilePhone?: string | null;
    companyName?: string | null;
    category: typeof CONNECT_RECEIVABLE_CATEGORY_SUBSCRIPTION | typeof CONNECT_RECEIVABLE_CATEGORY_UPGRADE;
    description: string;
    notes: string;
  } | null {
    const store = loadStore();

    const subscriptionId =
      typeof payment.subscription === 'string'
        ? payment.subscription.trim()
        : (payment as { subscription?: { id?: string } }).subscription?.id?.trim() ?? '';

    if (subscriptionId) {
      const member = findConnectMemberByAsaasSubscriptionId(store, subscriptionId);
      if (member) {
        const plan = this.resolvePlan(member.connectPlanId);
        const holderKey = normalizeHolderKey(member.holderName);
        return {
          holderName: member.holderName,
          holderKey,
          ...this.memberPaymentIdentity(member, payment),
          category: CONNECT_RECEIVABLE_CATEGORY_SUBSCRIPTION,
          description: `Movly — ${plan.name} — ${member.holderName}`,
          notes: `Cobrança recorrente Asaas (${payment.id}).`,
        };
      }
    }

    const ref = stripConnectAsaasUserRefSuffix(
      (payment as { externalReference?: string }).externalReference?.trim() ?? '',
    );
    if (!ref) return null;

    const upgradeMatch = ref.match(/^(.+):upgrade:([^:]+)$/);
    if (upgradeMatch) {
      const holderKey = upgradeMatch[1].trim();
      const toPlanId = upgradeMatch[2].trim() as ConnectPlanId;
      const member = this.findMemberByHolderKey(store, holderKey);
      const holderName = member?.holderName ?? holderKey;
      const plan = this.resolvePlan(toPlanId);
      return {
        holderName,
        holderKey,
        ...(member ? this.memberPaymentIdentity(member, payment) : {}),
        category: CONNECT_RECEIVABLE_CATEGORY_UPGRADE,
        description: `Movly — upgrade — ${holderName}`,
        notes: `Upgrade pró-rata Asaas (${payment.id}) → plano ${plan.name}.`,
      };
    }

    const subMatch = ref.match(/^(.+):([^:]+)$/);
    if (subMatch) {
      const holderKey = subMatch[1].trim();
      const planId = subMatch[2].trim() as ConnectPlanId;
      const member = this.findMemberByHolderKey(store, holderKey);
      if (!member) return null;
      const plan = this.resolvePlan(planId);
      return {
        holderName: member.holderName,
        holderKey,
        ...this.memberPaymentIdentity(member, payment),
        category: CONNECT_RECEIVABLE_CATEGORY_SUBSCRIPTION,
        description: `Movly — ${plan.name} — ${member.holderName}`,
        notes: `Cobrança Asaas (${payment.id}).`,
      };
    }

    const member = findConnectMember(store, ref);
    if (!member) return null;
    const plan = this.resolvePlan(member.connectPlanId);
    const holderKey = normalizeHolderKey(member.holderName);
    return {
      holderName: member.holderName,
      holderKey,
      ...this.memberPaymentIdentity(member, payment),
      category: CONNECT_RECEIVABLE_CATEGORY_SUBSCRIPTION,
      description: `Movly — ${plan.name} — ${member.holderName}`,
      notes: `Cobrança Asaas (${payment.id}).`,
    };
  }

  private memberPaymentIdentity(
    member: NonNullable<ReturnType<typeof findConnectMemberByAsaasSubscriptionId>>,
    payment: AsaasPayment,
  ) {
    const fromPayment = parseConnectAsaasUserIdFromReference(
      (payment as { externalReference?: string }).externalReference,
    );
    return {
      platformUserId: member.userId ?? fromPayment,
      cpf: member.holderCpf ?? null,
      mobilePhone: member.holderPhone ?? null,
      companyName: member.companyName ?? null,
    };
  }

  private findMemberByHolderKey(
    store: ReturnType<typeof loadStore>,
    holderKey: string,
  ) {
    const key = holderKey.trim().toLowerCase();
    return (
      store.connectMembers?.find((m) => normalizeHolderKey(m.holderName) === key) ?? null
    );
  }

  private resolvePlan(planId: ConnectPlanId): { name: string } {
    const domain = getDomain() as {
      connectPlans?: Array<{ id: string; name?: string }>;
    };
    const row = domain.connectPlans?.find((p) => p.id === planId);
    return { name: row?.name ?? planId };
  }
}
