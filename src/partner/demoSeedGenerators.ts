import type { ApiStore, CheckInLogEntry, GymStudent, ModalityReservation, ModalitySlotTemplate } from './types';
import type { DayOfWeek } from './weeklySchedule';
import { DEMO_UNIT_IDS, isDemoReservationId } from './demoSeedMerge';
import {
  clampCheckInsThisMonth,
  MAX_CHECKINS_PER_MONTH,
  MAX_DAILY_PASSES_PER_MONTH,
} from './studentLimits';
import {
  assignRealisticAscendingBrTimes,
  randomGymOpenBrTimeIso,
} from './gymLocalTime';

/** Referência “hoje” do cenário demo. */
export const DEMO_TODAY = '2026-08-25';
export const DEMO_RANGE_START = '2026-06-01';
export const DEMO_RANGE_END = DEMO_TODAY;

export const DEMO_MONTH_KEYS = ['2026-06', '2026-07', '2026-08'] as const;

const NETWORK_UNIT_IDS = ['g_carpe', 'g_carpe_batel', 'g_carpe_centro'] as const;

const UNIT_DAILY_PRICES: Record<string, number> = {
  g_carpe: 44.9,
  g_carpe_batel: 47.9,
  g_carpe_centro: 42.9,
};

const DAY_TO_JS: Record<DayOfWeek, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

