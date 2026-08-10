import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

export type SendMailResult = {
  sent: boolean;
  enrollmentCode?: string;
  reason?: string;
};

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;

  constructor(private readonly config: ConfigService) {}

  getConnectAppUrl(): string | null {
    const raw = this.config.get<string>('CONNECT_APP_URL')?.trim();
    return raw ? raw.replace(/\/$/, '') : null;
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

  async sendEmployeeEnrollmentCode(input: {
    to: string;
    employeeName: string;
    companyName: string;
    enrollmentCode: string;
  }): Promise<SendMailResult> {
    const code = input.enrollmentCode.trim();
    const appUrl = this.getConnectAppUrl();
    const appSteps = appUrl
      ? `Baixe o app ACAF Connect (${appUrl}) e abra Minha conta.`
      : 'Abra o app ACAF Connect e vá em Minha conta.';

    const subject = `Código ACAF Connect — ${input.companyName}`;
    const body = [
      `Olá${input.employeeName ? `, ${input.employeeName}` : ''}!`,
      '',
      `${input.companyName} liberou o benefício ACAF Connect para colaboradores.`,
      '',
      'Código de adesão da empresa:',
      code,
      '',
      appSteps,
      'Informe o código para validar sua empresa e escolher o plano.',
      '',
      'Compartilhe este código apenas com colaboradores autorizados.',
    ].join('\n');

    const transporter = this.getTransporter();
    if (!transporter) {
      this.logger.warn(
        `SMTP_HOST não configurado — código não enviado para ${input.to}. Código: ${code}`,
      );
      return {
        sent: false,
        enrollmentCode: code,
        reason: 'SMTP não configurado na API. Use "Copiar código" ou configure SMTP_HOST.',
      };
    }

    const from =
      this.config.get<string>('SMTP_FROM')?.trim() ||
      this.config.get<string>('SMTP_USER')?.trim() ||
      'noreply@acaf.com.br';

    const htmlAppLine = appUrl
      ? `<p>Baixe o app ACAF Connect e abra <strong>Minha conta</strong> (<a href="${appUrl}">${appUrl}</a>).</p>`
      : '<p>Abra o app ACAF Connect e vá em <strong>Minha conta</strong>.</p>';

    try {
      await transporter.sendMail({
        from,
        to: input.to,
        subject,
        text: body,
        html: [
          `<p>Olá${input.employeeName ? `, <strong>${input.employeeName}</strong>` : ''}!</p>`,
          `<p><strong>${input.companyName}</strong> liberou o benefício ACAF Connect para colaboradores.</p>`,
          '<p>Código de adesão da empresa:</p>',
          `<p style="font-size:20px;font-weight:700;font-family:monospace">${code}</p>`,
          htmlAppLine,
          '<p>Informe o código para validar sua empresa e escolher o plano.</p>',
          '<p style="color:#666;font-size:13px">Compartilhe este código apenas com colaboradores autorizados.</p>',
        ].join(''),
      });
      this.logger.log(`Código de adesão enviado por e-mail para ${input.to}`);
      return { sent: true, enrollmentCode: code };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Falha ao enviar e-mail para ${input.to}: ${message}`);
      return {
        sent: false,
        enrollmentCode: code,
        reason: `Falha ao enviar e-mail: ${message}`,
      };
    }
  }
}
