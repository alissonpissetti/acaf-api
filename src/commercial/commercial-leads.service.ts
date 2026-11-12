import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  formatCnpj,
  formatMobilePhone,
  isValidCnpj,
  isValidMobilePhone,
  normalizeCnpj,
  normalizeMobilePhone,
  resolveBrazilMobilePhone,
} from '../users/person.utils';
import { UsersService } from '../users/users.service';
import { AdminService } from '../partner/admin.service';
import { CommercialLead, type CommercialLeadType, type CommercialLeadTemperature } from './commercial-lead.entity';
import { CommercialLeadInteraction } from './commercial-lead-interaction.entity';
import { CommercialLeadContact } from './commercial-lead-contact.entity';
import { CommercialLeadOwner } from './commercial-lead-owner.entity';
import { CommercialFunnelsService } from './commercial-funnels.service';
import { CommercialLossReasonsService } from './commercial-loss-reasons.service';
import { CommercialLeadAuditService } from './commercial-lead-audit.service';
import type { CommercialLeadAuditChange } from './commercial-lead-audit.entity';
import { CommercialFunnelStage } from './commercial-funnel-stage.entity';
import { CommercialFunnel } from './commercial-funnel.entity';
import { EvolutionContactProfile } from '../evolution/evolution-contact-profile.entity';
import { EvolutionMessage } from '../evolution/evolution-message.entity';
import {
  type CommercialLeadSource,
  inferCommercialLeadSource,
  isCommercialLeadSource,
  leadSourceMeta,
} from './commercial-lead-source';
import { UserRole, userHasRole } from '../users/user.entity';
import {
  canAutoCreateWhatsAppLead,
  isHumanContactName,
  normalizedBrazilMobileKey,
  phoneKeyFromJid,
} from '../evolution/evolution-contact.resolver';
import { resolveContactFromEvolutionPayload } from '../evolution/evolution-message.parser';

type LeadOwnerDto = {
  userId: string;
  name: string | null;
  avatarUrl: string | null;
  avatarColor: string | null;
};

type LeadContactDto = {
  id: string;
  name: string;
  role: string | null;
  phone: string | null;
  email: string | null;
  isPrimary: boolean;
  sortOrder: number;
};

type LeadContactInput = {
  id?: string;
  name: string;
  role?: string | null;
  phone?: string | null;
  email?: string | null;
  isPrimary?: boolean;
};

type LeadDto = {
  id: string;
  funnelId: string;
  funnelName: string;
  stageId: string;
  stage: string;
  stageLabel: string;
  stageOutcome: string;
  title: string;
  type: CommercialLeadType | null;
  typeLabel: string | null;
  source: CommercialLeadSource;
  sourceLabel: string;
  sourceColor: string;
  sourceSoft: string;
  temperature: CommercialLeadTemperature;
  temperatureLabel: string;
  legalName: string | null;
  cnpj: string | null;
  email: string | null;
  phone: string | null;
  contactName: string | null;
  whatsappContactKey: string | null;
  contacts: LeadContactDto[];
  notes: string | null;
  ownerUserId: string;
  ownerName: string | null;
  ownerAvatarUrl: string | null;
  ownerAvatarColor: string | null;
  owners: LeadOwnerDto[];
  createdByUserId: string;
  createdByName: string | null;
  convertedNetworkId: string | null;
  convertedCompanyId: string | null;
  converted: boolean;
  sortOrder: number;
  lastInteractionAt: string | null;
  latestInteractionContent: string | null;
  lossReasonId: string | null;
  lossReasonLabel: string | null;
  stageEnteredAt: string | null;
  stageExpiredAt: string | null;
  stageExpired: boolean;
  stageMaxDaysInStage: number | null;
  stageDeadlineAt: string | null;
  createdAt: string;
  updatedAt: string;
};

function nextLeadSortOrder(): number {
  return Math.floor(Date.now() / 1000);
}

function temperatureLabel(temperature: CommercialLeadTemperature): string {
  if (temperature === 'warm') return 'Morno';
  if (temperature === 'hot') return 'Quente';
  return 'Frio';
}

function parseTemperature(value?: string | null): CommercialLeadTemperature {
  if (value === 'warm' || value === 'hot') return value;
  return 'cold';
}

function whatsAppContactAliasKeys(contactKey: string, phone?: string | null): string[] {
  const keys = new Set<string>();
  const ck = String(contactKey ?? '').trim();
  if (ck) keys.add(ck);

  const lidDigits = ck.replace(/^lid:/i, '').replace(/\D/g, '');
  if (lidDigits.length >= 8) {
    keys.add(lidDigits);
    keys.add(`lid:${lidDigits}`);
  }

  const ph = phone ? normalizeMobilePhone(phone) : '';
  if (ph && isValidMobilePhone(ph)) keys.add(ph);

  return [...keys].filter(Boolean);
}

function canonicalWhatsAppContactKey(contactKey: string, phone?: string | null): string {
  const ph = phone ? normalizeMobilePhone(phone) : '';
  if (ph && isValidMobilePhone(ph)) return ph;
  const ck = String(contactKey ?? '').trim();
  if (ck.startsWith('lid:')) return ck;
  const fromCk = resolveBrazilMobilePhone(ck);
  if (fromCk) return fromCk;
  const digits = ck.replace(/\D/g, '');
  if (digits.length >= 8 && /^\d+$/.test(ck)) {
    const normalized = normalizeMobilePhone(digits);
    if (isValidMobilePhone(normalized)) return normalized;
    return `lid:${digits}`;
  }
  return ck;
}

function preferOpenWhatsAppLead(rows: CommercialLead[]): CommercialLead | null {
  if (!rows.length) return null;
  return rows.find(leadIsOpen) ?? null;
}

function expandWhatsAppReferenceKeys(
  contactKey: string,
  phone?: string | null,
  extraAliasKeys?: string[],
): string[] {
  const seed = [...whatsAppContactAliasKeys(contactKey, phone), ...(extraAliasKeys ?? [])];
  const keys = new Set<string>();
  for (const raw of seed) {
    const item = String(raw ?? '').trim();
    if (!item) continue;
    keys.add(item);
    keys.add(canonicalWhatsAppContactKey(item, phone));
    keys.add(normalizeWhatsAppGroupKey(item));
    const resolved = resolveBrazilMobilePhone(item);
    if (resolved) {
      keys.add(resolved);
      keys.add(canonicalWhatsAppContactKey(resolved, resolved));
    }
  }
  keys.add(canonicalWhatsAppContactKey(contactKey, phone));
  keys.add(normalizeWhatsAppGroupKey(canonicalWhatsAppContactKey(contactKey, phone)));
  return [...keys].filter(Boolean);
}

function extractWhatsAppMarkerFromNotes(notes: string | null | undefined): string | null {
  const match = String(notes ?? '').match(/whatsapp-contact:([^\s.]+)/i);
  return match?.[1]?.trim() || null;
}

function normalizeWhatsAppGroupKey(key: string | null | undefined): string {
  const raw = String(key ?? '').trim();
  if (!raw) return '';
  const fromNotes = extractWhatsAppMarkerFromNotes(raw);
  const value = fromNotes || raw;
  const digits = value.replace(/^lid:/i, '').replace(/\D/g, '');
  if (digits.length >= 8 && !isValidMobilePhone(normalizeMobilePhone(digits))) {
    return `lid:${digits}`;
  }
  const phone = normalizeMobilePhone(value.replace(/^lid:/i, ''));
  if (isValidMobilePhone(phone)) return phone;
  return value;
}

function leadIsOpen(lead: CommercialLead): boolean {
  return !lead.convertedNetworkId && !lead.convertedCompanyId;
}

@Injectable()
export class CommercialLeadsService {
  constructor(
    @InjectRepository(CommercialLead)
    private readonly leads: Repository<CommercialLead>,
    @InjectRepository(CommercialLeadInteraction)
    private readonly interactions: Repository<CommercialLeadInteraction>,
    @InjectRepository(CommercialLeadOwner)
    private readonly leadOwners: Repository<CommercialLeadOwner>,
    @InjectRepository(CommercialLeadContact)
    private readonly leadContacts: Repository<CommercialLeadContact>,
    @InjectRepository(CommercialFunnel)
    private readonly funnels: Repository<CommercialFunnel>,
    @InjectRepository(CommercialFunnelStage)
    private readonly stages: Repository<CommercialFunnelStage>,
    @InjectRepository(EvolutionContactProfile)
    private readonly evolutionProfiles: Repository<EvolutionContactProfile>,
    @InjectRepository(EvolutionMessage)
    private readonly evolutionMessages: Repository<EvolutionMessage>,
    private readonly funnelService: CommercialFunnelsService,
    private readonly lossReasons: CommercialLossReasonsService,
    private readonly audit: CommercialLeadAuditService,
    private readonly users: UsersService,
    private readonly admin: AdminService,
  ) {}

  async list(filters?: {
    funnelId?: string;
    ownerUserId?: string;
    type?: CommercialLeadType;
    limit?: number;
  }) {
    const limit = Math.min(Math.max(filters?.limit ?? 500, 1), 2000);
    const qb = this.leads
      .createQueryBuilder('lead')
      .orderBy('lead.sortOrder', 'ASC')
      .addOrderBy('lead.updatedAt', 'DESC')
      .take(limit);

    if (filters?.funnelId) {
      qb.andWhere('lead.funnelId = :funnelId', { funnelId: filters.funnelId });
    }
    if (filters?.ownerUserId) {
      qb.andWhere(
        '(lead.ownerUserId = :ownerUserId OR EXISTS (SELECT 1 FROM acaf_commercial_lead_owners lo WHERE lo.lead_id = lead.id AND lo.user_id = :ownerUserId))',
        { ownerUserId: filters.ownerUserId },
      );
    }
    if (filters?.type) {
      qb.andWhere('lead.type = :type', { type: filters.type });
    }

    const rows = await qb.getMany();
    const stageMap = await this.loadStageMap(rows.map((row) => row.stageId));
    const latestInteractionMap = await this.loadLatestInteractionMap(rows.map((row) => row.id));
    const ownersMap = await this.loadOwnersMap(rows);
    const contactsMap = await this.loadContactsMap(rows);
    const funnelMap = await this.loadFunnelMap(rows.map((row) => row.funnelId));
    const lossReasonLabels = await this.lossReasons.labelMap(
      rows.map((row) => row.lossReasonId ?? '').filter(Boolean),
    );
    const dtoContext = { funnels: funnelMap, lossReasonLabels };
    return Promise.all(
      rows.map((row) =>
        this.toDto(
          row,
          stageMap.get(row.stageId) ?? null,
          latestInteractionMap.get(row.id) ?? null,
          ownersMap.get(row.id) ?? [],
          contactsMap.get(row.id) ?? [],
          dtoContext,
        ),
      ),
    );
  }

