import { randomUUID } from 'node:crypto';
import type {
  ApiStore,
  GymUnit,
  ModalityReservation,
  ModalitySlotOverride,
  ModalitySlotTemplate,
} from './types';
import { WEEKDAY_ORDER, type DayOfWeek } from './weeklySchedule';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

const JS_DAY_TO_KEY: DayOfWeek[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export type ModalityOccurrence = {
  occurrenceKey: string;
  occurrenceDate: string;
  slotTemplateId?: string;
  overrideId?: string;
  modality: string;
  instructorName?: string;
  startTime: string;
  endTime: string;
  capacity: number;
};

export type ModalityAvailability = ModalityOccurrence & {
  booked: number;
  available: number;
};

function parseTimeMinutes(value: string): number {
  const match = TIME_RE.exec(value.trim());
  if (!match) return NaN;
  return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
}

export function isValidTime(value: string): boolean {
  return TIME_RE.test(value.trim());
}

export function isValidDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T12:00:00`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function dayKeyFromDate(date: string): DayOfWeek {
  const d = new Date(`${date}T12:00:00`);
  return JS_DAY_TO_KEY[d.getDay()];
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function compareDates(a: string, b: string): number {
  return a.localeCompare(b);
}

function modalityAllowed(unit: GymUnit, modality: string): boolean {
  return unit.modalities.some((m) => m.toLowerCase() === modality.toLowerCase());
}

function normalizeTemplate(raw: ModalitySlotTemplate, unit: GymUnit): ModalitySlotTemplate | null {
  if (!modalityAllowed(unit, raw.modality)) return null;
  if (!WEEKDAY_ORDER.includes(raw.dayOfWeek)) return null;
  if (!isValidTime(raw.startTime) || !isValidTime(raw.endTime)) return null;
  if (parseTimeMinutes(raw.startTime) >= parseTimeMinutes(raw.endTime)) return null;
  const capacity = Math.floor(Number(raw.capacity));
  if (!Number.isFinite(capacity) || capacity < 1) return null;
  return {
    id: raw.id?.trim() || randomUUID(),
    modality: raw.modality.trim(),
    instructorName: raw.instructorName?.trim() || undefined,
    dayOfWeek: raw.dayOfWeek,
    startTime: raw.startTime.trim(),
    endTime: raw.endTime.trim(),
    capacity,
    active: raw.active !== false,
  };
}

function normalizeOverride(raw: ModalitySlotOverride, unit: GymUnit): ModalitySlotOverride | null {
  if (!isValidDate(raw.date)) return null;
  if (!modalityAllowed(unit, raw.modality)) return null;
  if (!['cancel', 'extra', 'patch'].includes(raw.kind)) return null;
  if (raw.kind !== 'cancel') {
    if (!isValidTime(raw.startTime) || !isValidTime(raw.endTime)) return null;
    if (parseTimeMinutes(raw.startTime) >= parseTimeMinutes(raw.endTime)) return null;
  }
  if (raw.kind === 'extra' || raw.kind === 'patch') {
    const cap = raw.capacity !== undefined ? Math.floor(Number(raw.capacity)) : undefined;
    if (cap !== undefined && (!Number.isFinite(cap) || cap < 1)) return null;
  }
  return {
    id: raw.id?.trim() || randomUUID(),
    date: raw.date,
    kind: raw.kind,
    slotTemplateId: raw.slotTemplateId?.trim() || undefined,
    modality: raw.modality.trim(),
    instructorName: raw.instructorName?.trim() || undefined,
    startTime: raw.startTime?.trim() ?? '00:00',
    endTime: raw.endTime?.trim() ?? '00:00',
    capacity: raw.capacity !== undefined ? Math.floor(Number(raw.capacity)) : undefined,
  };
}

export function normalizeModalitySlotTemplates(
  unit: GymUnit,
  templates?: ModalitySlotTemplate[],
): ModalitySlotTemplate[] {
  if (!templates?.length) return [];
  return templates
    .map((t) => normalizeTemplate(t, unit))
    .filter((t): t is ModalitySlotTemplate => t !== null);
}

export function normalizeModalitySlotOverrides(
  unit: GymUnit,
  overrides?: ModalitySlotOverride[],
): ModalitySlotOverride[] {
  if (!overrides?.length) return [];
  return overrides
    .map((o) => normalizeOverride(o, unit))
    .filter((o): o is ModalitySlotOverride => o !== null);
}

export function getScheduledModalities(unit: GymUnit): string[] {
  const set = new Set<string>();
  for (const t of unit.modalitySlotTemplates ?? []) {
    if (t.active) set.add(t.modality);
  }
  for (const o of unit.modalitySlotOverrides ?? []) {
    if (o.kind === 'extra') set.add(o.modality);
  }
  return [...set];
}

export function buildOccurrenceKey(input: {
  occurrenceDate: string;
  startTime: string;
  endTime: string;
  modality: string;
  slotTemplateId?: string;
  overrideId?: string;
}): string {
  const ref = input.overrideId ?? input.slotTemplateId ?? 'adhoc';
  return `${input.occurrenceDate}|${input.startTime}|${input.endTime}|${input.modality}|${ref}`;
}

function findPatchOverride(
  unit: GymUnit,
  date: string,
  templateId: string,
): ModalitySlotOverride | undefined {
  return unit.modalitySlotOverrides?.find(
    (o) => o.kind === 'patch' && o.date === date && o.slotTemplateId === templateId,
  );
}

function isCancelled(
  unit: GymUnit,
  date: string,
  templateId: string,
): boolean {
  return (
    unit.modalitySlotOverrides?.some(
      (o) => o.kind === 'cancel' && o.date === date && o.slotTemplateId === templateId,
    ) ?? false
  );
}

export function expandOccurrences(
  unit: GymUnit,
  from: string,
  to: string,
  modalityFilter?: string,
): ModalityOccurrence[] {
  if (!isValidDate(from) || !isValidDate(to) || compareDates(from, to) > 0) return [];

  const occurrences: ModalityOccurrence[] = [];
  const templates = (unit.modalitySlotTemplates ?? []).filter((t) => t.active);

  for (let cursor = from; compareDates(cursor, to) <= 0; cursor = addDays(cursor, 1)) {
    const dayKey = dayKeyFromDate(cursor);

    for (const template of templates) {
      if (template.dayOfWeek !== dayKey) continue;
      if (modalityFilter && template.modality.toLowerCase() !== modalityFilter.trim().toLowerCase()) {
        continue;
      }
      if (isCancelled(unit, cursor, template.id)) continue;

      const patch = findPatchOverride(unit, cursor, template.id);
      const startTime = patch?.startTime ?? template.startTime;
      const endTime = patch?.endTime ?? template.endTime;
      const capacity = patch?.capacity ?? template.capacity;
      const instructorName = patch?.instructorName ?? template.instructorName;

      occurrences.push({
        occurrenceKey: buildOccurrenceKey({
          occurrenceDate: cursor,
          startTime,
          endTime,
          modality: template.modality,
          slotTemplateId: template.id,
        }),
        occurrenceDate: cursor,
        slotTemplateId: template.id,
        modality: template.modality,
        instructorName,
        startTime,
        endTime,
        capacity,
      });
    }

    for (const extra of unit.modalitySlotOverrides ?? []) {
      if (extra.kind !== 'extra' || extra.date !== cursor) continue;
      if (modalityFilter && extra.modality.toLowerCase() !== modalityFilter.trim().toLowerCase()) {
        continue;
      }
      const capacity = extra.capacity ?? 1;
      occurrences.push({
        occurrenceKey: buildOccurrenceKey({
          occurrenceDate: cursor,
          startTime: extra.startTime,
          endTime: extra.endTime,
          modality: extra.modality,
          overrideId: extra.id,
        }),
        occurrenceDate: cursor,
        overrideId: extra.id,
        modality: extra.modality,
        instructorName: extra.instructorName,
        startTime: extra.startTime,
        endTime: extra.endTime,
        capacity,
      });
    }
  }

  return occurrences.sort((a, b) => {
    const byDate = compareDates(a.occurrenceDate, b.occurrenceDate);
    if (byDate !== 0) return byDate;
    return parseTimeMinutes(a.startTime) - parseTimeMinutes(b.startTime);
  });
}

function countBookings(
  store: ApiStore,
  unitId: string,
  occurrence: ModalityOccurrence,
): number {
  return (store.modalityReservations ?? []).filter(
    (r) =>
      r.unitId === unitId &&
      r.status !== 'cancelled' &&
      r.occurrenceDate === occurrence.occurrenceDate &&
      r.startTime === occurrence.startTime &&
      r.endTime === occurrence.endTime &&
      r.modality.toLowerCase() === occurrence.modality.toLowerCase() &&
      (occurrence.slotTemplateId
        ? r.slotTemplateId === occurrence.slotTemplateId
        : r.overrideId === occurrence.overrideId),
  ).length;
}

export function getAvailability(
  store: ApiStore,
  unit: GymUnit,
  from: string,
  to: string,
  modalityFilter?: string,
): ModalityAvailability[] {
  return expandOccurrences(unit, from, to, modalityFilter).map((occurrence) => {
    const booked = countBookings(store, unit.id, occurrence);
    return {
      ...occurrence,
      booked,
      available: Math.max(0, occurrence.capacity - booked),
    };
  });
}

function findOccurrence(
  store: ApiStore,
  unit: GymUnit,
  input: {
    occurrenceDate: string;
    slotTemplateId?: string;
    overrideId?: string;
  },
): ModalityOccurrence | null {
  const list = expandOccurrences(unit, input.occurrenceDate, input.occurrenceDate);
  return (
    list.find((o) => {
      if (input.slotTemplateId) {
        return o.slotTemplateId === input.slotTemplateId && o.occurrenceDate === input.occurrenceDate;
      }
      if (input.overrideId) {
        return o.overrideId === input.overrideId && o.occurrenceDate === input.occurrenceDate;
      }
      return false;
    }) ?? null
  );
}

export type CreateReservationInput = {
  unitId: string;
  occurrenceDate: string;
  slotTemplateId?: string;
  overrideId?: string;
  holderName: string;
  holderUserId?: string;
};

export function createReservation(
  store: ApiStore,
  input: CreateReservationInput,
): ModalityReservation {
  const unit = store.units.find((u) => u.id === input.unitId);
  if (!unit) throw new Error('Unidade não encontrada.');
  if (!isValidDate(input.occurrenceDate)) throw new Error('Data inválida.');
  const holderName = input.holderName?.trim();
  if (!holderName) throw new Error('Informe o nome do aluno.');
  if (!input.slotTemplateId && !input.overrideId) {
    throw new Error('Informe o horário a reservar.');
  }

  const occurrence = findOccurrence(store, unit, {
    occurrenceDate: input.occurrenceDate,
    slotTemplateId: input.slotTemplateId,
    overrideId: input.overrideId,
  });
  if (!occurrence) throw new Error('Horário não disponível nesta data.');

  const booked = countBookings(store, unit.id, occurrence);
  if (booked >= occurrence.capacity) throw new Error('Não há vagas para este horário.');

  const duplicate = (store.modalityReservations ?? []).some(
    (r) =>
      r.unitId === input.unitId &&
      r.status === 'confirmed' &&
      r.occurrenceDate === input.occurrenceDate &&
      r.holderName.toLowerCase() === holderName.toLowerCase() &&
      r.startTime === occurrence.startTime &&
      r.endTime === occurrence.endTime &&
      r.modality.toLowerCase() === occurrence.modality.toLowerCase(),
  );
  if (duplicate) throw new Error('Você já possui reserva neste horário.');

  const reservation: ModalityReservation = {
    id: `mr-${randomUUID()}`,
    unitId: input.unitId,
    occurrenceDate: occurrence.occurrenceDate,
    slotTemplateId: occurrence.slotTemplateId,
    overrideId: occurrence.overrideId,
    modality: occurrence.modality,
    instructorName: occurrence.instructorName,
    startTime: occurrence.startTime,
    endTime: occurrence.endTime,
    holderName,
    holderUserId: input.holderUserId?.trim() || undefined,
    status: 'confirmed',
    reservedAt: new Date().toISOString(),
  };

  if (!store.modalityReservations) store.modalityReservations = [];
  store.modalityReservations.push(reservation);
  return reservation;
}

export function cancelReservation(store: ApiStore, reservationId: string): ModalityReservation {
  const reservation = store.modalityReservations?.find((r) => r.id === reservationId);
  if (!reservation) throw new Error('Reserva não encontrada.');
  if (reservation.status === 'cancelled') throw new Error('Reserva já cancelada.');
  if (reservation.status === 'checked_in') throw new Error('Não é possível cancelar após check-in.');
  reservation.status = 'cancelled';
  return reservation;
}

export function reservationsForUnitDate(
  store: ApiStore,
  unitId: string,
  date: string,
): ModalityReservation[] {
  return (store.modalityReservations ?? [])
    .filter((r) => r.unitId === unitId && r.occurrenceDate === date && r.status !== 'cancelled')
    .sort((a, b) => parseTimeMinutes(a.startTime) - parseTimeMinutes(b.startTime));
}

export function reservationsForUnitRange(
  store: ApiStore,
  unitId: string,
  from: string,
  to: string,
): ModalityReservation[] {
  if (!isValidDate(from) || !isValidDate(to) || from > to) return [];
  return (store.modalityReservations ?? [])
    .filter(
      (r) =>
        r.unitId === unitId &&
        r.status !== 'cancelled' &&
        r.occurrenceDate >= from &&
        r.occurrenceDate <= to,
    )
    .sort((a, b) => {
      const byDate = compareDates(a.occurrenceDate, b.occurrenceDate);
      if (byDate !== 0) return byDate;
      return parseTimeMinutes(a.startTime) - parseTimeMinutes(b.startTime);
    });
}

export function reservationsForHolder(
  store: ApiStore,
  holderName: string,
): ModalityReservation[] {
  const needle = holderName.trim().toLowerCase();
  if (!needle) return [];
  return (store.modalityReservations ?? [])
    .filter((r) => r.holderName.toLowerCase().includes(needle))
    .sort((a, b) => {
      const byDate = compareDates(b.occurrenceDate, a.occurrenceDate);
      if (byDate !== 0) return byDate;
      return parseTimeMinutes(a.startTime) - parseTimeMinutes(b.startTime);
    });
}

export function markReservationCheckedIn(
  store: ApiStore,
  unitId: string,
  holderName: string,
  at = new Date(),
): ModalityReservation | null {
  const today = at.toISOString().slice(0, 10);
  const nowMinutes = at.getHours() * 60 + at.getMinutes();
  const needle = holderName.trim().toLowerCase();
  if (!needle) return null;

  const candidates = (store.modalityReservations ?? []).filter(
    (r) =>
      r.unitId === unitId &&
      r.occurrenceDate === today &&
      r.status === 'confirmed' &&
      r.holderName.toLowerCase().includes(needle),
  );

  for (const r of candidates) {
    const start = parseTimeMinutes(r.startTime);
    const end = parseTimeMinutes(r.endTime);
    if (nowMinutes >= start - 30 && nowMinutes <= end + 30) {
      r.status = 'checked_in';
      return r;
    }
  }

  return null;
}

export function templateHasFutureReservations(
  store: ApiStore,
  unitId: string,
  templateId: string,
): boolean {
  const today = new Date().toISOString().slice(0, 10);
  return (store.modalityReservations ?? []).some(
    (r) =>
      r.unitId === unitId &&
      r.slotTemplateId === templateId &&
      r.status === 'confirmed' &&
      r.occurrenceDate >= today,
  );
}
