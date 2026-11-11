import { Injectable, Logger } from '@nestjs/common';
import { isValidMobilePhone, normalizeMobilePhone } from '../users/person.utils';
import { ComteleClient } from './comtele.client';

export type SendSmsResult = {
  sent: boolean;
  reason?: string;
};

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(private readonly comtele: ComteleClient) {}

  isConfigured(): boolean {
    return this.comtele.isConfigured();
  }

  async sendAdminAuthCode(input: {
    to: string;
    code: string;
    purpose: 'login' | 'password_reset';
  }): Promise<SendSmsResult> {
    const action =
      input.purpose === 'password_reset'
        ? 'redefinir sua senha no Painel Admin'
        : 'acessar o Painel Admin';
    const message = `Movly Admin — use o código ${input.code} para ${action}. Válido por 10 minutos.`;
    return this.dispatch(input.to, message, 'MOVLYADM');
  }

  async sendPartnerAuthCode(input: {
    to: string;
    code: string;
    purpose: 'login';
  }): Promise<SendSmsResult> {
    const message = `Movly Parceiro — use o código ${input.code} para acessar sua conta. Válido por 10 minutos.`;
    return this.dispatch(input.to, message, 'MOVLYPTR');
  }

  async sendCorporateAuthCode(input: {
    to: string;
    code: string;
    purpose: 'login' | 'password_reset';
  }): Promise<SendSmsResult> {
    const action =
      input.purpose === 'password_reset'
        ? 'redefinir sua senha no Portal Corporativo'
        : 'acessar o Portal Corporativo';
    const message = `Movly Corporativo — use o código ${input.code} para ${action}. Válido por 10 minutos.`;
    return this.dispatch(input.to, message, 'MOVLYCORP');
  }

  async sendEmployeeEnrollmentCode(input: {
    to: string;
    employeeName: string;
    companyName: string;
    enrollmentCode: string;
  }): Promise<SendSmsResult> {
    const name = input.employeeName.trim();
    const company = input.companyName.trim() || 'sua empresa';
    const message = [
      `Olá${name ? `, ${name}` : ''}!`,
      `${company} convidou você para o app Movly.`,
      `Código: ${input.enrollmentCode}.`,
      'Abra Minha conta e informe o código.',
    ].join(' ');
    return this.dispatch(input.to, message, 'MOVLYINV');
  }

  /** DDI 55 + celular nacional, igual à api-formo-v2 (`normalizeCellphoneSms`). */
  private toSmsReceiver(phone: string): string | null {
    const digits = normalizeMobilePhone(phone);
    if (!isValidMobilePhone(digits)) return null;
    return `55${digits}`;
  }

  private async dispatch(
    to: string,
    message: string,
    identifier: string,
  ): Promise<SendSmsResult> {
    const receiver = this.toSmsReceiver(to);
    if (!receiver) {
      this.logger.warn(`SMS ignorado: celular inválido (${to}).`);
      return { sent: false, reason: 'Celular inválido para envio de SMS.' };
    }

    if (!this.comtele.isConfigured()) {
      this.logger.log(`[dev] SMS para ${receiver}: ${message}`);
      return {
        sent: false,
        reason:
          'Envio ao celular não configurado na API. Use e-mail ou copie o código manualmente.',
      };
    }

    const result = await this.comtele.send(message, [receiver], identifier);
    if (!result.status) {
      this.logger.error(`Falha Comtele para ${receiver}: ${result.message ?? 'sem detalhe'}`);
      return {
        sent: false,
        reason: 'Não foi possível enviar o SMS agora. Tente novamente ou use e-mail / copiar código.',
      };
    }

    this.logger.log(`SMS enviado para ${receiver} (${identifier})`);
    return { sent: true };
  }
}
