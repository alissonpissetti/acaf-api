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
import { In, IsNull, MoreThan, Repository } from 'typeorm';
import { MailService } from '../mail/mail.service';
import { PartnerAccessService } from '../platform-users/partner-access.service';
import { loadStore } from '../partner/store';
import type { AdminNetwork, ApiStore } from '../partner/types';
import { UserRole, userHasRole } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { isValidCnpj, normalizeCnpj } from '../users/person.utils';
import { PartnerAuthService } from './partner-auth.service';
import { PartnerOnboardingCnpjChallenge } from './partner-onboarding-cnpj-challenge.entity';
import { findNetworkIdForCnpj } from './partner-onboarding-cnpj';
import { PartnerOnboardingEmailSend } from './partner-onboarding-email-send.entity';
import { PartnerOnboardingInvite } from './partner-onboarding-invite.entity';
import {
  resolvePartnerOnboardingInviteRecipient,
  todayDateBr,
  type PartnerOnboardingInviteRecipient,
} from './partner-onboarding-invite-recipient';
import {
  PARTNER_INVITE_KIND_ONBOARDING,
  PARTNER_INVITE_KIND_TEAM,
  type PartnerInviteKind,
} from './partner-invite-kind';

const TOKEN_BYTES = 24;
const DEFAULT_TTL_DAYS = 14;
const RECOVERY_INVITE_TTL_DAYS = 2;
const PARTNER_PORTAL_PRODUCTION_URL = 'https://parceiro.sejamovly.com';
const CNPJ_CODE_TTL_MS = 10 * 60 * 1000;
const CNPJ_CODE_COOLDOWN_MS = 60 * 1000;
const CNPJ_CODE_MAX_ATTEMPTS = 5;
const CNPJ_CODE_MIN_RESPONSE_MS = 450;
const CNPJ_RECOVERY_GENERIC_MESSAGE =
  'Se o CNPJ estiver cadastrado e o onboarding ainda estiver pendente, enviaremos um código para o e-mail do responsável.';
const CNPJ_ALREADY_CONFIGURED_MESSAGE =
  'O acesso desta academia já está configurado. Entre no portal com e-mail e senha ou peça um convite à equipe.';
const CNPJ_CODE_INVALID_MESSAGE = 'Código inválido ou expirado.';

export const PARTNER_ONBOARDING_EMAIL_EXISTS_CODE = 'PARTNER_ONBOARDING_EMAIL_EXISTS';
export const PARTNER_ONBOARDING_PHONE_EXISTS_CODE = 'PARTNER_ONBOARDING_PHONE_EXISTS';
export const PARTNER_ONBOARDING_CPF_EXISTS_CODE = 'PARTNER_ONBOARDING_CPF_EXISTS';

type ExistingUserReuseDecision =
  | { allowed: false }
  | { allowed: true; requireExistingPassword: boolean };

