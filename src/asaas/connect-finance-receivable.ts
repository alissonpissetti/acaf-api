import { CashEntryStatus } from '../finance/cash-entry.types';
import type { AsaasPayment } from './asaas.types';
import { asaasPaymentPending, asaasPaymentSucceeded } from './asaas.client';

export const CONNECT_RECEIVABLE_CATEGORY_SUBSCRIPTION = 'connect_subscription';
export const CONNECT_RECEIVABLE_CATEGORY_UPGRADE = 'connect_plan_upgrade';
export const CONNECT_RECEIVABLE_CATEGORY_DOWNGRADE = 'connect_plan_downgrade';

export const CONNECT_PAYABLE_CATEGORY_GATEWAY_FEE = 'connect_gateway_fee';

export type ConnectReceivableCategory =
  | typeof CONNECT_RECEIVABLE_CATEGORY_SUBSCRIPTION
  | typeof CONNECT_RECEIVABLE_CATEGORY_UPGRADE
  | typeof CONNECT_RECEIVABLE_CATEGORY_DOWNGRADE;

export type AsaasReceivableStatusFields = {
  status: CashEntryStatus;
  settledAt: Date | null;
  expectedSettledAt: string | null;
};

/**
 * Regra de valor (conta a receber da plataforma):
 * - Padrão: bruto (`value`) — reflete a cobrança ao cliente; a taxa Asaas vira conta a pagar separada.
 * - `CONNECT_FINANCE_RECEIVABLE_USE_NET=true`: líquido (`netValue`) — somente se o financeiro não
 *   registrar a taxa do gateway em conta a pagar (não recomendado com sync de taxa ativo).
 */
export function connectPaymentReceivableAmount(
  payment: Pick<AsaasPayment, 'value' | 'netValue'>,
  useNetValue: boolean,
): string {
  const gross = Number(payment.value ?? 0);
  const net = payment.netValue != null ? Number(payment.netValue) : NaN;
  const amount = useNetValue && Number.isFinite(net) && net > 0 ? net : gross;
  if (!(amount > 0)) return '0.01';
  return amount.toFixed(2);
}

/** Taxa do gateway: campo `fee` ou derivada (bruto − líquido). */
export function connectGatewayFeeAmount(payment: Pick<AsaasPayment, 'value' | 'netValue' | 'fee'>): number | null {
  const fee = payment.fee != null ? Number(payment.fee) : NaN;
  if (Number.isFinite(fee) && fee >= 0.01) return fee;
  const gross = Number(payment.value ?? 0);
  const net = payment.netValue != null ? Number(payment.netValue) : NaN;
  if (Number.isFinite(gross) && Number.isFinite(net) && gross > net) {
    const derived = gross - net;
    if (derived >= 0.01) return Math.round(derived * 100) / 100;
  }
  return null;
}

/** Data de vencimento operacional da cobrança (campo `dueDate` do Asaas). */
export function connectPaymentDueDate(payment: Pick<AsaasPayment, 'dueDate'>): string {
  const raw = payment.dueDate?.trim();
  if (raw && isIsoDate(raw)) return raw;
  return new Date().toISOString().slice(0, 10);
}

/** Data de compensação / liquidação prevista ou efetiva no gateway. */
export function connectPaymentCompensationDate(
  payment: Pick<AsaasPayment, 'creditDate' | 'estimatedCreditDate' | 'paymentDate' | 'dueDate'>,
): string | null {
  const credit = payment.creditDate?.trim();
  if (credit && isIsoDate(credit)) return credit;
  const estimated = payment.estimatedCreditDate?.trim();
  if (estimated && isIsoDate(estimated)) return estimated;
  const paid = payment.paymentDate?.trim();
  if (paid && isIsoDate(paid)) return paid;
  return null;
}

export function connectPaymentExpectedSettlementDate(
  payment: Pick<AsaasPayment, 'creditDate' | 'estimatedCreditDate' | 'status'>,
): string | null {
  if (asaasPaymentLiquidated(payment.status)) {
    const credit = payment.creditDate?.trim();
    if (credit && isIsoDate(credit)) return credit;
    return null;
  }
  const estimated = payment.estimatedCreditDate?.trim();
  if (estimated && isIsoDate(estimated)) return estimated;
  return null;
}

