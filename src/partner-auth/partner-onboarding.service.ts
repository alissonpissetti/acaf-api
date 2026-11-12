import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as crypto from 'node:crypto';
import { In, Repository } from 'typeorm';
import { MailService } from '../mail/mail.service';
import { PartnerAccessService } from '../platform-users/partner-access.service';
import { loadStore } from '../partner/store';
import type { AdminNetwork, ApiStore } from '../partner/types';
import { UserRole } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { PartnerAuthService } from './partner-auth.service';
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
const PARTNER_PORTAL_PRODUCTION_URL = 'https://parceiro.sejamovly.com';

function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

export type PartnerOnboardingEmailListMeta = {
  onboardingInviteEmail: string | null;
  onboardingInviteEmailSource: 'network' | 'unit' | null;
  onboardingInviteEmailSentToday: boolean;
};

@Injectable()
export class PartnerOnboardingService {
  constructor(
    @InjectRepository(PartnerOnboardingInvite)
    private readonly invites: Repository<PartnerOnboardingInvite>,
    @InjectRepository(PartnerOnboardingEmailSend)
    private readonly emailSends: Repository<PartnerOnboardingEmailSend>,
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

  async completeInvite(
    token: string,
    body: { name: string; email: string; cpf: string; mobilePhone: string; password: string },
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

    const created = await this.users.createWithPassword({
      name: body.name,
      email: body.email,
      cpf: body.cpf,
      mobilePhone: body.mobilePhone,
      password: body.password,
      roles: [UserRole.PARTNER],
      strictPartnerProfile: true,
    });

    for (const unitId of unitIds) {
      await this.partnerAccess.linkUserToUnit(unitId, created.id);
    }

    row.usedAt = new Date();
    row.usedByUserId = created.id;
    await this.invites.save(row);

    return this.partnerAuth.issueTokensForUserId(created.id);
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
