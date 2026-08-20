import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  CommercialFunnelStage,
  type FunnelStageOutcome,
} from './commercial-funnel-stage.entity';
import {
  CommercialFunnel,
  type FunnelOutcomeAction,
} from './commercial-funnel.entity';
import { CommercialLead } from './commercial-lead.entity';

function slugifyFunnel(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

type StageInput = {
  id?: string;
  name: string;
  slug?: string;
  sortOrder: number;
  outcome: FunnelStageOutcome;
  active?: boolean;
  maxDaysInStage?: number | null;
};

type FunnelDto = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  active: boolean;
  isDefault: boolean;
  sortOrder: number;
  winAction: FunnelOutcomeAction;
  winActionLabel: string;
  winTargetFunnelId: string | null;
  winTargetStageId: string | null;
  winTargetFunnelName: string | null;
  winTargetStageName: string | null;
  lossAction: FunnelOutcomeAction;
  lossActionLabel: string;
  lossTargetFunnelId: string | null;
  lossTargetStageId: string | null;
  lossTargetFunnelName: string | null;
  lossTargetStageName: string | null;
  stages: ReturnType<CommercialFunnelsService['stageDto']>[];
  createdAt: string;
  updatedAt: string;
};

@Injectable()
export class CommercialFunnelsService {
  constructor(
    @InjectRepository(CommercialFunnel)
    private readonly funnels: Repository<CommercialFunnel>,
    @InjectRepository(CommercialFunnelStage)
    private readonly stages: Repository<CommercialFunnelStage>,
    @InjectRepository(CommercialLead)
    private readonly leads: Repository<CommercialLead>,
  ) {}

