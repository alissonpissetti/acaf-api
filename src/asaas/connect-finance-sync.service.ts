import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { normalizeHolderKey } from '../partner/checkIn';
import { findConnectMember } from '../partner/connectMember';
import { loadStore, updateStore } from '../partner/store';
import type { ConnectMemberRecord } from '../partner/types';
import type { AsaasPayment } from './asaas.types';
import {
  ConnectFinanceReceivableService,
  type UpsertConnectPaymentReceivableInput,
} from './connect-finance-receivable.service';
import { ConnectFinancePayableService } from './connect-finance-payable.service';
import {
  CONNECT_RECEIVABLE_CATEGORY_SUBSCRIPTION,
  connectGatewayFeeAmount,
  type ConnectReceivableCategory,
} from './connect-finance-receivable';
import { bindConnectPaymentUserFromMember, findConnectMemberForPayment } from './connect-payment-user-binding';
import { connectFallbackMemberEmail, isPlatformUserUuid } from './connect-checkout-identity';
import { UsersService } from '../users/users.service';
import { TransactionService } from '../finance/transaction.service';

export type ConnectFinanceSyncResult = {
  receivableId: string | null;
  payableId: string | null;
  transactionId: string | null;
};

@Injectable()
export class ConnectFinanceSyncService {
  private readonly log = new Logger(ConnectFinanceSyncService.name);

  constructor(
    private readonly receivableService: ConnectFinanceReceivableService,
    private readonly payableService: ConnectFinancePayableService,
    @Inject(forwardRef(() => UsersService))
    private readonly usersService: UsersService,
    @Inject(forwardRef(() => TransactionService))
    private readonly transactionService: TransactionService,
  ) {}

  async syncAsaasPayment(input: UpsertConnectPaymentReceivableInput): Promise<ConnectFinanceSyncResult> {
    const enriched = await this.enrichForFinanceSync(input);
    if (!enriched) {
      return { receivableId: null, payableId: null, transactionId: null };
    }

    const receivableId = await this.receivableService.upsertFromAsaasPayment(enriched);
    const payableId = await this.payableService.upsertGatewayFeeFromAsaasPayment({
      payment: enriched.payment,
      notes: enriched.notes,
    });

    let transactionId: string | null = null;
    if (receivableId && enriched.platformUserId && isPlatformUserUuid(enriched.platformUserId)) {
      const user = await this.usersService.findById(enriched.platformUserId);
      if (user) {
        await this.receivableService.relinkConnectReceivablesToUser(
          enriched.holderKey,
          enriched.platformUserId,
          user.name,
        );
      }
      transactionId = await this.transactionService.syncFromConnectPayment({
        payment: enriched.payment,
        receivableId,
        userId: enriched.platformUserId,
        holderKey: enriched.holderKey,
        category: enriched.category,
        description: enriched.description,
        webhookEvent: enriched.webhookEvent,
      });
    }

    this.persistMemberFinanceMetadata(enriched);

    return { receivableId, payableId, transactionId };
  }

  private async enrichForFinanceSync(
    input: UpsertConnectPaymentReceivableInput,
  ): Promise<UpsertConnectPaymentReceivableInput | null> {
    const store = loadStore();
    const holderKey = input.holderKey.trim().toLowerCase();
    const member =
      findConnectMember(store, input.holderName) ??
      findConnectMemberForPayment(store.connectMembers, input.holderName, holderKey);

    const binding = bindConnectPaymentUserFromMember(input.holderName, holderKey, member);

    let platformUserId =
      input.platformUserId?.trim() && isPlatformUserUuid(input.platformUserId)
        ? input.platformUserId.trim()
        : binding.platformUserId;

    if (!platformUserId && member) {
      const ensured = await this.ensureMemberPlatformUser(member);
      platformUserId = ensured?.userId ?? null;
    }

    const cpf = input.cpf ?? binding.cpf;
    const mobilePhone = input.mobilePhone ?? binding.mobilePhone;

    if ((cpf || mobilePhone) && !platformUserId) {
      this.log.error(
        `Assinatura: finance sync bloqueado — CPF/celular sem userId resolvido (titular=${binding.holderName}, payment=${input.payment.id ?? '?'})`,
      );
      return null;
    }

    if (member && !member.userId && platformUserId) {
      this.persistMemberUserId(member.holderKey, platformUserId);
    }

    if (member && !platformUserId && !cpf && !mobilePhone) {
      this.log.warn(
        `Assinatura: membro sem userId/CPF/celular — payer pode cair em holderKey (titular=${member.holderName})`,
      );
    }

    return {
      ...input,
      holderName: binding.holderName,
      holderKey: binding.holderKey,
      companyName: input.companyName?.trim() || binding.companyName,
      platformUserId,
      cpf,
      mobilePhone,
    };
  }

