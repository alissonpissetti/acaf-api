import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  formatCnpj,
  isValidCnpj,
  isValidMobilePhone,
  normalizeCnpj,
  normalizeMobilePhone,
} from '../users/person.utils';
import { UsersService } from '../users/users.service';
import { AdminService } from '../partner/admin.service';
import { CommercialLead, type CommercialLeadType, type CommercialLeadTemperature } from './commercial-lead.entity';
import { CommercialLeadInteraction } from './commercial-lead-interaction.entity';
import { CommercialLeadContact } from './commercial-lead-contact.entity';
import { CommercialLeadOwner } from './commercial-lead-owner.entity';
import { CommercialFunnelsService } from './commercial-funnels.service';
import { CommercialFunnelStage } from './commercial-funnel-stage.entity';
import { CommercialFunnel } from './commercial-funnel.entity';
import { UserRole, userHasRole } from '../users/user.entity';

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
  temperature: CommercialLeadTemperature;
  temperatureLabel: string;
  legalName: string | null;
  cnpj: string | null;
  email: string | null;
  phone: string | null;
  contactName: string | null;
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
    private readonly funnelService: CommercialFunnelsService,
    private readonly users: UsersService,
    private readonly admin: AdminService,
  ) {}

  async list(filters?: {
    funnelId?: string;
    ownerUserId?: string;
    type?: CommercialLeadType;
  }) {
    const qb = this.leads
      .createQueryBuilder('lead')
      .orderBy('lead.sortOrder', 'ASC')
      .addOrderBy('lead.updatedAt', 'DESC');

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
    await Promise.all(
      rows.map((row) => this.syncStageExpiration(row, stageMap.get(row.stageId) ?? null)),
    );
    return Promise.all(
      rows.map((row) =>
        this.toDto(
          row,
          stageMap.get(row.stageId) ?? null,
          latestInteractionMap.get(row.id) ?? null,
          ownersMap.get(row.id) ?? [],
          contactsMap.get(row.id) ?? [],
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
    if (!text) throw new BadRequestException('Mensagem WhatsApp vazia.');
    if (!externalId.trim()) throw new BadRequestException('Identificador externo obrigatório.');

    const existing = await this.interactions.findOne({
      where: { leadId, externalId: externalId.trim(), source: 'whatsapp' },
    });
    if (existing) {
      return { interaction: await this.interactionDto(existing), duplicate: true as const };
    }

    const lead = await this.leads.findOne({ where: { id: leadId } });
    if (!lead) throw new NotFoundException('Lead não encontrado.');

    const saved = await this.interactions.save(
      this.interactions.create({
        leadId,
        userId: null,
        content: text,
        source: 'whatsapp',
        externalId: externalId.trim(),
        ...(createdAt ? { createdAt } : {}),
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
      whatsapp: 'Contato via WhatsApp',
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
      legalName?: string;
      cnpj?: string;
      email?: string;
      phone?: string;
      contactName?: string;
      contacts?: LeadContactInput[];
      notes?: string;
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
      throw new BadRequestException('Nenhum funil comercial configurado.');
    }

    const firstStage = funnel.stages.find((stage) => stage.outcome === 'pipeline' && stage.active);
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

    const phoneRaw = input.phone ? normalizeMobilePhone(input.phone) : '';
    if (phoneRaw && !isValidMobilePhone(phoneRaw)) {
      throw new BadRequestException('Telefone inválido.');
    }

    const normalizedContacts = this.normalizeContactInputs(input.contacts, {
      contactName: input.contactName,
      phone: input.phone,
      email: input.email,
    });
    this.validateContactInputs(normalizedContacts);
    const primaryContact = normalizedContacts.find((contact) => contact.isPrimary) ?? normalizedContacts[0];

    const now = new Date();
    const saved = await this.leads.save(
      this.leads.create({
        title,
        type,
        temperature: parseTemperature(input.temperature),
        funnelId: funnel.id,
        stageId: firstStage.id,
        legalName: input.legalName?.trim() || null,
        cnpj,
        email: primaryContact?.email ?? (input.email?.toLowerCase().trim() || null),
        phone: primaryContact?.phone ?? (phoneRaw || null),
        contactName: primaryContact?.name ?? (input.contactName?.trim() || null),
        notes: input.notes?.trim() || null,
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
    },
    actingUserId?: string,
  ) {
    const lead = await this.leads.findOne({ where: { id } });
    if (!lead) throw new NotFoundException('Lead não encontrado.');

    if (lead.convertedNetworkId || lead.convertedCompanyId) {
      if (patch.stageId != null) {
        throw new BadRequestException('Lead já convertido em cadastro.');
      }
    }

    if (patch.title != null) {
      const title = patch.title.trim();
      if (!title) throw new BadRequestException('Informe o nome do lead.');
      lead.title = title;
    }

    if (patch.type !== undefined) {
      if (!patch.type) {
        lead.type = null;
      } else if (patch.type !== 'partner' && patch.type !== 'corporate') {
        throw new BadRequestException('Tipo de lead inválido.');
      } else {
        lead.type = patch.type;
      }
    }

    if (patch.temperature !== undefined) {
      lead.temperature = parseTemperature(patch.temperature);
    }

    let outcomeResult: Awaited<ReturnType<CommercialLeadsService['applyStageOutcome']>> | null = null;
    let stageChanged = false;

    if (patch.stageId != null && patch.stageId !== lead.stageId) {
      const stage = await this.funnelService.getStage(patch.stageId);
      if (stage.funnelId !== lead.funnelId) {
        throw new BadRequestException('Etapa inválida para o funil do lead.');
      }
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
    }

    if (patch.legalName !== undefined) {
      lead.legalName = patch.legalName?.trim() || null;
    }

    if (patch.cnpj !== undefined) {
      const cnpj = patch.cnpj ? normalizeCnpj(patch.cnpj) : null;
      if (cnpj && !isValidCnpj(cnpj)) throw new BadRequestException('CNPJ inválido.');
      lead.cnpj = cnpj;
    }

    if (patch.contacts !== undefined) {
      const normalizedContacts = this.normalizeContactInputs(patch.contacts);
      this.validateContactInputs(normalizedContacts);
      await this.syncLeadContacts(lead.id, normalizedContacts);
      this.applyPrimaryContactToLead(lead, normalizedContacts);
    } else {
      if (patch.email !== undefined) {
        lead.email = patch.email?.toLowerCase().trim() || null;
      }

      if (patch.phone !== undefined) {
        const phoneRaw = patch.phone ? normalizeMobilePhone(patch.phone) : '';
        if (phoneRaw && !isValidMobilePhone(phoneRaw)) {
          throw new BadRequestException('Telefone inválido.');
        }
        lead.phone = phoneRaw || null;
      }

      if (patch.contactName !== undefined) {
        lead.contactName = patch.contactName?.trim() || null;
      }
    }

    if (patch.notes !== undefined) {
      lead.notes = patch.notes?.trim() || null;
    }

    if (patch.ownerUserIds !== undefined) {
      const ownerUserIds = this.resolveOwnerUserIds(patch.ownerUserIds);
      await this.assertAdminOwners(ownerUserIds);
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

  private async loadLatestInteractionMap(leadIds: string[]) {
    const map = new Map<string, string>();
    const unique = [...new Set(leadIds.filter(Boolean))];
    if (!unique.length) return map;

    const rows = await this.interactions.find({
      where: { leadId: In(unique) },
      order: { createdAt: 'DESC' },
    });

    for (const row of rows) {
      if (!map.has(row.leadId)) map.set(row.leadId, row.content);
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
          ? user?.name ?? 'WhatsApp'
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
  ): Promise<LeadDto> {
    const resolvedOwners =
      owners.length > 0
        ? owners
        : await this.buildOwnerDtos(
            await this.getLeadOwnerUserIds(lead.id, lead.ownerUserId),
          );
    const resolvedContacts = contacts.length > 0 ? contacts : this.buildLegacyContacts(lead);
    const primaryOwner = resolvedOwners[0];
    const [owner, createdBy, funnel, resolvedStage] = await Promise.all([
      this.userProfile(lead.ownerUserId),
      this.userProfile(lead.createdByUserId),
      this.funnels.findOne({ where: { id: lead.funnelId } }),
      stage !== undefined
        ? Promise.resolve(stage)
        : this.stages.findOne({ where: { id: lead.stageId } }),
    ]);

    const deadline = this.buildStageDeadline(lead, resolvedStage);

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
          ? 'Academia parceira'
          : lead.type === 'corporate'
            ? 'Empresa corporativa'
            : null,
      temperature: parseTemperature(lead.temperature),
      temperatureLabel: temperatureLabel(parseTemperature(lead.temperature)),
      legalName: lead.legalName,
      cnpj: lead.cnpj ? formatCnpj(lead.cnpj) : null,
      email: lead.email,
      phone: lead.phone,
      contactName: lead.contactName,
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
        phone: item.phone ? normalizeMobilePhone(item.phone) : null,
        email: item.email?.toLowerCase().trim() || null,
        isPrimary: Boolean(item.isPrimary),
      }))
      .filter((item) => item.name || item.phone || item.email);

    if (fromArray.length) return this.ensurePrimaryContact(fromArray);

    const legacyName = legacy?.contactName?.trim();
    const legacyPhone = legacy?.phone ? normalizeMobilePhone(legacy.phone) : null;
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
}
