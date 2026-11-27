import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NextcloudService } from '../storage/nextcloud.service';
import { UsersService } from '../users/users.service';
import {
  DEFAULT_CRONOGRAMA_REQUESTER_NAME_PREFIX,
  PROJECT_TASK_PHASES,
} from './project-task.constants';
import { ProjectTask } from './project-task.entity';
import { ProjectTaskEvent } from './project-task-event.entity';
import type {
  CreateProjectTaskBody,
  CreateProjectTaskCommentBody,
  PatchProjectTaskBody,
  ProjectTaskAttachmentDto,
  ProjectTaskCommentDto,
  ProjectTaskDto,
  ProjectTaskEventDto,
  ProjectTaskTouchDto,
  RemoveProjectTaskCommentResult,
} from './project-tasks.dto';
import { ProjectTaskAttachment } from './project-task-attachment.entity';
import { ProjectTaskComment } from './project-task-comment.entity';
import { ProjectTaskNotificationsService } from './project-task-notifications.service';
import { ProjectTasksSeedService } from './project-tasks-seed.service';
import {
  assertValidDateRange,
  isValidPhase,
  isValidPriority,
  isValidStatus,
  normalizeStatusProgress,
} from './project-task.rules';

const TRACKED_FIELDS: Array<keyof ProjectTask> = [
  'name',
  'phase',
  'startDate',
  'endDate',
  'status',
  'priority',
  'tags',
  'estimatedHours',
  'timeTrackedSeconds',
  'requesterUserId',
  'progress',
  'owner',
  'ownerUserIds',
  'notes',
  'isMilestone',
];

function sanitizeTags(tags: string[] | null | undefined): string[] | null {
  if (!tags?.length) return null;
  const out = [...new Set(tags.map((t) => String(t).trim()).filter(Boolean))].slice(0, 30);
  return out.length ? out : null;
}

function parseEstimatedHours(value: number | undefined): string {
  if (value == null || Number.isNaN(value)) return '0';
  const n = Math.max(0, Math.min(9999.99, Number(value)));
  return n.toFixed(2);
}

