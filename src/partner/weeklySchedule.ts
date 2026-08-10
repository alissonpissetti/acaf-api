export type DayOfWeek = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export type UnitDaySchedule = {
  closed: boolean;
  open: string;
  close: string;
};

export type UnitWeeklySchedule = Record<DayOfWeek, UnitDaySchedule>;

export const WEEKDAY_ORDER: DayOfWeek[] = [
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat',
  'sun',
];

export const WEEKDAY_LABELS: Record<DayOfWeek, string> = {
  mon: 'segunda-feira',
  tue: 'terça-feira',
  wed: 'quarta-feira',
  thu: 'quinta-feira',
  fri: 'sexta-feira',
  sat: 'sábado',
  sun: 'domingo',
};

export function defaultWeeklySchedule(): UnitWeeklySchedule {
  const weekday = { closed: false, open: '05:30', close: '22:00' };
  return {
    mon: { ...weekday },
    tue: { ...weekday },
    wed: { ...weekday },
    thu: { ...weekday },
    fri: { ...weekday },
    sat: { closed: false, open: '08:00', close: '16:00' },
    sun: { closed: false, open: '09:00', close: '13:00' },
  };
}

export function normalizeWeeklySchedule(
  input?: Partial<UnitWeeklySchedule> | null,
): UnitWeeklySchedule {
  const base = defaultWeeklySchedule();
  if (!input) return base;

  for (const day of WEEKDAY_ORDER) {
    const row = input[day];
    if (!row) continue;
    base[day] = {
      closed: Boolean(row.closed),
      open: row.open?.trim() || base[day].open,
      close: row.close?.trim() || base[day].close,
    };
  }

  return base;
}

export function formatDayRange(day: UnitDaySchedule): string {
  if (day.closed) return 'Fechado';
  if (!day.open || !day.close) return '—';
  return `${day.open}–${day.close}`;
}

function dayScheduleKey(day: UnitDaySchedule): string {
  if (day.closed) return 'closed';
  return `${day.open}|${day.close}`;
}

function formatDayLabelShort(day: DayOfWeek): string {
  const short = WEEKDAY_LABELS[day].slice(0, 3);
  return short.charAt(0).toUpperCase() + short.slice(1);
}

function formatDayLabelRange(start: DayOfWeek, end: DayOfWeek): string {
  if (start === end) return formatDayLabelShort(start);
  return `${formatDayLabelShort(start)}–${formatDayLabelShort(end)}`;
}

export type OpenHoursGroup = {
  start: DayOfWeek;
  end: DayOfWeek;
  range: string;
};

export function groupOpenHours(schedule: UnitWeeklySchedule): OpenHoursGroup[] {
  const normalized = normalizeWeeklySchedule(schedule);
  const groups: OpenHoursGroup[] = [];

  for (const day of WEEKDAY_ORDER) {
    const key = dayScheduleKey(normalized[day]);
    const last = groups[groups.length - 1];
    const prevDay = last?.end;
    const isAdjacent =
      prevDay != null && WEEKDAY_ORDER.indexOf(day) === WEEKDAY_ORDER.indexOf(prevDay) + 1;

    if (last && last.range === formatDayRange(normalized[day]) && isAdjacent) {
      last.end = day;
    } else {
      groups.push({
        start: day,
        end: day,
        range: formatDayRange(normalized[day]),
      });
    }
  }

  return groups;
}

export function formatOpenHoursSummary(schedule: UnitWeeklySchedule): string {
  return groupOpenHours(schedule)
    .map((group) => `${formatDayLabelRange(group.start, group.end)} ${group.range}`)
    .join(' · ');
}

export function getTodayDayKey(): DayOfWeek {
  const map: DayOfWeek[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  return map[new Date().getDay()];
}

export function getRotatedWeekdayOrder(today: DayOfWeek = getTodayDayKey()): DayOfWeek[] {
  const start = WEEKDAY_ORDER.indexOf(today);
  if (start < 0) return [...WEEKDAY_ORDER];
  return [...WEEKDAY_ORDER.slice(start), ...WEEKDAY_ORDER.slice(0, start)];
}
