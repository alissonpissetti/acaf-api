import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  AsaasCustomer,
  AsaasErrorBody,
  AsaasListResponse,
  AsaasPayment,
  AsaasSubscription,
} from './asaas.types';

const DEFAULT_TIMEOUT_MS = 25_000;
const DEFAULT_SANDBOX_URL = 'https://api-sandbox.asaas.com/v3';

export type AsaasCreditCardInput = {
  holderName: string;
  number: string;
  expiryMonth: string;
  expiryYear: string;
  ccv: string;
};

export type AsaasCreditCardHolderInfo = {
  name: string;
  email: string;
  cpfCnpj: string;
  postalCode: string;
  addressNumber: string;
  phone: string;
  mobilePhone?: string;
};

@Injectable()
export class AsaasClient {
  private readonly apiKey: string | null;
  private readonly baseUrl: string;

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('ASAAS_API_KEY')?.trim() || null;
    const raw =
      this.config.get<string>('ASAAS_API_URL')?.trim() ||
      this.config.get<string>('ASAAS_API_BASE_URL')?.trim() ||
      DEFAULT_SANDBOX_URL;
    this.baseUrl = raw.replace(/\/$/, '');
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async findCustomerByExternalReference(externalReference: string): Promise<AsaasCustomer | null> {
    const list = await this.get<AsaasListResponse<AsaasCustomer>>('/customers', {
      externalReference,
      limit: '1',
    });
    const row = list.data?.[0];
    return row?.id ? row : null;
  }

  async createCustomer(input: {
    name: string;
    cpfCnpj: string;
    email: string;
    phone?: string;
    externalReference: string;
  }): Promise<AsaasCustomer> {
    return this.post<AsaasCustomer>('/customers', {
      name: input.name,
      cpfCnpj: input.cpfCnpj,
      email: input.email,
      phone: input.phone,
      mobilePhone: input.phone,
      externalReference: input.externalReference,
      notificationDisabled: true,
    });
  }

  async updateCustomer(
    customerId: string,
    patch: { externalReference?: string; name?: string; email?: string },
  ): Promise<AsaasCustomer> {
    return this.put<AsaasCustomer>(`/customers/${encodeURIComponent(customerId)}`, patch);
  }

  async createCreditCardSubscription(input: {
    customerId: string;
    value: number;
    description: string;
    externalReference?: string;
    creditCard: AsaasCreditCardInput;
    creditCardHolderInfo: AsaasCreditCardHolderInfo;
  }): Promise<AsaasSubscription> {
    const nextDueDate = formatAsaasDate(new Date());
    return this.post<AsaasSubscription>('/subscriptions', {
      customer: input.customerId,
      billingType: 'CREDIT_CARD',
      cycle: 'MONTHLY',
      value: input.value,
      nextDueDate,
      description: input.description,
      externalReference: input.externalReference,
      creditCard: input.creditCard,
      creditCardHolderInfo: input.creditCardHolderInfo,
    });
  }

  async getSubscription(subscriptionId: string): Promise<AsaasSubscription> {
    return this.get<AsaasSubscription>(`/subscriptions/${encodeURIComponent(subscriptionId)}`);
  }

  async updateSubscription(
    subscriptionId: string,
    patch: { value?: number; description?: string; externalReference?: string },
  ): Promise<AsaasSubscription> {
    return this.put<AsaasSubscription>(`/subscriptions/${encodeURIComponent(subscriptionId)}`, patch);
  }

  async createCustomerCreditCardPayment(input: {
    customerId: string;
    value: number;
    description: string;
    externalReference?: string;
  }): Promise<AsaasPayment> {
    const dueDate = formatAsaasDate(new Date());
    return this.post<AsaasPayment>('/payments', {
      customer: input.customerId,
      billingType: 'CREDIT_CARD',
      value: input.value,
      dueDate,
      description: input.description,
      externalReference: input.externalReference,
    });
  }

  async listSubscriptionPayments(subscriptionId: string, limit = 5): Promise<AsaasPayment[]> {
    const list = await this.get<AsaasListResponse<AsaasPayment>>(
      `/subscriptions/${encodeURIComponent(subscriptionId)}/payments`,
      { limit: String(limit) },
    );
    return list.data ?? [];
  }

  async getPayment(paymentId: string): Promise<AsaasPayment> {
    return this.get<AsaasPayment>(`/payments/${encodeURIComponent(paymentId)}`);
  }

  private async get<T>(path: string, query?: Record<string, string>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v) url.searchParams.set(k, v);
      }
    }
    return this.request<T>('GET', url.toString());
  }

  private async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    return this.request<T>('POST', `${this.baseUrl}${path}`, body);
  }

  private async put<T>(path: string, body: Record<string, unknown>): Promise<T> {
    return this.request<T>('PUT', `${this.baseUrl}${path}`, body);
  }

  private async request<T>(method: string, url: string, body?: Record<string, unknown>): Promise<T> {
    if (!this.apiKey) {
      throw new Error('ASAAS_API_KEY não configurada.');
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    try {
      const headers: Record<string, string> = {
        accept: 'application/json',
        access_token: this.apiKey,
      };
      const init: RequestInit = { method, headers, signal: controller.signal };
      if (body != null) {
        headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
      }
      const response = await fetch(url, init);
      const data = (await response.json().catch(() => null)) as (T & AsaasErrorBody) | null;
      if (!response.ok) {
        throw new Error(this.messageFromAsaas(data, response.status));
      }
      if (data == null) {
        throw new Error('Resposta vazia do Asaas.');
      }
      return data;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Tempo esgotado ao comunicar com o Asaas.');
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private messageFromAsaas(data: AsaasErrorBody | null, status: number): string {
    const errors = data?.errors;
    if (Array.isArray(errors) && errors.length) {
      const parts = errors
        .map((e) => e.description?.trim() || e.code?.trim())
        .filter(Boolean) as string[];
      if (parts.length) return parts.join(' ');
    }
    return `Falha no gateway de pagamento (HTTP ${status}).`;
  }
}

function formatAsaasDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Estados que indicam cobrança autorizada ou recebida no cartão. */
export function asaasPaymentSucceeded(status: string | undefined): boolean {
  const s = (status ?? '').toUpperCase();
  return s === 'CONFIRMED' || s === 'RECEIVED' || s === 'RECEIVED_IN_CASH';
}

/** Pagamento ainda em processamento no cartão (sandbox pode demorar segundos). */
export function asaasPaymentPending(status: string | undefined): boolean {
  const s = (status ?? '').toUpperCase();
  return s === 'PENDING' || s === 'AUTHORIZED';
}

/** Resultado de cobrança da assinatura Movly exposto ao app (upgrade / checkout). */
export type ConnectPaymentOutcome = 'confirmed' | 'pending_payment' | 'failed';

/** CONFIRMED/RECEIVED quitam recebível; PENDING/AUTHORIZED aguardam; demais = falha. */
export function connectPaymentOutcomeFromAsaasStatus(
  status: string | undefined,
): ConnectPaymentOutcome {
  if (asaasPaymentSucceeded(status)) return 'confirmed';
  if (asaasPaymentPending(status)) return 'pending_payment';
  return 'failed';
}
