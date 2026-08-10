import { randomUUID } from 'node:crypto';
import type { DayOfWeek } from './weeklySchedule';
import { WEEKDAY_ORDER } from './weeklySchedule';
import { isValidTime } from './modalitySchedule';
import type { DailyPassOffer, DailyPassPricingRule, GymUnit } from './types';

export const DAILY_PASS_OFFER_BASE = 'base';

const JS_DAY_TO_KEY: DayOfWeek[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function normalizeDailyPrice(price: number): number {
  if (!Number.isFinite(price) || price < 0) return 0;
  return Math.round(price * 100) / 100;
}

function parseTimeMinutes(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
}

function dayKeyFromDate(date: string): DayOfWeek {
  const d = new Date(`${date}T12:00:00`);
  return JS_DAY_TO_KEY[d.getDay()];
}

function modalityAllowed(unit: GymUnit, modality: string): boolean {
  return unit.modalities.some((m) => m.toLowerCase() === modality.toLowerCase());
}

function effectiveDailyPassModalities(unit: GymUnit): string[] {
  const configured = unit.dailyPassModalities ?? [];
  if (configured.length === 0) return [...unit.modalities];
  return configured.filter((m) => modalityAllowed(unit, m));
}

function intervalsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function normalizeDailyPassPricingRules(
  unit: GymUnit,
  rules?: DailyPassPricingRule[] | null,
): DailyPassPricingRule[] {
  if (!rules?.length) return [];

  const normalized: DailyPassPricingRule[] = [];
  for (const raw of rules) {
    if (raw.active === false) {
      const days = (raw.daysOfWeek ?? []).filter((d) => WEEKDAY_ORDER.includes(d));
      const modalities = (raw.modalities ?? []).filter((m) => modalityAllowed(unit, m));
      if (!days.length || !modalities.length) continue;
      if (!isValidTime(raw.startTime) || !isValidTime(raw.endTime)) continue;
      if (parseTimeMinutes(raw.startTime) >= parseTimeMinutes(raw.endTime)) continue;
      normalized.push({
        id: raw.id?.trim() || randomUUID(),
        label: raw.label?.trim() || undefined,
        daysOfWeek: days,
        startTime: raw.startTime.trim(),
        endTime: raw.endTime.trim(),
        modalities,
        price: normalizeDailyPrice(raw.price),
        active: false,
      });
      continue;
    }

    const days = (raw.daysOfWeek ?? []).filter((d) => WEEKDAY_ORDER.includes(d));
    const modalities = (raw.modalities ?? []).filter((m) => modalityAllowed(unit, m));
    if (!days.length || !modalities.length) continue;
    if (!isValidTime(raw.startTime) || !isValidTime(raw.endTime)) continue;
    if (parseTimeMinutes(raw.startTime) >= parseTimeMinutes(raw.endTime)) continue;

    normalized.push({
      id: raw.id?.trim() || randomUUID(),
      label: raw.label?.trim() || undefined,
      daysOfWeek: days,
      startTime: raw.startTime.trim(),
      endTime: raw.endTime.trim(),
      modalities,
      price: normalizeDailyPrice(raw.price),
      active: true,
    });
  }

  return normalized;
}

export function validateDailyPassPricingRules(
  unit: GymUnit,
  rules: DailyPassPricingRule[],
): string | null {
  const active = rules.filter((r) => r.active);

  for (let i = 0; i < active.length; i += 1) {
    const a = active[i]!;
    const aStart = parseTimeMinutes(a.startTime);
    const aEnd = parseTimeMinutes(a.endTime);

    for (let j = i + 1; j < active.length; j += 1) {
      const b = active[j]!;
      const sharedDays = a.daysOfWeek.filter((d) => b.daysOfWeek.includes(d));
      if (!sharedDays.length) continue;

      const sharedMods = a.modalities.filter((m) =>
        b.modalities.some((x) => x.toLowerCase() === m.toLowerCase()),
      );
      if (!sharedMods.length) continue;

      const bStart = parseTimeMinutes(b.startTime);
      const bEnd = parseTimeMinutes(b.endTime);
      if (intervalsOverlap(aStart, aEnd, bStart, bEnd)) {
        const mod = sharedMods[0];
        return `Faixas "${a.label ?? a.id}" e "${b.label ?? b.id}" se sobrepõem em horário para ${mod}.`;
      }
    }
  }

  if (unit.dailyPassActive) {
    const integralMods = effectiveDailyPassModalities(unit);
    const hasActiveRules = active.some((r) => r.modalities.length > 0);
    if (integralMods.length === 0 && !hasActiveRules) {
      return 'Ative modalidades na diária integral ou cadastre faixas promocionais.';
    }
  }

  return null;
}

function baseOffer(unit: GymUnit): DailyPassOffer | null {
  if (!unit.dailyPassActive) return null;
  const modalities = effectiveDailyPassModalities(unit);
  if (!modalities.length) return null;

  return {
    id: DAILY_PASS_OFFER_BASE,
    kind: 'full_day',
    label: 'Diária integral',
    startTime: null,
    endTime: null,
    modalities,
    price: normalizeDailyPrice(unit.dailyPassPrice),
    pricingRuleId: null,
  };
}

function ruleToOffer(rule: DailyPassPricingRule): DailyPassOffer {
  return {
    id: rule.id,
    kind: 'window',
    label: rule.label ?? 'Faixa promocional',
    startTime: rule.startTime,
    endTime: rule.endTime,
    modalities: [...rule.modalities],
    price: rule.price,
    pricingRuleId: rule.id,
  };
}

export function expandDailyPassOffers(unit: GymUnit, date: string): DailyPassOffer[] {
  const day = dayKeyFromDate(date);
  const offers: DailyPassOffer[] = [];

  const full = baseOffer(unit);
  if (full) offers.push(full);

  const rules = unit.dailyPassPricingRules ?? [];
  for (const rule of rules) {
    if (!rule.active) continue;
    if (!rule.daysOfWeek.includes(day)) continue;
    offers.push(ruleToOffer(rule));
  }

  return offers;
}

export function resolveDailyPassOffer(
  unit: GymUnit,
  offerId: string,
  date: string,
): DailyPassOffer | null {
  const offers = expandDailyPassOffers(unit, date);
  return offers.find((o) => o.id === offerId) ?? null;
}

export function formatDailyPassWindowMessage(startTime: string, endTime: string): string {
  return `Diária válida das ${startTime} às ${endTime}.`;
}

export function isWithinDailyPassWindow(
  startTime: string,
  endTime: string,
  at = new Date(),
): boolean {
  const nowMinutes = at.getHours() * 60 + at.getMinutes();
  const start = parseTimeMinutes(startTime);
  const end = parseTimeMinutes(endTime);
  return nowMinutes >= start && nowMinutes < end;
}
