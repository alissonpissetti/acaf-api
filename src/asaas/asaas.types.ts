export type AsaasCustomer = {
  id: string;
  name?: string;
  cpfCnpj?: string;
  externalReference?: string;
};

export type AsaasSubscription = {
  id: string;
  customer: string;
  status?: string;
  value?: number;
  cycle?: string;
  nextDueDate?: string;
  description?: string;
};

/** Rateio/split configurado no Asaas (cartão adiantado / parceiros). */
export type AsaasPaymentSplit = {
  id?: string;
  walletId?: string;
  fixedValue?: number;
  percentualValue?: number;
  totalValue?: number;
  status?: string;
};

/**
 * Campos relevantes do pagamento Asaas v3 (`GET /payments/:id`, webhooks).
 * @see https://docs.asaas.com/reference/recuperar-uma-unica-cobranca
 */
export type AsaasPayment = {
  id: string;
  status: string;
  subscription?: string;
  externalReference?: string;
  value?: number;
  /** Valor líquido após taxas do gateway. */
  netValue?: number;
  /** Taxa cobrada pelo Asaas na cobrança. */
  fee?: number;
  billingType?: string;
  dueDate?: string;
  paymentDate?: string;
  /** Data prevista de crédito (cartão). */
  estimatedCreditDate?: string;
  /** Data efetiva de crédito na conta Asaas. */
  creditDate?: string;
  dateCreated?: string;
  split?: AsaasPaymentSplit[];
};

export type AsaasListResponse<T> = {
  object?: string;
  hasMore?: boolean;
  totalCount?: number;
  limit?: number;
  offset?: number;
  data?: T[];
};

export type AsaasErrorBody = {
  errors?: Array<{ code?: string; description?: string }>;
};
