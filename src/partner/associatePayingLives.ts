import type { ApiStore, GymUnit } from './types';

function isListedAssociateUnit(unit: GymUnit): boolean {
  if (!unit.acafAssociate) return false;
  return unit.acafAssociate.listed !== false;
}

/**
 * Vidas pagantes para faixas de repasse de associados: assinante ativo com academia principal
 * em unidade com cadastro de associado listada no catálogo.
 */
export function countAssociatePayingLives(store: ApiStore): number {
  const unitIds = new Set(
    store.units.filter((u) => isListedAssociateUnit(u)).map((u) => u.id),
  );
  if (!unitIds.size) return 0;
  return (store.connectMembers ?? []).filter(
    (m) => m.active && m.primaryUnitId && unitIds.has(m.primaryUnitId),
  ).length;
}
