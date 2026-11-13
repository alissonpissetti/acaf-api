/** Tipo de negócio da transação (evolução: vendas com parcelas, etc.). */
export type TransactionKind =
  | 'connect_subscription'
  | 'connect_plan_upgrade'
  | 'connect_plan_downgrade'
  | 'connect_one_off'
  | 'product_sale';

export enum TransactionStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export const TRANSACTION_GATEWAY_ASAAS = 'asaas';
