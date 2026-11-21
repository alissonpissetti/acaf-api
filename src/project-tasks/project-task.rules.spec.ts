import { normalizeStatusProgress, durationDays } from './project-task.rules';

describe('project-task.rules', () => {
  it('done força progress 100', () => {
    expect(normalizeStatusProgress('done', 10)).toEqual({ status: 'done', progress: 100 });
  });

  it('progress 100 força done', () => {
    expect(normalizeStatusProgress('in_progress', 100)).toEqual({ status: 'done', progress: 100 });
  });

  it('todo com progress > 0 vira in_progress', () => {
    expect(normalizeStatusProgress('todo', 25)).toEqual({ status: 'in_progress', progress: 25 });
  });

  it('cancelada não vira concluída com progress 100', () => {
    expect(normalizeStatusProgress('cancelled', 100)).toEqual({ status: 'cancelled', progress: 100 });
  });

  it('calcula duração em dias inclusiva', () => {
    expect(durationDays({ startDate: '2026-11-01', endDate: '2026-11-01' })).toBe(1);
    expect(durationDays({ startDate: '2026-11-01', endDate: '2026-11-03' })).toBe(3);
  });
});