  async get(id: string) {
    const lead = await this.leads.findOne({ where: { id } });
    if (!lead) throw new NotFoundException('Lead não encontrado.');
    const stage = await this.stages.findOne({ where: { id: lead.stageId } });
    await this.syncStageExpiration(lead, stage);
    const latestMap = await this.loadLatestInteractionMap([lead.id]);
    const ownersMap = await this.loadOwnersMap([lead]);
    const contactsMap = await this.loadContactsMap([lead]);
    return this.toDto(
      lead,
      stage,
      latestMap.get(lead.id) ?? null,
      ownersMap.get(lead.id) ?? [],
      contactsMap.get(lead.id) ?? [],
    );
  }

  async listInteractions(leadId: string) {
    const lead = await this.leads.findOne({ where: { id: leadId } });
    if (!lead) throw new NotFoundException('Lead não encontrado.');

    const rows = await this.interactions.find({
      where: { leadId },
      order: { createdAt: 'DESC' },
    });

    return Promise.all(rows.map((row) => this.interactionDto(row)));
  }

  async addInteraction(
    leadId: string,
    userId: string,
    content: string,
    source: CommercialLeadInteraction['source'] = 'manual',
  ) {
    const text = content.trim();
    if (!text) throw new BadRequestException('Informe o texto da interação.');
    if (text.length > 500) {
      throw new BadRequestException('Interação muito longa (máximo de 500 caracteres).');
    }

    const lead = await this.leads.findOne({ where: { id: leadId } });
    if (!lead) throw new NotFoundException('Lead não encontrado.');

    const saved = await this.interactions.save(
      this.interactions.create({
        leadId,
        userId,
        content: text,
        source,
        createdAt: new Date(),
      }),
    );

    lead.lastInteractionAt = saved.createdAt;
    await this.leads.save(lead);

    const stage = await this.stages.findOne({ where: { id: lead.stageId } });
    const ownersMap = await this.loadOwnersMap([lead]);
    const contactsMap = await this.loadContactsMap([lead]);
    return {
      interaction: await this.interactionDto(saved),
      lead: await this.toDto(
        lead,
        stage,
        text,
        ownersMap.get(lead.id) ?? [],
        contactsMap.get(lead.id) ?? [],
      ),
    };
  }

  async ingestWhatsAppInteraction(
    leadId: string,
    content: string,
    externalId: string,
    createdAt?: Date,
  ) {
    const text = content.trim();
    if (!text) throw new BadRequestException('Mensagem vazia.');
    if (!externalId.trim()) throw new BadRequestException('Identificador externo obrigatório.');

    const existing = await this.interactions.findOne({
      where: { leadId, externalId: externalId.trim(), source: 'whatsapp' },
    });
    if (existing) {
      return { interaction: await this.interactionDto(existing), duplicate: true as const };
    }

    const lead = await this.leads.findOne({ where: { id: leadId } });
    if (!lead) throw new NotFoundException('Lead não encontrado.');

    const interactionAt =
      createdAt instanceof Date && !Number.isNaN(createdAt.getTime()) ? createdAt : new Date();

    const saved = await this.interactions.save(
      this.interactions.create({
        leadId,
        userId: null,
        content: text,
        source: 'whatsapp',
        externalId: externalId.trim(),
        createdAt: interactionAt,
      }),
    );

    if (!lead.lastInteractionAt || saved.createdAt > lead.lastInteractionAt) {
      lead.lastInteractionAt = saved.createdAt;
      await this.leads.save(lead);
    }

    return {
      interaction: await this.interactionDto(saved),
      duplicate: false as const,
    };
  }

  async recordInteraction(
    id: string,
    userId: string,
    kind?: 'call' | 'whatsapp' | 'email',
  ) {
    const labels: Record<'call' | 'whatsapp' | 'email', string> = {
      call: 'Ligação realizada',
      whatsapp: 'Contato por mensagem no celular',
      email: 'E-mail enviado',
    };

    if (kind && labels[kind]) {
      return this.addInteraction(id, userId, labels[kind], 'system');
    }

    const lead = await this.leads.findOne({ where: { id } });
    if (!lead) throw new NotFoundException('Lead não encontrado.');
    lead.lastInteractionAt = new Date();
    await this.leads.save(lead);
    const stage = await this.stages.findOne({ where: { id: lead.stageId } });
    const latestMap = await this.loadLatestInteractionMap([lead.id]);
    const ownersMap = await this.loadOwnersMap([lead]);
    const contactsMap = await this.loadContactsMap([lead]);
    return this.toDto(
      lead,
      stage,
      latestMap.get(lead.id) ?? null,
      ownersMap.get(lead.id) ?? [],
      contactsMap.get(lead.id) ?? [],
    );
  }

  async create(
    input: {
      title: string;
      type?: CommercialLeadType | null;
      funnelId?: string;
      stageId?: string;
      source?: CommercialLeadSource;
      legalName?: string;
      cnpj?: string;
      email?: string;
      phone?: string;
      contactName?: string;
      contacts?: LeadContactInput[];
      notes?: string;
      whatsappContactKey?: string | null;
      ownerUserId?: string;
      ownerUserIds?: string[];
      temperature?: CommercialLeadTemperature;
    },
    createdByUserId: string,
  ) {
    const title = input.title.trim();
    if (!title) throw new BadRequestException('Informe o nome do lead.');

    let type: CommercialLeadType | null = null;
    if (input.type != null && String(input.type).trim() !== '') {
      if (input.type !== 'partner' && input.type !== 'corporate') {
        throw new BadRequestException('Tipo de lead inválido.');
      }
      type = input.type;
    }

    const funnel = input.funnelId
      ? await this.funnelService.getFunnelWithStages(input.funnelId)
      : await this.funnelService.getDefaultFunnel();

    if (!funnel) {
      throw new BadRequestException(
        'Nenhum funil comercial ativo. Marque um funil como padrão para novos leads no administrativo.',
      );
    }

    let firstStage: CommercialFunnelStage | null = null;
    const requestedStageId = input.stageId?.trim();
    if (requestedStageId) {
      const stage = funnel.stages.find(
        (row) => row.id === requestedStageId && row.active && row.outcome === 'pipeline',
      );
      if (!stage) {
        throw new BadRequestException('Etapa inicial do funil inválida.');
      }
      firstStage = stage;
    } else {
      firstStage = this.funnelService.getFirstPipelineStage(funnel);
    }
    if (!firstStage) {
      throw new BadRequestException('Funil sem etapa inicial de pipeline.');
    }

    const ownerUserIds = this.resolveOwnerUserIds(
      input.ownerUserIds,
      input.ownerUserId,
      createdByUserId,
    );
    await this.assertAdminOwners(ownerUserIds);
    const ownerUserId = ownerUserIds[0];

    const cnpj = input.cnpj ? normalizeCnpj(input.cnpj) : null;
    if (cnpj && !isValidCnpj(cnpj)) {
      throw new BadRequestException('CNPJ inválido.');
    }

    const phoneRaw = input.phone ? resolveBrazilMobilePhone(input.phone) : null;
    if (input.phone?.trim() && !phoneRaw) {
      throw new BadRequestException('Telefone inválido.');
    }

    const normalizedContacts = this.normalizeContactInputs(input.contacts, {
      contactName: input.contactName,
      phone: input.phone,
      email: input.email,
    });
    this.validateContactInputs(normalizedContacts);
    const primaryContact = normalizedContacts.find((contact) => contact.isPrimary) ?? normalizedContacts[0];

    let source: CommercialLeadSource = 'manual';
    if (input.source != null && String(input.source).trim()) {
      const raw = String(input.source).trim();
      if (!isCommercialLeadSource(raw)) {
        throw new BadRequestException('Origem do lead inválida.');
      }
      source = raw;
    }

    const now = new Date();
    const saved = await this.leads.save(
      this.leads.create({
        title,
        type,
        source,
        temperature: parseTemperature(input.temperature),
        funnelId: funnel.id,
        stageId: firstStage.id,
        legalName: input.legalName?.trim() || null,
        cnpj,
        email: primaryContact?.email ?? (input.email?.toLowerCase().trim() || null),
        phone: primaryContact?.phone ?? (phoneRaw || null),
        contactName: primaryContact?.name ?? (input.contactName?.trim() || null),
        notes: input.notes?.trim() || null,
        whatsappContactKey: input.whatsappContactKey?.trim() || null,
        ownerUserId,
        createdByUserId,
        sortOrder: nextLeadSortOrder(),
        lastInteractionAt: now,
        stageEnteredAt: now,
      }),
    );

    await this.syncLeadOwners(saved.id, ownerUserIds);
    if (normalizedContacts.length) {
      await this.syncLeadContacts(saved.id, normalizedContacts);
    }

    await this.audit.record(saved.id, createdByUserId, [
      {
        field: 'create',
        label: 'Lead criado',
        from: null,
        to: saved.title,
      },
    ]);

    const stage = await this.stages.findOne({ where: { id: saved.stageId } });
    const ownersMap = await this.loadOwnersMap([saved]);
    const contactsMap = await this.loadContactsMap([saved]);
    return this.toDto(
      saved,
      stage,
      null,
      ownersMap.get(saved.id) ?? [],
      contactsMap.get(saved.id) ?? [],
    );
  }

