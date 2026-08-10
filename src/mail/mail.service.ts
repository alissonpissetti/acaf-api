import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

export type SendMailResult = {
  sent: boolean;
  inviteUrl?: string;
  reason?: string;
};

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;

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

  private getTransporter(): Transporter | null {
    if (this.transporter) return this.transporter;

    const host = this.config.get<string>('SMTP_HOST');
    if (!host) return null;

    const port = Number(this.config.get<string>('SMTP_PORT') ?? 587);
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASS');

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465 || this.config.get<string>('SMTP_SECURE') === 'true',
      auth: user && pass ? { user, pass } : undefined,
    });

    return this.transporter;
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

    const transporter = this.getTransporter();
    if (!transporter) {
      this.logger.warn(
        `SMTP_HOST não configurado — convite não enviado para ${input.to}. Link: ${inviteUrl}`,
      );
      return {
        sent: false,
        inviteUrl,
        reason: 'SMTP não configurado na API. Use "Copiar link" ou configure SMTP_HOST.',
      };
    }

    const from =
      this.config.get<string>('SMTP_FROM')?.trim() ||
      this.config.get<string>('SMTP_USER')?.trim() ||
      'noreply@acaf.com.br';

    try {
      await transporter.sendMail({
        from,
        to: input.to,
        subject,
        text: body,
        html: [
          `<p>Olá${input.employeeName ? `, <strong>${input.employeeName}</strong>` : ''}!</p>`,
          `<p><strong>${input.companyName}</strong> convidou você para o benefício ACAF Connect.</p>`,
          `<p><a href="${inviteUrl}">Ativar conta e definir senha</a></p>`,
          `<p style="color:#666;font-size:13px">Ou copie o link: ${inviteUrl}</p>`,
          '<p style="color:#666;font-size:13px">Este link expira em 7 dias.</p>',
        ].join(''),
      });
      this.logger.log(`Convite enviado por e-mail para ${input.to}`);
      return { sent: true, inviteUrl };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Falha ao enviar e-mail para ${input.to}: ${message}`);
      return {
        sent: false,
        inviteUrl,
        reason: `Falha ao enviar e-mail: ${message}`,
      };
    }
  }
}
