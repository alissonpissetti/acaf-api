import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { NotificationsService } from '../notifications/notifications.service';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { ProjectTask } from './project-task.entity';
import { ProjectTaskComment } from './project-task-comment.entity';
import type { ProjectTaskWatcherSource } from './project-task-watcher.entity';
import { ProjectTaskWatcher } from './project-task-watcher.entity';

function excerpt(text: string, max = 140): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

function bodyPreview(body: string): string {
  const plain = body.replace(/@\[([^\]]+)\]\([^)]+\)/gi, '@$1');
  return excerpt(plain);
}

function taskLabel(task: ProjectTask): string {
  const name = task.name?.trim() || 'Tarefa';
  return task.code?.trim() ? `${task.code} — ${name}` : name;
}

@Injectable()
export class ProjectTaskNotificationsService {
  private readonly logger = new Logger(ProjectTaskNotificationsService.name);

  constructor(
    private readonly notifications: NotificationsService,
    private readonly users: UsersService,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(ProjectTaskWatcher)
    private readonly watchers: Repository<ProjectTaskWatcher>,
  ) {}

  private taskUrl(taskId: string): string {
    return `/m/operacao/cronograma?task=${encodeURIComponent(taskId)}`;
  }

  async deleteWatchersForTask(taskId: string): Promise<void> {
    await this.watchers.delete({ taskId });
  }

  async ensureWatchers(
    taskId: string,
    userIds: string[],
    source: ProjectTaskWatcherSource,
  ): Promise<void> {
    const unique = [...new Set(userIds.filter(Boolean))];
    if (!unique.length) return;

    for (const userId of unique) {
      const existing = await this.watchers.findOne({ where: { taskId, userId } });
      if (!existing) {
        await this.watchers.save(this.watchers.create({ taskId, userId, source }));
      }
    }
  }

  async syncAssigneeWatchers(task: ProjectTask): Promise<void> {
    const ids = [...(task.ownerUserIds ?? [])];
    if (task.requesterUserId) ids.push(task.requesterUserId);
    if (task.createdBy) ids.push(task.createdBy);
    await this.ensureWatchers(task.id, ids, 'assignee');
  }

  async onAssigneesChanged(
    task: ProjectTask,
    previousOwnerUserIds: string[] | null | undefined,
    actorUserId: string,
  ): Promise<void> {
    const prev = new Set(previousOwnerUserIds ?? []);
    const added = (task.ownerUserIds ?? []).filter((id) => !prev.has(id) && id !== actorUserId);

    if (added.length) {
      const actor = await this.actorName(actorUserId);
      const label = taskLabel(task);
      await this.notifySafely({
        userIds: added,
        triggerKey: 'cronograma.task.assigned',
        title: 'Você foi definido como responsável',
        body: `${actor} atribuiu você como responsável na tarefa “${label}”.`,
        severity: 'info',
        entityType: 'project_task',
        entityId: task.id,
        actionUrl: this.taskUrl(task.id),
        metadata: { taskId: task.id, actorUserId },
      });
    }

    await this.syncAssigneeWatchers(task);
  }

  private async filterNotifiableUserIds(userIds: string[]): Promise<string[]> {
    const unique = [...new Set(userIds.filter(Boolean))];
    if (!unique.length) return [];

    const rows = await this.userRepo.find({
      where: { id: In(unique), active: true },
      select: ['id'],
    });

    return rows.map((row) => row.id);
  }