async function padElapsed(startedAt: number, minMs: number): Promise<void> {
  const wait = minMs - (Date.now() - startedAt);
  if (wait > 0) {
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

export type PartnerOnboardingEmailListMeta = {
  onboardingInviteEmail: string | null;
  onboardingInviteEmailSource: 'network' | 'unit' | null;
  onboardingInviteEmailSentToday: boolean;
};

export type PartnerOnboardingCnpjRequestResult = {
  ok: true;
  status: 'check_email' | 'already_configured';
  message: string;
  cooldownSeconds?: number;
  codeTtlSeconds?: number;
};

export type PartnerOnboardingCnpjVerifyResult =
  | { status: 'ok'; token: string; expiresAt: string }
  | { status: 'already_configured'; message: string };

@Injectable()
export class PartnerOnboardingService {
  private readonly logger = new Logger(PartnerOnboardingService.name);

  constructor(
    @InjectRepository(PartnerOnboardingInvite)
    private readonly invites: Repository<PartnerOnboardingInvite>,
    @InjectRepository(PartnerOnboardingEmailSend)
    private readonly emailSends: Repository<PartnerOnboardingEmailSend>,
    @InjectRepository(PartnerOnboardingCnpjChallenge)
    private readonly cnpjChallenges: Repository<PartnerOnboardingCnpjChallenge>,
    private readonly users: UsersService,
    private readonly partnerAccess: PartnerAccessService,
    private readonly partnerAuth: PartnerAuthService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  private partnerPortalBaseUrl(): string {
    const fromEnv = this.config.get<string>('PARTNER_PORTAL_PUBLIC_URL')?.trim().replace(/\/$/, '');
    if (fromEnv) return fromEnv;
    return PARTNER_PORTAL_PRODUCTION_URL;
  }

  private invitePath(kind: PartnerInviteKind): string {
    return kind === PARTNER_INVITE_KIND_TEAM ? 'login/equipe' : 'login/onboarding';
  }

  private buildInviteUrl(token: string, kind: PartnerInviteKind): string {
    const path = this.invitePath(kind);
    return `${this.partnerPortalBaseUrl()}/${path}/${encodeURIComponent(token)}`;
  }

  async resolveInviteKindForNetwork(networkId: string): Promise<PartnerInviteKind> {
    const trimmed = networkId.trim();
    const store = loadStore();
    const unitIds = store.units.filter((u) => u.networkId === trimmed).map((u) => u.id);
    if (!unitIds.length) {
      return PARTNER_INVITE_KIND_ONBOARDING;
    }
    const partnerUserCount = await this.partnerAccess.countLinkedUsersForUnits(unitIds);
    return partnerUserCount > 0 ? PARTNER_INVITE_KIND_TEAM : PARTNER_INVITE_KIND_ONBOARDING;
  }

  /**
   * Gera convite único; retorna o token em claro **uma vez** (para montar a URL).
   */
  async createInvite(
    networkId: string,
    createdByUserId: string | null,
    ttlDays = DEFAULT_TTL_DAYS,
  ): Promise<{ token: string; expiresAt: string; inviteUrl: string; inviteKind: PartnerInviteKind }> {
    const trimmed = networkId.trim();
    const store = loadStore();
    const network = store.networks.find((n) => n.id === trimmed);
    if (!network) {
      throw new NotFoundException('Rede não encontrada.');
    }
    const unitIds = store.units.filter((u) => u.networkId === trimmed).map((u) => u.id);
    if (!unitIds.length) {
      throw new BadRequestException('A rede não possui unidades. Adicione ao menos uma unidade antes de convidar.');
    }

    const inviteKind = await this.resolveInviteKindForNetwork(trimmed);

    const token = crypto.randomBytes(TOKEN_BYTES).toString('hex');
    const tokenHash = sha256Hex(token);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + ttlDays);

    await this.invites.save(
      this.invites.create({
        tokenHash,
        networkId: trimmed,
        kind: inviteKind,
        createdByUserId,
        expiresAt,
        usedAt: null,
        usedByUserId: null,
      }),
    );

    const inviteUrl = this.buildInviteUrl(token, inviteKind);

    return {
      token,
      expiresAt: expiresAt.toISOString(),
      inviteUrl,
      inviteKind,
    };
  }

  async getPreviewByToken(
    token: string,
  ): Promise<{ networkId: string; networkName: string; expiresAt: string; inviteKind: PartnerInviteKind }> {
    const row = await this.findValidInvite(token);
    const store = loadStore();
    const network = store.networks.find((n) => n.id === row.networkId);
    if (!network) {
      throw new NotFoundException('Rede não encontrada.');
    }
    const inviteKind =
      row.kind === PARTNER_INVITE_KIND_TEAM ? PARTNER_INVITE_KIND_TEAM : PARTNER_INVITE_KIND_ONBOARDING;

    return {
      networkId: network.id,
      networkName: network.name,
      expiresAt: row.expiresAt.toISOString(),
      inviteKind,
    };
  }

  /**
   * Convite de onboarding: permite reutilizar conta parceira existente (modal + confirmação),
   * vinculando às unidades desta rede — inclusive multi-rede, desde que não seja admin do console.
   */
  private async evaluateExistingUserReuseForInvite(
    userId: string,
    email: string,
    network: AdminNetwork,
    unitIds: string[],
    store: ApiStore,
    inviteKind: PartnerInviteKind,
  ): Promise<ExistingUserReuseDecision> {
    const user = await this.users.findById(userId);
    if (!user?.active) return { allowed: false };
    if (userHasRole(user, UserRole.ADMIN)) return { allowed: false };

    const recipient = this.resolveInviteRecipientForNetwork(network, store);
    const normalized = email.trim().toLowerCase();
    const isInviteRecipient =
      Boolean(recipient) && recipient!.email.trim().toLowerCase() === normalized;

    const linkedUnitIds = await this.partnerAccess.listUnitIdsForUser(userId);
    const linkedToThisNetwork = linkedUnitIds.some((id) => unitIds.includes(id));

    if (inviteKind !== PARTNER_INVITE_KIND_ONBOARDING) {
      if (linkedToThisNetwork || isInviteRecipient) {
        return { allowed: true, requireExistingPassword: false };
      }
      if (linkedUnitIds.some((id) => !unitIds.includes(id))) {
        return { allowed: false };
      }
      return { allowed: false };
    }

    if (linkedToThisNetwork || isInviteRecipient) {
      return { allowed: true, requireExistingPassword: false };
    }

    if (linkedUnitIds.length > 0) {
      if (!userHasRole(user, UserRole.PARTNER)) {
        return { allowed: false };
      }
      return { allowed: true, requireExistingPassword: false };
    }

    if (userHasRole(user, UserRole.PARTNER)) {
      return { allowed: true, requireExistingPassword: false };
    }

    return { allowed: false };
  }

  private async finishInviteForUser(
    row: PartnerOnboardingInvite,
    userId: string,
    unitIds: string[],
  ) {
    for (const unitId of unitIds) {
      await this.partnerAccess.linkUserToUnit(unitId, userId);
    }

    row.usedAt = new Date();
    row.usedByUserId = userId;
    await this.invites.save(row);

    return this.partnerAuth.issueTokensForUserId(userId);
  }

  async completeInvite(
    token: string,
    body: {
      name: string;
      email: string;
      cpf: string;
      mobilePhone: string;
      password: string;
      confirmUpdateExisting?: boolean;
    },
  ) {
    const row = await this.findValidInvite(token);

    const store = loadStore();
    const network = store.networks.find((n) => n.id === row.networkId);
    if (!network) {
      throw new NotFoundException('Rede não encontrada.');
    }

    const unitIds = store.units.filter((u) => u.networkId === row.networkId).map((u) => u.id);
    if (!unitIds.length) {
      throw new BadRequestException('Não há unidades nesta rede.');
    }

    const email = body.email.trim().toLowerCase();
    const existing = await this.users.findByEmail(email);

    if (existing) {
      const inviteKind =
        row.kind === PARTNER_INVITE_KIND_TEAM ? PARTNER_INVITE_KIND_TEAM : PARTNER_INVITE_KIND_ONBOARDING;

      const reuse = await this.evaluateExistingUserReuseForInvite(
        existing.id,
        email,
        network,
        unitIds,
        store,
        inviteKind,
      );

      if (!reuse.allowed) {
        throw new ConflictException('E-mail já cadastrado.');
      }

      if (!body.confirmUpdateExisting) {
        throw new ConflictException({
          message: 'E-mail já cadastrado.',
          code: PARTNER_ONBOARDING_EMAIL_EXISTS_CODE,
          requireExistingPassword:
            inviteKind === PARTNER_INVITE_KIND_ONBOARDING ? false : reuse.requireExistingPassword,
        });
      }

      const personConflict = await this.users.findPersonFieldHolderIds(
        body.cpf,
        body.mobilePhone,
        existing.id,
      );

      if (inviteKind === PARTNER_INVITE_KIND_ONBOARDING) {
        await this.users.releaseConflictingPersonFieldsForPartnerOnboarding(
          body.cpf,
          body.mobilePhone,
          existing.id,
        );
      } else if (personConflict.phoneUserId || personConflict.cpfUserId) {
        throw new ConflictException(
          personConflict.phoneUserId ? 'Celular já cadastrado.' : 'CPF já cadastrado.',
        );
      }

      await this.users.updateForPartnerInvite(existing.id, {
        name: body.name,
        cpf: body.cpf,
        mobilePhone: body.mobilePhone,
        password: body.password,
        roles: [UserRole.PARTNER],
        strictPartnerProfile: true,
      });

      return this.finishInviteForUser(row, existing.id, unitIds);
    }

    const inviteKind =
      row.kind === PARTNER_INVITE_KIND_TEAM ? PARTNER_INVITE_KIND_TEAM : PARTNER_INVITE_KIND_ONBOARDING;

    const personConflict = await this.users.findPersonFieldHolderIds(body.cpf, body.mobilePhone);

    if (!body.confirmUpdateExisting) {
      if (personConflict.phoneUserId) {
        throw new ConflictException({
          message: 'Celular já cadastrado.',
          code: PARTNER_ONBOARDING_PHONE_EXISTS_CODE,
          requireExistingPassword: false,
        });
      }
      if (personConflict.cpfUserId) {
        throw new ConflictException({
          message: 'CPF já cadastrado.',
          code: PARTNER_ONBOARDING_CPF_EXISTS_CODE,
          requireExistingPassword: false,
        });
      }
    } else if (inviteKind === PARTNER_INVITE_KIND_ONBOARDING) {
      await this.users.releaseConflictingPersonFieldsForPartnerOnboarding(
        body.cpf,
        body.mobilePhone,
      );
    }

    const created = await this.users.createWithPassword({
      name: body.name,
      email: body.email,
      cpf: body.cpf,
      mobilePhone: body.mobilePhone,
      password: body.password,
      roles: [UserRole.PARTNER],
      strictPartnerProfile: true,
    });

    return this.finishInviteForUser(row, created.id, unitIds);
  }

  resolveInviteRecipientForNetwork(
    network: AdminNetwork,
    store: ApiStore = loadStore(),
  ): PartnerOnboardingInviteRecipient | null {
    const units = store.units.filter((u) => u.networkId === network.id);
    return resolvePartnerOnboardingInviteRecipient(network, units);
  }

  async listOnboardingEmailMetaByNetwork(
    networks: AdminNetwork[],
    store: ApiStore = loadStore(),
  ): Promise<Map<string, PartnerOnboardingEmailListMeta>> {
    const today = todayDateBr();
    const scopes: Array<{ type: 'unit' | 'network'; id: string }> = [];
    const perNetwork = new Map<string, PartnerOnboardingInviteRecipient | null>();

    for (const network of networks) {
      const resolved = this.resolveInviteRecipientForNetwork(network, store);
      perNetwork.set(network.id, resolved);
      if (resolved) {
        scopes.push({ type: resolved.scopeType, id: resolved.scopeId });
      }
    }

    const blocked = new Set<string>();
    if (scopes.length) {
      const unitIds = scopes.filter((s) => s.type === 'unit').map((s) => s.id);
      const networkIds = scopes.filter((s) => s.type === 'network').map((s) => s.id);
      const rows: PartnerOnboardingEmailSend[] = [];
      if (unitIds.length) {
        rows.push(
          ...(await this.emailSends.find({
            where: { sentOn: today, scopeType: 'unit', scopeId: In(unitIds) },
          })),
        );
      }
      if (networkIds.length) {
        rows.push(
          ...(await this.emailSends.find({
            where: { sentOn: today, scopeType: 'network', scopeId: In(networkIds) },
          })),
        );
      }
      for (const row of rows) {
        blocked.add(`${row.scopeType}:${row.scopeId}`);
      }
    }

    const out = new Map<string, PartnerOnboardingEmailListMeta>();
    for (const network of networks) {
      const resolved = perNetwork.get(network.id) ?? null;
      if (!resolved) {
        out.set(network.id, {
          onboardingInviteEmail: null,
          onboardingInviteEmailSource: null,
          onboardingInviteEmailSentToday: false,
        });
        continue;
      }
      out.set(network.id, {
        onboardingInviteEmail: resolved.email,
        onboardingInviteEmailSource: resolved.source,
        onboardingInviteEmailSentToday: blocked.has(`${resolved.scopeType}:${resolved.scopeId}`),
      });
    }
    return out;
  }

  /**
   * Gera convite, envia por e-mail e registra limite de 1 envio/dia por academia (unidade) ou por rede.
   */
  async sendOnboardingInviteEmail(
    networkId: string,
    createdByUserId: string | null,
  ): Promise<{
    sent: boolean;
    recipientEmail: string;
    inviteUrl: string;
    expiresAt: string;
    inviteKind: PartnerInviteKind;
    reason?: string;
  }> {
    const store = loadStore();
    const network = store.networks.find((n) => n.id === networkId.trim());
    if (!network) {
      throw new NotFoundException('Rede não encontrada.');
    }

    const resolved = this.resolveInviteRecipientForNetwork(network, store);
    if (!resolved) {
      throw new BadRequestException(
        'Nenhum e-mail disponível. Informe o e-mail responsável da rede ou o e-mail da planilha ACAF na unidade.',
      );
    }

    const today = todayDateBr();
    const existing = await this.emailSends.findOne({
      where: {
        scopeType: resolved.scopeType,
        scopeId: resolved.scopeId,
        sentOn: today,
      },
    });
    if (existing) {
      throw new BadRequestException(
        'Já foi enviado um convite por e-mail hoje para esta academia/rede. Tente novamente amanhã.',
      );
    }

    const { inviteUrl, expiresAt, inviteKind } = await this.createInvite(networkId, createdByUserId);
    const expiresDate = new Date(expiresAt);

    const mailResult =
      inviteKind === PARTNER_INVITE_KIND_TEAM
        ? await this.mail.sendPartnerTeamInvite({
            to: resolved.email,
            networkName: network.name,
            inviteUrl,
            expiresAt: expiresDate,
          })
        : await this.mail.sendPartnerOnboardingInvite({
            to: resolved.email,
            networkName: network.name,
            inviteUrl,
            expiresAt: expiresDate,
          });

    if (!mailResult.sent) {
      const manualHint =
        inviteKind === PARTNER_INVITE_KIND_TEAM
          ? 'Não foi possível enviar o e-mail. Use "Gerar link de equipe" e envie manualmente.'
          : 'Não foi possível enviar o e-mail. Use "Gerar link" e envie manualmente.';
      throw new BadRequestException(mailResult.reason ?? manualHint);
    }

    await this.emailSends.save(
      this.emailSends.create({
        scopeType: resolved.scopeType,
        scopeId: resolved.scopeId,
        sentOn: today,
        networkId: network.id,
        recipientEmail: resolved.email,
        createdByUserId,
      }),
    );

    return {
      sent: true,
      recipientEmail: resolved.email,
      inviteUrl,
      expiresAt,
      inviteKind,
    };
  }

  /** Redes com ao menos um convite de onboarding ainda válido (não usado e não expirado). */
  async networkIdsWithPendingInvite(): Promise<Set<string>> {
    const now = new Date();
    const rows = await this.invites
      .createQueryBuilder('invite')
      .select('DISTINCT invite.networkId', 'networkId')
      .where('invite.usedAt IS NULL')
      .andWhere('invite.expiresAt > :now', { now })
      .getRawMany<{ networkId: string }>();

    return new Set(rows.map((row) => row.networkId).filter(Boolean));
  }

  private genericCnpjCheckEmail(): PartnerOnboardingCnpjRequestResult {
    return {
      ok: true,
      status: 'check_email',
      message: CNPJ_RECOVERY_GENERIC_MESSAGE,
      cooldownSeconds: Math.round(CNPJ_CODE_COOLDOWN_MS / 1000),
      codeTtlSeconds: Math.round(CNPJ_CODE_TTL_MS / 1000),
    };
  }

  private alreadyConfiguredResult(): PartnerOnboardingCnpjRequestResult {
    return {
      ok: true,
      status: 'already_configured',
      message: CNPJ_ALREADY_CONFIGURED_MESSAGE,
    };
  }

  private async dummyCodeHash(): Promise<void> {
    await bcrypt.hash(crypto.randomBytes(16).toString('hex'), 10);
  }

  /**
   * Passo prévio quando o link de onboarding foi perdido: identifica pelo CNPJ
   * e envia um código ao e-mail já cadastrado. Não distingue CNPJ desconhecido
   * de cadastro pendente (anti-enumeração).
   */
  async requestCnpjRecovery(rawCnpj: string): Promise<PartnerOnboardingCnpjRequestResult> {
    const startedAt = Date.now();
    const cnpj = normalizeCnpj(rawCnpj);
    if (!isValidCnpj(cnpj)) {
      throw new BadRequestException('Informe um CNPJ válido.');
    }

    try {
      const store = loadStore();
      const networkId = findNetworkIdForCnpj(store, cnpj);
      if (!networkId) {
        await this.dummyCodeHash();
        return this.genericCnpjCheckEmail();
      }

      const network = store.networks.find((n) => n.id === networkId);
      if (!network) {
        await this.dummyCodeHash();
        return this.genericCnpjCheckEmail();
      }

      const inviteKind = await this.resolveInviteKindForNetwork(networkId);
      if (inviteKind === PARTNER_INVITE_KIND_TEAM) {
        const recipient = this.resolveInviteRecipientForNetwork(network, store);
        if (recipient) {
          await this.mail.sendPartnerOnboardingAlreadyConfigured({
            to: recipient.email,
            networkName: network.name,
            loginUrl: `${this.partnerPortalBaseUrl()}/login`,
          });
        }
        return this.alreadyConfiguredResult();
      }

      const recipient = this.resolveInviteRecipientForNetwork(network, store);
      if (!recipient) {
        await this.dummyCodeHash();
        return this.genericCnpjCheckEmail();
      }

      const recent = await this.cnpjChallenges.findOne({
        where: {
          cnpj,
          consumedAt: IsNull(),
          expiresAt: MoreThan(new Date()),
        },
        order: { createdAt: 'DESC' },
      });
      if (recent && Date.now() - recent.createdAt.getTime() < CNPJ_CODE_COOLDOWN_MS) {
        return this.genericCnpjCheckEmail();
      }

      await this.cnpjChallenges.update(
        { cnpj, consumedAt: IsNull() },
        { consumedAt: new Date() },
      );

      const code = String(crypto.randomInt(100000, 1000000));
      const codeHash = await bcrypt.hash(code, 10);
      const expiresAt = new Date(Date.now() + CNPJ_CODE_TTL_MS);
      await this.cnpjChallenges.save(
        this.cnpjChallenges.create({
          cnpj,
          networkId,
          codeHash,
          expiresAt,
        }),
      );

      const mailResult = await this.mail.sendPartnerOnboardingRecoveryCode({
        to: recipient.email,
        networkName: network.name,
        code,
        ttlMinutes: Math.round(CNPJ_CODE_TTL_MS / 60000),
      });
      if (!mailResult.sent) {
        this.logger.warn(
          `Código de onboarding por CNPJ gerado para a rede ${networkId}, e-mail não enviado: ${mailResult.reason ?? 'falha'}`,
        );
      }

      return this.genericCnpjCheckEmail();
    } finally {
      await padElapsed(startedAt, CNPJ_CODE_MIN_RESPONSE_MS);
    }
  }

  async verifyCnpjRecovery(
    rawCnpj: string,
    rawCode: string,
  ): Promise<PartnerOnboardingCnpjVerifyResult> {
    const cnpj = normalizeCnpj(rawCnpj);
    if (!isValidCnpj(cnpj)) {
      throw new BadRequestException('Informe um CNPJ válido.');
    }
    const code = String(rawCode ?? '').trim();
    if (!/^\d{6}$/.test(code)) {
      throw new BadRequestException('Informe o código de 6 dígitos recebido no e-mail.');
    }

    const row = await this.cnpjChallenges.findOne({
      where: {
        cnpj,
        consumedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
      },
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

    const inviteKind = await this.resolveInviteKindForNetwork(row.networkId);
    if (inviteKind === PARTNER_INVITE_KIND_TEAM) {
      row.consumedAt = new Date();
      await this.cnpjChallenges.save(row);
      return { status: 'already_configured', message: CNPJ_ALREADY_CONFIGURED_MESSAGE };
    }

    try {
      const issued = await this.createInvite(row.networkId, null, RECOVERY_INVITE_TTL_DAYS);
      if (issued.inviteKind !== PARTNER_INVITE_KIND_ONBOARDING) {
        row.consumedAt = new Date();
        await this.cnpjChallenges.save(row);
        return { status: 'already_configured', message: CNPJ_ALREADY_CONFIGURED_MESSAGE };
      }
      row.consumedAt = new Date();
      await this.cnpjChallenges.save(row);
      return { status: 'ok', token: issued.token, expiresAt: issued.expiresAt };
    } catch (err) {
      this.logger.error(
        `Falha ao emitir convite após verificação de CNPJ (${row.networkId}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw new BadRequestException('Não foi possível iniciar o cadastro. Fale com o time Movly.');
    }
  }

  private async findValidInvite(token: string): Promise<PartnerOnboardingInvite> {
    const trimmed = token?.trim();
    if (!trimmed) {
      throw new BadRequestException('Convite inválido.');
    }
    const tokenHash = sha256Hex(trimmed);
    const row = await this.invites.findOne({ where: { tokenHash } });
    if (!row) {
      throw new NotFoundException('Convite não encontrado.');
    }
    if (row.usedAt) {
      throw new BadRequestException('Este convite já foi utilizado.');
    }
    if (new Date() > row.expiresAt) {
      throw new BadRequestException('Este convite expirou.');
    }
    return row;
  }
}
