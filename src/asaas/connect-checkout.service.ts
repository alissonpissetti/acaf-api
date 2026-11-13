import { BadRequestException, Inject, Injectable, NotFoundException, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { normalizeHolderKey } from '../partner/checkIn';
import { getDomain } from '../partner/store';
import type { ConnectMemberProfile } from '../partner/connectMember';
import { upsertConnectSubscription } from '../partner/connectMember';
import type { ConnectPlanId } from '../partner/types';
import {
  AsaasClient,
  asaasPaymentPending,
  asaasPaymentSucceeded,
  type AsaasCreditCardHolderInfo,
  type AsaasCreditCardInput,
} from './asaas.client';
import {
  mapSubscriptionPaymentToStatementEntry,
  type ConnectBillingStatementEntry,
} from './connect-billing';
import { CONNECT_RECEIVABLE_CATEGORY_SUBSCRIPTION } from './connect-finance-receivable';
import { ConnectFinanceSyncService } from './connect-finance-sync.service';
import {
  findConnectMember,
  findConnectMemberByUserId,
} from '../partner/connectMember';
import { loadStore, updateStore } from '../partner/store';
import { UsersService } from '../users/users.service';
import { connectFallbackMemberEmail } from './connect-checkout-identity';
import {
  buildConnectAsaasCustomerExternalReference,
  buildConnectAsaasPaymentExternalReference,
} from './connect-asaas-external-ref';
import { ConnectFinanceReceivableService } from './connect-finance-receivable.service';
import {
  isValidCpf,
  isValidMobilePhone,
  normalizeCpf,
  normalizeMobilePhone,
} from '../users/person.utils';

export type ConnectSubscriptionCheckoutInput = {
  holderName: string;
  connectPlanId: ConnectPlanId;
  companyName?: string;
  holderCpf?: string;
  holderEmail?: string;
  holderPhone?: string;
  card: {
    holderName: string;
    number: string;
    expiryMonth: string;
    expiryYear: string;
    cvv: string;
  };
};

export type ConnectSubscriptionCheckoutResult = {
  profile: ConnectMemberProfile;
  gateway: {
    customerId: string;
    subscriptionId: string;
    firstPaymentId: string | null;
    firstPaymentStatus: string;
    cardLastFour: string;
  };
};

const SANDBOX_DEFAULT_CPF = '24971563792';

@Injectable()
export class ConnectCheckoutService {
  constructor(
    private readonly asaas: AsaasClient,
    private readonly config: ConfigService,
    private readonly connectFinance: ConnectFinanceSyncService,
    private readonly receivableFinance: ConnectFinanceReceivableService,
    @Inject(forwardRef(() => UsersService))
    private readonly usersService: UsersService,
  ) {}

  async checkout(input: ConnectSubscriptionCheckoutInput): Promise<ConnectSubscriptionCheckoutResult> {
    try {
      return await this.checkoutWithAsaas(input);
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      const message =
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : 'Falha ao processar pagamento no Asaas.';
      throw new BadRequestException(message);
    }
  }

  private async checkoutWithAsaas(
    input: ConnectSubscriptionCheckoutInput,
  ): Promise<ConnectSubscriptionCheckoutResult> {
    if (!this.asaas.isConfigured()) {
      throw new BadRequestException(
        'Pagamento indisponível no momento. O gateway Asaas não está configurado.',
      );
    }

    const holderName = input.holderName.trim();
    if (!holderName) {
      throw new BadRequestException('Informe o nome do titular.');
    }

    const plan = this.resolvePlan(input.connectPlanId);
    const value = plan.pricePerMonth;
    if (!(value > 0)) {
      throw new BadRequestException('Plano inválido ou sem valor configurado.');
    }

    const cardNumber = digitsOnly(input.card.number);
    if (cardNumber.length < 13) {
      throw new BadRequestException('Número do cartão inválido.');
    }
    const cvv = digitsOnly(input.card.cvv);
    if (cvv.length < 3) {
      throw new BadRequestException('CVV inválido.');
    }

    const expiryMonth = input.card.expiryMonth.padStart(2, '0');
    const expiryYear = normalizeExpiryYear(input.card.expiryYear);
    if (!isValidExpiry(expiryMonth, expiryYear)) {
      throw new BadRequestException('Validade do cartão inválida.');
    }

    const cpfCnpj = this.resolveCpf(input.holderCpf);
    const holderKey = normalizeHolderKey(holderName);
    const email = input.holderEmail?.trim() || connectFallbackMemberEmail(holderName);
    const phone = resolveCheckoutMobilePhone(input.holderPhone, this.config);

    const platformUserId = await this.usersService.ensureConnectMemberUser({
      name: holderName,
      email,
      cpf: cpfCnpj.length === 11 ? cpfCnpj : undefined,
      mobilePhone: phone,
    });
    const linkedUser = await this.usersService.findById(platformUserId);

    const customerExternalRef = buildConnectAsaasCustomerExternalReference(holderKey, platformUserId);
    let customer =
      (await this.asaas.findCustomerByExternalReference(customerExternalRef)) ??
      (await this.asaas.findCustomerByExternalReference(holderKey));
    if (!customer) {
      customer = await this.asaas.createCustomer({
        name: holderName,
        cpfCnpj,
        email,
        phone,
        externalReference: customerExternalRef,
      });
    } else if (customer.externalReference?.trim() !== customerExternalRef) {
      customer = await this.asaas.updateCustomer(customer.id, {
        externalReference: customerExternalRef,
        name: holderName,
        email,
      });
    }

    const creditCard: AsaasCreditCardInput = {
      holderName: input.card.holderName.trim() || holderName,
      number: cardNumber,
      expiryMonth,
      expiryYear,
      ccv: cvv,
    };

    const creditCardHolderInfo: AsaasCreditCardHolderInfo = {
      name: holderName,
      email,
      cpfCnpj,
      postalCode: this.config.get<string>('ASAAS_DEFAULT_POSTAL_CODE')?.trim() || '01310100',
      addressNumber: this.config.get<string>('ASAAS_DEFAULT_ADDRESS_NUMBER')?.trim() || '100',
      phone,
      mobilePhone: phone,
    };

    const subscription = await this.asaas.createCreditCardSubscription({
      customerId: customer.id,
      value,
      description: `Movly — ${plan.name}`,
      externalReference: buildConnectAsaasPaymentExternalReference(
        `${holderKey}:${input.connectPlanId}`,
        platformUserId,
      ),
      creditCard,
      creditCardHolderInfo,
    });

    const firstPayment = await this.waitForFirstPayment(subscription.id);
    const paymentStatus = firstPayment?.status ?? 'UNKNOWN';
    if (!asaasPaymentSucceeded(paymentStatus) && !asaasPaymentPending(paymentStatus)) {
      throw new BadRequestException(
        firstPayment
          ? `Pagamento recusado pelo emissor (${paymentStatus}). Verifique os dados do cartão.`
          : 'Não foi possível confirmar a cobrança no gateway.',
      );
    }

    const cardLastFour = cardNumber.slice(-4);

    const profile = upsertConnectSubscription({
      holderName,
      connectPlanId: input.connectPlanId,
      active: true,
      companyName: input.companyName,
      asaasCustomerId: customer.id,
      asaasSubscriptionId: subscription.id,
      cardLastFour,
      userId: platformUserId,
      holderCpf: cpfCnpj.length === 11 ? cpfCnpj : undefined,
      holderEmail: email,
      holderPhone: phone,
    });

    if (linkedUser) {
      await this.receivableFinance.relinkConnectReceivablesToUser(
        holderKey,
        platformUserId,
        linkedUser.name,
      );
    }

    if (firstPayment?.id) {
      const paymentWithSubscription = { ...firstPayment, subscription: subscription.id };
      await this.connectFinance.syncAsaasPayment({
        payment: paymentWithSubscription,
        holderName,
        holderKey,
        platformUserId,
        cpf: cpfCnpj.length === 11 ? cpfCnpj : undefined,
        mobilePhone: phone,
        category: CONNECT_RECEIVABLE_CATEGORY_SUBSCRIPTION,
        description: `Movly — ${plan.name} — ${holderName}`,
        notes: `Primeira cobrança da assinatura Asaas (${paymentWithSubscription.id}).`,
      });
    }

    return {
      profile,
      gateway: {
        customerId: customer.id,
        subscriptionId: subscription.id,
        firstPaymentId: firstPayment?.id ?? null,
        firstPaymentStatus: paymentStatus,
        cardLastFour,
      },
    };
  }

  async listMemberBillingStatement(holderName: string): Promise<ConnectBillingStatementEntry[]> {
    const trimmed = holderName.trim();
    if (!trimmed) return [];

    const store = loadStore();
    const member = findConnectMember(store, trimmed);
    if (!member?.active || !member.asaasSubscriptionId) {
      return [];
    }
    if (!this.asaas.isConfigured()) {
      return [];
    }

    const plan = this.resolvePlan(member.connectPlanId);
    const holderKey = normalizeHolderKey(trimmed);
    await this.ensureMemberReceivablesLinked(member, holderKey);
    if (this.asaas.isConfigured()) {
      await this.connectFinance.syncSubscriptionPayments({
        subscriptionId: member.asaasSubscriptionId,
        holderName: trimmed,
        holderKey,
        planName: plan.name,
        listPayments: (id, limit) => this.asaas.listSubscriptionPayments(id, limit),
        limit: 24,
      });
    }

    const payments = await this.asaas.listSubscriptionPayments(member.asaasSubscriptionId, 12);
    return payments
      .map((payment) =>
        mapSubscriptionPaymentToStatementEntry({
          payment,
          planName: plan.name,
          cardLastFour: member.cardLastFour,
        }),
      )
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  }

  async listBillingStatementForPlatformUser(userId: string): Promise<ConnectBillingStatementEntry[]> {
    const id = userId.trim();
    if (!id) return [];

    const user = await this.usersService.findById(id);
    if (!user) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    const store = loadStore();
    const cpf = user.cpf ? normalizeCpf(user.cpf) : '';
    const member =
      findConnectMemberByUserId(store, id) ??
      (cpf
        ? store.connectMembers?.find((m) => m.holderCpf && normalizeCpf(m.holderCpf) === cpf)
        : undefined) ??
      findConnectMember(store, user.name);

    if (!member?.holderName?.trim()) {
      return [];
    }

    if (!member.userId) {
      try {
        updateStore((s) => {
          const idx = s.connectMembers?.findIndex((m) => m.holderKey === member.holderKey) ?? -1;
          if (idx >= 0 && s.connectMembers) {
            s.connectMembers[idx] = { ...s.connectMembers[idx], userId: id };
          }
        });
      } catch {
        // Store opcional em ambientes sem JSON persistido.
      }
      await this.receivableFinance.relinkConnectReceivablesToUser(
        member.holderKey,
        id,
        user.name,
      );
    }

    return this.listMemberBillingStatement(member.holderName.trim());
  }

  private async ensureMemberReceivablesLinked(
    member: NonNullable<ReturnType<typeof findConnectMember>>,
    holderKey: string,
  ): Promise<void> {
    const userId = member.userId?.trim();
    if (userId) {
      const user = await this.usersService.findById(userId);
      if (user) {
        await this.receivableFinance.relinkConnectReceivablesToUser(holderKey, userId, user.name);
      }
      return;
    }

    const cpf = member.holderCpf?.trim();
    const phone = member.holderPhone?.trim();
    if (!cpf && !phone) return;

    try {
      const platformUserId = await this.usersService.ensureConnectMemberUser({
        name: member.holderName,
        email: member.holderEmail?.trim() || connectFallbackMemberEmail(member.holderName),
        cpf: cpf || undefined,
        mobilePhone: phone || undefined,
      });
      updateStore((s) => {
        const idx = s.connectMembers?.findIndex((m) => m.holderKey === holderKey) ?? -1;
        if (idx >= 0 && s.connectMembers) {
          s.connectMembers[idx] = { ...s.connectMembers[idx], userId: platformUserId };
        }
      });
      const user = await this.usersService.findById(platformUserId);
      if (user) {
        await this.receivableFinance.relinkConnectReceivablesToUser(
          holderKey,
          platformUserId,
          user.name,
        );
      }
    } catch {
      // Relink ocorre na próxima sincronização financeira.
    }
  }

  private resolvePlan(planId: ConnectPlanId): { name: string; pricePerMonth: number } {
    const domain = getDomain() as {
      connectPlans?: Array<{ id: string; name?: string; pricePerMonth?: number }>;
    };
    const row = domain.connectPlans?.find((p) => p.id === planId);
    if (!row) {
      throw new BadRequestException('Plano não encontrado.');
    }
    return {
      name: row.name ?? planId,
      pricePerMonth: Number(row.pricePerMonth ?? 0),
    };
  }

  private resolveCpf(raw?: string): string {
    const digits = digitsOnly(raw ?? '');
    if (digits.length === 11) {
      if (!isValidCpf(digits)) {
        throw new BadRequestException('CPF do titular inválido.');
      }
      return digits;
    }
    if (digits.length === 14) {
      return digits;
    }
    const fallback = this.config.get<string>('ASAAS_CHECKOUT_DEFAULT_CPF')?.trim();
    const fbDigits = digitsOnly(fallback ?? '');
    if (fbDigits.length === 11 || fbDigits.length === 14) {
      return fbDigits;
    }
    const sandboxUrl = (this.config.get<string>('ASAAS_API_URL') ?? '').includes('sandbox');
    if (sandboxUrl || !this.config.get<string>('ASAAS_API_URL')) {
      return SANDBOX_DEFAULT_CPF;
    }
    throw new BadRequestException('Informe o CPF do titular para cobrança.');
  }

  private async waitForFirstPayment(subscriptionId: string) {
    const delays = [0, 800, 1500, 2500];
    let last: Awaited<ReturnType<AsaasClient['listSubscriptionPayments']>>[number] | null = null;
    for (const ms of delays) {
      if (ms > 0) {
        await sleep(ms);
      }
      const payments = await this.asaas.listSubscriptionPayments(subscriptionId, 3);
      last = payments[0] ?? null;
      if (!last) continue;
      const status = last.status;
      if (asaasPaymentSucceeded(status) || !asaasPaymentPending(status)) {
        return last;
      }
    }
    return last;
  }
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

function normalizeExpiryYear(year: string): string {
  const d = digitsOnly(year);
  if (d.length === 2) return `20${d}`;
  return d;
}

function isValidExpiry(month: string, year: string): boolean {
  const m = Number(month);
  const y = Number(year);
  if (!Number.isFinite(m) || m < 1 || m > 12) return false;
  if (!Number.isFinite(y) || y < 2000) return false;
  const now = new Date();
  const expires = new Date(y, m, 0, 23, 59, 59);
  return expires >= new Date(now.getFullYear(), now.getMonth(), 1);
}

export function resolveCheckoutMobilePhone(
  raw: string | undefined,
  config: ConfigService,
): string {
  const fromInput = normalizeMobilePhone(raw ?? '');
  if (isValidMobilePhone(fromInput)) {
    return fromInput;
  }
  const fromEnv = normalizeMobilePhone(config.get<string>('ASAAS_DEFAULT_CUSTOMER_PHONE') ?? '');
  if (isValidMobilePhone(fromEnv)) {
    return fromEnv;
  }
  throw new BadRequestException('Informe um celular válido com DDD (11 dígitos).');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