  async update(
    id: string,
    patch: {
      title?: string;
      type?: CommercialLeadType | null;
      stageId?: string;
      legalName?: string | null;
      cnpj?: string | null;
      email?: string | null;
      phone?: string | null;
      contactName?: string | null;
      contacts?: LeadContactInput[];
      notes?: string | null;
      ownerUserId?: string;
      ownerUserIds?: string[];
      temperature?: CommercialLeadTemperature;
      sortOrder?: number;
      lossReasonId?: string;
      lossReasonCustom?: string;
    },
    actingUserId?: string,
  ) {
    const lead = await this.leads.findOne({ where: { id } });
    if (!lead) throw new NotFoundException('Lead não encontrado.');

    const auditChanges: CommercialLeadAuditChange[] = [];
    const ownerIdsBefore = await this.getLeadOwnerUserIds(lead.id, lead.ownerUserId);
    const stageBefore = await this.stages.findOne({ where: { id: lead.stageId } });

    if (lead.convertedNetworkId || lead.convertedCompanyId) {
      if (patch.stageId != null) {
        throw new BadRequestException('Lead já convertido em cadastro.');
      }
    }

    if (patch.title != null) {
      const title = patch.title.trim();
      if (!title) throw new BadRequestException('Informe o nome do lead.');
      if (title !== lead.title) {
        auditChanges.push({
          field: 'title',
          label: 'Nome do lead',
          from: lead.title,
          to: title,
        });
      }
      lead.title = title;
    }

    if (patch.type !== undefined) {
      const prevLabel = this.typeAuditLabel(lead.type);
      if (!patch.type) {
        lead.type = null;
      } else if (patch.type !== 'partner' && patch.type !== 'corporate') {
        throw new BadRequestException('Tipo de lead inválido.');
      } else {
        lead.type = patch.type;
      }
      const nextLabel = this.typeAuditLabel(lead.type);
      if (prevLabel !== nextLabel) {
        auditChanges.push({ field: 'type', label: 'Tipo', from: prevLabel, to: nextLabel });
      }
    }

    if (patch.temperature !== undefined) {
      const prev = temperatureLabel(parseTemperature(lead.temperature));
      lead.temperature = parseTemperature(patch.temperature);
      const next = temperatureLabel(lead.temperature);
      if (prev !== next) {
        auditChanges.push({ field: 'temperature', label: 'Temperatura', from: prev, to: next });
      }
    }

    let outcomeResult: Awaited<ReturnType<CommercialLeadsService['applyStageOutcome']>> | null = null;
    let stageChanged = false;

    if (patch.stageId != null && patch.stageId !== lead.stageId) {
      const previousStage = await this.stages.findOne({ where: { id: lead.stageId } });
      const stage = await this.funnelService.getStage(patch.stageId);
      if (stage.funnelId !== lead.funnelId) {
        throw new BadRequestException('Etapa inválida para o funil do lead.');
      }

      const enteringLost =
        stage.outcome === 'lost' && previousStage?.outcome !== 'lost';
      let lossReasonLabel: string | null = null;
      if (enteringLost) {
        const reasonId = await this.lossReasons.resolveForLost({
          lossReasonId: patch.lossReasonId,
          lossReasonCustom: patch.lossReasonCustom,
        });
        lead.lossReasonId = reasonId;
        lossReasonLabel = await this.lossReasons.getLabel(reasonId);
      }

      auditChanges.push({
        field: 'stage',
        label: 'Etapa do funil',
        from: stageBefore?.name ?? '—',
        to: stage.name,
      });

      lead.stageId = patch.stageId;
      stageChanged = true;
      outcomeResult = await this.applyStageOutcome(lead, stage, actingUserId ?? lead.ownerUserId);
      if (outcomeResult) {
        const reloaded = await this.leads.findOne({ where: { id: lead.id } });
        if (reloaded) {
          Object.assign(lead, reloaded);
        }
      }
      this.resetStageTimer(lead);
      this.touchLastInteraction(lead);

      if (lossReasonLabel && actingUserId) {
        await this.addInteraction(
          lead.id,
          actingUserId,
          `Motivo da perda: ${lossReasonLabel}`,
        );
      } else if (lossReasonLabel) {
        await this.addInteraction(lead.id, lead.ownerUserId, `Motivo da perda: ${lossReasonLabel}`);
      }
    }

    if (patch.legalName !== undefined) {
      const next = patch.legalName?.trim() || null;
      if ((lead.legalName ?? '') !== (next ?? '')) {
        auditChanges.push({
          field: 'legalName',
          label: 'Razão social',
          from: lead.legalName,
          to: next,
        });
      }
      lead.legalName = next;
    }

    if (patch.cnpj !== undefined) {
      const cnpj = patch.cnpj ? normalizeCnpj(patch.cnpj) : null;
      if (cnpj && !isValidCnpj(cnpj)) throw new BadRequestException('CNPJ inválido.');
      const prev = lead.cnpj ? formatCnpj(lead.cnpj) : null;
      const next = cnpj ? formatCnpj(cnpj) : null;
      if (prev !== next) {
        auditChanges.push({ field: 'cnpj', label: 'CNPJ', from: prev, to: next });
      }
      lead.cnpj = cnpj;
    }

    if (patch.contacts !== undefined) {
      const normalizedContacts = this.normalizeContactInputs(patch.contacts, {
        contactName: lead.contactName,
        phone: lead.phone,
        email: lead.email,
      });
      const primary =
        normalizedContacts.find((contact) => contact.isPrimary) ?? normalizedContacts[0] ?? null;
      if (primary && !primary.phone && lead.phone) {
        primary.phone = lead.phone;
      }
      this.validateContactInputs(normalizedContacts);
      await this.syncLeadContacts(lead.id, normalizedContacts);
      this.applyPrimaryContactToLead(lead, normalizedContacts);
      auditChanges.push({
        field: 'contacts',
        label: 'Contatos',
        from: 'Anterior',
        to: 'Lista atualizada',
      });
    } else {
      if (patch.email !== undefined) {
        lead.email = patch.email?.toLowerCase().trim() || null;
      }

      if (patch.phone !== undefined) {
        const phoneRaw = patch.phone ? resolveBrazilMobilePhone(patch.phone) : null;
        if (patch.phone?.trim() && !phoneRaw) {
          throw new BadRequestException('Telefone inválido.');
        }
        lead.phone = phoneRaw || null;
      }

      if (patch.contactName !== undefined) {
        lead.contactName = patch.contactName?.trim() || null;
      }
    }

    if (patch.notes !== undefined) {
      const next = patch.notes?.trim() || null;
      if ((lead.notes ?? '') !== (next ?? '')) {
        auditChanges.push({
          field: 'notes',
          label: 'Observações',
          from: lead.notes?.trim() || null,
          to: next,
        });
      }
      lead.notes = next;
    }

    if (patch.ownerUserIds !== undefined) {
      const ownerUserIds = this.resolveOwnerUserIds(patch.ownerUserIds);
      await this.assertAdminOwners(ownerUserIds);
      const prevNames = await this.ownerNamesForAudit(ownerIdsBefore);
      const nextNames = await this.ownerNamesForAudit(ownerUserIds);
      if (prevNames !== nextNames) {
        auditChanges.push({
          field: 'owners',
          label: 'Responsáveis',
          from: prevNames || '—',
          to: nextNames || '—',
        });
      }
      lead.ownerUserId = ownerUserIds[0];
      await this.syncLeadOwners(lead.id, ownerUserIds);
    } else if (patch.ownerUserId != null) {
      const ownerUserIds = this.resolveOwnerUserIds(undefined, patch.ownerUserId);
      await this.assertAdminOwners(ownerUserIds);
      lead.ownerUserId = ownerUserIds[0];
      await this.syncLeadOwners(lead.id, ownerUserIds);
    }

    if (patch.sortOrder != null) {
      lead.sortOrder = patch.sortOrder;
    }

    const patchKeys = Object.keys(patch).filter((key) => patch[key as keyof typeof patch] !== undefined);
    const sortOrderOnly = patchKeys.length === 1 && patchKeys[0] === 'sortOrder';
    if (!sortOrderOnly && !stageChanged) {
      this.touchLastInteraction(lead);
    }

    const saved = await this.leads.save(lead);
    await this.audit.record(saved.id, actingUserId, auditChanges);
    const stage = await this.stages.findOne({ where: { id: saved.stageId } });
    await this.syncStageExpiration(saved, stage);
    const latestMap = await this.loadLatestInteractionMap([saved.id]);
    const ownersMap = await this.loadOwnersMap([saved]);
    const contactsMap = await this.loadContactsMap([saved]);
    const dto = await this.toDto(
      saved,
      stage,
      latestMap.get(saved.id) ?? null,
      ownersMap.get(saved.id) ?? [],
      contactsMap.get(saved.id) ?? [],
    );

    if (outcomeResult) {
      return { lead: dto, outcome: outcomeResult };
    }

    return dto;
  }

  async convert(id: string, actingUserId: string) {
    const lead = await this.leads.findOne({ where: { id } });
    if (!lead) throw new NotFoundException('Lead não encontrado.');

    const conversion = await this.executeConvert(lead, actingUserId);
    const refreshed = await this.leads.findOneOrFail({ where: { id: lead.id } });
    const transferOutcome = await this.applyTransferAction(refreshed, 'won');

    const finalLead = await this.leads.findOneOrFail({ where: { id: refreshed.id } });
    const stage = await this.stages.findOne({ where: { id: finalLead.stageId } });
    const latestMap = await this.loadLatestInteractionMap([finalLead.id]);
    const ownersMap = await this.loadOwnersMap([finalLead]);
    const contactsMap = await this.loadContactsMap([finalLead]);

    return {
      lead: await this.toDto(
        finalLead,
        stage,
        latestMap.get(finalLead.id) ?? null,
        ownersMap.get(finalLead.id) ?? [],
        contactsMap.get(finalLead.id) ?? [],
      ),
      conversion,
      outcome: transferOutcome,
    };
  }

