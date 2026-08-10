import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type SendMailResult = {
  sent: boolean;
  inviteUrl?: string;
};

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly config: ConfigService) {}

  getCorporateAppUrl(): string {
    return (
      this.config.get<string>('CORPORATE_APP_URL')?.replace(/\/$/, '') ??
      'http://127.0.0.1:5177'
    );
  }

  buildInviteUrl(token: string): string {
    return `${this.getCorporateAppUrl()}/ativar?token=${encodeURIComponent(token)}`;
  }

  async sendEmployeeInvite(input: {
    to: string;
    employeeName: string;
    companyName: string;
    token: string;
  }): Promise<SendMailResult> {
    const inviteUrl = this.buildInviteUrl(input.token);
    const subject = `Convite ACAF Connect — ${input.companyName}`;
    const body = [
      `Olá${input.employeeName ? `, ${input.employeeName}` : ''}!`,
      '',
      `${input.companyName} convidou você para o benefício ACAF Connect.`,
      'Ative sua conta e defina sua senha:',
      inviteUrl,
      '',
      'Este link expira em 7 dias.',
    ].join('\n');

    const host = this.config.get<string>('SMTP_HOST');
    if (!host) {
      this.logger.log(`[dev] Convite para ${input.to}: ${inviteUrl}`);
      return { sent: false, inviteUrl };
    }

    this.logger.warn(
      `SMTP configurado mas nodemailer não instalado. Link dev: ${inviteUrl}`,
    );
    return { sent: false, inviteUrl };
  }
}
