import type { ApiStore, GymUnit } from './types';
import { withDemoCorporateFields } from '../corporate/demo-corporate-companies';

/** IDs das unidades do cenário demo Carpe (regeneradas pelo seed). */
export const DEMO_UNIT_IDS = new Set(['g_carpe', 'g_carpe_batel', 'g_carpe_centro']);

export function isDemoStudentId(id: string): boolean {
  return /^s\d+$/.test(id);
}

export function isDemoCheckInId(id: string): boolean {
  return id.startsWith('ci-');
}

export function isDemoReservationId(id: string): boolean {
  return /^mr-\d+$/.test(id);
}

export function isDemoPendingCheckInId(id: string): boolean {
  return /^pend-\d+$/.test(id);
}

export function isDemoIssuedCode(code: string): boolean {
  return code.includes('DEMO') || code.startsWith('ACAF-MCK-DEMO');
}

function mergeDemoUnit(existing: GymUnit, generated: GymUnit): GymUnit {
  return {
    ...generated,
    ...existing,
    networkId: existing.networkId ?? generated.networkId,
    modalitySlotTemplates:
      generated.modalitySlotTemplates?.length
        ? generated.modalitySlotTemplates
        : existing.modalitySlotTemplates,
    modalitySlotOverrides:
      generated.modalitySlotOverrides ?? existing.modalitySlotOverrides,
  };
}

/**
 * Mescla seed demo em store existente sem apagar dados cadastrados manualmente
 * (unidades extras, alunos, check-ins, reservas, repasses de outras unidades).
 * Apenas substitui registros identificados como demo sintético.
 */
export function mergeDemoSeedIntoStore(existing: ApiStore, generated: ApiStore): ApiStore {
  const preservedUnits = existing.units.filter((u) => !DEMO_UNIT_IDS.has(u.id));
  const mergedDemoUnits = generated.units.map((demoUnit) => {
    const current = existing.units.find((u) => u.id === demoUnit.id);
    return current ? mergeDemoUnit(current, demoUnit) : demoUnit;
  });

  const preservedStudents = existing.students.filter((s) => !isDemoStudentId(s.id));
  const preservedCheckIns = existing.checkInLog.filter((e) => !isDemoCheckInId(e.id));
  const preservedReservations = (existing.modalityReservations ?? []).filter(
    (r) => !isDemoReservationId(r.id),
  );
  const preservedPending = (existing.pendingCheckIns ?? []).filter(
    (p) => !isDemoPendingCheckInId(p.id),
  );
  const preservedIssued = (existing.issuedCodes ?? []).filter(
    (c) => !isDemoIssuedCode(c.code),
  );

  const payoutHistoryByUnit = { ...existing.payoutHistoryByUnit };
  const payoutsByUnit = { ...existing.payoutsByUnit };
  for (const unitId of DEMO_UNIT_IDS) {
    if (generated.payoutHistoryByUnit[unitId]) {
      payoutHistoryByUnit[unitId] = generated.payoutHistoryByUnit[unitId];
    }
    if (generated.payoutsByUnit[unitId]) {
      payoutsByUnit[unitId] = generated.payoutsByUnit[unitId];
    }
  }

  const existingNetworkIds = new Set((existing.networks ?? []).map((n) => n.id));
  const extraNetworks = (generated.networks ?? []).filter((n) => !existingNetworkIds.has(n.id));
  const networks = [...(existing.networks ?? []), ...extraNetworks];

  const checkInLog = [...preservedCheckIns, ...generated.checkInLog].sort((a, b) =>
    b.validatedAt.localeCompare(a.validatedAt),
  );

  return {
    ...existing,
    networkId: existing.networkId || generated.networkId,
    networkName: existing.networkName || generated.networkName,
    activeUnitId: existing.activeUnitId || generated.activeUnitId,
    networks: networks.length ? networks : generated.networks,
    units: [...preservedUnits, ...mergedDemoUnits],
    students: [...preservedStudents, ...generated.students.map((s) => withDemoCorporateFields(s))],
    checkInLog,
    modalityReservations: [...preservedReservations, ...(generated.modalityReservations ?? [])],
    pendingCheckIns: [...preservedPending, ...(generated.pendingCheckIns ?? [])],
    issuedCodes: [...preservedIssued, ...(generated.issuedCodes ?? [])],
    payoutHistoryByUnit,
    payoutsByUnit,
  };
}