function estimatedHoursToNumber(raw: string | number | null | undefined): number {
  const n = Number(raw ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function sanitizeOwnerUserIds(ids: string[] | null | undefined): string[] | null {
  if (!ids?.length) return null;
  const out = [...new Set(ids.map((id) => String(id).trim()).filter(Boolean))];
  return out.length ? out : null;
}

function serializeTrackedField(field: keyof ProjectTask, value: unknown): string | null {
  if (value == null) return null;
  if (field === 'ownerUserIds' || field === 'tags') {
    const arr = Array.isArray(value) ? value : [];
    return arr.length ? JSON.stringify(arr) : null;
  }
  if (field === 'isMilestone') return value ? 'true' : 'false';
  if (field === 'timeTrackedSeconds') return value != null ? String(value) : null;
  if (field === 'estimatedHours') return value != null ? String(value) : null;
  return String(value);
}

const MAX_TASK_ATTACHMENTS = 20;
const MAX_TASK_ATTACHMENT_BYTES = 15 * 1024 * 1024;

const MENTION_ID_PATTERN = /@\[[^\]]+\]\(([0-9a-f-]{36})\)/gi;

function extractMentionedUserIds(body: string): string[] {
  const ids = new Set<string>();
  const re = new RegExp(MENTION_ID_PATTERN.source, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    if (m[1]) ids.add(m[1]);
  }
  return [...ids];
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
    @InjectRepository(ProjectTaskComment)
    private readonly comments: Repository<ProjectTaskComment>,
    @InjectRepository(ProjectTaskAttachment)
    private readonly attachments: Repository<ProjectTaskAttachment>,
    private readonly storage: NextcloudService,
    private readonly users: UsersService,
    private readonly seed: ProjectTasksSeedService,
    private readonly taskNotifications: ProjectTaskNotificationsService,
  ) {}

  async onModuleInit() {
    await this.seed.seedIfEmpty();
    await this.backfillDefaultRequestersIfNeeded();
  }

  private async defaultRequesterUserId(): Promise<string | null> {
    const fromEnv = process.env.CRONOGRAMA_DEFAULT_REQUESTER_EMAIL?.trim();
    if (fromEnv) {
      const user = await this.users.findByEmail(fromEnv);
      if (user?.active) return user.id;
    }
    const all = await this.users.findAll();
    const prefix = DEFAULT_CRONOGRAMA_REQUESTER_NAME_PREFIX.toLowerCase();
    const match = all.find((u) => u.active !== false && u.name?.trim().toLowerCase().startsWith(prefix));
    return match?.id ?? null;
  }

  /** Tarefas sem solicitante recebem o padrão (Alisson). */
  private async backfillDefaultRequestersIfNeeded(): Promise<void> {
    const requesterId = await this.defaultRequesterUserId();
    if (!requesterId) return;
    await this.tasks
      .createQueryBuilder()
      .update(ProjectTask)
      .set({ requesterUserId: requesterId })
      .where('requesterUserId IS NULL')
      .execute();
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

    const priority =
      body.priority && isValidPriority(body.priority) ? body.priority : 'medium';
    const tags = sanitizeTags(body.tags);
    const defaultRequester = await this.defaultRequesterUserId();
    const entity = this.tasks.create({
      code,
      phase: body.phase,
      name,
      startDate,
      endDate,
      status,
      priority,
      tags,
      estimatedHours: parseEstimatedHours(body.estimatedHours),
      timeTrackedSeconds: Math.max(0, Math.floor(body.timeTrackedSeconds ?? 0)),
      requesterUserId: body.requesterUserId?.trim() || defaultRequester || userId,
      createdBy: userId,
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
    void this.taskNotifications.onAssigneesChanged(saved, [], userId);
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
    if (body.priority !== undefined) {
      if (!isValidPriority(body.priority)) throw new BadRequestException('Prioridade inválida.');
      current.priority = body.priority;
    }
    if (body.tags !== undefined) current.tags = sanitizeTags(body.tags);
    if (body.estimatedHours !== undefined) {
      current.estimatedHours = parseEstimatedHours(body.estimatedHours);
    }
    if (body.timeTrackedSeconds !== undefined) {
      current.timeTrackedSeconds = Math.max(0, Math.floor(body.timeTrackedSeconds));
    }
    if (body.requesterUserId !== undefined) {
      current.requesterUserId = body.requesterUserId?.trim() || null;
    }

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
    const changeCount = await this.logEvents(saved.id, userId, before, saved, false);
    void this.taskNotifications.onAssigneesChanged(saved, before.ownerUserIds, userId);
    if (changeCount > 0) {
      void this.taskNotifications.onTaskUpdated(saved, userId);
    }
    return (await this.toDtos([saved]))[0]!;
  }

  async remove(id: string): Promise<{ ok: true }> {
    const current = await this.tasks.findOne({ where: { id } });
    if (!current) throw new NotFoundException('Tarefa não encontrada.');
    const attachmentRows = await this.attachments.find({ where: { taskId: id } });
    for (const row of attachmentRows) {
      if (row.storagePath?.trim()) {
        try {
          await this.storage.deleteFile(row.storagePath);
        } catch {
          /* segue removendo metadados */
        }
      }
    }
    await this.attachments.delete({ taskId: id });
    await this.comments.delete({ taskId: id });
    await this.events.delete({ taskId: id });
    await this.taskNotifications.deleteWatchersForTask(id);
    await this.tasks.delete({ id });
    return { ok: true };
  }

  async listAttachments(taskId: string): Promise<ProjectTaskAttachmentDto[]> {
    await this.assertTask(taskId);
    const rows = await this.attachments.find({
      where: { taskId },
      order: { createdAt: 'ASC' },
      take: MAX_TASK_ATTACHMENTS,
    });
    return this.attachmentDtos(rows);
  }

  async uploadAttachments(
    taskId: string,
    userId: string,
    files: Express.Multer.File[],
  ): Promise<ProjectTaskAttachmentDto[]> {
    const task = await this.assertTask(taskId);
    if (!files?.length) throw new BadRequestException('Envie ao menos um arquivo.');

    const current = await this.attachments.count({ where: { taskId } });
    if (current + files.length > MAX_TASK_ATTACHMENTS) {
      throw new BadRequestException(`Limite de ${MAX_TASK_ATTACHMENTS} anexos por tarefa.`);
    }

    for (const file of files) {
      if (file.size > MAX_TASK_ATTACHMENT_BYTES) {
        throw new BadRequestException('Cada arquivo pode ter no máximo 15 MB.');
      }
    }

    const savedRows: ProjectTaskAttachment[] = [];
    const storedPaths: string[] = [];
    try {
      for (const file of files) {
        const stored = await this.storage.uploadProjectTaskAttachment(taskId, file);
        storedPaths.push(stored.path);
        const row = this.attachments.create({
          taskId,
          userId,
          originalName: file.originalname,
          mimeType: file.mimetype,
          size: file.size,
          storagePath: stored.path,
          publicUrl: stored.publicUrl,
        });
        const saved = await this.attachments.save(row);
        savedRows.push(saved);
        await this.recordActivity(taskId, userId, 'attachment_added', null, file.originalname);
        void this.taskNotifications.onAttachmentAdded(task, file.originalname, userId);
      }
    } catch (err) {
      for (const path of storedPaths) {
        try {
          await this.storage.deleteFile(path);
        } catch {
          /* ignore */
        }
      }
      throw err;
    }

    return this.attachmentDtos(savedRows);
  }

  async removeAttachment(
    taskId: string,
    attachmentId: string,
    userId: string,
  ): Promise<{ ok: true }> {
    const task = await this.assertTask(taskId);
    const row = await this.attachments.findOne({ where: { id: attachmentId, taskId } });
    if (!row) throw new NotFoundException('Anexo não encontrado.');

    if (row.storagePath?.trim()) {
      await this.storage.deleteFile(row.storagePath);
    }
    await this.attachments.delete({ id: attachmentId });
    await this.recordActivity(taskId, userId, 'attachment_removed', row.originalName, null);
    void this.taskNotifications.onAttachmentRemoved(task, row.originalName, userId);
    return { ok: true };
  }

  private async assertTask(taskId: string): Promise<ProjectTask> {
    const task = await this.tasks.findOne({ where: { id: taskId } });
    if (!task) throw new NotFoundException('Tarefa não encontrada.');
    return task;
  }

  async listComments(taskId: string): Promise<ProjectTaskCommentDto[]> {
    const task = await this.tasks.findOne({ where: { id: taskId } });
    if (!task) throw new NotFoundException('Tarefa não encontrada.');
    const rows = await this.comments.find({
      where: { taskId },
      order: { createdAt: 'ASC' },
      take: 200,
    });
    return this.commentDtos(rows);
  }

  async addComment(
    taskId: string,
    userId: string,
    body: CreateProjectTaskCommentBody,
  ): Promise<ProjectTaskCommentDto> {
    const task = await this.tasks.findOne({ where: { id: taskId } });
    if (!task) throw new NotFoundException('Tarefa não encontrada.');
    const text = body.body?.trim();
    if (!text) throw new BadRequestException('Digite um comentário.');
    const mentioned = extractMentionedUserIds(text);
    const saved = await this.comments.save(
      this.comments.create({
        taskId,
        userId,
        body: text,
        mentionedUserIds: mentioned.length ? mentioned : null,
      }),
    );
    void this.taskNotifications.onComment(task, saved, userId);
    const dto = (await this.commentDtos([saved]))[0]!;
    const touch = await this.touchTaskUpdated(task, userId);
    return { ...dto, ...touch };
  }

  async removeComment(
    taskId: string,
    commentId: string,
    userId: string,
  ): Promise<RemoveProjectTaskCommentResult> {
    const task = await this.assertTask(taskId);
    const comment = await this.comments.findOne({ where: { id: commentId, taskId } });
    if (!comment) throw new NotFoundException('Comentário não encontrado.');
    if (!comment.userId || comment.userId !== userId) {
      throw new ForbiddenException('Você só pode remover os seus próprios comentários.');
    }

    const rows = await this.comments.find({
      where: { taskId },
      order: { createdAt: 'ASC' },
      take: 200,
    });
    const mine = rows.filter((c) => c.userId === userId);
    const myLatest = mine[mine.length - 1];
    if (!myLatest || myLatest.id !== commentId) {
      throw new ForbiddenException('Só é possível remover o seu último comentário nesta tarefa.');
    }
    const lastOverall = rows[rows.length - 1];
    if (!lastOverall || lastOverall.id !== commentId) {
      throw new ForbiddenException('Não é possível remover: já há resposta depois deste comentário.');
    }

    await this.comments.remove(comment);
    const touch = await this.touchTaskUpdated(task, userId);
    return { ok: true, ...touch };
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
    const userIds = [
      ...new Set(
        sorted
          .flatMap((r) => [r.updatedBy, r.requesterUserId, r.createdBy])
          .filter(Boolean),
      ),
    ] as string[];
    const nameById = new Map<string, string>();
    for (const uid of userIds) {
      const user = await this.users.findById(uid);
      if (user?.name) nameById.set(uid, user.name);
    }
    return sorted.map((row) => ({
      id: row.id,
      code: row.code,
      phase: row.phase,
      name: row.name,
      startDate: ymd(row.startDate),
      endDate: ymd(row.endDate),
      status: row.status,
      priority: row.priority ?? 'medium',
      tags: Array.isArray(row.tags) ? row.tags : [],
      estimatedHours: estimatedHoursToNumber(row.estimatedHours),
      timeTrackedSeconds: row.timeTrackedSeconds ?? 0,
      requesterUserId: row.requesterUserId,
      requesterName: row.requesterUserId ? nameById.get(row.requesterUserId) ?? null : null,
      progress: row.progress,
      owner: row.owner,
      ownerUserIds: Array.isArray(row.ownerUserIds) ? row.ownerUserIds : [],
      notes: row.notes,
      isMilestone: row.isMilestone,
      sortOrder: row.sortOrder,
      createdAt: row.createdAt.toISOString(),
      createdBy: row.createdBy,
      createdByName: row.createdBy ? nameById.get(row.createdBy) ?? null : null,
      updatedAt: row.updatedAt.toISOString(),
      updatedBy: row.updatedBy,
      updatedByName: row.updatedBy ? nameById.get(row.updatedBy) ?? null : null,
    }));
  }

  private async attachmentDtos(rows: ProjectTaskAttachment[]): Promise<ProjectTaskAttachmentDto[]> {
    const userIds = [...new Set(rows.map((r) => r.userId).filter(Boolean))] as string[];
    const nameById = new Map<string, string>();
    for (const uid of userIds) {
      const user = await this.users.findById(uid);
      if (user?.name) nameById.set(uid, user.name);
    }
    return rows.map((row) => ({
      id: row.id,
      taskId: row.taskId,
      userId: row.userId,
      userName: row.userId ? nameById.get(row.userId) ?? null : null,
      originalName: row.originalName,
      mimeType: row.mimeType,
      size: row.size,
      publicUrl: row.publicUrl,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  private async touchTaskUpdated(task: ProjectTask, userId: string): Promise<ProjectTaskTouchDto> {
    task.updatedBy = userId;
    const saved = await this.tasks.save(task);
    const dto = (await this.toDtos([saved]))[0]!;
    return {
      taskUpdatedAt: dto.updatedAt,
      taskUpdatedBy: dto.updatedBy,
      taskUpdatedByName: dto.updatedByName,
    };
  }

  private async commentDtos(rows: ProjectTaskComment[]): Promise<ProjectTaskCommentDto[]> {
    const userIds = [...new Set(rows.map((r) => r.userId).filter(Boolean))] as string[];
    const nameById = new Map<string, string>();
    for (const uid of userIds) {
      const user = await this.users.findById(uid);
      if (user?.name) nameById.set(uid, user.name);
    }
    return rows.map((row) => ({
      id: row.id,
      taskId: row.taskId,
      userId: row.userId,
      userName: row.userId ? nameById.get(row.userId) ?? null : null,
      body: row.body,
      mentionedUserIds: Array.isArray(row.mentionedUserIds) ? row.mentionedUserIds : [],
      createdAt: row.createdAt.toISOString(),
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

  private async recordActivity(
    taskId: string,
    userId: string,
    field: string,
    oldValue: string | null,
    newValue: string | null,
  ): Promise<void> {
    await this.events.save(
      this.events.create({
        taskId,
        userId,
        field,
        oldValue,
        newValue,
      }),
    );
  }

  private async logEvents(
    taskId: string,
    userId: string,
    before: Partial<ProjectTask>,
    after: ProjectTask,
    isCreate: boolean,
  ): Promise<number> {
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
    return isCreate ? 0 : entries.length;
  }
}