function connectPaymentExecutionDate(
  payment: Pick<AsaasPayment, 'paymentDate' | 'dueDate' | 'dateCreated'>,
): string | null {
  const paid = payment.paymentDate?.trim();
  if (paid && isIsoDate(paid)) return paid;
  const due = payment.dueDate?.trim();
  if (due && isIsoDate(due)) return due;
  const created = payment.dateCreated?.trim();
  if (created && isIsoDate(created.slice(0, 10))) return created.slice(0, 10);
  return null;
}

/** Mapeia status Asaas → contas a receber (pendente / quitado / vencido / cancelado). */
export function asaasPaymentToReceivableFields(
  payment: Pick<AsaasPayment, 'status' | 'paymentDate' | 'creditDate' | 'estimatedCreditDate' | 'dueDate' | 'dateCreated'>,
): AsaasReceivableStatusFields {
  const statusRaw = (payment.status ?? '').toUpperCase();

  if (statusRaw === 'RECEIVED' || statusRaw === 'RECEIVED_IN_CASH') {
    const executionDate = connectPaymentExecutionDate(payment);
    const compensationDate = connectPaymentExpectedSettlementDate(payment);
    return {
      status: CashEntryStatus.SETTLED,
      settledAt: parsePaymentSettledAt(executionDate ?? payment.creditDate ?? payment.paymentDate),
      expectedSettledAt: compensationDate,
    };
  }

  if (asaasPaymentSucceeded(payment.status) && statusRaw === 'CONFIRMED') {
    const executionDate = connectPaymentExecutionDate(payment) ?? new Date().toISOString().slice(0, 10);
    return {
      status: CashEntryStatus.SETTLED,
      settledAt: parsePaymentSettledAt(executionDate),
      expectedSettledAt: connectPaymentExpectedSettlementDate(payment),
    };
  }

  if (asaasPaymentPending(payment.status)) {
    return {
      status: CashEntryStatus.PENDING,
      settledAt: null,
      expectedSettledAt: connectPaymentExpectedSettlementDate(payment),
    };
  }

  if (statusRaw === 'OVERDUE') {
    return {
      status: CashEntryStatus.OVERDUE,
      settledAt: null,
      expectedSettledAt: connectPaymentExpectedSettlementDate(payment),
    };
  }

  if (
    statusRaw === 'REFUNDED' ||
    statusRaw === 'REFUND_REQUESTED' ||
    statusRaw === 'CHARGEBACK' ||
    statusRaw === 'CHARGEBACK_DISPUTE' ||
    statusRaw === 'DUNNING_REQUESTED'
  ) {
    return { status: CashEntryStatus.CANCELLED, settledAt: null, expectedSettledAt: null };
  }

  return {
    status: CashEntryStatus.PENDING,
    settledAt: null,
    expectedSettledAt: connectPaymentExpectedSettlementDate(payment),
  };
}

/** Status em que o valor já foi creditado na conta Asaas. */
export function asaasPaymentLiquidated(status: string | undefined): boolean {
  const s = (status ?? '').toUpperCase();
  return s === 'RECEIVED' || s === 'RECEIVED_IN_CASH';
}

export function asaasPaymentToPayableFields(
  payment: Pick<AsaasPayment, 'status' | 'creditDate' | 'paymentDate' | 'estimatedCreditDate'>,
): AsaasReceivableStatusFields {
  return asaasPaymentToReceivableFields(payment);
}

function parsePaymentSettledAt(paymentDate?: string | null): Date {
  if (paymentDate && isIsoDate(paymentDate)) {
    return new Date(`${paymentDate}T12:00:00.000Z`);
  }
  return new Date();
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** @deprecated use connectPaymentReceivableAmount */
export function connectPaymentAmount(payment: Pick<AsaasPayment, 'value'>): string {
  return connectPaymentReceivableAmount(payment, false);
}