  private async ensureMemberPlatformUser(
    member: ConnectMemberRecord,
  ): Promise<{ userId: string; userName: string } | null> {
    const existing = member.userId?.trim();
    if (existing && isPlatformUserUuid(existing)) {
      const user = await this.usersService.findById(existing);
      if (user) return { userId: existing, userName: user.name };
    }

    const cpf = member.holderCpf?.trim();
    const mobilePhone = member.holderPhone?.trim();
    const email = member.holderEmail?.trim() || connectFallbackMemberEmail(member.holderName);
    if (!cpf && !mobilePhone && !email) return null;

    try {
      const userId = await this.usersService.ensureConnectMemberUser({
        name: member.holderName,
        email,
        cpf: cpf || undefined,
        mobilePhone: mobilePhone || undefined,
      });
      this.persistMemberUserId(member.holderKey, userId);
      const user = await this.usersService.findById(userId);
      return user ? { userId, userName: user.name } : { userId, userName: member.holderName };
    } catch (error) {
      this.log.error(
        `Assinatura: falha ao garantir usuário do titular ${member.holderName}: ${error instanceof Error ? error.message : error}`,
      );
      return null;
    }
  }

  private persistMemberUserId(holderKey: string, userId: string): void {
    const key = holderKey.trim().toLowerCase();
    try {
      updateStore((s) => {
        const idx = s.connectMembers?.findIndex((m) => m.holderKey === key) ?? -1;
        if (idx < 0 || !s.connectMembers) return;
        s.connectMembers[idx] = { ...s.connectMembers[idx], userId };
      });
    } catch (error) {
      this.log.warn(
        `Não foi possível gravar userId no assinante (${key}): ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  async createDowngradeReceivable(
    input: Parameters<ConnectFinanceReceivableService['createDowngradeReceivable']>[0],
  ): Promise<string | null> {
    const receivableId = await this.receivableService.createDowngradeReceivable(input);
    if (receivableId && input.platformUserId && isPlatformUserUuid(input.platformUserId)) {
      await this.transactionService.syncFromConnectDowngrade({
        receivableId,
        userId: input.platformUserId,
        holderKey: input.holderKey,
        amount: input.amount.toFixed(2),
        description: input.description,
      });
    }
    return receivableId;
  }

  async syncSubscriptionPayments(input: {
    subscriptionId: string;
    holderName: string;
    holderKey: string;
    planName: string;
    category?: ConnectReceivableCategory;
    listPayments: (subscriptionId: string, limit: number) => Promise<AsaasPayment[]>;
    limit?: number;
  }): Promise<void> {
    const subscriptionId = input.subscriptionId.trim();
    if (!subscriptionId) return;

    const category = input.category ?? CONNECT_RECEIVABLE_CATEGORY_SUBSCRIPTION;
    const payments = await input.listPayments(subscriptionId, input.limit ?? 24);
    for (const payment of payments) {
      await this.syncAsaasPayment({
        payment,
        holderName: input.holderName,
        holderKey: input.holderKey,
        category,
        description: `Movly — ${input.planName} — ${input.holderName}`,
        notes: `Cobrança recorrente Asaas (${payment.id}).`,
      });
    }
  }

  private persistMemberFinanceMetadata(input: UpsertConnectPaymentReceivableInput): void {
    const paymentId = input.payment.id?.trim();
    if (!paymentId) return;

    const store = loadStore();
    const member =
      findConnectMember(store, input.holderName) ??
      store.connectMembers?.find((m) => m.holderKey === input.holderKey.trim().toLowerCase());

    if (!member) return;

    const gross = Number(input.payment.value ?? 0);
    const net =
      input.payment.netValue != null && Number.isFinite(Number(input.payment.netValue))
        ? Number(input.payment.netValue)
        : null;
    const fee = connectGatewayFeeAmount(input.payment);
    const estimatedCredit = input.payment.estimatedCreditDate?.trim() || null;

    try {
      updateStore((s) => {
        const idx = s.connectMembers?.findIndex((m) => m.holderKey === member.holderKey) ?? -1;
        if (idx < 0 || !s.connectMembers) return;
        const row = s.connectMembers[idx];
        row.financePartnerUnitId = row.primaryUnitId ?? row.financePartnerUnitId ?? null;
        row.financeAdvanceEligible = Boolean(row.primaryUnitId);
        row.lastSyncedAsaasPaymentId = paymentId;
        row.lastSyncedAsaasPaymentAt = new Date().toISOString();
        row.financePartnerShare = {
          grossValue: gross,
          netValue: net,
          gatewayFee: fee,
          estimatedCreditDate: estimatedCredit,
          asaasPaymentId: paymentId,
          holderKey: normalizeHolderKey(input.holderName),
        };
      });
    } catch (error) {
      this.log.warn(
        `Não foi possível gravar metadados financeiros do titular ${input.holderName}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
}
