/** Máximo de diárias compradas por aluno no mês (regra de negócio). */
export const MAX_DAILY_PASSES_PER_MONTH = 3;

/** Máximo de check-ins por aluno no mês (planos mensais e diária). */
export const MAX_CHECKINS_PER_MONTH = 30;

export function clampCheckInsThisMonth(count: number): number {
  if (!Number.isFinite(count) || count < 0) return 0;
  return Math.min(MAX_CHECKINS_PER_MONTH, Math.floor(count));
}
