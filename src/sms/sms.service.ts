import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type SendSmsResult = {
  sent: boolean;
};

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(private readonly config: ConfigService) {}

  async sendAdminAuthCode(input: {
    to: string;
    code: string;
    purpose: 'login' | 'password_reset';
  }): Promise<SendSmsResult> {
    const action =
      input.purpose === 'password_reset'
        ? 'redefinir sua senha no Painel Admin'
        : 'acessar o Painel Admin';
    const message = `Painel Admin — use o código ${input.code} para ${action}. Válido por 10 minutos.`;

    const provider = this.config.get<string>('SMS_PROVIDER');
    if (!provider) {
      this.logger.log(`[dev] SMS para ${input.to}: ${message}`);
      return { sent: false };
    }

    this.logger.warn(
      `SMS_PROVIDER configurado mas integração não implementada. Mensagem dev: ${message}`,
    );
    return { sent: false };
  }

  async sendPartnerAuthCode(input: {
    to: string;
    code: string;
    purpose: 'login';
  }): Promise<SendSmsResult> {
    const message = `Portal Parceiro — use o código ${input.code} para acessar sua conta. Válido por 10 minutos.`;

    const provider = this.config.get<string>('SMS_PROVIDER');
    if (!provider) {
      this.logger.log(`[dev] SMS para ${input.to}: ${message}`);
      return { sent: false };
    }

    this.logger.warn(
      `SMS_PROVIDER configurado mas integração não implementada. Mensagem dev: ${message}`,
    );
    return { sent: false };
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
    const message = `Portal Corporativo — use o código ${input.code} para ${action}. Válido por 10 minutos.`;

    const provider = this.config.get<string>('SMS_PROVIDER');
    if (!provider) {
      this.logger.log(`[dev] SMS para ${input.to}: ${message}`);
      return { sent: false };
    }

    this.logger.warn(
      `SMS_PROVIDER configurado mas integração não implementada. Mensagem dev: ${message}`,
    );
    return { sent: false };
  }

  async sendEmployeeEnrollmentCode(input: {
    to: string;
    employeeName: string;
    companyName: string;
    enrollmentCode: string;
  }): Promise<SendSmsResult> {
    const message = [
      `Olá${input.employeeName ? `, ${input.employeeName}` : ''}!`,
      `${input.companyName} — Connect.`,
      `Código: ${input.enrollmentCode}.`,
      'Abra o app, vá em Minha conta e informe o código.',
    ].join(' ');

    const provider = this.config.get<string>('SMS_PROVIDER');
    if (!provider) {
      this.logger.log(`[dev] SMS para ${input.to}: ${message}`);
      return { sent: false };
    }

    this.logger.warn(
      `SMS_PROVIDER configurado mas integração não implementada. Mensagem dev: ${message}`,
    );
    return { sent: false };
  }
}
