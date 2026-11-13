import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccountPayable } from '../finance/account-payable.entity';
import { AccountPlan } from '../finance/account-plan.entity';
import { CostCenter } from '../finance/cost-center.entity';
import {
  CONNECT_PAYABLE_CATEGORY_GATEWAY_FEE,
  asaasPaymentToPayableFields,
  connectGatewayFeeAmount,
  connectPaymentCompensationDate,
  connectPaymentDueDate,
} from './connect-finance-receivable';
import type { AsaasPayment } from './asaas.types';

const CONNECT_FINANCE_CREATED_BY_FALLBACK = '00000000-0000-4000-8000-000000000001';
const ASAAS_COUNTERPART_NAME = 'Asaas Pagamentos';

export type UpsertConnectGatewayFeePayableInput = {
  payment: AsaasPayment;
  notes?: string | null;
};

@Injectable()
export class ConnectFinancePayableService {
  private readonly log = new Logger(ConnectFinancePayableService.name);

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(AccountPayable)
    private readonly payables: Repository<AccountPayable>,
    @InjectRepository(CostCenter)
    private readonly costCenters: Repository<CostCenter>,
    @InjectRepository(AccountPlan)
    private readonly accountPlans: Repository<AccountPlan>,
  ) {}

  async resolvePayableTargets(): Promise<{
    costCenterId: string;
    accountPlanId: string;
    supplierId: string | null;
    createdByUserId: string;
  } | null> {
    const costCenterId =
      this.config.get<string>('CONNECT_FINANCE_COST_CENTER_ID')?.trim() ||
      (await this.costCenters.findOne({ where: {}, order: { createdAt: 'ASC' } }))?.id;
    const accountPlanId =
      this.config.get<string>('CONNECT_FINANCE_PAYABLE_ACCOUNT_PLAN_ID')?.trim() ||
      this.config.get<string>('CONNECT_FINANCE_EXPENSE_ACCOUNT_PLAN_ID')?.trim() ||
      (
        await this.accountPlans.findOne({
          where: { kind: 'expense', active: true },
          order: { createdAt: 'ASC' },
        })
      )?.id;

    if (!costCenterId || !accountPlanId) {
      return null;
    }

    const supplierId = this.config.get<string>('CONNECT_FINANCE_ASAAS_SUPPLIER_ID')?.trim() || null;
    const createdByUserId =
      this.config.get<string>('CONNECT_FINANCE_CREATED_BY_USER_ID')?.trim() ||
      CONNECT_FINANCE_CREATED_BY_FALLBACK;

    return { costCenterId, accountPlanId, supplierId, createdByUserId };
  }

  async upsertGatewayFeeFromAsaasPayment(input: UpsertConnectGatewayFeePayableInput): Promise<string | null> {
    const paymentId = input.payment.id?.trim();
    if (!paymentId) return null;

    const fee = connectGatewayFeeAmount(input.payment);
    if (fee == null || fee < 0.01) {
      return null;
    }

    const ctx = await this.resolvePayableTargets();
    if (!ctx) {
      this.log.warn(`Connect sem conta a pagar de taxa (centro/plano ausente). Pagamento=${paymentId}`);
      return null;
    }

    const { status, settledAt, expectedSettledAt } = asaasPaymentToPayableFields(input.payment);
    const compensationDate = connectPaymentCompensationDate(input.payment);
    const dueDate = compensationDate ?? connectPaymentDueDate(input.payment);
    const amount = fee.toFixed(2);

    const existing = await this.payables.findOne({ where: { asaasPaymentId: paymentId } });
    if (existing) {
      existing.status = status;
      existing.settledAt = settledAt;
      existing.expectedSettledAt = expectedSettledAt;
      existing.dueDate = dueDate;
      existing.amount = amount;
      await this.payables.save(existing);
      return existing.id;
    }

    try {
      const saved = await this.payables.save(
        this.payables.create({
          description: `Taxa gateway Asaas — cobrança ${paymentId}`,
          amount,
          dueDate,
          settledAt,
          expectedSettledAt,
          recurrenceGroupId: null,
          recurrenceIndex: null,
          recurrenceTotal: null,
          status,
          costCenterId: ctx.costCenterId,
          counterpartName: ASAAS_COUNTERPART_NAME,
          supplierId: ctx.supplierId,
          supplierPixKeyId: null,
          accountPlanId: ctx.accountPlanId,
          category: CONNECT_PAYABLE_CATEGORY_GATEWAY_FEE,
          notes: input.notes?.trim() || `Taxa Asaas vinculada ao pagamento ${paymentId}.`,
          attachments: [],
          createdByUserId: ctx.createdByUserId,
          asaasPaymentId: paymentId,
          reimbursementSourcePayableId: null,
          reimbursementPayableId: null,
        }),
      );
      return saved.id;
    } catch (error) {
      const retry = await this.payables.findOne({ where: { asaasPaymentId: paymentId } });
      if (retry) {
        retry.status = status;
        retry.settledAt = settledAt;
        retry.expectedSettledAt = expectedSettledAt;
        await this.payables.save(retry);
        return retry.id;
      }
      this.log.error(
        `Falha ao criar conta a pagar de taxa (Asaas ${paymentId}): ${error instanceof Error ? error.message : error}`,
      );
      return null;
    }
  }
}
