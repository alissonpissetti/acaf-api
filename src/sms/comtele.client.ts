import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_BASE_URL = 'https://sms.comtele.com.br';

export type ComteleSendResult = {
  status: boolean;
  message?: string;
};

type ComteleApiPayload = {
  Success?: boolean;
  Message?: string;
  message?: string;
  hasError?: boolean;
  errors?: unknown;
  Object?: unknown;
  object?: unknown;
};

@Injectable()
export class ComteleClient {
  private readonly authKey: string | null;
  private readonly baseUrl: string;
  private readonly defaultSender: string;

  constructor(private readonly config: ConfigService) {
    this.authKey = this.config.get<string>('COMTELE_AUTH_KEY')?.trim() || null;
    const raw =
      this.config.get<string>('COMTELE_URL')?.trim() ||
      this.config.get<string>('COMTELE_API_BASE_URL')?.trim() ||
      DEFAULT_BASE_URL;
    this.baseUrl = raw.replace(/\/$/, '').replace(/\/api\/v2$/i, '');
    this.defaultSender = this.config.get<string>('COMTELE_SENDER')?.trim() || 'Movly';
  }

  isConfigured(): boolean {
    return Boolean(this.authKey);
  }

  async send(
    message: string,
    destinations: string[],
    identifier?: string | null,
  ): Promise<ComteleSendResult> {
    if (!this.authKey) {
      return { status: false, message: 'COMTELE_AUTH_KEY não configurada.' };
    }
    if (!destinations.length) {
      return { status: false, message: 'Nenhum destinatário de SMS.' };
    }

    const payload = {
      Sender: identifier?.trim() || this.defaultSender,
      Content: message,
      Receivers: destinations.join(','),
    };

    try {
      const data = await this.post<ComteleApiPayload>('/api/v2/send', payload);
      return this.normalizeSendResponse(data);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      return { status: false, message: messageText };
    }
  }

  private normalizeSendResponse(data: ComteleApiPayload | null): ComteleSendResult {
    if (!data) {
      return { status: false, message: 'Resposta vazia da Comtele' };
    }
    if (typeof data.Success === 'boolean') {
      return { status: data.Success, message: data.Message ?? data.message };
    }
    if (typeof data.hasError === 'boolean') {
      const apiErrors = Array.isArray(data.errors) ? data.errors.map(String) : [];
      return {
        status: !data.hasError,
        message: data.message ?? data.Message ?? (apiErrors.length ? apiErrors.join('; ') : undefined),
      };
    }
    return { status: false, message: 'Resposta inválida da Comtele' };
  }

  private async post<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'auth-key': this.authKey ?? '',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const data = (await response.json().catch(() => null)) as T | null;
      if (!response.ok) {
        const detail =
          data && typeof data === 'object'
            ? String(
                (data as ComteleApiPayload).Message ??
                  (data as ComteleApiPayload).message ??
                  `HTTP ${response.status}`,
              )
            : `HTTP ${response.status}`;
        throw new Error(detail);
      }
      if (data == null) {
        throw new Error('Resposta vazia da Comtele');
      }
      return data;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
