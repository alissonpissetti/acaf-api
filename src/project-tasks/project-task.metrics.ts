import { durationDays, isTaskLate, type ProjectTaskLike } from './project-task.rules';

export type TaskForMetrics = ProjectTaskLike & {
  isMilestone: boolean;
  code?: string | null;
};

export function weightedProgressPercent(tasks: TaskForMetrics[]): number {
  const work = tasks.filter((t) => !t.isMilestone);
  const totalDays = work.reduce((acc, t) => acc + durationDays(t), 0);
  if (!totalDays) return 0;
  const weighted = work.reduce((acc, t) => {
    const pct = t.status === 'done' ? 100 : t.status === 'cancelled' ? 0 : t.progress;
    return acc + pct * durationDays(t);
  }, 0);
  return Math.round(weighted / totalDays);
}

export function countCompletedTasks(tasks: TaskForMetrics[]): { done: number; total: number } {
  const work = tasks.filter((t) => !t.isMilestone);
  const done = work.filter((t) => t.status === 'done').length;
  return { done, total: work.length };
}

export function countLateTasks(tasks: TaskForMetrics[], todayYmd: string): number {
  return tasks.filter((t) => !t.isMilestone && isTaskLate(t, todayYmd)).length;
}

export function daysUntilDate(targetYmd: string, todayYmd: string): number {
  const a = new Date(`${todayYmd}T00:00:00`);
  const b = new Date(`${targetYmd}T00:00:00`);
  return Math.ceil((b.getTime() - a.getTime()) / 86_400_000);
}