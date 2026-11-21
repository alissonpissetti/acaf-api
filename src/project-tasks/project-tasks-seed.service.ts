import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Repository } from 'typeorm';
import { LEGACY_STATUS_TO_API, PROJECT_TASK_PHASES } from './project-task.constants';
import { normalizeStatusProgress } from './project-task.rules';
import { ProjectTask } from './project-task.entity';

type SeedRow = {
  id?: string;
  fase?: string;
  nome?: string;
  ini?: string;
  fim?: string;
  status?: string;
  pct?: number;
  resp?: string;
  nota?: string;
  marco?: boolean;
};

@Injectable()
export class ProjectTasksSeedService {
  private readonly logger = new Logger(ProjectTasksSeedService.name);

  constructor(
    @InjectRepository(ProjectTask)
    private readonly tasks: Repository<ProjectTask>,
  ) {}

  resolveSeedPath(): string | null {
    const candidates = [
      join(process.cwd(), '../docs/cronograma/tarefas.json'),
      join(process.cwd(), 'docs/cronograma/tarefas.json'),
      join(process.cwd(), 'shared/project_tasks_seed.json'),
    ];
    return candidates.find((p) => existsSync(p)) ?? null;
  }

  async seedFromJsonFile(options?: { forceUpsert?: boolean }): Promise<{ inserted: number; updated: number }> {
    const path = this.resolveSeedPath();
    if (!path) {
      this.logger.warn('Arquivo tarefas.json não encontrado para seed do cronograma.');
      return { inserted: 0, updated: 0 };
    }

    const raw = JSON.parse(readFileSync(path, 'utf-8')) as SeedRow[];
    let inserted = 0;
    let updated = 0;

    const phaseOrder = new Map(PROJECT_TASK_PHASES.map((p, i) => [p, i]));

    for (let index = 0; index < raw.length; index++) {
      const row = raw[index]!;
      const code = String(row.id ?? '').trim() || null;
      const phase = String(row.fase ?? '').trim();
      if (!code || !phase || !PROJECT_TASK_PHASES.includes(phase as (typeof PROJECT_TASK_PHASES)[number])) {
        continue;
      }
      const legacyStatus = String(row.status ?? 'afazer');
      const statusRaw = LEGACY_STATUS_TO_API[legacyStatus] ?? 'todo';
      const normalized = normalizeStatusProgress(statusRaw, Number(row.pct) || 0);
      const isMilestone = Boolean(row.marco);
      let startDate = String(row.ini ?? '').slice(0, 10);
      let endDate = String(row.fim ?? startDate).slice(0, 10);
      if (isMilestone) endDate = startDate;

      const sortOrder = index;

      const payload: Partial<ProjectTask> = {
        code,
        phase: phase as ProjectTask['phase'],
        name: String(row.nome ?? 'Sem nome').trim(),
        startDate,
        endDate,
        status: normalized.status,
        progress: normalized.progress,
        owner: String(row.resp ?? '').trim() || null,
        notes: String(row.nota ?? '').trim() || null,
        isMilestone,
        sortOrder,
      };

      const existing = await this.tasks.findOne({ where: { code } });
      if (!existing) {
        await this.tasks.save(this.tasks.create(payload));
        inserted += 1;
        continue;
      }
      if (options?.forceUpsert) {
        Object.assign(existing, payload);
        await this.tasks.save(existing);
        updated += 1;
      }
    }

    this.logger.log(`Seed cronograma: ${inserted} inseridas, ${updated} atualizadas (${path}).`);
    return { inserted, updated };
  }

  async seedIfEmpty(): Promise<void> {
    const count = await this.tasks.count();
    if (count > 0) return;
    await this.seedFromJsonFile({ forceUpsert: false });
  }
}