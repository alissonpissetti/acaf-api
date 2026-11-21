import { BadRequestException } from '@nestjs/common';
import type { ProjectTaskStatus } from './project-task.constants';
import { PROJECT_TASK_PHASES, PROJECT_TASK_STATUSES } from './project-task.constants';

export function isValidPhase(phase: string): boolean {
  return (PROJECT_TASK_PHASES as readonly string[]).includes(phase);
}

export function isValidStatus(status: string): status is ProjectTaskStatus {
  return (PROJECT_TASK_STATUSES as readonly string[]).includes(status);
}

export function normalizeStatusProgress(
  status: ProjectTaskStatus,
  progress: number,
): { status: ProjectTaskStatus; progress: number } {
  let nextStatus = status;
  let nextProgress = Math.max(0, Math.min(100, Math.floor(progress) || 0));
  if (nextStatus === 'done') {
    nextProgress = 100;
  } else if (nextProgress === 100 && nextStatus !== 'cancelled') {
    nextStatus = 'done';
  } else if (nextStatus === 'todo' && nextProgress > 0) {
    nextStatus = 'in_progress';
  }
  return { status: nextStatus, progress: nextProgress };
}

export function assertValidDateRange(startDate: string, endDate: string, isMilestone: boolean): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw new BadRequestException('Datas devem estar no formato YYYY-MM-DD.');
  }
  if (endDate < startDate) {
    throw new BadRequestException('A data de fim não pode ser anterior ao início.');
  }
  if (isMilestone && startDate !== endDate) {
    throw new BadRequestException('Marcos devem ter início e fim no mesmo dia.');
  }
}

export type ProjectTaskLike = {
  isMilestone?: boolean;
  status: ProjectTaskStatus;
  progress: number;
  startDate: string;
  endDate: string;
};

export function durationDays(task: Pick<ProjectTaskLike, 'startDate' | 'endDate'>): number {
  const start = new Date(`${task.startDate}T00:00:00`);
  const end = new Date(`${task.endDate}T00:00:00`);
  const diff = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  return Math.max(1, diff + 1);
}

export function isTaskLate(task: Pick<ProjectTaskLike, 'status' | 'endDate'>, todayYmd: string): boolean {
  if (task.status === 'done' || task.status === 'cancelled' || task.status === 'postponed') return false;
  return task.endDate < todayYmd;
}