import type { CheckInLogEntry } from './types';

/** Horário de funcionamento típico da academia (America/Sao_Paulo). */
export const GYM_OPEN_MINUTES = 7 * 60 + 30;
export const GYM_CLOSE_MINUTES = 21 * 60;

const BR_TZ = 'America/Sao_Paulo';

export function brDateKeyFromIso(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: BR_TZ }).format(new Date(iso));
}

export function brDateKeyToday(): string {
  return brDateKeyFromIso(new Date().toISOString());
}

export function brMinutesFromMidnight(iso: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: BR_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso));
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return hour * 60 + minute;
}

/** Converte horário local (Brasil) em ISO UTC. */
export function brLocalToUtcIso(
  dateYmd: string,
  hour: number,
  minute: number,
  second = 0,
): string {
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  const ss = String(second).padStart(2, '0');
  return new Date(`${dateYmd}T${hh}:${mm}:${ss}-03:00`).toISOString();
}

function minutesToParts(totalMinutes: number): { hour: number; minute: number } {
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  return { hour, minute };
}

/** Horários aleatórios crescentes entre 7:30 e 21:00 (dia local BR). */
export function assignRealisticAscendingBrTimes(
  dateYmd: string,
  count: number,
  rand: () => number,
): string[] {
  if (count <= 0) return [];

  const minGap = 8;
  const maxGap = 52;
  const maxFirst = GYM_CLOSE_MINUTES - minGap * (count - 1);
  const morningWindowEnd = Math.min(GYM_OPEN_MINUTES + 90, maxFirst);
  const firstStart =
    GYM_OPEN_MINUTES +
    Math.floor(rand() * Math.max(1, morningWindowEnd - GYM_OPEN_MINUTES + 1));

  let current = firstStart;
  const minuteMarks: number[] = [];
  for (let i = 0; i < count; i++) {
    minuteMarks.push(Math.min(current, GYM_CLOSE_MINUTES));
    if (i < count - 1) {
      current = Math.min(
        current + minGap + Math.floor(rand() * (maxGap - minGap + 1)),
        GYM_CLOSE_MINUTES,
      );
    }
  }

  return minuteMarks.map((m) => {
    const { hour, minute } = minutesToParts(m);
    const second = Math.floor(rand() * 60);
    return brLocalToUtcIso(dateYmd, hour, minute, second);
  });
}

/** Um horário aleatório entre 7:30 e 21:00 (dia local BR). */
export function randomGymOpenBrTimeIso(dateYmd: string, rand: () => number): string {
  const minuteOfDay =
    GYM_OPEN_MINUTES + Math.floor(rand() * (GYM_CLOSE_MINUTES - GYM_OPEN_MINUTES));
  const { hour, minute } = minutesToParts(minuteOfDay);
  const second = Math.floor(rand() * 60);
  return brLocalToUtcIso(dateYmd, hour, minute, second);
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Corrige entradas fora do horário de academia ou com horários inválidos no histórico. */
export function normalizeRealisticGymCheckInTimes(log: CheckInLogEntry[]): CheckInLogEntry[] {
  const byGroup = new Map<string, CheckInLogEntry[]>();
  for (const entry of log) {
    const day = brDateKeyFromIso(entry.validatedAt);
    const key = `${entry.unitId}|${day}`;
    const group = byGroup.get(key) ?? [];
    group.push(entry);
    byGroup.set(key, group);
  }

  const updated = new Map<string, CheckInLogEntry>();

  for (const [key, entries] of byGroup) {
    const needsFix = entries.some((e) => {
      const m = brMinutesFromMidnight(e.validatedAt);
      return m < GYM_OPEN_MINUTES || m > GYM_CLOSE_MINUTES;
    });
    if (!needsFix) continue;

    const sorted = [...entries].sort((a, b) => a.validatedAt.localeCompare(b.validatedAt));
    const dateYmd = brDateKeyFromIso(sorted[0]!.validatedAt);
    let seed = 0;
    for (let i = 0; i < key.length; i++) seed = (seed * 31 + key.charCodeAt(i)) >>> 0;
    const rand = mulberry32(seed);
    const times = assignRealisticAscendingBrTimes(dateYmd, sorted.length, rand);

    sorted.forEach((entry, i) => {
      updated.set(entry.id, { ...entry, validatedAt: times[i]! });
    });
  }

  if (updated.size === 0) return log;
  return log.map((entry) => updated.get(entry.id) ?? entry);
}
