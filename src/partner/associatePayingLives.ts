import type { ApiStore, ConnectMemberRecord, GymUnit } from './types';
import { normalizeHolderKey } from './checkIn';
import { brDateKeyFromIso, brDateKeyToday } from './gymLocalTime';

function isListedAssociateUnit(unit: GymUnit): boolean {
  if (!unit.acafAssociate) return false;
  return unit.acafAssociate.listed !== false;
}

function listedAssociateUnitIds(store: ApiStore): Set<string> {
  return new Set(store.units.filter((u) => isListedAssociateUnit(u)).map((u) => u.id));
}

/** Plano mensal válido para vidas pagantes (ativa explícita ou assinatura Asaas vinculada). */
export function countsAsPayingConnectMember(member: ConnectMemberRecord): boolean {
  if (member.active === true) return true;
  if (member.asaasSubscriptionId?.trim()) return true;
  return false;
}

function payingLifeHolderKeys(store: ApiStore): Set<string> {
  const keys = new Set<string>();

  for (const m of store.connectMembers ?? []) {
    if (!countsAsPayingConnectMember(m)) continue;
    const key = m.holderKey || normalizeHolderKey(m.holderName);
    if (key) keys.add(key);
  }

  const monthPrefix = brDateKeyToday().slice(0, 7);
  for (const entry of store.checkInLog ?? []) {
    if (entry.type !== 'connect_member') continue;
    if (!brDateKeyFromIso(entry.validatedAt).startsWith(monthPrefix)) continue;
    const key = normalizeHolderKey(entry.holderName);
    if (key) keys.add(key);
  }

  return keys;
}

export type PayingLivesDiagnostics = {
  count: number;
  connectMembersTotal: number;
  payingMembersActiveFlag: number;
  payingMembersWithAsaasSubscription: number;
  checkInHoldersThisMonth: number;
  listedAssociateUnits: number;
  monthPrefix: string;
};

export function diagnoseAssociatePayingLives(store: ApiStore): PayingLivesDiagnostics {
  const members = store.connectMembers ?? [];
  const monthPrefix = brDateKeyToday().slice(0, 7);
  let payingMembersActiveFlag = 0;
  let payingMembersWithAsaasSubscription = 0;
  for (const m of members) {
    if (m.active === true) payingMembersActiveFlag += 1;
    if (m.asaasSubscriptionId?.trim()) payingMembersWithAsaasSubscription += 1;
  }
  const checkInHolders = new Set<string>();
  for (const entry of store.checkInLog ?? []) {
    if (entry.type !== 'connect_member') continue;
    if (!brDateKeyFromIso(entry.validatedAt).startsWith(monthPrefix)) continue;
    const key = normalizeHolderKey(entry.holderName);
    if (key) checkInHolders.add(key);
  }
  return {
    count: payingLifeHolderKeys(store).size,
    connectMembersTotal: members.length,
    payingMembersActiveFlag,
    payingMembersWithAsaasSubscription,
    checkInHoldersThisMonth: checkInHolders.size,
    listedAssociateUnits: listedAssociateUnitIds(store).size,
    monthPrefix,
  };
}

/**
 * Vidas pagantes para faixas de repasse ACAF: titulares únicos com plano Movly ativo (ou assinatura
 * Asaas no cadastro) e titulares com check-in de plano confirmado no mês civil (America/Sao_Paulo)
 * em qualquer unidade. Pendências na recepção não entram.
 */
export function countAssociatePayingLives(store: ApiStore): number {
  return payingLifeHolderKeys(store).size;
}