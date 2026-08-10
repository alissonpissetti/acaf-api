import type { ApiStore, CheckInLogEntry, GymStudent } from './types';
import { clampCheckInsThisMonth } from './studentLimits';
import { formatDailyPassWindowMessage, isWithinDailyPassWindow } from './dailyPassPricing';
import { markReservationCheckedIn } from './modalitySchedule';
import {
  CHECK_IN_MAX_RADIUS_KM,
  distanceToUnitKm,
  isWithinCheckInRadius,
  unitHasCoordinates,
} from './checkInGeo';
import { brDateKeyFromIso, brDateKeyToday } from './gymLocalTime';
import {
  findConnectMember,
  recordConnectMemberCheckIn,
  refreshConnectMemberPrimaryStatsFromLog,
  validateConnectCheckInAtUnit,
} from './connectMember';
import { recomputeConnectPayouts } from './connectPayout';
import { applyStudentStatsFromLog, DEMO_TODAY } from './demoSeedGenerators';

export type ValidateResult =
  | { ok: true; type: CheckInLogEntry['type']; holderName: string; message: string }
  | { ok: false; message: string };

function normalizeUnitToken(unitId: string): string {
  return unitId.toUpperCase().replace(/-/g, '_');
}

function unitIdsMatch(codeToken: string, unitId: string): boolean {
  const a = codeToken.toUpperCase().replace(/-/g, '_');
  const b = normalizeUnitToken(unitId);
  return a === b || a.endsWith(b) || b.endsWith(a);
}

export function normalizeHolderKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function resolveStudentForCheckIn(
  store: ApiStore,
  unitId: string,
  result: Extract<ValidateResult, { ok: true }>,
  code: string,
): GymStudent | undefined {
  if (result.type === 'daily_pass') {
    return store.students.find(
      (s) =>
        s.unitId === unitId &&
        s.channel === 'daily_pass' &&
        result.holderName.toLowerCase().includes(s.name.split(' ')[0].toLowerCase()),
    );
  }
  if (result.type === 'connect_member') {
    const holderKey = normalizeHolderKey(result.holderName);
    const member = findConnectMember(store, result.holderName);
    if (member) {
      return store.students.find(
        (s) =>
          s.unitId === unitId &&
          s.channel === 'connect_primary' &&
          normalizeHolderKey(s.name) === holderKey,
      );
    }
    return store.students.find(
      (s) =>
        s.unitId === unitId &&
        s.channel === 'connect_primary' &&
        normalizeHolderKey(s.name) === holderKey,
    );
  }
  return undefined;
}