  private async notifySafely(input: Parameters<NotificationsService['notify']>[0]): Promise<void> {
    try {
      const userIds = await this.filterNotifiableUserIds(input.userIds);
      if (!userIds.length) return;
      await this.notifications.notify({ ...input, userIds });
    } catch (error) {
      this.logger.warn(
        `Falha ao enviar notificação (${input.triggerKey}): ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  private async actorName(actorUserId: string): Promise<string> {
    const user = await this.users.findById(actorUserId);
    return user?.name?.trim() || 'Alguém';
  }

  private async listWatcherIds(taskId: string, excludeUserIds: string[] = []): Promise<string[]> {
    const exclude = new Set(excludeUserIds.filter(Boolean));
    const rows = await this.watchers.find({ where: { taskId }, select: ['userId'] });
    return rows.map((r) => r.userId).filter((id) => !exclude.has(id));
  }

  async onComment(task: ProjectTask, comment: ProjectTaskComment, actorUserId: string): Promise<void> {
    const mentioned = [...new Set((comment.mentionedUserIds ?? []).filter(Boolean))];
    await this.ensureWatchers(task.id, mentioned, 'mention');

    const actor = await this.actorName(actorUserId);
    const label = taskLabel(task);
    const preview = bodyPreview(comment.body);
    const url = this.taskUrl(task.id);

    const mentionTargets = mentioned.filter((id) => id !== actorUserId);
    if (mentionTargets.length) {
      await this.notifySafely({
        userIds: mentionTargets,
        triggerKey: 'cronograma.task.mentioned',
        title: 'Você foi mencionado em uma tarefa',
        body: `${actor} mencionou você em “${label}”: ${preview}`,
        severity: 'info',
        entityType: 'project_task',
        entityId: task.id,
        actionUrl: url,
        metadata: { taskId: task.id, commentId: comment.id, actorUserId },
      });
    }

    const watcherIds = await this.listWatcherIds(task.id, [actorUserId, ...mentioned]);
    if (watcherIds.length) {
      await this.notifySafely({
        userIds: watcherIds,
        triggerKey: 'cronograma.task.comment',
        title: 'Novo comentário na tarefa',
        body: `${actor} comentou em “${label}”: ${preview}`,
        severity: 'info',
        entityType: 'project_task',
        entityId: task.id,
        actionUrl: url,
        metadata: { taskId: task.id, commentId: comment.id, actorUserId },
      });
    }
  }

  async onAttachmentAdded(task: ProjectTask, fileName: string, actorUserId: string): Promise<void> {
    const actor = await this.actorName(actorUserId);
    const label = taskLabel(task);
    const watcherIds = await this.listWatcherIds(task.id, [actorUserId]);
    if (!watcherIds.length) return;

    await this.notifySafely({
      userIds: watcherIds,
      triggerKey: 'cronograma.task.attachment',
      title: 'Novo anexo na tarefa',
      body: `${actor} anexou “${excerpt(fileName, 80)}” em “${label}”.`,
      severity: 'info',
      entityType: 'project_task',
      entityId: task.id,
      actionUrl: this.taskUrl(task.id),
      metadata: { taskId: task.id, fileName, actorUserId },
    });
  }

  async onAttachmentRemoved(task: ProjectTask, fileName: string, actorUserId: string): Promise<void> {
    const actor = await this.actorName(actorUserId);
    const label = taskLabel(task);
    const watcherIds = await this.listWatcherIds(task.id, [actorUserId]);
    if (!watcherIds.length) return;

    await this.notifySafely({
      userIds: watcherIds,
      triggerKey: 'cronograma.task.attachment',
      title: 'Anexo removido da tarefa',
      body: `${actor} removeu “${excerpt(fileName, 80)}” de “${label}”.`,
      severity: 'info',
      entityType: 'project_task',
      entityId: task.id,
      actionUrl: this.taskUrl(task.id),
      metadata: { taskId: task.id, fileName, actorUserId, removed: true },
    });
  }

  async onTaskUpdated(task: ProjectTask, actorUserId: string): Promise<void> {
    const actor = await this.actorName(actorUserId);
    const label = taskLabel(task);
    const watcherIds = await this.listWatcherIds(task.id, [actorUserId]);
    if (!watcherIds.length) return;

    await this.notifySafely({
      userIds: watcherIds,
      triggerKey: 'cronograma.task.updated',
      title: 'Tarefa atualizada',
      body: `${actor} atualizou “${label}”.`,
      severity: 'info',
      entityType: 'project_task',
      entityId: task.id,
      actionUrl: this.taskUrl(task.id),
      metadata: { taskId: task.id, actorUserId },
    });
  }
}