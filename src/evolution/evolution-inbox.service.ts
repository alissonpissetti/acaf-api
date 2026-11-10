import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CommercialLeadsService } from '../commercial/commercial-leads.service';
import { CommercialLead } from '../commercial/commercial-lead.entity';
import { EvolutionInstance } from './evolution-instance.entity';
import { EvolutionMessage } from './evolution-message.entity';

export type ParsedEvolutionMessage = {
  fromMe: boolean;
  phone: string | null;
  remoteJid: string;
  pushName?: string;
  text: string;
  externalId: string;
  messageAt: Date;
  isGroup: boolean;
};

export type EvolutionInboxThreadDto = {
  threadKey: string;
  instanceId: string;
  instanceName: string;
  contactPhone: string;
  contactName: string | null;
  leadId: string | null;
  leadTitle: string | null;
  lastMessageAt: string;
  lastMessagePreview: string;
  lastDirection: 'in' | 'out';
};

export type EvolutionInboxMessageDto = {
  id: string;
  direction: 'in' | 'out';
  body: string;
  contactName: string | null;
  messageAt: string;
  leadId: string | null;
};

@Injectable()
export class EvolutionInboxService {
  constructor(
    @InjectRepository(EvolutionMessage)
    private readonly messages: Repository<EvolutionMessage>,
    @InjectRepository(EvolutionInstance)
    private readonly instances: Repository<EvolutionInstance>,
    @InjectRepository(CommercialLead)
    private readonly leads: Repository<CommercialLead>,
    private readonly commercialLeads: CommercialLeadsService,
  ) {}

  async ingestFromInstance(
    instance: EvolutionInstance,
    input: {
      ownerUserId: string;
      parsed: ParsedEvolutionMessage;
    },
  ): Promise<{ leadId: string | null; created: boolean; messageId: string | null }> {
    const { parsed, ownerUserId } = input;
    if (parsed.isGroup || !parsed.phone) {
      return { leadId: null, created: false, messageId: null };
    }

    const duplicate = await this.messages.findOne({
      where: { instanceId: instance.id, externalId: parsed.externalId },
      select: ['id'],
    });
    if (duplicate) {
      return { leadId: null, created: false, messageId: duplicate.id };
    }

    let leadId: string | null = null;
    let created = false;

    if (!parsed.fromMe) {
      const outcome = await this.commercialLeads.ensureLeadFromWhatsAppInbox({
        phone: parsed.phone,
        pushName: parsed.pushName,
        messageText: parsed.text,
        externalId: parsed.externalId,
        ownerUserId,
        createdByUserId: ownerUserId,
        instanceLabel: instance.name,
      });
      leadId = outcome.leadId;
      created = outcome.created;
    } else {
      const existing = await this.commercialLeads.findOpenLeadByPhone(parsed.phone);
      leadId = existing?.id ?? null;
    }

    const saved = await this.messages.save(
      this.messages.create({
        instanceId: instance.id,
        contactPhone: parsed.phone,
        contactName: parsed.pushName?.trim() || null,
        remoteJid: parsed.remoteJid,
        direction: parsed.fromMe ? 'out' : 'in',
        body: parsed.text.slice(0, 2000),
        externalId: parsed.externalId,
        leadId,
        messageAt: parsed.messageAt,
      }),
    );

    return { leadId, created, messageId: saved.id };
  }

  async listThreads(filters?: { instanceId?: string }): Promise<EvolutionInboxThreadDto[]> {
    const qb = this.messages
      .createQueryBuilder('m')
      .leftJoinAndSelect('m.instance', 'inst')
      .orderBy('m.messageAt', 'DESC')
      .take(3000);

    if (filters?.instanceId) {
      qb.andWhere('m.instance_id = :instanceId', { instanceId: filters.instanceId });
    }

    const rows = await qb.getMany();
    const byThread = new Map<string, EvolutionInboxThreadDto>();

    const leadIds = [...new Set(rows.map((row) => row.leadId).filter(Boolean))] as string[];
    const leadRows = leadIds.length
      ? await this.leads.find({ where: { id: In(leadIds) }, select: ['id', 'title'] })
      : [];
    const leadTitleById = new Map(leadRows.map((lead) => [lead.id, lead.title]));

    for (const row of rows) {
      const threadKey = `${row.instanceId}:${row.contactPhone}`;
      if (byThread.has(threadKey)) continue;

      const leadTitle = row.leadId ? leadTitleById.get(row.leadId) ?? null : null;

      byThread.set(threadKey, {
        threadKey,
        instanceId: row.instanceId,
        instanceName: row.instance?.name ?? 'WhatsApp',
        contactPhone: row.contactPhone,
        contactName: row.contactName,
        leadId: row.leadId,
        leadTitle,
        lastMessageAt: row.messageAt.toISOString(),
        lastMessagePreview: row.body,
        lastDirection: row.direction,
      });
    }

    return [...byThread.values()].sort(
      (a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime(),
    );
  }

  async listThreadMessages(
    instanceId: string,
    contactPhone: string,
    limit = 200,
  ): Promise<EvolutionInboxMessageDto[]> {
    const digits = contactPhone.replace(/\D/g, '');
    if (!digits) throw new NotFoundException('Conversa não encontrada.');

    const instance = await this.instances.findOne({ where: { id: instanceId }, select: ['id'] });
    if (!instance) throw new NotFoundException('Instância não encontrada.');

    const rows = await this.messages.find({
      where: { instanceId, contactPhone: digits },
      order: { messageAt: 'ASC' },
      take: limit,
    });

    if (!rows.length) throw new NotFoundException('Nenhuma mensagem nesta conversa.');

    return rows.map((row) => ({
      id: row.id,
      direction: row.direction,
      body: row.body,
      contactName: row.contactName,
      messageAt: row.messageAt.toISOString(),
      leadId: row.leadId,
    }));
  }
}
