import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { CashEntryStatus } from '../finance/cash-entry.types';
import { AccountReceivable } from '../finance/account-receivable.entity';
import { TransactionService } from '../finance/transaction.service';
import { connectFallbackMemberEmail, isPlatformUserUuid } from './connect-checkout-identity';
import {
  CONNECT_RECEIVABLE_CATEGORY_DOWNGRADE,
  CONNECT_RECEIVABLE_CATEGORY_SUBSCRIPTION,
  CONNECT_RECEIVABLE_CATEGORY_UPGRADE,
  type ConnectReceivableCategory,
} from './connect-finance-receivable';
import { ConnectFinanceReceivableService } from './connect-finance-receivable.service';
import { AsaasClient } from './asaas.client';
import type { AsaasPayment } from './asaas.types';
import { loadStore } from '../partner/store';
import { User, UserRole } from '../users/user.entity';
import {
  isValidCpf,
  isValidMobilePhone,
  normalizeCpf,
  normalizeMobilePhone,
} from '../users/person.utils';
import { pickAvatarColor } from '../users/avatar-colors';

export type ConnectTransactionBackfillSummary = {
  processed: number;
  relinkedReceivables: number;
  transactionsLinked: number;
  transactionsCreated: number;
  skipped: number;
  errors: Array<{ receivableId: string; reason: string }>;
};

export type ConnectTransactionBackfillOptions = {
  limit?: number;
  fetchFromAsaas?: boolean;
};

const CONNECT_CATEGORIES = [
  CONNECT_RECEIVABLE_CATEGORY_SUBSCRIPTION,
  CONNECT_RECEIVABLE_CATEGORY_UPGRADE,
  CONNECT_RECEIVABLE_CATEGORY_DOWNGRADE,
] as const;

function parseConnectCategory(raw: string | null | undefined): ConnectReceivableCategory {
  const category = raw?.trim();
  if (
    category === CONNECT_RECEIVABLE_CATEGORY_SUBSCRIPTION ||
    category === CONNECT_RECEIVABLE_CATEGORY_UPGRADE ||
    category === CONNECT_RECEIVABLE_CATEGORY_DOWNGRADE
  ) {
    return category;
  }
  return CONNECT_RECEIVABLE_CATEGORY_SUBSCRIPTION;
}

function receivableStatusToAsaasStatus(status: CashEntryStatus): string {
  switch (status) {
    case CashEntryStatus.SETTLED:
      return 'RECEIVED';
    case CashEntryStatus.OVERDUE:
      return 'OVERDUE';
    case CashEntryStatus.CANCELLED:
      return 'REFUNDED';
    default:
      return 'PENDING';
  }
}

function paymentFromReceivable(row: AccountReceivable): AsaasPayment {
  return {
    id: row.asaasPaymentId!.trim(),
    status: receivableStatusToAsaasStatus(row.status),
    subscription: row.asaasSubscriptionId?.trim() || undefined,
    value: Number(row.amount),
    dueDate: row.dueDate,
    paymentDate: row.settledAt ? row.settledAt.toISOString().slice(0, 10) : undefined,
    creditDate: row.expectedSettledAt ?? undefined,
    estimatedCreditDate: row.expectedSettledAt ?? undefined,
  };
}

@Injectable()
export class ConnectTransactionBackfillService {
  private readonly log = new Logger(ConnectTransactionBackfillService.name);

  constructor(
    @InjectRepository(AccountReceivable)
    private readonly receivables: Repository<AccountReceivable>,
    @InjectRepository(User)
    private readonly platformUsers: Repository<User>,
    private readonly receivableFinance: ConnectFinanceReceivableService,
    private readonly transactionService: TransactionService,
    private readonly asaas: AsaasClient,
  ) {}

