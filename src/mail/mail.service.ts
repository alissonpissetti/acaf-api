import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { NextcloudService } from '../storage/nextcloud.service';
import {
  buildEmployeeEnrollmentInviteHtml,
  buildEmployeeEnrollmentInviteSubject,
  buildEmployeeEnrollmentInviteText,
} from './employee-enrollment-invite.template';
import {
  buildPartnerOnboardingInviteHtml,
  buildPartnerOnboardingInviteSubject,
  buildPartnerOnboardingInviteText,
} from './partner-onboarding-invite.template';
import {
  buildPartnerTeamInviteHtml,
  buildPartnerTeamInviteSubject,
  buildPartnerTeamInviteText,
} from './partner-team-invite.template';

const MAIL_LOGO_FILE = 'movly-logo-lime-on-purple.png';

const HOSTINGER_MAIL_API_BASE = 'https://api.mail.hostinger.com';

export type SendMailResult = {
  sent: boolean;
  enrollmentCode?: string;
  reason?: string;
};

export type SendPartnerOnboardingInviteResult = {
  sent: boolean;
  reason?: string;
};

type HostingerMailbox = { resourceId: string; address: string };

@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;
  private hostingerMailboxId: string | null = null;
  private mailLogoUrl: string | null = null;
  private mailLogoReady: Promise<void> | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly storage: NextcloudService,
  ) {}

  async onModuleInit() {
    this.mailLogoReady = this.publishMailLogo();
    await this.mailLogoReady;
  }

  private mailProvider(): 'hostinger' | 'smtp' | null {
    const explicit = this.config.get<string>('MAIL_PROVIDER')?.trim().toLowerCase();
    if (explicit === 'hostinger') return 'hostinger';
    if (explicit === 'smtp') return 'smtp';
    if (this.config.get<string>('HOSTINGER_MAIL_API_TOKEN')?.trim()) return 'hostinger';
    if (this.config.get<string>('SMTP_HOST')?.trim()) return 'smtp';
    return null;
  }

  private defaultFromAddress(): string {
    if (this.mailProvider() === 'hostinger') {
      return (
        this.config.get<string>('HOSTINGER_MAIL_FROM')?.trim() ||
        this.config.get<string>('SMTP_FROM')?.trim() ||
        this.config.get<string>('SMTP_USER')?.trim() ||
        'noreply@exemplo.com.br'
      );
    }
    return (
      this.config.get<string>('SMTP_FROM')?.trim() ||
      this.config.get<string>('HOSTINGER_MAIL_FROM')?.trim() ||
      this.config.get<string>('SMTP_USER')?.trim() ||
      'noreply@exemplo.com.br'
    );
  }

  private hostingerDisplayName(): string | undefined {
    const name = this.config.get<string>('HOSTINGER_MAIL_DISPLAY_NAME')?.trim();
    return name || undefined;
  }

  private async resolveHostingerMailboxId(token: string): Promise<string> {
    if (this.hostingerMailboxId) return this.hostingerMailboxId;

    const forced = this.config.get<string>('HOSTINGER_MAIL_MAILBOX_ID')?.trim();
    if (forced) {
      this.hostingerMailboxId = forced;
      return forced;
    }

    const response = await fetch(`${HOSTINGER_MAIL_API_BASE}/api/v1/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const payload = (await response.json().catch(() => ({}))) as {
      data?: { mailboxes?: HostingerMailbox[] };
      error?: string;
    };

    if (!response.ok) {
      const detail = payload.error ?? `HTTP ${response.status}`;
      throw new Error(`Hostinger Mail API (/me): ${detail}`);
    }

    const mailboxes = payload.data?.mailboxes ?? [];
    if (!mailboxes.length) {
      throw new Error('Token Hostinger sem caixas de e-mail associadas.');
    }

    const prefer = this.defaultFromAddress().toLowerCase();
    const match =
      mailboxes.find((box) => box.address?.toLowerCase() === prefer) ?? mailboxes[0]!;

    this.hostingerMailboxId = match.resourceId;
    return match.resourceId;
  }

  private async sendViaHostinger(input: {
    to: string;
    subject: string;
    text: string;
    html: string;
  }): Promise<void> {
    const token = this.config.get<string>('HOSTINGER_MAIL_API_TOKEN')?.trim();
    if (!token) {
      throw new Error('HOSTINGER_MAIL_API_TOKEN não configurado.');
    }

    const mailboxId = await this.resolveHostingerMailboxId(token);
    const body: Record<string, unknown> = {
      to: [input.to],
      subject: input.subject,
      text: input.text,
      html: input.html,
    };
    const displayName = this.hostingerDisplayName();
    if (displayName) body.displayName = displayName;

    const response = await fetch(
      `${HOSTINGER_MAIL_API_BASE}/api/v1/mailboxes/${encodeURIComponent(mailboxId)}/send`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    );

    if (response.status === 204) return;

    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    const detail = payload.error ?? `HTTP ${response.status}`;
    throw new Error(`Hostinger Mail API (send): ${detail}`);
  }

  getConnectAppUrl(): string | null {
    const raw = this.config.get<string>('CONNECT_APP_URL')?.trim();
    if (!raw || !/^https?:\/\//i.test(raw)) return null;
    return raw.replace(/\/$/, '');
  }

  private localMailLogoPath(): string | null {
    const candidates = [
      join(process.cwd(), 'assets/branding', MAIL_LOGO_FILE),
      join(__dirname, '../../assets/branding', MAIL_LOGO_FILE),
    ];
    return candidates.find((path) => existsSync(path)) ?? null;
  }

  /** HTTPS público no Nextcloud; MAIL_LOGO_URL no .env tem prioridade. */
  private async publishMailLogo(): Promise<void> {
    const forced = this.config.get<string>('MAIL_LOGO_URL')?.trim();
    if (forced && /^https?:\/\//i.test(forced)) {
      this.mailLogoUrl = forced.replace(/\/$/, '');
      this.logger.log(`Logo do e-mail: MAIL_LOGO_URL (${this.mailLogoUrl})`);
      return;
    }

    const localPath = this.localMailLogoPath();
    if (!localPath) {
      this.logger.warn(
        `Logo local não encontrada (assets/branding/${MAIL_LOGO_FILE}). E-mail usa fallback tipográfico.`,
      );
      this.mailLogoUrl = this.legacyBrandLogoUrl();
      return;
    }

    try {
      const buffer = await readFile(localPath);
      const { publicUrl, path } = await this.storage.ensurePublicBrandAsset(
        MAIL_LOGO_FILE,
        buffer,
        'image/png',
      );
      this.mailLogoUrl = publicUrl;
      this.logger.log(`Logo do e-mail publicada no storage (${path}): ${publicUrl}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Não foi possível publicar a logo no storage: ${message}`);
      this.mailLogoUrl = this.legacyBrandLogoUrl();
    }
  }

  private legacyBrandLogoUrl(): string | null {
    const base = (
      this.config.get<string>('BRAND_ASSETS_PUBLIC_URL')?.trim() ||
      this.config.get<string>('CORPORATE_APP_URL')?.trim() ||
      ''
    ).replace(/\/$/, '');
    if (!base || !/^https?:\/\//i.test(base)) return null;
    return `${base}/branding/${MAIL_LOGO_FILE}`;
  }

  private async employeeInviteLogoUrl(): Promise<string | null> {
    if (!this.mailLogoReady) {
      this.mailLogoReady = this.publishMailLogo();
    }
    await this.mailLogoReady;
    return this.mailLogoUrl;
  }

  private friendlySendError(message: string): string {
    if (/535|authentication failed|invalid login/i.test(message)) {
      return 'Falha na autenticação do envio de e-mail. Confira MAIL_PROVIDER e as credenciais (token Hostinger ou SMTP). Enquanto isso, use "Copiar código".';
    }
    return `Falha ao enviar e-mail: ${message}`;
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
    const inviteContent = {
      employeeName: input.employeeName,
      companyName: input.companyName,
      enrollmentCode: code,
      appUrl,
      logoUrl: await this.employeeInviteLogoUrl(),
    };

    const subject = buildEmployeeEnrollmentInviteSubject(input.companyName);
    const body = buildEmployeeEnrollmentInviteText(inviteContent);
    const html = buildEmployeeEnrollmentInviteHtml(inviteContent);

    const provider = this.mailProvider();
    if (!provider) {
      this.logger.warn(
        `E-mail não configurado — código não enviado para ${input.to}. Código: ${code}`,
      );
      return {
        sent: false,
        enrollmentCode: code,
        reason:
          'E-mail não configurado na API (SMTP ou Hostinger Mail API). Use "Copiar código" ou configure MAIL_PROVIDER.',
      };
    }

    const from = this.defaultFromAddress();

    try {
      if (provider === 'hostinger') {
        await this.sendViaHostinger({ to: input.to, subject, text: body, html });
      } else {
        const transporter = this.getTransporter();
        if (!transporter) {
          return {
            sent: false,
            enrollmentCode: code,
            reason: 'SMTP_HOST não configurado na API.',
          };
        }
        await transporter.sendMail({ from, to: input.to, subject, text: body, html });
      }
      this.logger.log(`Código de adesão enviado por e-mail para ${input.to}`);
      return { sent: true, enrollmentCode: code };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Falha ao enviar e-mail para ${input.to}: ${message}`);
      return {
        sent: false,
        enrollmentCode: code,
        reason: this.friendlySendError(message),
      };
    }
  }

  async sendPartnerOnboardingInvite(input: {
    to: string;
    networkName: string;
    inviteUrl: string;
    expiresAt: Date;
  }): Promise<SendPartnerOnboardingInviteResult> {
    const expiresAtLabel = input.expiresAt.toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      dateStyle: 'short',
      timeStyle: 'short',
    });
    const inviteContent = {
      networkName: input.networkName,
      inviteUrl: input.inviteUrl.trim(),
      expiresAtLabel,
      logoUrl: await this.employeeInviteLogoUrl(),
    };

    const subject = buildPartnerOnboardingInviteSubject(input.networkName);
    const text = buildPartnerOnboardingInviteText(inviteContent);
    const html = buildPartnerOnboardingInviteHtml(inviteContent);

    const provider = this.mailProvider();
    if (!provider) {
      this.logger.warn(`E-mail não configurado — convite de onboarding não enviado para ${input.to}`);
      return {
        sent: false,
        reason:
          'E-mail não configurado na API (SMTP ou Hostinger Mail API). Configure MAIL_PROVIDER ou use "Gerar link".',
      };
    }

    const from = this.defaultFromAddress();

    try {
      if (provider === 'hostinger') {
        await this.sendViaHostinger({ to: input.to, subject, text, html });
      } else {
        const transporter = this.getTransporter();
        if (!transporter) {
          return { sent: false, reason: 'SMTP_HOST não configurado na API.' };
        }
        await transporter.sendMail({ from, to: input.to, subject, text, html });
      }
      this.logger.log(`Convite de onboarding parceiro enviado para ${input.to}`);
      return { sent: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Falha ao enviar convite de onboarding para ${input.to}: ${message}`);
      return { sent: false, reason: this.friendlySendError(message) };
    }
  }

  async sendPartnerTeamInvite(input: {
    to: string;
    networkName: string;
    inviteUrl: string;
    expiresAt: Date;
  }): Promise<SendPartnerOnboardingInviteResult> {
    const expiresAtLabel = input.expiresAt.toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      dateStyle: 'short',
      timeStyle: 'short',
    });
    const inviteContent = {
      networkName: input.networkName,
      inviteUrl: input.inviteUrl.trim(),
      expiresAtLabel,
      logoUrl: await this.employeeInviteLogoUrl(),
    };

    const subject = buildPartnerTeamInviteSubject(input.networkName);
    const text = buildPartnerTeamInviteText(inviteContent);
    const html = buildPartnerTeamInviteHtml(inviteContent);

    const provider = this.mailProvider();
    if (!provider) {
      this.logger.warn(`E-mail não configurado — convite de equipe não enviado para ${input.to}`);
      return {
        sent: false,
        reason:
          'E-mail não configurado na API (SMTP ou Hostinger Mail API). Configure MAIL_PROVIDER ou use "Gerar link".',
      };
    }

    const from = this.defaultFromAddress();

    try {
      if (provider === 'hostinger') {
        await this.sendViaHostinger({ to: input.to, subject, text, html });
      } else {
        const transporter = this.getTransporter();
        if (!transporter) {
          return { sent: false, reason: 'SMTP_HOST não configurado na API.' };
        }
        await transporter.sendMail({ from, to: input.to, subject, text, html });
      }
      this.logger.log(`Convite de equipe parceiro enviado para ${input.to}`);
      return { sent: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Falha ao enviar convite de equipe para ${input.to}: ${message}`);
      return { sent: false, reason: this.friendlySendError(message) };
    }
  }
}
