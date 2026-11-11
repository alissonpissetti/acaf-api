import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CommercialLead } from './commercial-lead.entity';
import { CommercialFunnelStage } from './commercial-funnel-stage.entity';
import { CommercialFunnel } from './commercial-funnel.entity';
import { CommercialLossReason } from './commercial-loss-reason.entity';
import { CommercialLeadInteraction } from './commercial-lead-interaction.entity';
import {
  CommercialLossReasonsService,
  normalizeLossReasonKey,
} from './commercial-loss-reasons.service';

const CATALOG_LOSS_LABELS = [
  'Preço / orçamento',
  'Sem resposta do lead',
  'Escolheu concorrente',
  'Sem fit com a solução',
  'Timing — sem prioridade agora',
  'Decisão interna / pausa do projeto',
];

const CATALOG_LOSS_KEYS = new Set(CATALOG_LOSS_LABELS.map((label) => normalizeLossReasonKey(label)));

const OBJECTION_HINTS = [
  'obje',
  'caro',
  'preço',
  'preco',
  'budget',
  'concorrent',
  'não tem',
  'nao tem',
  'sem fit',
  'prioridade',
  'depois',
  'adiar',
];

type ReportFilters = {
  funnelId?: string;
  from?: string;
  to?: string;
  limit?: number;
};

@Injectable()
export class CommercialLossReportService {
  constructor(
    @InjectRepository(CommercialLead)
    private readonly leads: Repository<CommercialLead>,
    @InjectRepository(CommercialFunnelStage)
    private readonly stages: Repository<CommercialFunnelStage>,
    @InjectRepository(CommercialFunnel)
    private readonly funnels: Repository<CommercialFunnel>,
    @InjectRepository(CommercialLossReason)
    private readonly lossReasons: Repository<CommercialLossReason>,
    @InjectRepository(CommercialLeadInteraction)
    private readonly interactions: Repository<CommercialLeadInteraction>,
    private readonly lossReasonLabels: CommercialLossReasonsService,
  ) {}

