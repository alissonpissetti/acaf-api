import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { CommercialLeadType } from '../commercial/commercial-lead.entity';
import { CommercialLeadsService } from '../commercial/commercial-leads.service';
import { UserRole } from '../users/user.entity';
import { UsersService } from '../users/users.service';

const PUBLIC_INTERACTION = 'Lead captado pelo site público.';

export type SiteContactPayload = {
  profile?: string;
  name?: string;
  email?: string;
  organization?: string;
  phone?: string;
  /** Campo oculto anti-bot; se preenchido, ignoramos o envio. */
  botField?: string;
};

@Injectable()
export class SitePublicService {
  constructor(
    private readonly config: ConfigService,
    private readonly leads: CommercialLeadsService,
    private readonly users: UsersService,
  ) {}

  assertContactSecret(req: Request) {
    const expected = this.config.get<string>('SITE_LEAD_SECRET')?.trim();
    if (!expected) return;
    const provided =
      (req.headers['x-site-lead-secret'] as string | undefined)?.trim() ||
      (req.headers['x-api-key'] as string | undefined)?.trim();
    if (!provided || provided !== expected) {
      throw new UnauthorizedException('Chave de envio inválida.');
    }
  }

  async submitContact(body: SiteContactPayload, req: Request) {
    if (body.botField?.trim()) {
      return { ok: true as const, accepted: true as const, leadId: null };
    }

    const profile = body.profile?.trim() ?? '';
    const name = body.name?.trim() ?? '';
    const email = body.email?.trim().toLowerCase() ?? '';
    const organization = body.organization?.trim() ?? '';
    const phone = body.phone?.trim() ?? '';

    if (!profile) throw new BadRequestException('Selecione o seu perfil.');
    if (!name) throw new BadRequestException('Informe o nome.');
    if (!email) throw new BadRequestException('Informe o e-mail.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('E-mail inválido.');
    }

    const type = mapProfileToLeadType(profile);
    const title = organization || name;
    const ownerUserIds = await this.resolveSiteLeadOwnerUserIds();
    const ownerUserId = ownerUserIds[0]!;

    const noteLines = [
      `Perfil informado no site: ${profile}`,
      organization ? `Empresa ou academia: ${organization}` : null,
      `Origem: site institucional Movly`,
      this.requestContextLine(req),
    ].filter(Boolean);

    const lead = await this.leads.create(
      {
        title,
        type,
        source: 'public_site',
        legalName: organization || undefined,
        email,
        phone: phone || undefined,
        contactName: name,
        notes: noteLines.join('\n'),
        ownerUserIds,
        temperature: 'warm',
      },
      ownerUserId,
    );

    await this.leads.addInteraction(lead.id, ownerUserId, PUBLIC_INTERACTION);

    return {
      ok: true as const,
      leadId: lead.id,
      message: 'Recebemos seu contato. Em breve a equipe comercial retorna.',
    };
  }

  private requestContextLine(req: Request) {
    const referer = req.headers.referer?.slice(0, 300);
    const ip = extractIp(req);
    const parts = [referer ? `Referrer: ${referer}` : null, ip ? `IP: ${ip}` : null].filter(Boolean);
    return parts.length ? parts.join(' · ') : null;
  }

  /** Todos os console admins ativos — visíveis para a equipe comercial no funil. */
  private async resolveSiteLeadOwnerUserIds(): Promise<string[]> {
    const fromEnv = this.config.get<string>('SITE_LEAD_OWNER_USER_ID')?.trim();
    if (fromEnv) {
      const admins = await this.users.findAll();
      const match = admins.find((user) => user.id === fromEnv && user.active);
      if (!match) {
        throw new ForbiddenException('Responsável comercial do site não está disponível.');
      }
      return [fromEnv];
    }

    const admins = await this.users.findAll();
    const activeAdmins = admins
      .filter((user) => user.active !== false && (user.roles?.includes(UserRole.ADMIN) ?? false))
      .map((user) => user.id);
    if (activeAdmins.length) {
      return activeAdmins;
    }

    const fallback = admins.find((user) => user.active);
    if (!fallback) {
      throw new BadRequestException('Nenhum usuário admin disponível para receber o lead.');
    }
    return [fallback.id];
  }
}

function mapProfileToLeadType(profile: string): CommercialLeadType | null {
  const normalized = profile.toLowerCase();
  if (normalized.includes('academia') || normalized.includes('estúdio') || normalized.includes('estudio')) {
    return 'partner';
  }
  if (
    normalized.includes('empresa') ||
    normalized.includes('rh') ||
    normalized.includes('gestor') ||
    normalized.includes('colaborador indicando')
  ) {
    return 'corporate';
  }
  return null;
}

function extractIp(req: Request) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0]?.trim().slice(0, 64) ?? null;
  }
  if (Array.isArray(forwarded) && forwarded[0]) {
    return String(forwarded[0]).split(',')[0]?.trim().slice(0, 64) ?? null;
  }
  return req.socket?.remoteAddress?.slice(0, 64) ?? null;
}
