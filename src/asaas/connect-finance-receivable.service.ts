import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Company } from '../corporate/company.entity';
import { AccountPlan } from '../finance/account-plan.entity';
import { AccountReceivable } from '../finance/account-receivable.entity';
import { CostCenter } from '../finance/cost-center.entity';
import { User } from '../users/user.entity';
import {
  ConnectPayerUnresolvedError,
  connectReceivablePlatformUserId,
  resolveConnectReceivablePayer,
} from './connect-finance-payer';
import {
  CONNECT_RECEIVABLE_CATEGORY_DOWNGRADE,
  asaasPaymentToReceivableFields,
  connectPaymentDueDate,
  connectPaymentReceivableAmount,
  type ConnectReceivableCategory,
} from './connect-finance-receivable';
import { CashEntryStatus } from '../finance/cash-entry.types';
import type { AsaasPayment } from './asaas.types';

const CONNECT_FINANCE_CREATED_BY_FALLBACK = '00000000-0000-4000-8000-000000000001';

export type ConnectFinanceTargets = {
  costCenterId: string;
  accountPlanId: string;
  createdByUserId: string;
};

export type UpsertConnectPaymentReceivableInput = {
  payment: AsaasPayment;
  holderName: string;
  holderKey: string;
  companyName?: string | null;
  platformUserId?: string | null;
  cpf?: string | null;
  mobilePhone?: string | null;
  category: ConnectReceivableCategory;
  description: string;
  notes?: string | null;
  webhookEvent?: string | null;
};

export type CreateConnectDowngradeReceivableInput = {
  holderName: string;
  holderKey: string;
  amount: number;
  description: string;
  notes: string;
  platformUserId?: string | null;
  cpf?: string | null;
  mobilePhone?: string | null;
  companyName?: string | null;
};

