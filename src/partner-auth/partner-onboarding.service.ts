import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as crypto from 'node:crypto';
import { Repository } from 'typeorm';
import { PartnerAccessService } from '../platform-users/partner-access.service';
import { loadStore } from '../partner/store';
import { UserRole } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { PartnerAuthService } from './partner-auth.service';
import { PartnerOnboardingInvite } from './partner-onboarding-invite.entity';

const TOKEN_BYTES = 24;
const DEFAULT_TTL_DAYS = 14;
const PARTNER_PORTAL_PRODUCTION_URL = 'https://parceiro.sejamovly.com';

function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

@Injectable()
export class PartnerOnboardingService {
  constructor(
    @InjectRepository(PartnerOnboardingInvite)
    private readonly invites: Repository<PartnerOnboardingInvite>,
    private readonly users: UsersService,
    private readonly partnerAccess: PartnerAccessService,
    private readonly partnerAuth: PartnerAuthService,
    private readonly config: ConfigService,
  ) {}

  private partnerPortalBaseUrl(): string {
    const fromEnv = this.config.get<string>('PARTNER_PORTAL_PUBLIC_URL')?.trim().replace(/\/$/, '');
    if (fromEnv) return fromEnv;
    return PARTNER_PORTAL_PRODUCTION_URL;
  }

  /**
   * Gera convite único; retorna o token em claro **uma vez** (para montar a URL).
   */
  async createInvite(
    networkId: string,
    createdByUserId: string | null,
    ttlDays = DEFAULT_TTL_DAYS,
  ): Promise<{ token: string; expiresAt: string; inviteUrl: string }> {
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

    const token = crypto.randomBytes(TOKEN_BYTES).toString('hex');
    const tokenHash = sha256Hex(token);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + ttlDays);

    await this.invites.save(
      this.invites.create({
        tokenHash,
        networkId: trimmed,
        createdByUserId,
        expiresAt,
        usedAt: null,
        usedByUserId: null,
      }),
    );

    const inviteUrl = `${this.partnerPortalBaseUrl()}/login/onboarding/${encodeURIComponent(token)}`;

    return {
      token,
      expiresAt: expiresAt.toISOString(),
      inviteUrl,
    };
  }

  async getPreviewByToken(token: string): Promise<{ networkId: string; networkName: string; expiresAt: string }> {
    const row = await this.findValidInvite(token);
    const store = loadStore();
    const network = store.networks.find((n) => n.id === row.networkId);
    if (!network) {
      throw new NotFoundException('Rede não encontrada.');
    }
    return {
      networkId: network.id,
      networkName: network.name,
      expiresAt: row.expiresAt.toISOString(),
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
