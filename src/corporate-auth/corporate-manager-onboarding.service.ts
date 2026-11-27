import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import * as crypto from 'node:crypto';
import { IsNull, MoreThan, Repository } from 'typeorm';
import { OnboardingNotificationsService } from '../notifications/onboarding-notifications.service';
import { MailService } from '../mail/mail.service';
import { SmsService } from '../sms/sms.service';
import {
  maskEmailForDisplay,
  maskMobilePhoneForDisplay,
  maskPersonNameForDisplay,
} from '../partner-auth/partner-onboarding-contact-mask';
import { CorporateAccessService } from '../corporate/corporate-access.service';
import { CorporateEmployeesService } from '../corporate/corporate-employees.service';
import { Company } from '../corporate/company.entity';
import { formatCnpj, isValidCnpj, isValidCpf, isValidMobilePhone, normalizeCnpj, normalizeCpf, normalizeMobilePhone } from '../users/person.utils';
import { UserRole } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { CorporateManagerOnboardingCnpjChallenge } from './corporate-manager-onboarding-cnpj-challenge.entity';
import { CorporateManagerOnboardingInvite } from './corporate-manager-onboarding-invite.entity';

const TOKEN_BYTES = 24;
const DEFAULT_TTL_DAYS = 14;
const RECOVERY_INVITE_TTL_DAYS = 2;
const CORPORATE_PORTAL_PRODUCTION_URL = 'https://empresa.sejamovly.com';
const CNPJ_CODE_TTL_MS = 10 * 60 * 1000;
const CNPJ_CODE_COOLDOWN_MS = 60 * 1000;
const CNPJ_CODE_MAX_ATTEMPTS = 5;
const CNPJ_CODE_MIN_RESPONSE_MS = 450;
const CNPJ_RECOVERY_GENERIC_MESSAGE =
  'Se o CNPJ estiver cadastrado e o primeiro acesso ainda estiver pendente, enviaremos um código de verificação.';
const CNPJ_RECOVERY_CONFIRM_CONTACT_MESSAGE =
  'Confira o contato cadastrado e escolha como receber o código de verificação.';
const CNPJ_NOT_FOUND_MESSAGE =
  'Não encontramos este CNPJ entre empresas com primeiro acesso pendente. Confira os 14 dígitos, use o link enviado pelo comercial ou fale com o time Movly.';
const CNPJ_ALREADY_CONFIGURED_MESSAGE =
  'O acesso desta empresa já está configurado. Entre no portal com e-mail e senha ou peça ajuda ao time Movly.';
const CNPJ_CODE_INVALID_MESSAGE = 'Código inválido ou expirado.';

export type CorporateOnboardingRecoveryChannel = 'email' | 'sms';

export type CorporateOnboardingCnpjContactCorrection = {
  name: string;
  email: string;
  mobilePhone: string;
};

export type CorporateOnboardingCnpjRequestResult = {
  ok: true;
  status:
    | 'confirm_contact'
    | 'invite_ready'
    | 'cnpj_not_found'
    | 'check_email'
    | 'check_sms'
    | 'already_configured';
  message: string;
  token?: string;
  expiresAt?: string;
  channels?: CorporateOnboardingRecoveryChannel[];
  companyName?: string | null;
  maskedEmail?: string | null;
  maskedPhone?: string | null;
  contactName?: string | null;
  cooldownSeconds?: number;
  codeTtlSeconds?: number;
};

export type CorporateOnboardingCnpjVerifyResult =
  | { status: 'ok'; token: string; expiresAt: string }
  | { status: 'already_configured'; message: string };