@Injectable()
export class ConnectFinanceReceivableService {
  private readonly log = new Logger(ConnectFinanceReceivableService.name);

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(AccountReceivable)
    private readonly receivables: Repository<AccountReceivable>,
    @InjectRepository(CostCenter)
    private readonly costCenters: Repository<CostCenter>,
    @InjectRepository(AccountPlan)
    private readonly accountPlans: Repository<AccountPlan>,
    @InjectRepository(User)
    private readonly platformUsers: Repository<User>,
    @InjectRepository(Company)
    private readonly companies: Repository<Company>,
  ) {}

  useNetReceivableAmount(): boolean {
    const raw = this.config.get<string>('CONNECT_FINANCE_RECEIVABLE_USE_NET')?.trim().toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes';
  }

  async resolveFinanceTargets(): Promise<ConnectFinanceTargets | null> {
    const costCenterId =
      this.config.get<string>('CONNECT_FINANCE_COST_CENTER_ID')?.trim() ||
      (await this.costCenters.findOne({ where: {}, order: { createdAt: 'ASC' } }))?.id;
    const accountPlanId =
      this.config.get<string>('CONNECT_FINANCE_ACCOUNT_PLAN_ID')?.trim() ||
      (
        await this.accountPlans.findOne({
          where: { kind: 'revenue', active: true },
          order: { createdAt: 'ASC' },
        })
      )?.id;

    if (!costCenterId || !accountPlanId) {
      return null;
    }

    const createdByUserId =
      this.config.get<string>('CONNECT_FINANCE_CREATED_BY_USER_ID')?.trim() ||
      CONNECT_FINANCE_CREATED_BY_FALLBACK;

    return { costCenterId, accountPlanId, createdByUserId };
  }

  async upsertFromAsaasPayment(input: UpsertConnectPaymentReceivableInput): Promise<string | null> {
    const paymentId = input.payment.id?.trim();
    if (!paymentId) return null;

    const ctx = await this.resolveFinanceTargets();
    if (!ctx) {
      this.log.warn(
        `Assinatura sem conta a receber (centro/plano ausente). Pagamento=${paymentId} titular=${input.holderName}`,
      );
      return null;
    }

    const { status, settledAt, expectedSettledAt } = asaasPaymentToReceivableFields(input.payment);
    const dueDate = connectPaymentDueDate(input.payment);
    let payer;
    try {
      payer = await resolveConnectReceivablePayer(this.platformUsers, this.companies, {
        holderName: input.holderName,
        holderKey: input.holderKey,
        companyName: input.companyName,
        platformUserId: input.platformUserId,
        cpf: input.cpf,
        mobilePhone: input.mobilePhone,
      });
    } catch (error) {
      if (error instanceof ConnectPayerUnresolvedError) {
        this.log.error(
          `Assinatura: sync financeiro ignorado — pagador não resolvido. Pagamento=${paymentId} ${error.message}`,
        );
        return null;
      }
      throw error;
    }
    const platformUserId = connectReceivablePlatformUserId(payer);
    const connectHolderKey = input.holderKey.trim().toLowerCase();

    const patchFromPayment = (row: AccountReceivable) => {
      row.status = status;
      row.settledAt = settledAt;
      row.expectedSettledAt = expectedSettledAt;
      row.dueDate = dueDate;
      row.amount = connectPaymentReceivableAmount(input.payment, this.useNetReceivableAmount());
      row.counterpartName = payer.name;
      row.payerKind = payer.kind;
      row.payerRefId = payer.refId;
      row.platformUserId = platformUserId;
      row.connectHolderKey = connectHolderKey;
      if (input.payment.subscription?.trim()) {
        row.asaasSubscriptionId = input.payment.subscription.trim();
      }
    };

    const existing = await this.receivables.findOne({ where: { asaasPaymentId: paymentId } });
    if (existing) {
      patchFromPayment(existing);
      await this.receivables.save(existing);
      return existing.id;
    }

    try {
      const saved = await this.receivables.save(
        this.receivables.create({
          description: input.description,
          amount: connectPaymentReceivableAmount(input.payment, this.useNetReceivableAmount()),
          dueDate,
          settledAt,
          expectedSettledAt,
          recurrenceGroupId: null,
          recurrenceIndex: null,
          recurrenceTotal: null,
          status,
          costCenterId: ctx.costCenterId,
          counterpartName: payer.name,
          payerKind: payer.kind,
          payerRefId: payer.refId,
          platformUserId,
          connectHolderKey,
          accountPlanId: ctx.accountPlanId,
          category: input.category,
          notes: input.notes?.trim() || null,
          attachments: [],
          createdByUserId: ctx.createdByUserId,
          asaasPaymentId: paymentId,
          asaasSubscriptionId: input.payment.subscription?.trim() || null,
        }),
      );
      return saved.id;
    } catch (error) {
      const retry = await this.receivables.findOne({ where: { asaasPaymentId: paymentId } });
      if (retry) {
        patchFromPayment(retry);
        await this.receivables.save(retry);
        return retry.id;
      }
      this.log.error(
        `Falha ao criar conta a receber da assinatura (Asaas ${paymentId}): ${error instanceof Error ? error.message : error}`,
      );
      return null;
    }
  }

  /** Reaplica pagador cliente quando o titular da assinatura passa a ter userId na plataforma. */
  async relinkConnectReceivablesToUser(
    holderKey: string,
    userId: string,
    userName: string,
  ): Promise<number> {
    const key = holderKey.trim().toLowerCase();
    if (!key || !userId.trim()) return 0;

    const rows = await this.receivables.find({ where: { connectHolderKey: key } });
    let updated = 0;
    for (const row of rows) {
      if (
        row.payerKind === 'client' &&
        row.payerRefId === userId &&
        row.platformUserId === userId
      ) {
        continue;
      }
      row.payerKind = 'client';
      row.payerRefId = userId;
      row.platformUserId = userId;
      row.counterpartName = userName;
      await this.receivables.save(row);
      updated += 1;
    }
    return updated;
  }

  async createDowngradeReceivable(input: CreateConnectDowngradeReceivableInput): Promise<string | null> {
    if (!(input.amount >= 0.01)) return null;

    const ctx = await this.resolveFinanceTargets();
    if (!ctx) {
      this.log.warn(
        `Downgrade sem conta a receber no financeiro (centro/plano ausente). Titular=${input.holderName} valor=${input.amount}`,
      );
      return null;
    }

    const dueDate = new Date().toISOString().slice(0, 10);
    const connectHolderKey = input.holderKey.trim().toLowerCase();

    let payer;
    try {
      payer = await resolveConnectReceivablePayer(this.platformUsers, this.companies, {
        holderName: input.holderName,
        holderKey: input.holderKey,
        companyName: input.companyName,
        platformUserId: input.platformUserId,
        cpf: input.cpf,
        mobilePhone: input.mobilePhone,
      });
    } catch (error) {
      if (error instanceof ConnectPayerUnresolvedError) {
        this.log.error(`Downgrade de assinatura sem pagador vinculado: ${error.message}`);
        return null;
      }
      throw error;
    }
    const platformUserId = connectReceivablePlatformUserId(payer);

    try {
      const saved = await this.receivables.save(
        this.receivables.create({
          description: input.description,
          amount: input.amount.toFixed(2),
          dueDate,
          settledAt: null,
          expectedSettledAt: null,
          recurrenceGroupId: null,
          recurrenceIndex: null,
          recurrenceTotal: null,
          status: CashEntryStatus.PENDING,
          costCenterId: ctx.costCenterId,
          counterpartName: payer.name,
          payerKind: payer.kind,
          payerRefId: payer.refId,
          platformUserId,
          connectHolderKey,
          accountPlanId: ctx.accountPlanId,
          category: CONNECT_RECEIVABLE_CATEGORY_DOWNGRADE,
          notes: input.notes,
          attachments: [],
          createdByUserId: ctx.createdByUserId,
          asaasPaymentId: null,
          asaasSubscriptionId: null,
        }),
      );
      return saved.id;
    } catch (error) {
      this.log.error(
        `Falha ao criar conta a receber de downgrade: ${error instanceof Error ? error.message : error}`,
      );
      return null;
    }
  }
}