  /** Exclusão definitiva do lead e de todo o histórico vinculado (interações, auditoria, etc.). */
  async remove(id: string): Promise<{ deleted: true; id: string }> {
    const lead = await this.leads.findOne({ where: { id } });
    if (!lead) throw new NotFoundException('Lead não encontrado.');
    if (lead.convertedNetworkId || lead.convertedCompanyId) {
      throw new BadRequestException(
        'Este lead já foi convertido em cadastro e não pode ser excluído por aqui.',
      );
    }
    await this.detachLeadForeignKeys([id]);
    await this.deleteLeadRows([id]);
    return { deleted: true, id };
  }

  private async detachLeadForeignKeys(leadIds: string[]): Promise<void> {
    const ids = [...new Set(leadIds.filter(Boolean))];
    if (!ids.length) return;

    await this.evolutionMessages.update({ leadId: In(ids) }, { leadId: null });
    await this.evolutionProfiles.update({ leadId: In(ids) }, { leadId: null });
    await this.leads.manager.query(
      `UPDATE acaf_marketing_form_submissions SET lead_id = NULL WHERE lead_id IN (${ids.map(() => '?').join(',')})`,
      ids,
    );
  }

  private async deleteLeadRows(leadIds: string[]): Promise<void> {
    const ids = [...new Set(leadIds.filter(Boolean))];
    if (!ids.length) return;

    await this.interactions.delete({ leadId: In(ids) });
    await this.leadOwners.delete({ leadId: In(ids) });
    await this.leadContacts.delete({ leadId: In(ids) });
    await this.audit.deleteForLeads(ids);
    await this.leads.delete({ id: In(ids) });
  }

  private async executeConvert(lead: CommercialLead, actingUserId: string) {
    if (lead.convertedNetworkId || lead.convertedCompanyId) {
      throw new BadRequestException('Lead já convertido em cadastro.');
    }

    const stage = await this.funnelService.getStage(lead.stageId);
    if (stage.outcome === 'lost') {
      throw new BadRequestException('Não é possível converter um lead perdido.');
    }

    const ownerUserId = lead.ownerUserId || actingUserId;

    if (!lead.type) {
      throw new BadRequestException('Defina o tipo do lead antes de converter em cadastro.');
    }

    if (lead.type === 'partner') {
      const network = await this.admin.createNetwork(lead.title, undefined, ownerUserId);
      lead.convertedNetworkId = network.id;

      const wonStage = await this.stages.findOne({
        where: { funnelId: lead.funnelId, outcome: 'won', active: true },
      });
      if (wonStage) lead.stageId = wonStage.id;

      await this.leads.save(lead);

      return {
        kind: 'partner' as const,
        networkId: network.id,
        networkName: network.name,
        route: `/m/operacao/redes?id=${encodeURIComponent(network.id)}`,
      };
    }

    const cnpj = lead.cnpj ? normalizeCnpj(lead.cnpj) : '';
    if (!cnpj || !isValidCnpj(cnpj)) {
      throw new BadRequestException('Informe um CNPJ válido antes de converter a empresa.');
    }

    const email = lead.email?.trim();
    if (!email) {
      throw new BadRequestException('Informe o e-mail da empresa antes de converter.');
    }

    const company = await this.admin.createCompany(
      {
        legalName: lead.legalName?.trim() || lead.title,
        tradeName: lead.title,
        cnpj,
        email,
        phone: lead.phone ?? undefined,
      },
      ownerUserId,
    );

    lead.convertedCompanyId = company.id;

    const wonStage = await this.stages.findOne({
      where: { funnelId: lead.funnelId, outcome: 'won', active: true },
    });
    if (wonStage) lead.stageId = wonStage.id;

    await this.leads.save(lead);

    return {
      kind: 'corporate' as const,
      companyId: company.id,
      companyName: company.tradeName,
      route: `/m/corporativo/empresas?id=${encodeURIComponent(company.id)}`,
    };
  }

  private async applyStageOutcome(
    lead: CommercialLead,
    stage: CommercialFunnelStage,
    actingUserId: string,
  ) {
    if (stage.outcome === 'won') {
      const funnel = await this.funnels.findOne({ where: { id: lead.funnelId } });
      if (funnel?.winAction === 'convert' && !lead.convertedNetworkId && !lead.convertedCompanyId) {
        const conversion = await this.executeConvert(lead, actingUserId);
        const refreshed = await this.leads.findOneOrFail({ where: { id: lead.id } });
        const transferOutcome = await this.applyTransferAction(refreshed, 'won');
        return { conversion, outcome: transferOutcome };
      }
      return this.applyTransferAction(lead, 'won');
    }
    if (stage.outcome === 'lost') {
      return this.applyTransferAction(lead, 'lost');
    }
    return null;
  }

  private async applyTransferAction(lead: CommercialLead, kind: 'won' | 'lost') {
    const funnel = await this.funnels.findOne({ where: { id: lead.funnelId } });
    if (!funnel) return null;

    const action = kind === 'won' ? funnel.winAction : funnel.lossAction;
    if (action !== 'transfer_funnel') return null;

    const targetFunnelId =
      kind === 'won' ? funnel.winTargetFunnelId : funnel.lossTargetFunnelId;
    const targetStageId = kind === 'won' ? funnel.winTargetStageId : funnel.lossTargetStageId;

    if (!targetFunnelId || !targetStageId) return null;

    const targetStage = await this.funnelService.getStage(targetStageId);
    if (targetStage.funnelId !== targetFunnelId) return null;

    lead.funnelId = targetFunnelId;
    lead.stageId = targetStageId;
    this.resetStageTimer(lead);
    await this.leads.save(lead);

    const targetFunnel = await this.funnels.findOne({ where: { id: targetFunnelId } });
    return {
      kind: 'transfer_funnel' as const,
      targetFunnelId,
      targetFunnelName: targetFunnel?.name ?? null,
      targetStageId,
      targetStageName: targetStage.name,
    };
  }

  private async userProfile(userId: string | null | undefined): Promise<{
    name: string | null;
    avatarUrl: string | null;
    avatarColor: string | null;
  }> {
    if (!userId) return { name: null, avatarUrl: null, avatarColor: null };
    const user = await this.users.findById(userId);
    return {
      name: user?.name ?? null,
      avatarUrl: user?.avatarUrl ?? null,
      avatarColor: user?.avatarColor ?? null,
    };
  }

  private async loadStageMap(stageIds: string[]) {
    const unique = [...new Set(stageIds.filter(Boolean))];
    if (!unique.length) return new Map<string, CommercialFunnelStage>();
    const rows = await this.stages.find({ where: { id: In(unique) } });
    return new Map(rows.map((row) => [row.id, row]));
  }

  private stageReferenceAt(lead: CommercialLead): Date {
    return lead.stageEnteredAt ?? lead.createdAt;
  }

  private buildStageDeadline(
    lead: CommercialLead,
    stage: CommercialFunnelStage | null,
  ): Date | null {
    if (!stage?.maxDaysInStage || stage.maxDaysInStage <= 0 || stage.outcome !== 'pipeline') {
      return null;
    }
    const entered = this.stageReferenceAt(lead);
    const deadline = new Date(entered);
    deadline.setDate(deadline.getDate() + stage.maxDaysInStage);
    return deadline;
  }

  private isPastDeadline(deadline: Date | null): boolean {
    if (!deadline) return false;
    return Date.now() > deadline.getTime();
  }

  private resetStageTimer(lead: CommercialLead) {
    lead.stageEnteredAt = new Date();
    lead.stageExpiredAt = null;
  }

  private touchLastInteraction(lead: CommercialLead) {
    lead.lastInteractionAt = new Date();
  }

  private async syncStageExpiration(
    lead: CommercialLead,
    stage: CommercialFunnelStage | null,
  ) {
    const deadline = this.buildStageDeadline(lead, stage);
    if (!deadline) {
      if (lead.stageExpiredAt) {
        lead.stageExpiredAt = null;
        await this.leads.save(lead);
      }
      return;
    }

    const expired = this.isPastDeadline(deadline);
    if (expired && !lead.stageExpiredAt) {
      lead.stageExpiredAt = new Date();
      await this.leads.save(lead);
      return;
    }

    if (!expired && lead.stageExpiredAt) {
      lead.stageExpiredAt = null;
      await this.leads.save(lead);
    }
  }

  private async loadFunnelMap(funnelIds: string[]) {
    const unique = [...new Set(funnelIds.filter(Boolean))];
    if (!unique.length) return new Map<string, CommercialFunnel>();
    const rows = await this.funnels.find({ where: { id: In(unique) } });
    return new Map(rows.map((row) => [row.id, row]));
  }

  private async loadLatestInteractionMap(leadIds: string[]) {
    const map = new Map<string, string>();
    const unique = [...new Set(leadIds.filter(Boolean))];
    if (!unique.length) return map;

    const rows = await this.interactions
      .createQueryBuilder('interaction')
      .select('interaction.lead_id', 'leadId')
      .addSelect('interaction.content', 'content')
      .innerJoin(
        (sub) =>
          sub
            .select('sub.lead_id', 'lead_id')
            .addSelect('MAX(sub.created_at)', 'max_created')
            .from(CommercialLeadInteraction, 'sub')
            .where('sub.lead_id IN (:...unique)', { unique })
            .groupBy('sub.lead_id'),
        'latest',
        'latest.lead_id = interaction.lead_id AND latest.max_created = interaction.created_at',
      )
      .where('interaction.lead_id IN (:...unique)', { unique })
      .getRawMany<{ leadId: string; content: string }>();

    for (const row of rows) {
      if (row.leadId && row.content && !map.has(row.leadId)) {
        map.set(row.leadId, row.content);
      }
    }

    return map;
  }