  async getReport(filters?: ReportFilters) {
    const limit = Math.min(Math.max(filters?.limit ?? 50, 1), 200);
    const stageSets = await this.loadStageSets(filters?.funnelId);
    const lostStageIds = stageSets.lost;
    const from = this.parseDate(filters?.from);
    const to = this.parseDate(filters?.to, true);

    const funnelPerformance = await this.buildFunnelPerformance(
      stageSets,
      filters?.funnelId,
      from,
      to,
    );

    if (!lostStageIds.length) {
      return this.emptyReport(filters, funnelPerformance);
    }

    const qb = this.leads
      .createQueryBuilder('lead')
      .where('lead.stage_id IN (:...lostStageIds)', { lostStageIds })
      .andWhere('lead.converted_network_id IS NULL')
      .andWhere('lead.converted_company_id IS NULL');

    if (filters?.funnelId) {
      qb.andWhere('lead.funnel_id = :funnelId', { funnelId: filters.funnelId });
    }

    if (from) {
      qb.andWhere('COALESCE(lead.stage_entered_at, lead.updated_at) >= :from', { from });
    }
    if (to) {
      qb.andWhere('COALESCE(lead.stage_entered_at, lead.updated_at) <= :to', { to });
    }

    const rows = await qb
      .orderBy('COALESCE(lead.stage_entered_at, lead.updated_at)', 'DESC')
      .getMany();

    const totalLost = rows.length;
    const reasonIds = [...new Set(rows.map((row) => row.lossReasonId).filter(Boolean))] as string[];
    const reasonRows = reasonIds.length
      ? await this.lossReasons.find({ where: { id: In(reasonIds) } })
      : [];
    const reasonById = new Map(reasonRows.map((row) => [row.id, row]));

    const funnelIds = [...new Set(rows.map((row) => row.funnelId))];
    const funnelRows = funnelIds.length
      ? await this.funnels.find({ where: { id: In(funnelIds) } })
      : [];
    const funnelNameById = new Map(funnelRows.map((row) => [row.id, row.name]));

    const byReasonMap = new Map<
      string,
      { reasonId: string | null; label: string; count: number; catalog: boolean; objection: boolean }
    >();

    let withoutReason = 0;
    for (const lead of rows) {
      if (!lead.lossReasonId) {
        withoutReason += 1;
        continue;
      }
      const reason = reasonById.get(lead.lossReasonId);
      const label = reason?.label ?? (await this.lossReasonLabels.getLabel(lead.lossReasonId));
      const catalog = reason ? CATALOG_LOSS_KEYS.has(reason.labelKey) : false;
      const objection = reason ? !catalog || this.looksLikeObjection(label) : false;
      const key = lead.lossReasonId;
      if (!byReasonMap.has(key)) {
        byReasonMap.set(key, {
          reasonId: lead.lossReasonId,
          label,
          count: 0,
          catalog,
          objection,
        });
      }
      byReasonMap.get(key)!.count += 1;
    }

    const byReason = [...byReasonMap.values()]
      .map((row) => ({
        ...row,
        sharePercent: totalLost ? Math.round((row.count / totalLost) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.count - a.count);

    const objections = byReason.filter((row) => row.objection);
    const catalogReasons = byReason.filter((row) => row.catalog);
    const customReasons = byReason.filter((row) => !row.catalog);

    const leadIds = rows.slice(0, limit).map((row) => row.id);
    const interactionSnippets = await this.loadObjectionSnippets(leadIds);

    const recentLeads = rows.slice(0, limit).map((lead) => {
      const reason = lead.lossReasonId ? reasonById.get(lead.lossReasonId) : null;
      const lostAt = lead.stageEnteredAt ?? lead.updatedAt;
      return {
        id: lead.id,
        title: lead.title,
        funnelId: lead.funnelId,
        funnelName: funnelNameById.get(lead.funnelId) ?? '—',
        source: lead.source,
        type: lead.type,
        phone: lead.phone,
        lossReasonId: lead.lossReasonId,
        lossReasonLabel: reason?.label ?? null,
        lostAt: lostAt?.toISOString() ?? null,
        objectionSnippet: interactionSnippets.get(lead.id) ?? null,
      };
    });

    return {
      filters: {
        funnelId: filters?.funnelId ?? null,
        from: filters?.from ?? null,
        to: filters?.to ?? null,
      },
      funnelPerformance,
      summary: {
        totalLost,
        withReason: totalLost - withoutReason,
        withoutReason,
        catalogReasonCount: catalogReasons.reduce((sum, row) => sum + row.count, 0),
        objectionReasonCount: objections.reduce((sum, row) => sum + row.count, 0),
        customReasonCount: customReasons.reduce((sum, row) => sum + row.count, 0),
        lossSharePercent: funnelPerformance.period.closed
          ? Math.round((totalLost / funnelPerformance.period.closed) * 1000) / 10
          : 0,
      },
      byReason,
      objections,
      customReasons,
      catalogReasons,
      recentLeads,
    };
  }

  private async loadStageSets(funnelId?: string) {
    const qb = this.stages
      .createQueryBuilder('stage')
      .where('stage.active = :active', { active: true });
    if (funnelId) {
      qb.andWhere('stage.funnel_id = :funnelId', { funnelId });
    }
    const rows = await qb.getMany();
    return {
      pipeline: rows.filter((row) => row.outcome === 'pipeline').map((row) => row.id),
      won: rows.filter((row) => row.outcome === 'won').map((row) => row.id),
      lost: rows.filter((row) => row.outcome === 'lost').map((row) => row.id),
    };
  }

  private async buildFunnelPerformance(
    stageSets: { pipeline: string[]; won: string[]; lost: string[] },
    funnelId?: string,
    from?: Date | null,
    to?: Date | null,
  ) {
    const qb = this.leads.createQueryBuilder('lead');
    if (funnelId) {
      qb.andWhere('lead.funnel_id = :funnelId', { funnelId });
    }
    const rows = await qb.getMany();

    const wonSet = new Set(stageSets.won);
    const lostSet = new Set(stageSets.lost);
    const pipelineSet = new Set(stageSets.pipeline);

    const snapshot = { total: 0, pipeline: 0, won: 0, lost: 0, converted: 0 };
    const period = { total: 0, pipeline: 0, won: 0, lost: 0, closed: 0 };

    for (const lead of rows) {
      snapshot.total += 1;
      const converted = Boolean(lead.convertedNetworkId || lead.convertedCompanyId);
      const inPeriod = this.leadMatchesPeriod(lead, from, to);

      if (converted) {
        snapshot.converted += 1;
        snapshot.won += 1;
        if (inPeriod) {
          period.total += 1;
          period.won += 1;
          period.closed += 1;
        }
        continue;
      }

      if (wonSet.has(lead.stageId)) {
        snapshot.won += 1;
        if (inPeriod) {
          period.total += 1;
          period.won += 1;
          period.closed += 1;
        }
        continue;
      }

      if (lostSet.has(lead.stageId)) {
        snapshot.lost += 1;
        if (inPeriod) {
          period.total += 1;
          period.lost += 1;
          period.closed += 1;
        }
        continue;
      }

      if (pipelineSet.has(lead.stageId)) {
        snapshot.pipeline += 1;
        if (inPeriod) period.total += 1;
      }
    }

    period.pipeline = Math.max(0, period.total - period.won - period.lost);

    const snapshotClosed = snapshot.won + snapshot.lost;
    const winPercent = snapshotClosed
      ? Math.round((snapshot.won / snapshotClosed) * 1000) / 10
      : 0;
    const lossPercent = snapshotClosed
      ? Math.round((snapshot.lost / snapshotClosed) * 1000) / 10
      : 0;
    const conversionRate = period.closed
      ? Math.round((period.won / period.closed) * 1000) / 10
      : winPercent;
    const periodLossPercent = period.closed
      ? Math.round((period.lost / period.closed) * 1000) / 10
      : lossPercent;

    return {
      snapshot: {
        ...snapshot,
        closed: snapshotClosed,
        winPercent,
        lossPercent,
        pipelinePercent: snapshot.total
          ? Math.round((snapshot.pipeline / snapshot.total) * 1000) / 10
          : 0,
      },
      period: {
        ...period,
        winPercent: conversionRate,
        lossPercent: periodLossPercent,
        conversionRate,
      },
    };
  }

  private leadMatchesPeriod(lead: CommercialLead, from?: Date | null, to?: Date | null) {
    if (!from && !to) return true;
    const refs = [lead.stageEnteredAt, lead.updatedAt, lead.createdAt].filter(Boolean) as Date[];
    for (const ref of refs) {
      if (from && ref < from) continue;
      if (to && ref > to) continue;
      return true;
    }
    return false;
  }

  private async loadObjectionSnippets(leadIds: string[]) {
    const map = new Map<string, string>();
    if (!leadIds.length) return map;

    const rows = await this.interactions.find({
      where: { leadId: In(leadIds) },
      order: { createdAt: 'DESC' },
    });

    const byLead = new Map<string, CommercialLeadInteraction[]>();
    for (const row of rows) {
      if (!byLead.has(row.leadId)) byLead.set(row.leadId, []);
      byLead.get(row.leadId)!.push(row);
    }

    for (const leadId of leadIds) {
      const list = byLead.get(leadId) ?? [];
      const candidate = list.find((row) => {
        const text = String(row.content ?? '').trim();
        if (!text || text.startsWith('Motivo da perda:')) return false;
        const lower = text.toLowerCase();
        return OBJECTION_HINTS.some((hint) => lower.includes(hint));
      });
      if (candidate) {
        map.set(leadId, candidate.content.trim().slice(0, 280));
      }
    }

    return map;
  }

  private looksLikeObjection(label: string) {
    const lower = label.toLowerCase();
    return OBJECTION_HINTS.some((hint) => lower.includes(hint));
  }

  private parseDate(value?: string, endOfDay = false) {
    const raw = String(value ?? '').trim();
    if (!raw) return null;
    const date = new Date(`${raw}T${endOfDay ? '23:59:59' : '00:00:00'}`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private emptyReport(
    filters?: ReportFilters,
    funnelPerformance = this.emptyFunnelPerformance(),
  ) {
    return {
      filters: {
        funnelId: filters?.funnelId ?? null,
        from: filters?.from ?? null,
        to: filters?.to ?? null,
      },
      funnelPerformance,
      summary: {
        totalLost: 0,
        withReason: 0,
        withoutReason: 0,
        catalogReasonCount: 0,
        objectionReasonCount: 0,
        customReasonCount: 0,
        lossSharePercent: 0,
      },
      byReason: [],
      objections: [],
      customReasons: [],
      catalogReasons: [],
      recentLeads: [],
    };
  }

  private emptyFunnelPerformance() {
    return {
      snapshot: {
        total: 0,
        pipeline: 0,
        won: 0,
        lost: 0,
        converted: 0,
        closed: 0,
        winPercent: 0,
        lossPercent: 0,
        pipelinePercent: 0,
      },
      period: {
        total: 0,
        pipeline: 0,
        won: 0,
        lost: 0,
        closed: 0,
        winPercent: 0,
        lossPercent: 0,
        conversionRate: 0,
      },
    };
  }
}