  async list(includeInactive = false) {
    const rows = await this.funnels.find({
      where: includeInactive ? {} : { active: true },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
    return Promise.all(rows.map((row) => this.toSummaryDto(row)));
  }

  async listOptions() {
    const rows = await this.funnels.find({
      where: { active: true },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
    return Promise.all(
      rows.map(async (row) => {
        const stageRows = await this.stages.find({
          where: { funnelId: row.id, active: true },
          order: { sortOrder: 'ASC' },
        });
        return {
          id: row.id,
          name: row.name,
          slug: row.slug,
          isDefault: row.isDefault,
          stages: stageRows.map((stage) => this.stageDto(stage)),
        };
      }),
    );
  }

  async get(id: string) {
    const funnel = await this.loadFunnel(id);
    return this.toDto(funnel);
  }

  async getDefaultFunnel() {
    let funnel = await this.funnels.findOne({ where: { isDefault: true, active: true } });
    if (!funnel) {
      funnel = await this.funnels.findOne({ where: { active: true }, order: { sortOrder: 'ASC' } });
    }
    if (!funnel) return null;
    return this.loadFunnel(funnel.id);
  }

  async getFunnelWithStages(id: string) {
    return this.loadFunnel(id);
  }

  async create(input: {
    name: string;
    slug?: string;
    description?: string;
    sortOrder?: number;
    isDefault?: boolean;
    active?: boolean;
    winAction?: FunnelOutcomeAction;
    winTargetFunnelId?: string | null;
    winTargetStageId?: string | null;
    lossAction?: FunnelOutcomeAction;
    lossTargetFunnelId?: string | null;
    lossTargetStageId?: string | null;
    stages: StageInput[];
  }) {
    const name = input.name.trim();
    if (!name) throw new BadRequestException('Informe o nome do funil.');

    const slug = slugifyFunnel(input.slug?.trim() || name);
    if (!slug) throw new BadRequestException('Slug do funil inválido.');

    const slugTaken = await this.funnels.findOne({ where: { slug } });
    if (slugTaken) throw new BadRequestException('Já existe um funil com este slug.');

    this.validateStages(input.stages);
    await this.validateOutcomeTargets(input);

    if (input.isDefault) {
      await this.clearDefaultFlag();
    }

    const savedFunnel = await this.funnels.save(
      this.funnels.create({
        name,
        slug,
        description: input.description?.trim() || null,
        sortOrder: input.sortOrder ?? 0,
        isDefault: Boolean(input.isDefault),
        active: input.active ?? true,
        winAction: input.winAction ?? 'none',
        winTargetFunnelId: input.winTargetFunnelId ?? null,
        winTargetStageId: input.winTargetStageId ?? null,
        lossAction: input.lossAction ?? 'none',
        lossTargetFunnelId: input.lossTargetFunnelId ?? null,
        lossTargetStageId: input.lossTargetStageId ?? null,
      }),
    );

    await this.replaceStages(savedFunnel.id, input.stages);
    return this.get(savedFunnel.id);
  }

  async update(
    id: string,
    patch: {
      name?: string;
      slug?: string;
      description?: string | null;
      sortOrder?: number;
      isDefault?: boolean;
      active?: boolean;
      winAction?: FunnelOutcomeAction;
      winTargetFunnelId?: string | null;
      winTargetStageId?: string | null;
      lossAction?: FunnelOutcomeAction;
      lossTargetFunnelId?: string | null;
      lossTargetStageId?: string | null;
      stages?: StageInput[];
    },
  ) {
    const funnel = await this.loadFunnel(id);

    if (patch.name != null) {
      const name = patch.name.trim();
      if (!name) throw new BadRequestException('Informe o nome do funil.');
      funnel.name = name;
    }

    if (patch.slug != null) {
      const slug = slugifyFunnel(patch.slug);
      if (!slug) throw new BadRequestException('Slug do funil inválido.');
      const slugTaken = await this.funnels.findOne({ where: { slug } });
      if (slugTaken && slugTaken.id !== funnel.id) {
        throw new BadRequestException('Já existe um funil com este slug.');
      }
      funnel.slug = slug;
    }

    if (patch.description !== undefined) {
      funnel.description = patch.description?.trim() || null;
    }
    if (patch.sortOrder != null) funnel.sortOrder = patch.sortOrder;
    if (patch.active != null) funnel.active = patch.active;
    if (patch.isDefault != null) {
      if (patch.isDefault) await this.clearDefaultFlag(id);
      funnel.isDefault = patch.isDefault;
    }
    if (patch.winAction != null) funnel.winAction = patch.winAction;
    if (patch.winTargetFunnelId !== undefined) funnel.winTargetFunnelId = patch.winTargetFunnelId;
    if (patch.winTargetStageId !== undefined) funnel.winTargetStageId = patch.winTargetStageId;
    if (patch.lossAction != null) funnel.lossAction = patch.lossAction;
    if (patch.lossTargetFunnelId !== undefined) funnel.lossTargetFunnelId = patch.lossTargetFunnelId;
    if (patch.lossTargetStageId !== undefined) funnel.lossTargetStageId = patch.lossTargetStageId;

    if (patch.stages) {
      this.validateStages(patch.stages);
    }

    await this.validateOutcomeTargets({
      winAction: funnel.winAction,
      winTargetFunnelId: funnel.winTargetFunnelId,
      winTargetStageId: funnel.winTargetStageId,
      lossAction: funnel.lossAction,
      lossTargetFunnelId: funnel.lossTargetFunnelId,
      lossTargetStageId: funnel.lossTargetStageId,
    });

    await this.funnels.save(funnel);

    if (patch.stages) {
      await this.replaceStages(funnel.id, patch.stages);
    }

    return this.get(funnel.id);
  }

  async deactivate(id: string) {
    const funnel = await this.funnels.findOne({ where: { id } });
    if (!funnel) throw new NotFoundException('Funil não encontrado.');

    const leadCount = await this.leads.count({ where: { funnelId: id } });
    if (leadCount > 0) {
      throw new BadRequestException('Não é possível remover um funil com leads vinculados.');
    }

    funnel.active = false;
    funnel.isDefault = false;
    await this.funnels.save(funnel);
    return { ok: true };
  }

  async getStage(stageId: string) {
    const stage = await this.stages.findOne({ where: { id: stageId } });
    if (!stage) throw new NotFoundException('Etapa não encontrada.');
    return stage;
  }

  async getStagesForFunnel(funnelId: string) {
    const rows = await this.stages.find({
      where: { funnelId, active: true },
      order: { sortOrder: 'ASC' },
    });
    return rows.map((row) => this.stageDto(row));
  }

  private async loadFunnel(id: string) {
    const funnel = await this.funnels.findOne({ where: { id } });
    if (!funnel) throw new NotFoundException('Funil não encontrado.');

    const stageRows = await this.stages.find({
      where: { funnelId: id },
      order: { sortOrder: 'ASC' },
    });
    funnel.stages = stageRows;
    return funnel;
  }

  private async clearDefaultFlag(exceptId?: string) {
    const rows = await this.funnels.find({ where: { isDefault: true } });
    for (const row of rows) {
      if (exceptId && row.id === exceptId) continue;
      row.isDefault = false;
      await this.funnels.save(row);
    }
  }

  private validateStages(stages: StageInput[]) {
    if (!stages?.length) {
      throw new BadRequestException('Informe ao menos uma etapa.');
    }

    const slugs = new Set<string>();
    let pipelineCount = 0;
    let wonCount = 0;
    let lostCount = 0;

    for (const stage of stages) {
      const name = stage.name?.trim();
      if (!name) throw new BadRequestException('Toda etapa precisa de nome.');

      const slug = slugifyFunnel(stage.slug?.trim() || name);
      if (!slug) throw new BadRequestException('Slug de etapa inválido.');
      if (slugs.has(slug)) throw new BadRequestException(`Etapa duplicada: ${slug}.`);
      slugs.add(slug);

      if (stage.outcome === 'pipeline') pipelineCount += 1;
      if (stage.outcome === 'won') wonCount += 1;
      if (stage.outcome === 'lost') lostCount += 1;
    }

    if (pipelineCount < 1) {
      throw new BadRequestException('O funil precisa de ao menos uma etapa de pipeline.');
    }
    if (wonCount !== 1) {
      throw new BadRequestException('Defina exatamente uma etapa de ganho.');
    }
    if (lostCount !== 1) {
      throw new BadRequestException('Defina exatamente uma etapa de perda.');
    }
  }

  private async validateOutcomeTargets(input: {
    winAction?: FunnelOutcomeAction;
    winTargetFunnelId?: string | null;
    winTargetStageId?: string | null;
    lossAction?: FunnelOutcomeAction;
    lossTargetFunnelId?: string | null;
    lossTargetStageId?: string | null;
  }) {
    if (input.lossAction === 'convert') {
      throw new BadRequestException('A ação de perda não pode converter em cadastro.');
    }
    await this.validateOutcomeTarget('ganho', input.winAction, input.winTargetFunnelId, input.winTargetStageId);
    await this.validateOutcomeTarget('perda', input.lossAction, input.lossTargetFunnelId, input.lossTargetStageId);
  }

  private async validateOutcomeTarget(
    label: string,
    action?: FunnelOutcomeAction,
    targetFunnelId?: string | null,
    targetStageId?: string | null,
  ) {
    if (action !== 'transfer_funnel') return;

    if (!targetFunnelId || !targetStageId) {
      throw new BadRequestException(`Selecione funil e etapa de destino para a ação de ${label}.`);
    }

    const targetFunnel = await this.funnels.findOne({ where: { id: targetFunnelId, active: true } });
    if (!targetFunnel) {
      throw new BadRequestException(`Funil de destino inválido para a ação de ${label}.`);
    }

    const targetStage = await this.stages.findOne({
      where: { id: targetStageId, funnelId: targetFunnelId, active: true },
    });
    if (!targetStage) {
      throw new BadRequestException(`Etapa de destino inválida para a ação de ${label}.`);
    }
  }

  private async replaceStages(funnelId: string, stages: StageInput[]) {
    const existing = await this.stages.find({ where: { funnelId } });
    const existingById = new Map(existing.map((row) => [row.id, row]));
    const keepIds = new Set<string>();

    for (const [index, stageInput] of stages.entries()) {
      const name = stageInput.name.trim();
      const slug = slugifyFunnel(stageInput.slug?.trim() || name);
      const payload = {
        funnelId,
        name,
        slug,
        sortOrder: stageInput.sortOrder ?? index + 1,
        outcome: stageInput.outcome,
        active: stageInput.active ?? true,
        maxDaysInStage:
          stageInput.maxDaysInStage != null && stageInput.maxDaysInStage > 0
            ? Math.floor(stageInput.maxDaysInStage)
            : null,
      };

      if (stageInput.id && existingById.has(stageInput.id)) {
        const current = existingById.get(stageInput.id)!;
        Object.assign(current, payload);
        const saved = await this.stages.save(current);
        keepIds.add(saved.id);
        continue;
      }

      const saved = await this.stages.save(this.stages.create(payload));
      keepIds.add(saved.id);
    }

    for (const row of existing) {
      if (keepIds.has(row.id)) continue;

      const inUse = await this.leads.count({ where: { stageId: row.id } });
      if (inUse > 0) {
        throw new BadRequestException(
          `A etapa "${row.name}" possui leads e não pode ser removida.`,
        );
      }
      await this.stages.delete(row.id);
    }
  }

  stageDto(stage: CommercialFunnelStage) {
    return {
      id: stage.id,
      funnelId: stage.funnelId,
      name: stage.name,
      slug: stage.slug,
      outcome: stage.outcome,
      outcomeLabel:
        stage.outcome === 'won' ? 'Ganho' : stage.outcome === 'lost' ? 'Perda' : 'Pipeline',
      sortOrder: stage.sortOrder,
      active: stage.active,
      maxDaysInStage: stage.maxDaysInStage,
    };
  }

  private async toSummaryDto(funnel: CommercialFunnel) {
    const stageCount = await this.stages.count({ where: { funnelId: funnel.id, active: true } });
    const leadCount = await this.leads.count({ where: { funnelId: funnel.id } });
    return {
      id: funnel.id,
      name: funnel.name,
      slug: funnel.slug,
      description: funnel.description,
      active: funnel.active,
      isDefault: funnel.isDefault,
      sortOrder: funnel.sortOrder,
      stageCount,
      leadCount,
      winAction: funnel.winAction,
      lossAction: funnel.lossAction,
    };
  }

  private async toDto(funnel: CommercialFunnel): Promise<FunnelDto> {
    const [targetFunnelNames, targetStageNames] = await Promise.all([
      this.loadTargetNames([funnel.winTargetFunnelId, funnel.lossTargetFunnelId]),
      this.loadStageNames([funnel.winTargetStageId, funnel.lossTargetStageId]),
    ]);

    return {
      id: funnel.id,
      name: funnel.name,
      slug: funnel.slug,
      description: funnel.description,
      active: funnel.active,
      isDefault: funnel.isDefault,
      sortOrder: funnel.sortOrder,
      winAction: funnel.winAction,
      winActionLabel: this.actionLabel(funnel.winAction),
      winTargetFunnelId: funnel.winTargetFunnelId,
      winTargetStageId: funnel.winTargetStageId,
      winTargetFunnelName: funnel.winTargetFunnelId
        ? targetFunnelNames.get(funnel.winTargetFunnelId) ?? null
        : null,
      winTargetStageName: funnel.winTargetStageId
        ? targetStageNames.get(funnel.winTargetStageId) ?? null
        : null,
      lossAction: funnel.lossAction,
      lossActionLabel: this.actionLabel(funnel.lossAction),
      lossTargetFunnelId: funnel.lossTargetFunnelId,
      lossTargetStageId: funnel.lossTargetStageId,
      lossTargetFunnelName: funnel.lossTargetFunnelId
        ? targetFunnelNames.get(funnel.lossTargetFunnelId) ?? null
        : null,
      lossTargetStageName: funnel.lossTargetStageId
        ? targetStageNames.get(funnel.lossTargetStageId) ?? null
        : null,
      stages: (funnel.stages ?? []).map((stage) => this.stageDto(stage)),
      createdAt: funnel.createdAt.toISOString(),
      updatedAt: funnel.updatedAt.toISOString(),
    };
  }

  private actionLabel(action: FunnelOutcomeAction) {
    if (action === 'convert') return 'Converter em cadastro';
    if (action === 'transfer_funnel') return 'Mover para outro funil';
    return 'Nenhuma';
  }

  private async loadTargetNames(ids: Array<string | null>) {
    const valid = ids.filter(Boolean) as string[];
    if (!valid.length) return new Map<string, string>();
    const rows = await this.funnels.find({ where: { id: In(valid) } });
    return new Map(rows.map((row) => [row.id, row.name]));
  }

  private async loadStageNames(ids: Array<string | null>) {
    const valid = ids.filter(Boolean) as string[];
    if (!valid.length) return new Map<string, string>();
    const rows = await this.stages.find({ where: { id: In(valid) } });
    return new Map(rows.map((row) => [row.id, row.name]));
  }
}