export function dedupeCheckInLogByPersonPerDay(
  log: CheckInLogEntry[],
  units?: { id: string; networkId?: string }[],
): CheckInLogEntry[] {
  const unitNetwork = new Map(units?.map((u) => [u.id, u.networkId]) ?? []);
  const sorted = [...log].sort((a, b) => b.validatedAt.localeCompare(a.validatedAt));
  const seen = new Set<string>();
  const out: CheckInLogEntry[] = [];

  for (const entry of sorted) {
    const day = brDateKeyFromIso(entry.validatedAt);
    const name = normalizeHolderKey(entry.holderName);
    const key =
      entry.type === 'connect_member'
        ? `connect:${unitNetwork.get(entry.unitId) ?? entry.unitId}:${day}:${name}`
        : `daily:${entry.unitId}:${day}:${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }

  return out;
}

export function resolveCheckInHolderName(
  store: ApiStore,
  unitId: string,
  result: Extract<ValidateResult, { ok: true }>,
  code: string,
): string {
  const student = resolveStudentForCheckIn(store, unitId, result, code);
  return student?.name ?? result.holderName;
}

export function hasCheckInTodayForPerson(
  store: ApiStore,
  unitId: string,
  holderName: string,
  type: CheckInLogEntry['type'],
  code: string,
): boolean {
  const today = brDateKeyToday();
  const holderKey = normalizeHolderKey(holderName);
  const codeNorm = code.trim().toUpperCase();
  const unit = store.units.find((u) => u.id === unitId);
  const networkId = unit?.networkId;

  return store.checkInLog.some((entry) => {
    if (brDateKeyFromIso(entry.validatedAt) !== today) return false;
    if (entry.code === codeNorm && entry.receptionNote !== 'app_purchase') return true;

    const entryNameKey = normalizeHolderKey(entry.holderName);
    if (!holderKey || entryNameKey !== holderKey) return false;

    if (type === 'connect_member' && entry.type === 'connect_member') {
      const entryUnit = store.units.find((u) => u.id === entry.unitId);
      if (networkId && entryUnit?.networkId !== networkId) return false;
      return true;
    }

    return entry.unitId === unitId;
  });
}

export function duplicateCheckInTodayMessage(
  store: ApiStore,
  unitId: string,
  result: Extract<ValidateResult, { ok: true }>,
  code: string,
): string | null {
  const holderName = resolveCheckInHolderName(store, unitId, result, code);
  if (!hasCheckInTodayForPerson(store, unitId, holderName, result.type, code)) {
    return null;
  }
  if (result.type === 'connect_member') {
    return 'Você já fez check-in hoje na rede. Apenas 1 entrada por dia é permitida.';
  }
  return 'Este aluno já fez check-in hoje nesta unidade. Apenas 1 entrada por dia é permitida.';
}

export function validateCheckInCode(
  store: ApiStore,
  unitId: string,
  rawCode: string,
): ValidateResult {
  const code = rawCode.trim().toUpperCase();
  if (!code) {
    return { ok: false, message: 'Informe o código que o aluno mostrou no celular.' };
  }

  const unit = store.units.find((u) => u.id === unitId);
  if (!unit) {
    return { ok: false, message: 'Unidade não encontrada.' };
  }

  const now = new Date();

  if (code.startsWith('ACAF-')) {
    const issued = store.issuedCodes.find((c) => c.code.toUpperCase() === code);
    if (issued) {
      if (issued.unitId !== unitId) {
        return { ok: false, message: 'Diária emitida para outra unidade.' };
      }
      if (new Date(issued.validUntil) < now) {
        return { ok: false, message: 'Diária expirada.' };
      }
      const today = brDateKeyFromIso(now.toISOString());
      if (issued.occurrenceDate && issued.occurrenceDate !== today) {
        return { ok: false, message: 'Diária válida apenas no dia da compra.' };
      }
      if (issued.validWindowStart && issued.validWindowEnd) {
        if (!isWithinDailyPassWindow(issued.validWindowStart, issued.validWindowEnd, now)) {
          return {
            ok: false,
            message: formatDailyPassWindowMessage(issued.validWindowStart, issued.validWindowEnd),
          };
        }
      }
      const modalityNote =
        issued.allowedModalities?.length && issued.allowedModalities.length <= 3
          ? ` · ${issued.allowedModalities.join(', ')}`
          : '';
      return {
        ok: true,
        type: 'daily_pass',
        holderName: issued.holderName,
        message: `Diária válida · ${issued.holderName}${modalityNote}`,
      };
    }

    const parts = code.split('-');
    const unitToken = parts[parts.length - 1];
    if (!unitIdsMatch(unitToken, unitId)) {
      return {
        ok: false,
        message: `Código não pertence à unidade ${unit.unitName}.`,
      };
    }

    return {
      ok: true,
      type: 'daily_pass',
      holderName: 'Visitante · diária',
      message: 'Diária reconhecida.',
    };
  }

  if (code.startsWith('CHK-')) {
    const parts = code.split('-');
    if (parts.length < 3) {
      return { ok: false, message: 'Código de check-in inválido.' };
    }
    const unitToken = parts[1];
    const dayPart = parseInt(parts[2], 10);
    if (!unitIdsMatch(unitToken, unitId)) {
      return { ok: false, message: 'Check-in Connect emitido para outra unidade.' };
    }
    if (dayPart !== now.getDate()) {
      return {
        ok: false,
        message: 'Este código só vale no dia em que foi gerado.',
      };
    }
    return {
      ok: true,
      type: 'connect_member',
      holderName: 'Associado ACAF Connect',
      message: 'Check-in Connect do dia autorizado.',
    };
  }

  return {
    ok: false,
    message: 'Código não reconhecido. Peça ao aluno para abrir o ACAF Connect e mostrar o código na tela.',
  };
}

export function applySuccessfulCheckIn(
  store: ApiStore,
  unitId: string,
  result: Extract<ValidateResult, { ok: true }>,
  code: string,
): CheckInLogEntry {
  const duplicate = duplicateCheckInTodayMessage(store, unitId, result, code);
  if (duplicate) {
    throw new Error(duplicate);
  }

  const codeNorm = code.trim().toUpperCase();
  const entry: CheckInLogEntry = {
    id: `ci-${Date.now()}`,
    unitId,
    code: codeNorm,
    type: result.type,
    holderName: result.holderName,
    validatedAt: new Date().toISOString(),
  };

  store.checkInLog.push(entry);

  const today = brDateKeyToday();
  const student = resolveStudentForCheckIn(store, unitId, result, code);

  if (result.type === 'daily_pass') {
    const issued = store.issuedCodes.find((c) => c.code.toUpperCase() === codeNorm);
    if (student && issued?.pricePaid != null) {
      student.dailyPassPricePaid = issued.pricePaid;
    }
  }

  if (result.type === 'connect_member') {
    recordConnectMemberCheckIn(store, entry.holderName, unitId);
    recomputeConnectPayouts(store);
  }

  const linkedStudent = resolveStudentForCheckIn(store, unitId, result, code) ?? student;
  if (linkedStudent) {
    linkedStudent.checkInsThisMonth = clampCheckInsThisMonth(linkedStudent.checkInsThisMonth + 1);
    linkedStudent.lastVisit = today;
    if (result.type === 'daily_pass') {
      linkedStudent.dailyPassesThisMonth += 1;
    }
    entry.holderName = linkedStudent.name;
  }

  markReservationCheckedIn(store, unitId, entry.holderName);

  return entry;
}

export type GeoCheckInResult =
  | { ok: true; entry: CheckInLogEntry; message: string }
  | { ok: false; message: string };

/** Check-in automático solicitado pelo app (geolocalização + validação de código). */
export function requestGeoCheckIn(
  store: ApiStore,
  unitId: string,
  rawCode: string,
  holderName: string,
  latitude: number,
  longitude: number,
): GeoCheckInResult {
  const unit = store.units.find((u) => u.id === unitId);
  if (!unit) {
    return { ok: false, message: 'Unidade não encontrada.' };
  }

  if (!unitHasCoordinates(unit)) {
    return {
      ok: false,
      message: 'A unidade ainda não tem localização cadastrada para check-in automático.',
    };
  }

  if (!isWithinCheckInRadius(unit, latitude, longitude)) {
    const dist = distanceToUnitKm(unit, latitude, longitude);
    const distLabel = dist != null ? dist.toFixed(1).replace('.', ',') : '—';
    return {
      ok: false,
      message: `Check-in só é permitido dentro de ${CHECK_IN_MAX_RADIUS_KM} km da academia. Distância atual: ${distLabel} km.`,
    };
  }

  const codeResult = validateCheckInCode(store, unitId, rawCode);
  if (!codeResult.ok) {
    return codeResult;
  }

  const trimmedHolder = holderName.trim();
  const effectiveResult =
    trimmedHolder.length > 0
      ? { ...codeResult, holderName: trimmedHolder }
      : codeResult;

  const duplicate = duplicateCheckInTodayMessage(store, unitId, effectiveResult, rawCode);
  if (duplicate) {
    return { ok: false, message: duplicate };
  }

  if (effectiveResult.type === 'connect_member') {
    const primaryBlock = validateConnectCheckInAtUnit(store, trimmedHolder || effectiveResult.holderName, unitId);
    if (primaryBlock) {
      return { ok: false, message: primaryBlock };
    }
  }

  const entry = applySuccessfulCheckIn(store, unitId, effectiveResult, rawCode);
  return { ok: true, entry, message: effectiveResult.message };
}

/** Gera código CHK demo igual ao app Flutter MemberCheckInScreen. */
export function demoMemberCode(unitId: string, date = new Date()): string {
  return `CHK-${normalizeUnitToken(unitId)}-${date.getDate()}`;
}

export function listCheckInsForUnit(
  store: ApiStore,
  unitId: string,
  options?: { todayOnly?: boolean; limit?: number },
): CheckInLogEntry[] {
  const today = brDateKeyToday();
  let rows = store.checkInLog.filter((e) => e.unitId === unitId);
  if (options?.todayOnly) {
    rows = rows.filter((e) => brDateKeyFromIso(e.validatedAt) === today);
  }
  rows = [...rows].sort((a, b) => b.validatedAt.localeCompare(a.validatedAt));
  const limit = options?.limit ?? 100;
  return rows.slice(0, limit);
}

/** Remove check-in do log (admin / testes) e recalcula estatísticas relacionadas. */
export function cancelCheckInEntry(
  store: ApiStore,
  entryId: string,
  unitId?: string,
): CheckInLogEntry | null {
  const entry = store.checkInLog.find((e) => e.id === entryId);
  if (!entry) return null;
  if (unitId && entry.unitId !== unitId) return null;

  store.checkInLog = store.checkInLog.filter((e) => e.id !== entryId);

  if (entry.type === 'connect_member') {
    refreshConnectMemberPrimaryStatsFromLog(store, entry.holderName);
    recomputeConnectPayouts(store);
  }

  const monthPrefix = DEMO_TODAY.slice(0, 7);
  store.students = applyStudentStatsFromLog(store.students, store.checkInLog, monthPrefix);

  return entry;
}