  async run(options?: ConnectTransactionBackfillOptions): Promise<ConnectTransactionBackfillSummary> {
    const summary: ConnectTransactionBackfillSummary = {
      processed: 0,
      relinkedReceivables: 0,
      transactionsLinked: 0,
      transactionsCreated: 0,
      skipped: 0,
      errors: [],
    };

    summary.relinkedReceivables += await this.relinkFromConnectMembers();

    const rows = await this.listConnectReceivables(options?.limit);
    const useAsaas = options?.fetchFromAsaas !== false && this.asaas.isConfigured();

    for (const row of rows) {
      summary.processed += 1;
      const hadTransaction = Boolean(row.transactionId?.trim());

      try {
        const userId = await this.resolvePlatformUserId(row);
        if (!userId) {
          summary.skipped += 1;
          summary.errors.push({
            receivableId: row.id,
            reason: 'Usuário da plataforma não resolvido (sem platformUserId / assinante).',
          });
          continue;
        }

        const holderKey = row.connectHolderKey?.trim().toLowerCase() ?? '';
        if (holderKey) {
          const user = await this.findUserById(userId);
          if (user) {
            summary.relinkedReceivables += await this.receivableFinance.relinkConnectReceivablesToUser(
              holderKey,
              userId,
              user.name,
            );
          }
        }

        const paymentId = row.asaasPaymentId?.trim();
        if (paymentId) {
          const payment = await this.resolvePayment(row, useAsaas);
          if (!payment) {
            summary.skipped += 1;
            summary.errors.push({
              receivableId: row.id,
              reason: 'Não foi possível montar/recuperar pagamento Asaas.',
            });
            continue;
          }

          const transactionId = await this.transactionService.syncFromConnectPayment({
            payment,
            receivableId: row.id,
            userId,
            holderKey,
            category: parseConnectCategory(row.category),
            description: row.description,
            webhookEvent: 'BACKFILL',
          });

          if (transactionId) {
            summary.transactionsLinked += 1;
            if (!hadTransaction) summary.transactionsCreated += 1;
          } else {
            summary.skipped += 1;
          }
          continue;
        }

        if (row.category?.trim() === CONNECT_RECEIVABLE_CATEGORY_DOWNGRADE) {
          const transactionId = await this.transactionService.syncFromConnectDowngrade({
            receivableId: row.id,
            userId,
            holderKey,
            amount: row.amount,
            description: row.description,
          });
          if (transactionId) {
            summary.transactionsLinked += 1;
            if (!hadTransaction) summary.transactionsCreated += 1;
          } else {
            summary.skipped += 1;
          }
          continue;
        }

        summary.skipped += 1;
        summary.errors.push({
          receivableId: row.id,
          reason: 'Recebível da assinatura sem asaas_payment_id e sem categoria de downgrade.',
        });
      } catch (error) {
        summary.skipped += 1;
        const message = error instanceof Error ? error.message : String(error);
        summary.errors.push({ receivableId: row.id, reason: message });
        this.log.error(`Backfill falhou para recebível ${row.id}: ${message}`);
      }
    }

    this.log.log(
      `Backfill transações da assinatura: processados=${summary.processed} relink=${summary.relinkedReceivables} transações=${summary.transactionsLinked} novas=${summary.transactionsCreated} ignorados=${summary.skipped} erros=${summary.errors.length}`,
    );

    return summary;
  }

  private async listConnectReceivables(limit?: number): Promise<AccountReceivable[]> {
    const qb = this.receivables
      .createQueryBuilder('r')
      .where(
        new Brackets((w) => {
          w.where('r.asaas_payment_id IS NOT NULL')
            .orWhere('r.connect_holder_key IS NOT NULL')
            .orWhere('r.category IN (:...categories)', { categories: [...CONNECT_CATEGORIES] });
        }),
      )
      .orderBy('r.created_at', 'ASC');

    if (limit != null && limit > 0) {
      qb.take(limit);
    }

    return qb.getMany();
  }

  private async relinkFromConnectMembers(): Promise<number> {
    const store = loadStore();
    let updated = 0;

    for (const member of store.connectMembers ?? []) {
      const userId = member.userId?.trim();
      const holderKey = member.holderKey?.trim().toLowerCase();
      if (!holderKey || !userId || !isPlatformUserUuid(userId)) continue;

      const user = await this.findUserById(userId);
      if (!user) continue;

      updated += await this.receivableFinance.relinkConnectReceivablesToUser(holderKey, userId, user.name);
    }

    return updated;
  }

