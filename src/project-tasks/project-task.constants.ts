export const PROJECT_TASK_PHASES = [
  'Concepção e estratégia',
  'Empresa, jurídico e financeiro',
  'Marca e branding',
  'Produto e tecnologia',
  'Marketing e comunicação',
  'Rede e comercial',
  'Piloto com acesso controlado',
] as const;

export type ProjectTaskPhase = (typeof PROJECT_TASK_PHASES)[number];

export const PROJECT_TASK_STATUSES = [
  'todo',
  'in_progress',
  'blocked',
  'postponed',
  'cancelled',
  'done',
] as const;

export type ProjectTaskStatus = (typeof PROJECT_TASK_STATUSES)[number];

export const PROJECT_TASK_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;

export type ProjectTaskPriority = (typeof PROJECT_TASK_PRIORITIES)[number];

export const LEGACY_STATUS_TO_API: Record<string, ProjectTaskStatus> = {
  afazer: 'todo',
  andamento: 'in_progress',
  bloqueado: 'blocked',
  feito: 'done',
};

export const DEFAULT_PILOT_DATE = '2027-01-18';

export const PILOT_MILESTONE_CODE = 'm-piloto';