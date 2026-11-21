import { weightedProgressPercent } from './project-task.metrics';
import type { TaskForMetrics } from './project-task.metrics';

function task(partial: Partial<TaskForMetrics> & Pick<TaskForMetrics, 'startDate' | 'endDate'>): TaskForMetrics {
  return {
    isMilestone: false,
    status: 'todo',
    progress: 0,
    ...partial,
  };
}

describe('project-task.metrics', () => {
  it('progresso ponderado ignora marcos', () => {
    const tasks: TaskForMetrics[] = [
      task({ startDate: '2026-11-01', endDate: '2026-11-10', status: 'done', progress: 100 }),
      task({ startDate: '2026-11-01', endDate: '2026-11-01', status: 'done', progress: 0, isMilestone: true }),
      task({ startDate: '2026-11-01', endDate: '2026-11-01', status: 'in_progress', progress: 50 }),
    ];
    const pct = weightedProgressPercent(tasks);
    expect(pct).toBe(Math.round((100 * 10 + 50 * 1) / 11));
  });
});