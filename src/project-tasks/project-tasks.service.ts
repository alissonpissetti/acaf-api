import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UsersService } from '../users/users.service';
import { PROJECT_TASK_PHASES } from './project-task.constants';
import { ProjectTask } from './project-task.entity';
import { ProjectTaskEvent } from './project-task-event.entity';
import type { CreateProjectTaskBody, PatchProjectTaskBody, ProjectTaskDto, ProjectTaskEventDto } from './project-tasks.dto';
import { ProjectTasksSeedService } from './project-tasks-seed.service';
import {
  assertValidDateRange,
  isValidPhase,
  isValidStatus,
  normalizeStatusProgress,
} from './project-task.rules';

const TRACKED_FIELDS: Array<keyof ProjectTask> = [
  'name',
  'phase',
  'startDate',
  'endDate',
  'status',
  'progress',
  'owner',
  'ownerUserIds',
  'notes',
  'isMilestone',
];

function sanitizeOwnerUserIds(ids: string[] | null | undefined): string[] | null {
  if (!ids?.length) return null;
  const out = [...new Set(ids.map((id) => String(id).trim()).filter(Boolean))];
  return out.length ? out : null;
}

function serializeTrackedField(field: keyof ProjectTask, value: unknown): string | null {
  if (value == null) return null;
  if (field === 'ownerUserIds') {
    const arr = Array.isArray(value) ? value : [];
    return arr.length ? JSON.stringify(arr) : null;
  }
  if (field === 'isMilestone') return value ? 'true' : 'false';
  return String(value);
}

function ymd(value: string | Date): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
}

@Injectable()
export class ProjectTasksService implements OnModuleInit {
  constructor(
    @InjectRepository(ProjectTask)
    private readonly tasks: Repository<ProjectTask>,
    @InjectRepository(ProjectTaskEvent)
    private readonly events: Repository<ProjectTaskEvent>,
    private readonly users: UsersService,
    private readonly seed: ProjectTasksSeedService,
  ) {}

  async onModuleInit() {
    await this.seed.seedIfEmpty();
  }

  async list(): Promise<ProjectTaskDto[]> {
    const rows = await this.tasks.find();
    return this.toDtos(rows);
  }

  async create(body: CreateProjectTaskBody, userId: string): Promise<ProjectTaskDto> {
    const name = body.name?.trim();
    if (!name) throw new BadRequestException('Informe o nome da tarefa.');
    if (!isValidPhase(body.phase)) throw new BadRequestException('Fase inválida.');

    const statusIn = body.status && isValidStatus(body.status) ? body.status : 'todo';
    const { status, progress } = normalizeStatusProgress(statusIn, body.progress ?? 0);
    const isMilestone = Boolean(body.isMilestone);
    let startDate = body.startDate;
    let endDate = body.endDate;
    if (isMilestone) endDate = startDate;
    assertValidDateRange(startDate, endDate, isMilestone);

    const code = body.code?.trim() || null;
    if (code) {
      const dup = await this.tasks.findOne({ where: { code } });
      if (dup) throw new BadRequestException(`Código ${code} já existe.`);
    }

    const entity = this.tasks.create({
      code,
      phase: body.phase,
      name,
      startDate,
      endDate,
      status,
      progress,
      owner: body.owner?.trim() || null,
      ownerUserIds: sanitizeOwnerUserIds(body.ownerUserIds),
      notes: body.notes?.trim() || null,
      isMilestone,
      sortOrder: body.sortOrder ?? 0,
      updatedBy: userId,
    });
    const saved = await this.tasks.save(entity);
    await this.logEvents(saved.id, userId, {}, saved, true);
    return (await this.toDtos([saved]))[0]!;
  }

  async patch(id: string, body: PatchProjectTaskBody, userId: string): Promise<ProjectTaskDto> {
    const current = await this.tasks.findOne({ where: { id } });
    if (!current) throw new NotFoundException('Tarefa não encontrada.');

    const before = { ...current };
    if (body.phase !== undefined) {
      if (!isValidPhase(body.phase)) throw new BadRequestException('Fase inválida.');
      current.phase = body.phase;
    }
    if (body.name !== undefined) {
      const name = body.name.trim();
      if (!name) throw new BadRequestException('Informe o nome da tarefa.');
      current.name = name;
    }
    if (body.startDate !== undefined) current.startDate = body.startDate;
    if (body.endDate !== undefined) current.endDate = body.endDate;
    if (body.isMilestone !== undefined) current.isMilestone = Boolean(body.isMilestone);
    if (body.owner !== undefined) current.owner = body.owner?.trim() || null;
    if (body.ownerUserIds !== undefined) {
      current.ownerUserIds = sanitizeOwnerUserIds(body.ownerUserIds);
    }
    if (body.notes !== undefined) current.notes = body.notes?.trim() || null;
    if (body.sortOrder !== undefined) current.sortOrder = body.sortOrder;

    let status = current.status;
    let progress = current.progress;
    if (body.status !== undefined) {
      if (!isValidStatus(body.status)) throw new BadRequestException('Status inválido.');
      status = body.status;
    }
    if (body.progress !== undefined) progress = body.progress;
    const normalized = normalizeStatusProgress(status, progress);
    current.status = normalized.status;
    current.progress = normalized.progress;

    if (current.isMilestone) current.endDate = current.startDate;
    assertValidDateRange(current.startDate, current.endDate, current.isMilestone);

    if (body.code !== undefined) {
      const code = body.code?.trim() || null;
      if (code && code !== current.code) {
        const dup = await this.tasks.findOne({ where: { code } });
        if (dup && dup.id !== id) throw new BadRequestException(`Código ${code} já existe.`);
      }
      current.code = code;
    }

    current.updatedBy = userId;
    const saved = await this.tasks.save(current);
    await this.logEvents(saved.id, userId, before, saved, false);
    return (await this.toDtos([saved]))[0]!;
  }