async function padElapsed(startedAt: number, minMs: number): Promise<void> {
  const wait = minMs - (Date.now() - startedAt);
  if (wait > 0) {
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

export type CorporateManagerOnboardingInviteMeta = {
  inviteUrl: string;
  expiresAt: string;
  used: boolean;
  expired: boolean;
};

function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Máscara pontual (2º, 6º, 7º e 9º dígitos) — filial visível, sem esconder só o 0001. */
function maskCnpjForDisplay(cnpj: string | null): string | null {
  if (!cnpj) return null;
  const digits = cnpj.replace(/\D/g, '');
  if (digits.length !== 14) return formatCnpj(cnpj);
  /** Índices 0-based: dígitos 2, 6, 7 e 9 do CNPJ. */
  const redact = new Set([1, 5, 6, 8]);
  const masked = [...digits].map((d, i) => (redact.has(i) ? '*' : d)).join('');
  return `${masked.slice(0, 2)}.${masked.slice(2, 5)}.${masked.slice(5, 8)}/${masked.slice(8, 12)}-${masked.slice(12)}`;
}

@Injectable()
export class CorporateManagerOnboardingService {
  private readonly logger = new Logger(CorporateManagerOnboardingService.name);

  constructor(
    @InjectRepository(CorporateManagerOnboardingInvite)
    private readonly invites: Repository<CorporateManagerOnboardingInvite>,
    @InjectRepository(CorporateManagerOnboardingCnpjChallenge)
    private readonly cnpjChallenges: Repository<CorporateManagerOnboardingCnpjChallenge>,
    @InjectRepository(Company)
    private readonly companies: Repository<Company>,
    private readonly corporateAccess: CorporateAccessService,
    private readonly corporateEmployees: CorporateEmployeesService,
    private readonly users: UsersService,
    private readonly mail: MailService,
    private readonly sms: SmsService,
    private readonly config: ConfigService,
    private readonly onboardingNotifications: OnboardingNotificationsService,
  ) {}

  private corporatePortalBaseUrl(): string {
    const fromEnv = this.config.get<string>('CORPORATE_APP_URL')?.trim().replace(/\/$/, '');
    if (fromEnv) return fromEnv;
    return CORPORATE_PORTAL_PRODUCTION_URL;
  }

  private buildInviteUrl(token: string): string {
    return `${this.corporatePortalBaseUrl()}/onboarding/${encodeURIComponent(token)}`;
  }

  async describePersistedInvite(company: Company): Promise<CorporateManagerOnboardingInviteMeta | null> {
    const token = company.managerOnboardingInviteToken?.trim();
    if (!token) return null;

    const row = await this.invites.findOne({ where: { tokenHash: sha256Hex(token), companyId: company.id } });
    if (!row) return null;

    const expired = new Date() > row.expiresAt;
    return {
      inviteUrl: this.buildInviteUrl(token),
      expiresAt: row.expiresAt.toISOString(),
      used: Boolean(row.usedAt),
      expired,
    };
  }

  private async assertInviteAllowedForCompany(companyId: string): Promise<Company> {
    const company = await this.corporateAccess.findCompanyById(companyId);
    if (!company) throw new NotFoundException('Empresa não encontrada.');

    const managers = await this.corporateAccess.listCompanyManagers(companyId);
    if (managers.length > 0) {
      throw new BadRequestException(
        'Esta empresa já possui gestor vinculado. Use a aba Gestores para adicionar outras pessoas.',
      );
    }
    return company;
  }

  async getOrCreateAdminPersistedInvite(
    companyId: string,
    createdByUserId: string | null,
    ttlDays = DEFAULT_TTL_DAYS,
  ): Promise<{
    token: string;
    expiresAt: string;
    inviteUrl: string;
    reused: boolean;
  }> {
    const company = await this.assertInviteAllowedForCompany(companyId);

    const existing = await this.describePersistedInvite(company);
    if (existing && !existing.used && !existing.expired) {
      const token = company.managerOnboardingInviteToken!.trim();
      return {
        token,
        expiresAt: existing.expiresAt,
        inviteUrl: existing.inviteUrl,
        reused: true,
      };
    }

    const token = crypto.randomBytes(TOKEN_BYTES).toString('hex');
    const tokenHash = sha256Hex(token);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + ttlDays);

    await this.invites.save(
      this.invites.create({
        tokenHash,
        companyId: company.id,
        createdByUserId,
        expiresAt,
        usedAt: null,
        usedByUserId: null,
      }),
    );

    company.managerOnboardingInviteToken = token;
    company.managerOnboardingInviteExpiresAt = expiresAt;
    await this.companies.save(company);

    return {
      token,
      expiresAt: expiresAt.toISOString(),
      inviteUrl: this.buildInviteUrl(token),
      reused: false,
    };
  }

  async sendInviteEmail(
    companyId: string,
    createdByUserId: string | null,
    options?: { forceResend?: boolean; to?: string },
  ): Promise<{
    sent: boolean;
    recipientEmail: string;
    inviteUrl: string;
    expiresAt: string;
    reason?: string;
  }> {
    void options?.forceResend;
    const company = await this.assertInviteAllowedForCompany(companyId);
    const recipient = (options?.to?.trim() || company.email?.trim() || '').toLowerCase();
    if (!recipient) {
      throw new BadRequestException(
        'Informe o e-mail da empresa ou do gestor antes de enviar o convite.',
      );
    }

    const { inviteUrl, expiresAt } = await this.getOrCreateAdminPersistedInvite(companyId, createdByUserId);
    const expiresDate = new Date(expiresAt);
    const companyName = company.tradeName?.trim() || company.legalName;

    const mailResult = await this.mail.sendCorporateManagerOnboardingInvite({
      to: recipient,
      companyName,
      inviteUrl,
      expiresAt: expiresDate,
    });

    if (!mailResult.sent) {
      throw new BadRequestException(
        mailResult.reason ??
          'Não foi possível enviar o e-mail. Copie o link de onboarding e envie manualmente.',
      );
    }

    return {
      sent: true,
      recipientEmail: recipient,
      inviteUrl,
      expiresAt,
    };
  }

  async getPreviewByToken(token: string): Promise<{
    companyId: string;
    companyName: string;
    legalName: string;
    cnpjMasked: string | null;
    expiresAt: string;
    suggestedEmail: string | null;
  }> {
    const row = await this.findValidInvite(token);
    const company = await this.corporateAccess.findCompanyById(row.companyId);
    if (!company) throw new NotFoundException('Empresa não encontrada.');

    const managers = await this.corporateAccess.listCompanyManagers(company.id);
    if (managers.length > 0) {
      throw new BadRequestException('Esta empresa já possui gestor vinculado.');
    }

    return {
      companyId: company.id,
      companyName: company.tradeName?.trim() || company.legalName,
      legalName: company.legalName,
      cnpjMasked: maskCnpjForDisplay(company.cnpj ? formatCnpj(company.cnpj) : null),
      expiresAt: row.expiresAt.toISOString(),
      suggestedEmail: company.email?.trim() || null,
    };
  }

  async completeInvite(
    token: string,
    body: {
      name: string;
      email: string;
      cpf: string;
      mobilePhone: string;
      password: string;
    },
  ): Promise<{ ok: true; message: string }> {
    const row = await this.findValidInvite(token);
    const company = await this.corporateAccess.findCompanyById(row.companyId);
    if (!company) throw new NotFoundException('Empresa não encontrada.');

    const managers = await this.corporateAccess.listCompanyManagers(company.id);
    if (managers.length > 0) {
      throw new BadRequestException('Esta empresa já possui gestor vinculado.');
    }

    const email = body.email.trim().toLowerCase();
    const existing = await this.users.findByEmail(email);
    if (existing) {
      throw new ConflictException('E-mail já cadastrado. Faça login ou recupere a senha.');
    }

    const cnpj = company.cnpj ? normalizeCnpj(company.cnpj) : '';
    if (cnpj && !isValidCnpj(cnpj)) {
      throw new BadRequestException('CNPJ da empresa inválido no cadastro. Fale com o time Movly.');
    }

    const cpf = normalizeCpf(body.cpf);
    if (!isValidCpf(cpf)) throw new BadRequestException('CPF inválido.');

    const phone = normalizeMobilePhone(body.mobilePhone);
    if (!isValidMobilePhone(phone)) {
      throw new BadRequestException('Informe um celular válido.');
    }

    const manager = await this.users.create({
      name: body.name.trim(),
      email,
      password: body.password,
      cpf,
      mobilePhone: phone,
      roles: [UserRole.CORPORATE],
    });

    await this.corporateAccess.linkUserToCompany(company.id, manager.id);
    await this.corporateEmployees.linkManagerUserAsEmployee(company.id, manager.id);

    row.usedAt = new Date();
    row.usedByUserId = manager.id;
    await this.invites.save(row);

    company.managerOnboardingInviteToken = null;
    company.managerOnboardingInviteExpiresAt = null;
    await this.companies.save(company);

    this.logger.log(`Gestor ${manager.id} vinculado à empresa ${company.id} via onboarding.`);

    const companyName = company.tradeName?.trim() || company.legalName;
    void this.onboardingNotifications.onCorporateOnboardingCompleted({
      companyId: company.id,
      companyName,
      managerName: manager.name,
      managerEmail: manager.email,
    });

    return {
      ok: true,
      message:
        'Cadastro concluído. Sua empresa está em análise pela equipe Movly; após a aprovação você poderá acessar o portal com seu e-mail e senha.',
    };
  }

  async requestCnpjRecovery(
    rawCnpj: string,
    channelInput?: CorporateOnboardingRecoveryChannel,
    rawContactCorrection?: unknown,
  ): Promise<CorporateOnboardingCnpjRequestResult> {
    const startedAt = Date.now();
    const cnpj = normalizeCnpj(rawCnpj);
    if (!isValidCnpj(cnpj)) {
      throw new BadRequestException('Informe um CNPJ válido.');
    }
    const deliveryChannel: CorporateOnboardingRecoveryChannel =
      channelInput === 'sms' ? 'sms' : 'email';
    const contactCorrection = rawContactCorrection
      ? this.parseContactCorrection(rawContactCorrection)
      : null;

    try {
      const company = await this.companies.findOne({ where: { cnpj } });
      if (!company) {
        await bcrypt.hash(crypto.randomBytes(16).toString('hex'), 10);
        if (!channelInput) return this.cnpjNotFoundResult();
        return this.genericCnpjCheckSent(deliveryChannel, false);
      }

      const managers = await this.corporateAccess.listCompanyManagers(company.id);
      if (managers.length > 0) {
        const email = company.email?.trim();
        if (email) {
          await this.mail.sendCorporateManagerOnboardingAlreadyConfigured({
            to: email,
            companyName: company.tradeName || company.legalName,
            loginUrl: `${this.corporatePortalBaseUrl()}/login`,
          });
        }
        return this.alreadyConfiguredResult();
      }

      if (!channelInput) {
        const issued = await this.getOrCreateAdminPersistedInvite(company.id, null);
        const companyName = company.tradeName || company.legalName;
        return {
          ok: true,
          status: 'invite_ready',
          message: `Empresa identificada. Continue para criar seu acesso de gestor.`,
          token: issued.token,
          expiresAt: issued.expiresAt,
          companyName,
        };
      }

      const channels = this.recoveryChannelsForCompany(company, contactCorrection);
      if (deliveryChannel === 'sms' && !channels.includes('sms')) {
        await bcrypt.hash(crypto.randomBytes(16).toString('hex'), 10);
        return this.genericCnpjCheckSent('sms', false);
      }
      if (deliveryChannel === 'email' && !channels.includes('email')) {
        await bcrypt.hash(crypto.randomBytes(16).toString('hex'), 10);
        return this.genericCnpjCheckSent('email', false);
      }

      const emailTo =
        deliveryChannel === 'email'
          ? (contactCorrection?.email ?? company.email?.trim().toLowerCase() ?? null)
          : null;
      const phoneTo =
        deliveryChannel === 'sms'
          ? (contactCorrection?.mobilePhone ?? this.companyMobilePhone(company))
          : null;

      if (deliveryChannel === 'email' && !emailTo) {
        await bcrypt.hash(crypto.randomBytes(16).toString('hex'), 10);
        return this.genericCnpjCheckSent('email', false);
      }
      if (deliveryChannel === 'sms' && !phoneTo) {
        await bcrypt.hash(crypto.randomBytes(16).toString('hex'), 10);
        return this.genericCnpjCheckSent('sms', false);
      }

      const recent = await this.cnpjChallenges.findOne({
        where: { cnpj, consumedAt: IsNull(), expiresAt: MoreThan(new Date()) },
        order: { createdAt: 'DESC' },
      });
      if (recent && Date.now() - recent.createdAt.getTime() < CNPJ_CODE_COOLDOWN_MS) {
        if (contactCorrection) {
          await this.applyCompanyContactCorrection(company, contactCorrection);
          await this.cnpjChallenges.update(recent.id, {
            overrideEmail: contactCorrection.email,
            overridePhone: contactCorrection.mobilePhone,
            overrideName: contactCorrection.name,
          });
        }
        return this.genericCnpjCheckSent(deliveryChannel, true);
      }

      await this.cnpjChallenges.update({ cnpj, consumedAt: IsNull() }, { consumedAt: new Date() });

      const code = String(crypto.randomInt(100000, 1000000));
      const codeHash = await bcrypt.hash(code, 10);
      const expiresAt = new Date(Date.now() + CNPJ_CODE_TTL_MS);
      await this.cnpjChallenges.save(
        this.cnpjChallenges.create({
          cnpj,
          companyId: company.id,
          codeHash,
          expiresAt,
          deliveryChannel,
          overrideEmail: contactCorrection?.email ?? null,
          overridePhone: contactCorrection?.mobilePhone ?? null,
          overrideName: contactCorrection?.name ?? null,
        }),
      );

      if (contactCorrection) {
        await this.applyCompanyContactCorrection(company, contactCorrection);
      }

      const companyName = company.tradeName || company.legalName;
      const ttlMinutes = Math.round(CNPJ_CODE_TTL_MS / 60000);
      let delivered = false;
      if (deliveryChannel === 'email' && emailTo) {
        const mailResult = await this.mail.sendCorporateManagerOnboardingRecoveryCode({
          to: emailTo,
          companyName,
          code,
          ttlMinutes,
        });
        delivered = mailResult.sent;
      } else if (deliveryChannel === 'sms' && phoneTo) {
        const smsResult = await this.sms.sendPartnerOnboardingRecoveryCode({
          to: phoneTo,
          code,
          networkName: companyName,
          ttlMinutes,
        });
        delivered = smsResult.sent;
      }

      if (!delivered) {
        this.logger.warn(
          `Código onboarding corporativo gerado para ${company.id}, entrega ${deliveryChannel} falhou.`,
        );
      }

      return this.genericCnpjCheckSent(deliveryChannel, delivered);
    } finally {
      await padElapsed(startedAt, CNPJ_CODE_MIN_RESPONSE_MS);
    }
  }

  async verifyCnpjRecovery(
    rawCnpj: string,
    rawCode: string,
  ): Promise<CorporateOnboardingCnpjVerifyResult> {
    const cnpj = normalizeCnpj(rawCnpj);
    if (!isValidCnpj(cnpj)) {
      throw new BadRequestException('Informe um CNPJ válido.');
    }
    const code = String(rawCode ?? '').trim();
    if (!/^\d{6}$/.test(code)) {
      throw new BadRequestException('Informe o código de 6 dígitos recebido por e-mail ou SMS.');
    }

    const row = await this.cnpjChallenges.findOne({
      where: { cnpj, consumedAt: IsNull(), expiresAt: MoreThan(new Date()) },
      order: { createdAt: 'DESC' },
    });
    if (!row || row.attempts >= CNPJ_CODE_MAX_ATTEMPTS) {
      throw new UnauthorizedException(CNPJ_CODE_INVALID_MESSAGE);
    }

    const valid = await bcrypt.compare(code, row.codeHash);
    if (!valid) {
      row.attempts += 1;
      await this.cnpjChallenges.save(row);
      throw new UnauthorizedException(CNPJ_CODE_INVALID_MESSAGE);
    }

    const managers = await this.corporateAccess.listCompanyManagers(row.companyId);
    if (managers.length > 0) {
      row.consumedAt = new Date();
      await this.cnpjChallenges.save(row);
      return { status: 'already_configured', message: CNPJ_ALREADY_CONFIGURED_MESSAGE };
    }

    if (row.overrideName && row.overrideEmail && row.overridePhone) {
      const company = await this.corporateAccess.findCompanyById(row.companyId);
      if (company) {
        await this.applyCompanyContactCorrection(company, {
          name: row.overrideName,
          email: row.overrideEmail,
          mobilePhone: row.overridePhone,
        });
      }
    }

    try {
      const issued = await this.getOrCreateAdminPersistedInvite(
        row.companyId,
        null,
        RECOVERY_INVITE_TTL_DAYS,
      );
      row.consumedAt = new Date();
      await this.cnpjChallenges.save(row);
      return { status: 'ok', token: issued.token, expiresAt: issued.expiresAt };
    } catch (err) {
      this.logger.error(
        `Falha ao emitir convite corporativo após CNPJ (${row.companyId}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw new BadRequestException('Não foi possível iniciar o cadastro. Fale com o time Movly.');
    }
  }

  private companyMobilePhone(company: Company): string | null {
    const normalized = company.phone ? normalizeMobilePhone(company.phone) : '';
    return isValidMobilePhone(normalized) ? normalized : null;
  }

  private recoveryChannelsForCompany(
    company: Company,
    correction: CorporateOnboardingCnpjContactCorrection | null,
  ): CorporateOnboardingRecoveryChannel[] {
    const channels: CorporateOnboardingRecoveryChannel[] = [];
    const email = correction?.email ?? company.email?.trim();
    const phone = correction?.mobilePhone ?? this.companyMobilePhone(company);
    if (email) channels.push('email');
    if (phone) channels.push('sms');
    return channels;
  }

  private cnpjNotFoundResult(): CorporateOnboardingCnpjRequestResult {
    return { ok: true, status: 'cnpj_not_found', message: CNPJ_NOT_FOUND_MESSAGE };
  }

  private confirmContactPreview(company: Company): CorporateOnboardingCnpjRequestResult {
    const companyName = company.tradeName || company.legalName;
    const email = company.email?.trim();
    const phone = this.companyMobilePhone(company);
    return {
      ok: true,
      status: 'confirm_contact',
      message: CNPJ_RECOVERY_CONFIRM_CONTACT_MESSAGE,
      companyName,
      channels: this.recoveryChannelsForCompany(company, null),
      maskedEmail: email ? maskEmailForDisplay(email) : null,
      maskedPhone: phone ? maskMobilePhoneForDisplay(phone) : null,
      contactName: maskPersonNameForDisplay(companyName),
    };
  }

  private parseContactCorrection(raw: unknown): CorporateOnboardingCnpjContactCorrection | null {
    if (!raw || typeof raw !== 'object') return null;
    const body = raw as Record<string, unknown>;
    const name = String(body.name ?? '').trim();
    const email = String(body.email ?? '').trim().toLowerCase();
    const mobilePhone = normalizeMobilePhone(String(body.mobilePhone ?? ''));
    if (!name && !email && !mobilePhone) return null;
    if (name.length < 2) {
      throw new BadRequestException('Informe o nome completo do responsável.');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('Informe um e-mail válido para o responsável.');
    }
    if (!isValidMobilePhone(mobilePhone)) {
      throw new BadRequestException('Informe um celular válido com DDD (11 dígitos).');
    }
    return { name, email, mobilePhone };
  }

  private async applyCompanyContactCorrection(
    company: Company,
    correction: CorporateOnboardingCnpjContactCorrection,
  ): Promise<void> {
    company.email = correction.email;
    company.phone = correction.mobilePhone;
    await this.companies.save(company);
  }

  private genericCnpjCheckSent(
    channel: CorporateOnboardingRecoveryChannel,
    sent = true,
  ): CorporateOnboardingCnpjRequestResult {
    const message = sent
      ? channel === 'sms'
        ? 'Enviamos um código por SMS para o celular informado.'
        : 'Enviamos um código para o e-mail informado.'
      : CNPJ_RECOVERY_GENERIC_MESSAGE;
    return {
      ok: true,
      status: channel === 'sms' ? 'check_sms' : 'check_email',
      message,
      cooldownSeconds: Math.round(CNPJ_CODE_COOLDOWN_MS / 1000),
      codeTtlSeconds: Math.round(CNPJ_CODE_TTL_MS / 1000),
    };
  }

  private alreadyConfiguredResult(): CorporateOnboardingCnpjRequestResult {
    return { ok: true, status: 'already_configured', message: CNPJ_ALREADY_CONFIGURED_MESSAGE };
  }

  private async findValidInvite(token: string): Promise<CorporateManagerOnboardingInvite> {
    const trimmed = token?.trim();
    if (!trimmed) throw new BadRequestException('Convite inválido.');

    const tokenHash = sha256Hex(trimmed);
    const row = await this.invites.findOne({ where: { tokenHash } });
    if (!row) throw new NotFoundException('Convite não encontrado.');
    if (row.usedAt) throw new BadRequestException('Este convite já foi utilizado.');
    if (new Date() > row.expiresAt) throw new BadRequestException('Este convite expirou.');

    return row;
  }
}