  private async interactionDto(row: CommercialLeadInteraction) {
    const user = row.userId ? await this.users.findById(row.userId) : null;
    return {
      id: row.id,
      leadId: row.leadId,
      userId: row.userId,
      userName:
        row.source === 'whatsapp'
          ? user?.name ?? 'Mensagem no celular'
          : user?.name ?? 'Sistema',
      userAvatarUrl: user?.avatarUrl ?? null,
      userAvatarColor: user?.avatarColor ?? null,
      content: row.content,
      source: row.source,
      externalId: row.externalId,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private async toDto(
    lead: CommercialLead,
    stage?: CommercialFunnelStage | null,
    latestInteractionContent?: string | null,
    owners: LeadOwnerDto[] = [],
    contacts: LeadContactDto[] = [],
    context?: {
      funnels?: Map<string, CommercialFunnel>;
      lossReasonLabels?: Map<string, string>;
    },
  ): Promise<LeadDto> {
    const resolvedOwners =
      owners.length > 0
        ? owners
        : await this.buildOwnerDtos(
            await this.getLeadOwnerUserIds(lead.id, lead.ownerUserId),
          );
    let resolvedContacts = contacts.length > 0 ? contacts.map((row) => ({ ...row })) : this.buildLegacyContacts(lead);
    if (resolvedContacts.length > 0 && lead.phone) {
      const primaryIndex = resolvedContacts.findIndex((row) => row.isPrimary);
      const index = primaryIndex >= 0 ? primaryIndex : 0;
      if (!resolvedContacts[index]?.phone) {
        resolvedContacts = resolvedContacts.map((row, rowIndex) =>
          rowIndex === index ? { ...row, phone: lead.phone } : row,
        );
      }
    }
    const primaryOwner = resolvedOwners[0];
    const cachedFunnel = context?.funnels?.get(lead.funnelId);
    const [owner, createdBy, funnel, resolvedStage] = await Promise.all([
      this.userProfile(lead.ownerUserId),
      this.userProfile(lead.createdByUserId),
      cachedFunnel !== undefined
        ? Promise.resolve(cachedFunnel)
        : this.funnels.findOne({ where: { id: lead.funnelId } }),
      stage !== undefined
        ? Promise.resolve(stage)
        : this.stages.findOne({ where: { id: lead.stageId } }),
    ]);

    const deadline = this.buildStageDeadline(lead, resolvedStage);
    const resolvedSource = inferCommercialLeadSource({
      stored: lead.source,
      notes: lead.notes,
      latestInteraction: latestInteractionContent ?? null,
    });
    const sourceMeta = leadSourceMeta(resolvedSource);
    const lossReasonLabel = lead.lossReasonId
      ? (context?.lossReasonLabels?.get(lead.lossReasonId) ??
        (await this.lossReasons.getLabel(lead.lossReasonId)))
      : null;

    return {
      id: lead.id,
      funnelId: lead.funnelId,
      funnelName: funnel?.name ?? '—',
      stageId: lead.stageId,
      stage: resolvedStage?.slug ?? lead.stageId,
      stageLabel: resolvedStage?.name ?? '—',
      stageOutcome: resolvedStage?.outcome ?? 'pipeline',
      title: lead.title,
      type: lead.type,
      typeLabel:
        lead.type === 'partner'
          ? 'Academia'
          : lead.type === 'corporate'
            ? 'Empresa'
            : null,
      source: resolvedSource,
      sourceLabel: sourceMeta.label,
      sourceColor: sourceMeta.color,
      sourceSoft: sourceMeta.soft,
      temperature: parseTemperature(lead.temperature),
      temperatureLabel: temperatureLabel(parseTemperature(lead.temperature)),
      legalName: lead.legalName,
      cnpj: lead.cnpj ? formatCnpj(lead.cnpj) : null,
      email: lead.email,
      phone: lead.phone,
      contactName: lead.contactName,
      whatsappContactKey: lead.whatsappContactKey,
      contacts: resolvedContacts,
      notes: lead.notes,
      ownerUserId: lead.ownerUserId,
      ownerName: primaryOwner?.name ?? owner.name,
      ownerAvatarUrl: primaryOwner?.avatarUrl ?? owner.avatarUrl,
      ownerAvatarColor: primaryOwner?.avatarColor ?? owner.avatarColor,
      owners: resolvedOwners,
      createdByUserId: lead.createdByUserId,
      createdByName: createdBy.name,
      convertedNetworkId: lead.convertedNetworkId,
      convertedCompanyId: lead.convertedCompanyId,
      converted: Boolean(lead.convertedNetworkId || lead.convertedCompanyId),
      sortOrder: lead.sortOrder,
      lastInteractionAt: lead.lastInteractionAt?.toISOString() ?? null,
      latestInteractionContent: latestInteractionContent ?? null,
      lossReasonId: lead.lossReasonId,
      lossReasonLabel,
      stageEnteredAt: lead.stageEnteredAt?.toISOString() ?? null,
      stageExpiredAt: lead.stageExpiredAt?.toISOString() ?? null,
      stageExpired: Boolean(lead.stageExpiredAt) || this.isPastDeadline(deadline),
      stageMaxDaysInStage: resolvedStage?.maxDaysInStage ?? null,
      stageDeadlineAt: deadline?.toISOString() ?? null,
      createdAt: lead.createdAt.toISOString(),
      updatedAt: lead.updatedAt.toISOString(),
    };
  }

  private resolveOwnerUserIds(
    ownerUserIds?: string[],
    ownerUserId?: string,
    fallbackUserId?: string,
  ): string[] {
    const fromArray = (ownerUserIds ?? []).map((id) => id.trim()).filter(Boolean);
    const unique = [
      ...new Set(
        fromArray.length
          ? fromArray
          : ownerUserId?.trim()
            ? [ownerUserId.trim()]
            : fallbackUserId?.trim()
              ? [fallbackUserId.trim()]
              : [],
      ),
    ];
    if (!unique.length) {
      throw new BadRequestException('Informe ao menos um responsável.');
    }
    return unique;
  }

  private isAdminUser(user: Awaited<ReturnType<UsersService['findById']>>): boolean {
    if (!user?.active) return false;
    const roles = Array.isArray(user.roles) ? user.roles : [];
    if (!roles.length && user.passwordHash) return true;
    return userHasRole(user, UserRole.ADMIN);
  }

  private async assertAdminOwners(ownerUserIds: string[]) {
    for (const userId of ownerUserIds) {
      const user = await this.users.findById(userId);
      if (!this.isAdminUser(user)) {
        throw new BadRequestException('Responsáveis devem ser usuários console admin ativos.');
      }
    }
  }

  private async syncLeadOwners(leadId: string, ownerUserIds: string[]) {
    const unique = [...new Set(ownerUserIds.filter(Boolean))];
    await this.leadOwners.delete({ leadId });
    if (!unique.length) return;
    await this.leadOwners.save(
      unique.map((userId, index) =>
        this.leadOwners.create({ leadId, userId, sortOrder: index }),
      ),
    );
  }

  private async getLeadOwnerUserIds(leadId: string, fallbackUserId?: string): Promise<string[]> {
    const rows = await this.leadOwners.find({
      where: { leadId },
      order: { sortOrder: 'ASC' },
    });
    if (rows.length) return rows.map((row) => row.userId);
    return fallbackUserId ? [fallbackUserId] : [];
  }

  private async buildOwnerDtos(userIds: string[]): Promise<LeadOwnerDto[]> {
    return Promise.all(
      userIds.map(async (userId) => {
        const profile = await this.userProfile(userId);
        return { userId, ...profile };
      }),
    );
  }

  private async loadOwnersMap(leads: CommercialLead[]): Promise<Map<string, LeadOwnerDto[]>> {
    const map = new Map<string, LeadOwnerDto[]>();
    const leadIds = leads.map((lead) => lead.id).filter(Boolean);
    if (!leadIds.length) return map;

    const rows = await this.leadOwners.find({
      where: { leadId: In(leadIds) },
      order: { sortOrder: 'ASC' },
    });

    const idsByLead = new Map<string, string[]>();
    for (const row of rows) {
      if (!idsByLead.has(row.leadId)) idsByLead.set(row.leadId, []);
      idsByLead.get(row.leadId)!.push(row.userId);
    }

    await Promise.all(
      leads.map(async (lead) => {
        const userIds = idsByLead.get(lead.id)?.length
          ? (idsByLead.get(lead.id) ?? [])
          : lead.ownerUserId
            ? [lead.ownerUserId]
            : [];
        map.set(lead.id, await this.buildOwnerDtos(userIds));
      }),
    );

    return map;
  }

  private contactDto(row: CommercialLeadContact): LeadContactDto {
    return {
      id: row.id,
      name: row.name,
      role: row.role,
      phone: row.phone,
      email: row.email,
      isPrimary: row.isPrimary,
      sortOrder: row.sortOrder,
    };
  }

  private buildLegacyContacts(lead: CommercialLead): LeadContactDto[] {
    const name = lead.contactName?.trim();
    const phone = lead.phone;
    const email = lead.email;
    if (!name && !phone && !email) return [];

    return [
      {
        id: 'legacy',
        name: name || 'Contato',
        role: null,
        phone,
        email,
        isPrimary: true,
        sortOrder: 0,
      },
    ];
  }

  private ensurePrimaryContact(contacts: LeadContactInput[]): LeadContactInput[] {
    if (!contacts.length) return contacts;
    const primaryIndex = contacts.findIndex((contact) => contact.isPrimary);
    if (primaryIndex >= 0) {
      return contacts.map((contact, index) => ({
        ...contact,
        isPrimary: index === primaryIndex,
      }));
    }
    return contacts.map((contact, index) => ({
      ...contact,
      isPrimary: index === 0,
    }));
  }

  private normalizeContactInputs(
    contacts?: LeadContactInput[] | null,
    legacy?: {
      contactName?: string | null;
      phone?: string | null;
      email?: string | null;
    },
  ): LeadContactInput[] {
    const fromArray = (contacts ?? [])
      .map((item) => ({
        id: item.id?.trim() || undefined,
        name: item.name?.trim() ?? '',
        role: item.role?.trim() || null,
        phone: item.phone ? resolveBrazilMobilePhone(item.phone) : null,
        email: item.email?.toLowerCase().trim() || null,
        isPrimary: Boolean(item.isPrimary),
      }))
      .filter((item) => item.name || item.phone || item.email);

    if (fromArray.length) return this.ensurePrimaryContact(fromArray);

    const legacyName = legacy?.contactName?.trim();
    const legacyPhone = legacy?.phone ? resolveBrazilMobilePhone(legacy.phone) : null;
    const legacyEmail = legacy?.email?.toLowerCase().trim() || null;
    if (!legacyName && !legacyPhone && !legacyEmail) return [];

    return this.ensurePrimaryContact([
      {
        name: legacyName || 'Contato',
        role: null,
        phone: legacyPhone,
        email: legacyEmail,
        isPrimary: true,
      },
    ]);
  }

  private validateContactInputs(contacts: LeadContactInput[]) {
    for (const [index, contact] of contacts.entries()) {
      if (!contact.name?.trim()) {
        throw new BadRequestException(`Informe o nome do contato ${index + 1}.`);
      }
      if (contact.phone && !isValidMobilePhone(contact.phone)) {
        throw new BadRequestException(`Telefone inválido no contato "${contact.name}".`);
      }
    }
  }

  private applyPrimaryContactToLead(lead: CommercialLead, contacts: LeadContactInput[]) {
    const primary = contacts.find((contact) => contact.isPrimary) ?? contacts[0] ?? null;
    lead.contactName = primary?.name?.trim() || null;
    lead.phone = primary?.phone || null;
    lead.email = primary?.email || null;
  }

  private async syncLeadContacts(leadId: string, contacts: LeadContactInput[]) {
    await this.leadContacts.delete({ leadId });
    if (!contacts.length) return;

    const normalized = this.ensurePrimaryContact(contacts);
    await this.leadContacts.save(
      normalized.map((contact, index) =>
        this.leadContacts.create({
          leadId,
          name: contact.name.trim(),
          role: contact.role?.trim() || null,
          phone: contact.phone || null,
          email: contact.email || null,
          isPrimary: Boolean(contact.isPrimary),
          sortOrder: index,
        }),
      ),
    );
  }

  private async loadContactsMap(leads: CommercialLead[]): Promise<Map<string, LeadContactDto[]>> {
    const map = new Map<string, LeadContactDto[]>();
    const leadIds = leads.map((lead) => lead.id).filter(Boolean);
    if (!leadIds.length) return map;

    const rows = await this.leadContacts.find({
      where: { leadId: In(leadIds) },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });

    const rowsByLead = new Map<string, CommercialLeadContact[]>();
    for (const row of rows) {
      if (!rowsByLead.has(row.leadId)) rowsByLead.set(row.leadId, []);
      rowsByLead.get(row.leadId)!.push(row);
    }

    for (const lead of leads) {
      const leadRows = rowsByLead.get(lead.id) ?? [];
      map.set(
        lead.id,
        leadRows.length ? leadRows.map((row) => this.contactDto(row)) : this.buildLegacyContacts(lead),
      );
    }

    return map;
  }

  async findOpenLeadByWhatsAppContactKey(contactKey: string): Promise<CommercialLead | null> {
    const key = String(contactKey ?? '').trim();
    if (!key) return null;
    const marker = `whatsapp-contact:${key}`;

    const rows = await this.leads
      .createQueryBuilder('lead')
      .where('lead.notes LIKE :marker', { marker: `%${marker}%` })
      .orderBy('lead.createdAt', 'ASC')
      .getMany();
    const hit = preferOpenWhatsAppLead(rows);
    return hit && leadIsOpen(hit) ? hit : null;
  }

  private async findLeadByWhatsAppContactKeyMarker(contactKey: string): Promise<CommercialLead | null> {
    const key = String(contactKey ?? '').trim();
    if (!key) return null;
    const marker = `whatsapp-contact:${key}`;

    const rows = await this.leads
      .createQueryBuilder('lead')
      .where('lead.notes LIKE :marker', { marker: `%${marker}%` })
      .orderBy('lead.createdAt', 'ASC')
      .getMany();
    return preferOpenWhatsAppLead(rows);
  }

  async findLeadByWhatsAppIdentity(
    instanceId: string | undefined,
    contactKey: string,
    phone?: string | null,
    extraAliasKeys?: string[],
  ): Promise<CommercialLead | null> {
    const aliasKeys = expandWhatsAppReferenceKeys(contactKey, phone, extraAliasKeys);
    if (!aliasKeys.length) return null;

    let byRefColumn: CommercialLead[] = [];
    try {
      byRefColumn = await this.leads
        .createQueryBuilder('lead')
        .where('lead.whatsapp_contact_key IN (:...aliasKeys)', { aliasKeys })
        .orderBy('lead.createdAt', 'ASC')
        .getMany();
    } catch {
      /* coluna whatsapp_contact_key ausente até rodar a migração SQL */
    }
    const refHit = preferOpenWhatsAppLead(byRefColumn);
    if (refHit) return refHit;

    if (instanceId) {
      const profiles = await this.evolutionProfiles.find({
        where: { instanceId, contactKey: In(aliasKeys) },
        select: ['leadId'],
      });
      const profileLeadIds = [
        ...new Set(profiles.map((profile) => profile.leadId).filter(Boolean)),
      ] as string[];
      if (profileLeadIds.length) {
        const profileLeads = await this.leads.find({
          where: { id: In(profileLeadIds) },
          order: { createdAt: 'ASC' },
        });
        const profileHit = preferOpenWhatsAppLead(profileLeads);
        if (profileHit) return profileHit;
      }
    }

    if (instanceId) {
      const messages = await this.evolutionMessages
        .createQueryBuilder('message')
        .select('DISTINCT message.lead_id', 'leadId')
        .where('message.instance_id = :instanceId', { instanceId })
        .andWhere('message.contact_phone IN (:...aliasKeys)', { aliasKeys })
        .andWhere('message.lead_id IS NOT NULL')
        .getRawMany<{ leadId: string }>();
      const messageLeadIds = [...new Set(messages.map((row) => row.leadId).filter(Boolean))];
      if (messageLeadIds.length) {
        const messageLeads = await this.leads.find({
          where: { id: In(messageLeadIds) },
          order: { createdAt: 'ASC' },
        });
        const messageHit = preferOpenWhatsAppLead(messageLeads);
        if (messageHit) return messageHit;
      }
    }

    for (const key of aliasKeys) {
      const fromNotes = await this.findLeadByWhatsAppContactKeyMarker(key);
      if (fromNotes) return fromNotes;
    }

    const ph = phone ? normalizeMobilePhone(phone) : null;
    if (ph && isValidMobilePhone(ph)) {
      const byPhone = await this.findOpenLeadByPhone(ph);
      if (byPhone) return byPhone;
    }

    return null;
  }

  private async withWhatsAppLeadLock<T>(
    contactKey: string,
    phone: string | null | undefined,
    work: () => Promise<T>,
    extraAliasKeys?: string[],
  ): Promise<T> {
    const lockKeys = [
      ...new Set([
        canonicalWhatsAppContactKey(contactKey, phone),
        ...whatsAppContactAliasKeys(contactKey, phone),
        ...(extraAliasKeys ?? []),
      ]),
    ]
      .filter(Boolean)
      .map((key) => key.slice(0, 60))
      .sort();

    const connection = this.leads.manager.connection;
    const queryRunner = connection.createQueryRunner();
    await queryRunner.connect();
    const acquired: string[] = [];
    try {
      for (const lockKey of lockKeys) {
        await queryRunner.query('SELECT GET_LOCK(?, 15)', [`wa-lead-${lockKey}`]);
        acquired.push(lockKey);
      }
      return await work();
    } finally {
      for (const lockKey of acquired.reverse()) {
        try {
          await queryRunner.query('SELECT RELEASE_LOCK(?)', [`wa-lead-${lockKey}`]);
        } catch {
          /* ignore */
        }
      }
      await queryRunner.release();
    }
  }

  async findOpenLeadByPhone(phone: string): Promise<CommercialLead | null> {
    const digits = normalizeMobilePhone(phone);
    if (!digits) return null;

    const direct = await this.leads.findOne({ where: { phone: digits } });
    if (direct && leadIsOpen(direct)) return direct;

    const contact = await this.leadContacts
      .createQueryBuilder('contact')
      .where('contact.phone = :phone', { phone: digits })
      .orderBy('contact.createdAt', 'DESC')
      .getOne();
    if (!contact) return null;

    const linked = await this.leads.findOne({ where: { id: contact.leadId } });
    return linked && leadIsOpen(linked) ? linked : null;
  }

  /** Mensagem inbound WhatsApp: reusa lead por telefone ou cria lead básico no funil padrão. */
  async ensureLeadFromWhatsAppInbox(input: {
    instanceId?: string;
    contactKey: string;
    phone?: string | null;
    remoteJid?: string | null;
    pushName?: string | null;
    messageText: string;
    externalId: string;
    ownerUserId: string;
    createdByUserId: string;
    instanceLabel: string;
    messageAt?: Date;
    recordInteraction?: boolean;
    autoCreateLeads?: boolean;
    /** Telefones alternativos (senderPn, remoteJidAlt, etc.) para gravar no lead. */
    phoneHints?: Array<string | null | undefined>;
    mediaPayload?: string | null;
    /** Chave canônica (ex.: telefone) para deduplicar antes de criar. */
    identityContactKey?: string;
    extraAliasKeys?: string[];
    /** Lead já vinculado à thread (evita recriação ao reabrir conversa). */
    existingLeadId?: string | null;
  }): Promise<{ leadId: string | null; created: boolean }> {
    const contactKey = String(input.contactKey ?? '').trim();
    if (!contactKey || contactKey === 'unknown') {
      return { leadId: null, created: false };
    }

    const rawPhone = String(input.phone ?? contactKey).trim();
    let digits = this.resolveWhatsAppLeadPhoneDigits({
      phone: input.phone,
      contactKey,
      remoteJid: input.remoteJid,
      rawPhoneCandidate: rawPhone,
    });
    if (!digits) {
      const fromKey = normalizedBrazilMobileKey(contactKey);
      if (fromKey) digits = fromKey;
    }
    const mergedHints = this.collectWhatsAppPhoneHints(input);
    if (!digits) {
      for (const hint of mergedHints) {
        const resolved = resolveBrazilMobilePhone(hint);
        if (resolved) {
          digits = resolved;
          break;
        }
      }
    }

    const preview = input.messageText.trim().slice(0, 500);
    const shouldRecord = input.recordInteraction !== false;
    const canCreate = input.autoCreateLeads !== false;

    const identityKey = String(input.identityContactKey ?? contactKey).trim() || contactKey;
    const extraAliases = input.extraAliasKeys;

    return this.withWhatsAppLeadLock(identityKey, digits, async () => {
      let existing: CommercialLead | null = null;
      const hintedLeadId = String(input.existingLeadId ?? '').trim();
      if (hintedLeadId) {
        existing = await this.leads.findOne({ where: { id: hintedLeadId } });
      }
      if (!existing) {
        existing = await this.findLeadByWhatsAppIdentity(
          input.instanceId,
          identityKey,
          digits,
          extraAliases,
        );
      }
      if (!existing && identityKey !== contactKey) {
        existing = await this.findLeadByWhatsAppIdentity(
          input.instanceId,
          contactKey,
          digits,
          extraAliases,
        );
      }

      if (!existing) {
        const refKey = canonicalWhatsAppContactKey(identityKey, digits);
        try {
          const refRows = await this.leads.find({
            where: { whatsappContactKey: refKey },
            order: { createdAt: 'ASC' },
          });
          existing = preferOpenWhatsAppLead(refRows);
        } catch {
          /* coluna whatsapp_contact_key ausente até rodar a migração SQL */
        }
      }

      if (existing && !leadIsOpen(existing)) {
        existing = null;
      }

      if (existing) {
        const canonical = canonicalWhatsAppContactKey(identityKey, digits);
        if (!existing.whatsappContactKey) {
          await this.leads.update({ id: existing.id }, { whatsappContactKey: canonical });
        }
        if (digits) {
          await this.ensureLeadWhatsAppPhoneContact(existing.id, digits, input.pushName);
        } else {
          const fromKey = normalizedBrazilMobileKey(contactKey);
          if (fromKey) {
            await this.ensureLeadWhatsAppPhoneContact(existing.id, fromKey, input.pushName);
          }
        }
        await this.enrichLeadFromWhatsApp(existing.id, input.pushName);
        if (preview && shouldRecord) {
          await this.ingestWhatsAppInteraction(
            existing.id,
            preview,
            input.externalId,
            input.messageAt,
          );
        }
        return { leadId: existing.id, created: false };
      }

      if (!canCreate) {
        return { leadId: null, created: false };
      }

      if (
        !canAutoCreateWhatsAppLead({
          contactKey: identityKey,
          phoneDigits: digits,
          pushName: input.pushName,
        })
      ) {
        return { leadId: null, created: false };
      }

      const title =
        input.pushName?.trim() ||
        (digits && isValidMobilePhone(digits)
          ? formatMobilePhone(digits)
          : contactKey.replace(/^lid:/i, '') || 'Contato WhatsApp');

      const canonicalKey = canonicalWhatsAppContactKey(identityKey, digits);
      const marker = `whatsapp-contact:${canonicalKey}`;
      const createdLead = await this.create(
        {
          title,
          source: 'whatsapp',
          phone: digits ?? undefined,
          contactName: input.pushName?.trim() || undefined,
          contacts: [
            {
              name: input.pushName?.trim() || title || 'Contato WhatsApp',
              phone: digits ?? undefined,
              isPrimary: true,
            },
          ],
          notes: `Origem: instância WhatsApp «${input.instanceLabel}». ${marker}`,
          whatsappContactKey: canonicalKey,
          ownerUserId: input.ownerUserId,
          temperature: 'warm',
        },
        input.createdByUserId,
      );

      if (digits) {
        await this.ensureLeadWhatsAppPhoneContact(createdLead.id, digits, input.pushName);
      }

      if (preview && shouldRecord) {
        await this.ingestWhatsAppInteraction(
          createdLead.id,
          preview,
          input.externalId,
          input.messageAt,
        );
      }

      return { leadId: createdLead.id, created: true };
    }, extraAliases);
  }

  /** Funde lead WhatsApp duplicado no mantenedor (mesmo contato, thread lid vs telefone). */
  async absorbWhatsAppLeadDuplicate(duplicateId: string, keeperId: string): Promise<void> {
    const dup = String(duplicateId ?? '').trim();
    const keep = String(keeperId ?? '').trim();
    if (!dup || !keep || dup === keep) return;

    const [duplicate, keeper] = await Promise.all([
      this.leads.findOne({ where: { id: dup } }),
      this.leads.findOne({ where: { id: keep } }),
    ]);
    if (!duplicate || !keeper || !leadIsOpen(duplicate) || !leadIsOpen(keeper)) return;

    await this.evolutionMessages.update({ leadId: dup }, { leadId: keep });
    await this.evolutionProfiles.update({ leadId: dup }, { leadId: keep });
    await this.deleteLeadRows([dup]);
  }

  private collectWhatsAppPhoneHints(input: {
    phone?: string | null;
    contactKey: string;
    remoteJid?: string | null;
    phoneHints?: Array<string | null | undefined>;
    mediaPayload?: string | null;
  }): string[] {
    const hints = new Set<string>();
    const add = (value?: string | null) => {
      const raw = String(value ?? '').trim();
      if (raw) hints.add(raw);
    };
    for (const hint of input.phoneHints ?? []) add(hint);
    add(input.phone);
    add(input.contactKey);
    add(input.remoteJid);
    const payload = String(input.mediaPayload ?? '').trim();
    if (payload) {
      try {
        const data = JSON.parse(payload) as Record<string, unknown>;
        const key = (data.key ?? {}) as Record<string, unknown>;
        add(String(key.senderPn ?? data.senderPn ?? ''));
        add(String(key.remoteJid ?? data.remoteJid ?? ''));
        add(String(key.remoteJidAlt ?? data.remoteJidAlt ?? ''));
        add(String(key.participant ?? key.participantAlt ?? ''));
        const resolved = resolveContactFromEvolutionPayload(data);
        add(resolved?.phone ?? null);
      } catch {
        /* ignore */
      }
    }
    return [...hints];
  }

  private resolveWhatsAppLeadPhoneDigits(input: {
    phone?: string | null;
    contactKey: string;
    remoteJid?: string | null;
    rawPhoneCandidate: string;
  }): string | null {
    const candidates = [
      input.phone,
      input.rawPhoneCandidate,
      input.contactKey,
      input.remoteJid,
    ];
    for (const value of candidates) {
      const resolved = resolveBrazilMobilePhone(value);
      if (resolved) return resolved;
    }

    const remote = String(input.remoteJid ?? '').trim();
    if (remote) {
      const fromJid = phoneKeyFromJid(remote);
      if (fromJid && isValidMobilePhone(fromJid)) return fromJid;
    }

    const fromKey = normalizedBrazilMobileKey(input.contactKey);
    if (fromKey) return fromKey;

    return null;
  }

  /** Garante telefone no lead após ingestão WhatsApp (criação ou mensagem seguinte). */
  async applyWhatsAppPhoneToLead(
    leadId: string,
    candidates: Array<string | null | undefined>,
    pushName?: string | null,
    mediaPayload?: string | null,
  ): Promise<string | null> {
    const merged = this.collectWhatsAppPhoneHints({
      contactKey: '',
      phoneHints: candidates,
      mediaPayload,
    });
    for (const hint of merged) {
      const digits = resolveBrazilMobilePhone(hint);
      if (!digits) continue;
      await this.ensureLeadWhatsAppPhoneContact(leadId, digits, pushName);
      return digits;
    }
    return null;
  }

  /** Grava telefone no lead e na lista de contatos (fonte WhatsApp). */
  private async ensureLeadWhatsAppPhoneContact(
    leadId: string,
    phoneDigits: string,
    pushName?: string | null,
  ): Promise<void> {
    const digits = resolveBrazilMobilePhone(phoneDigits);
    if (!digits) return;

    const lead = await this.leads.findOne({ where: { id: leadId } });
    if (!lead) return;

    const nameFromWhatsApp = pushName?.trim();
    const contacts = await this.leadContacts.find({
      where: { leadId },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });

    const contactName =
      nameFromWhatsApp ||
      lead.contactName?.trim() ||
      (isHumanContactName(lead.title) ? lead.title.trim() : null) ||
      'Contato WhatsApp';

    const leadPatch: Partial<CommercialLead> = {};
    if (!lead.phone) leadPatch.phone = digits;
    if (!lead.contactName?.trim() && nameFromWhatsApp) {
      leadPatch.contactName = nameFromWhatsApp;
    }

    const primaryRow = contacts.find((row) => row.isPrimary) ?? contacts[0] ?? null;
    if (!lead.phone && primaryRow?.phone) {
      leadPatch.phone = primaryRow.phone;
    }

    const hasPhoneContact = contacts.some((row) => row.phone === digits);
    if (!hasPhoneContact) {
      if (!contacts.length) {
        await this.leadContacts.save(
          this.leadContacts.create({
            leadId,
            name: contactName,
            role: null,
            phone: digits,
            email: null,
            isPrimary: true,
            sortOrder: 0,
          }),
        );
      } else {
        const primary = contacts.find((row) => row.isPrimary) ?? contacts[0];
        if (primary && !primary.phone) {
          const contactPatch: Partial<CommercialLeadContact> = { phone: digits };
          if (!primary.name?.trim() || primary.name === 'Contato') {
            contactPatch.name = contactName;
          }
          await this.leadContacts.update({ id: primary.id }, contactPatch);
        } else {
          await this.leadContacts.save(
            this.leadContacts.create({
              leadId,
              name: contactName,
              role: null,
              phone: digits,
              email: null,
              isPrimary: false,
              sortOrder: contacts.length,
            }),
          );
        }
      }
    }

    if (Object.keys(leadPatch).length) {
      await this.leads.update({ id: leadId }, leadPatch);
    }
  }

  /**
   * Remove leads duplicados gerados por mensagens WhatsApp (mantém o mais antigo por contato).
   */
  async purgeWhatsAppDuplicateLeads(options?: { dryRun?: boolean; funnelId?: string }) {
    const dryRun = options?.dryRun !== false;
    const qb = this.leads
      .createQueryBuilder('lead')
      .where('lead.converted_network_id IS NULL')
      .andWhere('lead.converted_company_id IS NULL')
      .andWhere(
        `(lead.source = 'whatsapp'
          OR lead.notes LIKE :waNotes
          OR lead.notes LIKE :waOrigin
          OR lead.whatsapp_contact_key IS NOT NULL)`,
        { waNotes: '%whatsapp-contact:%', waOrigin: '%instância WhatsApp%' },
      );

    if (options?.funnelId) {
      qb.andWhere('lead.funnel_id = :funnelId', { funnelId: options.funnelId });
    }

    const rows = await qb.orderBy('lead.createdAt', 'ASC').getMany();
    const groups = new Map<string, CommercialLead[]>();

    for (const row of rows) {
      const key =
        normalizeWhatsAppGroupKey(row.whatsappContactKey) ||
        normalizeWhatsAppGroupKey(extractWhatsAppMarkerFromNotes(row.notes)) ||
        normalizeWhatsAppGroupKey(row.title) ||
        row.id;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row);
    }

    const toRemove: string[] = [];
    const toKeep: Array<{ key: string; leadId: string; removedIds: string[] }> = [];

    for (const [key, list] of groups) {
      if (list.length <= 1) continue;
      const keeper = list[0];
      const duplicates = list.slice(1).map((row) => row.id);
      toRemove.push(...duplicates);
      toKeep.push({ key, leadId: keeper.id, removedIds: duplicates });
    }

    if (!dryRun && toRemove.length) {
      for (const item of toKeep) {
        if (!item.removedIds.length) continue;
        await this.evolutionMessages.update(
          { leadId: In(item.removedIds) },
          { leadId: item.leadId },
        );
        await this.evolutionProfiles.update(
          { leadId: In(item.removedIds) },
          { leadId: item.leadId },
        );
        await this.deleteLeadRows(item.removedIds);
      }
    }

    return {
      dryRun,
      duplicateGroups: toKeep.length,
      leadsRemoved: toRemove.length,
      samples: toKeep.slice(0, 20),
    };
  }

  /** Preenche telefone em leads WhatsApp sem número, usando mensagens Evolution vinculadas. */
  async backfillWhatsAppLeadPhones(options?: { funnelId?: string; limit?: number }) {
    const limit = Math.min(Math.max(options?.limit ?? 300, 1), 2000);
    const qb = this.leads
      .createQueryBuilder('lead')
      .where('(lead.phone IS NULL OR lead.phone = "")')
      .andWhere(
        `(
          lead.source = 'whatsapp'
          OR lead.whatsapp_contact_key IS NOT NULL
          OR lead.notes LIKE :waOrigin
          OR EXISTS (
            SELECT 1 FROM acaf_evolution_messages em
            WHERE em.lead_id = lead.id
          )
          OR EXISTS (
            SELECT 1 FROM acaf_evolution_contact_profiles ep
            WHERE ep.lead_id = lead.id
          )
        )`,
        { waOrigin: '%instância WhatsApp%' },
      );
    if (options?.funnelId) {
      qb.andWhere('lead.funnel_id = :funnelId', { funnelId: options.funnelId });
    }
    const rows = await qb.orderBy('lead.created_at', 'DESC').limit(limit).getMany();

    const orphanLeadRefs = await this.countOrphanEvolutionLeadReferences();

    let updated = 0;
    const samples: Array<{ leadId: string; phone: string }> = [];

    for (const lead of rows) {
      const messages = await this.evolutionMessages.find({
        where: { leadId: lead.id },
        order: { messageAt: 'DESC' },
        take: 24,
        select: ['contactPhone', 'remoteJid', 'mediaPayload'],
      });

      const hints = [
        lead.whatsappContactKey,
        ...messages.flatMap((row) => [row.contactPhone, row.remoteJid]),
      ];
      let applied: string | null = null;
      for (const row of messages) {
        const rowHints = [row.contactPhone, row.remoteJid, lead.whatsappContactKey];
        applied = await this.applyWhatsAppPhoneToLead(lead.id, rowHints, null, row.mediaPayload);
        if (applied) break;
      }
      if (!applied) {
        applied = await this.applyWhatsAppPhoneToLead(lead.id, hints);
      }
      if (!applied) {
        const profiles = await this.evolutionProfiles.find({
          where: { leadId: lead.id },
          select: ['contactKey', 'phoneLabel'],
        });
        for (const profile of profiles) {
          const fromKey = resolveBrazilMobilePhone(profile.contactKey);
          const fromLabel = profile.phoneLabel
            ? resolveBrazilMobilePhone(profile.phoneLabel)
            : null;
          const digits = fromKey ?? fromLabel;
          if (!digits) continue;
          await this.ensureLeadWhatsAppPhoneContact(lead.id, digits);
          applied = digits;
          break;
        }
      }
      if (applied) {
        updated += 1;
        if (samples.length < 25) samples.push({ leadId: lead.id, phone: applied });
      }
    }

    return { checked: rows.length, updated, samples, orphanLeadRefs };
  }

  /** Mensagens/perfis apontam para `lead_id` que não existe mais na tabela comercial. */
  async countOrphanEvolutionLeadReferences(): Promise<{
    messageLeadIds: number;
    profileLeadIds: number;
  }> {
    const messageLeadIds = await this.evolutionMessages
      .createQueryBuilder('message')
      .leftJoin(CommercialLead, 'lead', 'lead.id = message.lead_id')
      .where('message.lead_id IS NOT NULL')
      .andWhere('lead.id IS NULL')
      .select('COUNT(DISTINCT message.lead_id)', 'count')
      .getRawOne<{ count: string }>();

    const profileLeadIds = await this.evolutionProfiles
      .createQueryBuilder('profile')
      .leftJoin(CommercialLead, 'lead', 'lead.id = profile.lead_id')
      .where('profile.lead_id IS NOT NULL')
      .andWhere('lead.id IS NULL')
      .select('COUNT(DISTINCT profile.lead_id)', 'count')
      .getRawOne<{ count: string }>();

    return {
      messageLeadIds: Number(messageLeadIds?.count ?? 0),
      profileLeadIds: Number(profileLeadIds?.count ?? 0),
    };
  }

  async enrichLeadPhoneFromWhatsAppInbox(leadId: string, phoneDigits: string): Promise<void> {
    const digits = resolveBrazilMobilePhone(phoneDigits);
    if (!digits) return;

    const lead = await this.leads.findOne({
      where: { id: leadId },
      select: ['id', 'phone', 'title'],
    });
    if (!lead) return;

    const title = lead.title?.trim() ?? '';
    const shouldRetitle =
      !lead.phone && (!title || title === 'Contato WhatsApp' || title.startsWith('WhatsApp '));

    await this.ensureLeadWhatsAppPhoneContact(leadId, digits);

    if (shouldRetitle) {
      await this.leads.update({ id: leadId }, { title: formatMobilePhone(digits) });
    }
  }

  async enrichLeadFromWhatsAppInbox(leadId: string, pushName?: string | null): Promise<void> {
    const name = pushName?.trim();
    if (!name) return;
    const lead = await this.leads.findOne({ where: { id: leadId }, select: ['id', 'contactName', 'title'] });
    if (!lead) return;
    const patch: Partial<CommercialLead> = {};
    const title = lead.title?.trim() ?? '';
    const titleLooksLikeId =
      title.replace(/\D/g, '').length >= 8 && title.replace(/[\d\s().\-]/g, '').length === 0;
    if (!lead.contactName?.trim()) patch.contactName = name;
    if (!title || title.startsWith('WhatsApp ') || titleLooksLikeId || title === 'Contato WhatsApp') {
      patch.title = name;
    }
    if (Object.keys(patch).length) {
      await this.leads.update({ id: leadId }, patch);
    }
  }

  private async enrichLeadFromWhatsApp(leadId: string, pushName?: string | null): Promise<void> {
    await this.enrichLeadFromWhatsAppInbox(leadId, pushName);
  }

  private typeAuditLabel(type: CommercialLeadType | null): string {
    if (type === 'partner') return 'Academia';
    if (type === 'corporate') return 'Empresa';
    return '—';
  }

  private async ownerNamesForAudit(userIds: string[]): Promise<string> {
    const names = await Promise.all(
      userIds.map(async (userId) => {
        const profile = await this.userProfile(userId);
        return profile.name?.trim() || userId;
      }),
    );
    return names.join(', ');
  }
}