  async remove(id: string): Promise<{ ok: true }> {
    const current = await this.tasks.findOne({ where: { id } });
    if (!current) throw new NotFoundException('Tarefa não encontrada.');
    await this.events.delete({ taskId: id });
    await this.tasks.delete({ id });
    return { ok: true };
  }

  async listEvents(taskId: string): Promise<ProjectTaskEventDto[]> {
    const task = await this.tasks.findOne({ where: { id: taskId } });
    if (!task) throw new NotFoundException('Tarefa não encontrada.');
    const rows = await this.events.find({
      where: { taskId },
      order: { createdAt: 'DESC' },
      take: 100,
    });
    return this.eventDtos(rows);
  }

  async runSeed(forceUpsert = true) {
    return this.seed.seedFromJsonFile({ forceUpsert });
  }

  private sortTasks(rows: ProjectTask[]): ProjectTask[] {
    const phaseIndex = new Map(PROJECT_TASK_PHASES.map((p, i) => [p, i]));
    return [...rows].sort((a, b) => {
      const pa = phaseIndex.get(a.phase) ?? 999;
      const pb = phaseIndex.get(b.phase) ?? 999;
      if (pa !== pb) return pa - pb;
      const sd = a.startDate.localeCompare(b.startDate);
      if (sd !== 0) return sd;
      return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
    });
  }

  private async toDtos(rows: ProjectTask[]): Promise<ProjectTaskDto[]> {
    const sorted = this.sortTasks(rows);
    const userIds = [...new Set(sorted.map((r) => r.updatedBy).filter(Boolean))] as string[];
    const nameById = new Map<string, string>();
    for (const userId of userIds) {
      const user = await this.users.findById(userId);
      if (user?.name) nameById.set(userId, user.name);
    }
    return sorted.map((row) => ({
      id: row.id,
      code: row.code,
      phase: row.phase,
      name: row.name,
      startDate: ymd(row.startDate),
      endDate: ymd(row.endDate),
      status: row.status,
      progress: row.progress,
      owner: row.owner,
      ownerUserIds: Array.isArray(row.ownerUserIds) ? row.ownerUserIds : [],
      notes: row.notes,
      isMilestone: row.isMilestone,
      sortOrder: row.sortOrder,
      updatedAt: row.updatedAt.toISOString(),
      updatedBy: row.updatedBy,
      updatedByName: row.updatedBy ? nameById.get(row.updatedBy) ?? null : null,
    }));
  }

  private async eventDtos(rows: ProjectTaskEvent[]): Promise<ProjectTaskEventDto[]> {
    const userIds = [...new Set(rows.map((r) => r.userId).filter(Boolean))] as string[];
    const nameById = new Map<string, string>();
    for (const userId of userIds) {
      const user = await this.users.findById(userId);
      if (user?.name) nameById.set(userId, user.name);
    }
    return rows.map((row) => ({
      id: row.id,
      taskId: row.taskId,
      userId: row.userId,
      userName: row.userId ? nameById.get(row.userId) ?? null : null,
      field: row.field,
      oldValue: row.oldValue,
      newValue: row.newValue,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  private async logEvents(
    taskId: string,
    userId: string,
    before: Partial<ProjectTask>,
    after: ProjectTask,
    isCreate: boolean,
  ): Promise<void> {
    const entries: ProjectTaskEvent[] = [];
    for (const field of TRACKED_FIELDS) {
      const oldVal = before[field as keyof ProjectTask];
      const newVal = after[field as keyof ProjectTask];
      const oldStr = serializeTrackedField(field, oldVal);
      const newStr = serializeTrackedField(field, newVal);
      if (isCreate) {
        if (newStr == null || newStr === '') continue;
        entries.push(
          this.events.create({
            taskId,
            userId,
            field,
            oldValue: null,
            newValue: newStr,
          }),
        );
      } else if (oldStr !== newStr) {
        entries.push(
          this.events.create({
            taskId,
            userId,
            field,
            oldValue: oldStr,
            newValue: newStr,
          }),
        );
      }
    }
    if (entries.length) await this.events.save(entries);
  }
}