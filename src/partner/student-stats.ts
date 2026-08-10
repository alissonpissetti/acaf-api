import type { CheckInLogEntry, GymStudent } from './types';
import { clampCheckInsThisMonth, MAX_DAILY_PASSES_PER_MONTH } from './studentLimits';

export function currentMonthPrefix(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function todayIso(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function applyStudentStatsFromLog(
  students: GymStudent[],
  log: CheckInLogEntry[],
  monthPrefix: string,
): GymStudent[] {
  return students.map((s) => {
    if (s.channel === 'daily_pass') {
      const entries = log.filter(
        (e) =>
          e.holderName === s.name &&
          e.type === 'daily_pass' &&
          e.validatedAt.slice(0, 7) === monthPrefix,
      );
      const passDays = new Set(entries.map((e) => e.validatedAt.slice(0, 10)));
      const dailyCount = Math.min(MAX_DAILY_PASSES_PER_MONTH, passDays.size);
      const visits = [...passDays].sort();
      const lastEntry = entries.sort((a, b) => b.validatedAt.localeCompare(a.validatedAt))[0];
      return {
        ...s,
        checkInsThisMonth: dailyCount,
        dailyPassesThisMonth: dailyCount,
        lastVisit: lastEntry?.validatedAt.slice(0, 10) ?? visits.at(-1) ?? s.lastVisit,
      };
    }

    const entries = log.filter(
      (e) =>
        e.holderName === s.name &&
        e.unitId === s.unitId &&
        e.validatedAt.slice(0, 7) === monthPrefix,
    );
    const visitDays = new Set(entries.map((e) => e.validatedAt.slice(0, 10)));
    const visits = [...visitDays].sort();
    return {
      ...s,
      checkInsThisMonth: clampCheckInsThisMonth(visits.length),
      dailyPassesThisMonth: 0,
      lastVisit: visits.at(-1) ?? s.lastVisit,
    };
  });
}