  private async resolvePlatformUserId(row: AccountReceivable): Promise<string | null> {
    const fromRow = row.platformUserId?.trim();
    if (fromRow && isPlatformUserUuid(fromRow)) {
      const user = await this.findUserById(fromRow);
      if (user) return fromRow;
    }

    if (row.payerKind === 'client') {
      const payerId = row.payerRefId?.trim();
      if (payerId && isPlatformUserUuid(payerId)) {
        const user = await this.findUserById(payerId);
        if (user) return payerId;
      }
    }

    const holderKey = row.connectHolderKey?.trim().toLowerCase();
    if (!holderKey) return null;

    const member = loadStore().connectMembers?.find((m) => m.holderKey === holderKey);
    if (!member) return null;

    const existing = member.userId?.trim();
    if (existing && isPlatformUserUuid(existing)) {
      const user = await this.findUserById(existing);
      if (user) return existing;
    }

    const cpf = member.holderCpf?.trim();
    const mobilePhone = member.holderPhone?.trim();
    const email = member.holderEmail?.trim() || connectFallbackMemberEmail(member.holderName);
    if (!cpf && !mobilePhone && !email) return null;

    try {
      return await this.ensureConnectMemberUser({
        name: member.holderName,
        email,
        cpf: cpf || undefined,
        mobilePhone: mobilePhone || undefined,
      });
    } catch (error) {
      this.log.warn(
        `Backfill: não foi possível garantir usuário para titular ${member.holderName}: ${error instanceof Error ? error.message : error}`,
      );
      return null;
    }
  }

  private async findUserById(id: string): Promise<User | null> {
    return this.platformUsers.findOne({ where: { id } });
  }

  private async ensureConnectMemberUser(input: {
    name: string;
    email?: string;
    cpf?: string;
    mobilePhone?: string;
  }): Promise<string> {
    const name = input.name.trim();
    const cpf = input.cpf ? normalizeCpf(input.cpf) : undefined;
    const phone = input.mobilePhone ? normalizeMobilePhone(input.mobilePhone) : undefined;
    const email = input.email?.trim().toLowerCase();

    let user: User | null = null;
    if (cpf && isValidCpf(cpf)) {
      user = await this.platformUsers.findOne({ where: { cpf } });
    }
    if (!user && phone && isValidMobilePhone(phone)) {
      user = await this.platformUsers.findOne({ where: { mobilePhone: phone } });
    }
    if (!user && email) {
      user = await this.platformUsers.findOne({ where: { email } });
    }

    if (!user) {
      const resolvedEmail = email || connectFallbackMemberEmail(name);
      const saved = await this.platformUsers.save(
        this.platformUsers.create({
          name,
          email: resolvedEmail,
          cpf: cpf && isValidCpf(cpf) ? cpf : null,
          mobilePhone: phone ?? null,
          passwordHash: null,
          roles: [UserRole.MEMBER],
          active: true,
          avatarColor: pickAvatarColor(resolvedEmail),
        }),
      );
      return saved.id;
    }

    const roles = Array.isArray(user.roles) ? user.roles : [];
    if (!roles.includes(UserRole.MEMBER)) {
      user.roles = [...roles, UserRole.MEMBER];
    }
    if (!user.active) user.active = true;
    user.name = name;
    if (cpf && isValidCpf(cpf) && !user.cpf) user.cpf = cpf;
    if (phone && !user.mobilePhone) user.mobilePhone = phone;
    await this.platformUsers.save(user);
    return user.id;
  }

  private async resolvePayment(row: AccountReceivable, useAsaas: boolean): Promise<AsaasPayment | null> {
    const paymentId = row.asaasPaymentId?.trim();
    if (!paymentId) return null;

    if (useAsaas) {
      try {
        return await this.asaas.getPayment(paymentId);
      } catch (error) {
        this.log.warn(
          `Backfill: Asaas indisponível para ${paymentId}, usando snapshot local. ${error instanceof Error ? error.message : error}`,
        );
      }
    }

    return paymentFromReceivable(row);
  }
}
