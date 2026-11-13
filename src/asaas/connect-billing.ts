import type { AsaasPayment } from './asaas.types';
import { asaasPaymentPending, asaasPaymentSucceeded } from './asaas.client';

export type ConnectBillingStatementStatus = 'paid' | 'pending' | 'failed';

export type ConnectBillingStatementEntry = {
  id: string;
  occurredAt: string;
  description: string;
  amount: number;
  status: ConnectBillingStatementStatus;
  cardLastFour?: string;
  /** Previsão ou data efetiva de compensação (crédito). */
  compensationAt?: string | null;
};

export function asaasPaymentToBillingStatus(status: string | undefined): ConnectBillingStatementStatus {
  if (asaasPaymentSucceeded(status)) return 'paid';
  if (asaasPaymentPending(status)) return 'pending';
  return 'failed';
}

export function mapSubscriptionPaymentToStatementEntry(input: {
  payment: AsaasPayment;
  planName: string;
  cardLastFour?: string;
}): ConnectBillingStatementEntry {
  const { payment, planName, cardLastFour } = input;
  const occurredAt =
    payment.paymentDate?.trim() ||
    payment.dueDate?.trim() ||
    payment.dateCreated?.trim() ||
    new Date().toISOString();
  const amount = Number(payment.value ?? 0);
  const compensationRaw =
    payment.creditDate?.trim() || payment.estimatedCreditDate?.trim() || null;
  const compensationAt = compensationRaw
    ? compensationRaw.includes('T')
      ? compensationRaw
      : `${compensationRaw}T12:00:00.000Z`
    : null;
  return {
    id: payment.id,
    occurredAt: occurredAt.includes('T') ? occurredAt : `${occurredAt}T12:00:00.000Z`,
    description: `Mensalidade ${planName}`,
    amount: Number.isFinite(amount) ? amount : 0,
    status: asaasPaymentToBillingStatus(payment.status),
    cardLastFour,
    compensationAt,
  };
}