function hashSeed(input: string): number {
  let h = 2166136261;
  for (const ch of input) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function referenceTodayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function bookingsForSlot(date: string, template: ModalitySlotTemplate): number {
  const capacity = template.capacity;
  const slotRand = mulberry32(hashSeed(`${date}|${template.id}`));
  const roll = slotRand();

  if (date === '2026-08-04' && template.id === 'mst-nat-ter') {
    return 8;
  }
  if (date === '2026-07-06' && template.modality === 'Boxe' && template.startTime === '07:00') {
    return Math.min(template.capacity, 5);
  }

  if (roll < 0.14) return 0;
  if (roll < 0.24) return capacity;
  const ratio = 0.32 + slotRand() * 0.58;
  return Math.max(1, Math.min(capacity, Math.round(capacity * ratio)));
}

/** Gera reservas demo alinhadas às faixas recorrentes da unidade. */
export function generateModalityReservationsFromTemplates(
  unitId: string,
  templates: ModalitySlotTemplate[],
  holderNames: string[],
  rangeStart = DEMO_RANGE_START,
  rangeEnd = DEMO_RANGE_END,
): ModalityReservation[] {
  if (!holderNames.length) return [];

  const rand = mulberry32(20260820);
  const rows: ModalityReservation[] = [];
  let seq = 0;
  let nameCursor = 0;
  const active = templates.filter((t) => t.active !== false);
  const today = referenceTodayIso();

  for (const date of eachDayInRange(rangeStart, rangeEnd)) {
    const dow = new Date(`${date}T12:00:00`).getDay();

    for (const template of active) {
      if (DAY_TO_JS[template.dayOfWeek] !== dow) continue;

      const count = bookingsForSlot(date, template);
      const usedInSlot = new Set<string>();

      for (let i = 0; i < count; i += 1) {
        let holderName = holderNames[nameCursor % holderNames.length]!;
        nameCursor += 1;
        let guard = 0;
        while (usedInSlot.has(holderName) && guard < holderNames.length) {
          holderName = holderNames[nameCursor % holderNames.length]!;
          nameCursor += 1;
          guard += 1;
        }
        usedInSlot.add(holderName);

        const isPast = date < today;
        const isToday = date === today;
        let status: ModalityReservation['status'] = 'confirmed';
        if (isPast) {
          status = rand() < 0.72 ? 'checked_in' : rand() < 0.9 ? 'confirmed' : 'cancelled';
        } else if (isToday && rand() < 0.12) {
          status = 'cancelled';
        }
        // Datas futuras (date > today) permanecem apenas confirmadas/canceladas — nunca check-in.

        const reservedDay = new Date(`${date}T12:00:00`);
        reservedDay.setDate(reservedDay.getDate() - (1 + Math.floor(rand() * 5)));

        rows.push({
          id: `mr-${seq++}`,
          unitId,
          occurrenceDate: date,
          slotTemplateId: template.id,
          modality: template.modality,
          instructorName: template.instructorName,
          startTime: template.startTime,
          endTime: template.endTime,
          holderName,
          status,
          reservedAt: reservedDay.toISOString(),
        });
      }
    }
  }

  return rows.sort((a, b) => b.occurrenceDate.localeCompare(a.occurrenceDate));
}

/** Regenera reservas demo a partir das faixas atuais de cada unidade no store. */
export function regenerateDemoModalityReservations(store: ApiStore): ModalityReservation[] {
  const preserved = (store.modalityReservations ?? []).filter((r) => !isDemoReservationId(r.id));
  const demoRows: ModalityReservation[] = [];

  for (const unitId of DEMO_UNIT_IDS) {
    const unit = store.units.find((u) => u.id === unitId);
    if (!unit) continue;
    const templates = unit.modalitySlotTemplates ?? [];
    if (!templates.length) continue;
    const holderNames = store.students.filter((s) => s.unitId === unitId).map((s) => s.name);
    if (!holderNames.length) continue;
    demoRows.push(
      ...generateModalityReservationsFromTemplates(unitId, templates, holderNames),
    );
  }

  return [...preserved, ...demoRows];
}

/** @deprecated use generateModalityReservationsFromTemplates */
export function generateModalityReservations(holderNames: string[]): ModalityReservation[] {
  return generateModalityReservationsFromTemplates(
    'g_carpe',
    [
      {
        id: 'mst-nat-seg',
        modality: 'Natação',
        instructorName: 'Ana Silva',
        dayOfWeek: 'mon',
        startTime: '07:00',
        endTime: '08:00',
        capacity: 10,
        active: true,
      },
      {
        id: 'mst-nat-qua',
        modality: 'Natação',
        instructorName: 'Ana Silva',
        dayOfWeek: 'wed',
        startTime: '07:00',
        endTime: '08:00',
        capacity: 10,
        active: true,
      },
      {
        id: 'mst-nat-sex',
        modality: 'Natação',
        instructorName: 'Carlos Mendes',
        dayOfWeek: 'fri',
        startTime: '18:00',
        endTime: '19:00',
        capacity: 8,
        active: true,
      },
    ],
    holderNames,
  );
}

const WALK_IN_DAILY = [
  'Visitante app',
  'Turista · diária',
  'Cliente avulso',
  'Aluno convidado',
  'Passante Connect',
  'Diária corporativa',
  'Convidado Connect',
];

function mulberry32(seed: number): () => number {
  let t = seed;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function eachDayInRange(start: string, end: string): string[] {
  const days: string[] = [];
  const cursor = new Date(`${start}T12:00:00`);
  const last = new Date(`${end}T12:00:00`);
  while (cursor <= last) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

export function datesInMonthWithinRange(
  year: number,
  month: number,
  rangeStart = DEMO_RANGE_START,
  rangeEnd = DEMO_RANGE_END,
): string[] {
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  return eachDayInRange(rangeStart, rangeEnd).filter((d) => d.startsWith(prefix));
}

function monthDays(monthKey: string): string[] {
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  return datesInMonthWithinRange(year, month);
}

function pickDistinctDays(days: string[], count: number, rand: () => number): string[] {
  if (count <= 0 || days.length === 0) return [];
  const pool = [...days];
  const picked: string[] = [];
  const n = Math.min(count, pool.length);
  for (let i = 0; i < n; i += 1) {
    const idx = Math.floor(rand() * pool.length);
    picked.push(pool.splice(idx, 1)[0]!);
  }
  return picked;
}

function seededRand(name: string, unitId: string, monthKey: string): () => number {
  let h = 2166136261;
  for (const ch of `${name}\0${unitId}\0${monthKey}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return mulberry32(h >>> 0);
}

/** Faixa realista de check-ins/mês para planos Connect (seed demo). */
const CONNECT_MONTHLY_CHECKINS_MIN = 4;
const CONNECT_MONTHLY_CHECKINS_MAX = 25;

/** Check-ins mensais variados para plano (4–25 em meses completos). */
function connectTargetForMonth(rand: () => number, availableDays: number): number {
  if (availableDays <= 0) return 0;

  const buckets: [number, number][] = [
    [4, 6],
    [7, 9],
    [10, 12],
    [13, 15],
    [16, 18],
    [19, 21],
    [22, 24],
    [25, 25],
  ];
  const bucket = buckets[Math.min(buckets.length - 1, Math.floor(rand() * buckets.length))]!;
  const target = bucket[0] + Math.floor(rand() * (bucket[1] - bucket[0] + 1));

  if (availableDays < CONNECT_MONTHLY_CHECKINS_MIN) {
    return Math.min(availableDays, Math.max(0, Math.floor(rand() * (availableDays + 1))));
  }

  return Math.min(availableDays, Math.max(CONNECT_MONTHLY_CHECKINS_MIN, Math.min(CONNECT_MONTHLY_CHECKINS_MAX, target)));
}

/** Diárias por pessoa/mês: maioria 1–2, máximo 3. */
function dailyTargetForMonth(rand: () => number): number {
  const roll = rand();
  if (roll < 0.48) return 1;
  if (roll < 0.88) return 2;
  return MAX_DAILY_PASSES_PER_MONTH;
}

function pickVisitUnit(homeUnitId: string, rand: () => number): string {
  if (rand() < 0.58) {
    const others = NETWORK_UNIT_IDS.filter((id) => id !== homeUnitId);
    if (others.length) {
      return others[Math.floor(rand() * others.length)]!;
    }
  }
  return homeUnitId;
}

function makeCheckInEntry(
  seq: number,
  unitId: string,
  holderName: string,
  type: CheckInLogEntry['type'],
  date: string,
  rand: () => number,
): CheckInLogEntry {
  const code =
    type === 'daily_pass'
      ? `ACAF-${seq.toString(36).toUpperCase()}-${unitId.split('_').pop()?.toUpperCase()}`
      : `CHK-${unitId.replace('g_', '').toUpperCase()}-${date.slice(5, 7)}${date.slice(8, 10)}-${seq}`;

  return {
    id: `ci-${seq}`,
    unitId,
    code,
    type,
    holderName,
    validatedAt: randomGymOpenBrTimeIso(date, rand),
  };
}

export function dailyPassGrossForEntry(entry: CheckInLogEntry): number {
  const unitPrice = UNIT_DAILY_PRICES[entry.unitId] ?? 44.9;
  if (entry.unitId === 'g_carpe_batel') {
    const hour = Number(entry.validatedAt.slice(11, 13));
    const dow = new Date(`${entry.validatedAt.slice(0, 10)}T12:00:00`).getDay();
    const weekday = dow >= 1 && dow <= 5;
    if (weekday && hour >= 10 && hour < 14) return 24.9;
  }
  return unitPrice;
}

/** Tráfego avulso desativado — diárias só de compradores nomeados (1–3/mês). */
function appendWalkInTraffic(_log: CheckInLogEntry[], _rand: () => number, startSeq: number): number {
  return startSeq;
}

export function generateCheckInLog(students: GymStudent[]): CheckInLogEntry[] {
  const log: CheckInLogEntry[] = [];
  const walkInRand = mulberry32(20260601);
  let seq = 0;

  for (const student of students) {
    for (const monthKey of DEMO_MONTH_KEYS) {
      const days = monthDays(monthKey);
      if (!days.length) continue;

      if (student.channel === 'daily_pass') {
        const monthRand = seededRand(student.name, student.unitId, `daily-${monthKey}`);
        const target = dailyTargetForMonth(monthRand);
        const visitDays = pickDistinctDays(days, target, monthRand);
        for (const date of visitDays) {
          const visitUnit = pickVisitUnit(student.unitId, monthRand);
          log.push(
            makeCheckInEntry(seq++, visitUnit, student.name, 'daily_pass', date, monthRand),
          );
        }
        continue;
      }

      const monthRand = seededRand(student.name, student.unitId, monthKey);
      const target = connectTargetForMonth(monthRand, days.length);
      const visitDays = pickDistinctDays(days, target, monthRand);

      for (const date of visitDays) {
        log.push(makeCheckInEntry(seq++, student.unitId, student.name, 'connect_member', date, monthRand));
      }
    }
  }

  appendWalkInTraffic(log, walkInRand, seq);
  return log.sort((a, b) => b.validatedAt.localeCompare(a.validatedAt));
}

export function generateTodayCheckIns(students: GymStudent[], today = DEMO_TODAY): CheckInLogEntry[] {
  const rand = mulberry32(20260825);
  const picks = students
    .filter((s) => s.channel !== 'daily_pass')
    .filter((s) => NETWORK_UNIT_IDS.includes(s.unitId as typeof NETWORK_UNIT_IDS[number]))
    .sort(() => rand() - 0.5)
    .slice(0, 11);

  const times = assignRealisticAscendingBrTimes(today, picks.length, rand);

  return picks.map((student, i) => ({
    id: `ci-today-${i}`,
    unitId: student.unitId,
    code: `CHK-TODAY-${i}`,
    type: 'connect_member' as const,
    holderName: student.name,
    validatedAt: times[i]!,
  }));
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

