import type { ConnectPlanId, ConnectMemberRecord, ApiStore, UnitGymSubscriptionRecord } from './types';
import { normalizeHolderKey } from './checkIn';
import {
  findConnectMember,
  primaryGymBlockReason,
  syncConnectMemberStudent,
  toConnectMemberProfile,
  type ConnectMemberProfile,
} from './connectMember';
import { recomputeConnectPayouts } from './connectPayout';
import { getConnectPlansFromDomain } from './planSpecs';
import { loadStore, updateStore } from './store';

export type SubscribeUnitGymInput = {
  holderName: string;
  unitId: string;
  planId: string;
  connectPlanId: ConnectPlanId;
  planName: string;
  pricePerMonth: number;
};

function connectTierIndex(planId: string): number {
  const plans = getConnectPlansFromDomain();
  const found = plans.find((p) => p.id === planId);
  return found?.tierIndex ?? -1;
}

export function isUnitTierEligibleForMember(
  memberConnectPlanId: ConnectPlanId,
  unitConnectPlanId: ConnectPlanId,
): boolean {
  const memberIdx = connectTierIndex(memberConnectPlanId);
  const unitIdx = connectTierIndex(unitConnectPlanId);
  if (memberIdx < 0 || unitIdx < 0) {
    const plans = getConnectPlansFromDomain();
    const memberPlan = plans.find((p) => p.id === memberConnectPlanId);
    const unitPlan = plans.find((p) => p.id === unitConnectPlanId);
    if (!memberPlan || !unitPlan) return false;
    return unitPlan.pricePerMonth <= memberPlan.pricePerMonth;
  }
  return unitIdx <= memberIdx;
}

function assignPrimaryUnitIfNeeded(
  store: ApiStore,
  member: ConnectMemberRecord,
  unitId: string,
  unitName: string,
): ConnectMemberRecord {
  if (member.primaryUnitId === unitId) return member;
  if (!member.primaryUnitId) {
    const now = new Date().toISOString();
    return {
      ...member,
      primaryUnitId: unitId,
      primaryUnitName: unitName,
      primaryChosenAt: now,
      primaryFirstCheckInAt: null,
      primaryCheckInsSinceFirst: 0,
    };
  }
  const block = primaryGymBlockReason(store, member, unitId);
  if (block) throw new Error(block);
  throw new Error(
    `Assinatura nesta unidade só na sua academia principal (${member.primaryUnitName ?? member.primaryUnitId}). `
      + 'Troque a academia principal no app antes de assinar nesta unidade.',
  );
}

export function subscribeUnitGymPlan(input: SubscribeUnitGymInput): ConnectMemberProfile {
  const holderName = input.holderName.trim();
  const unitId = input.unitId.trim();
  const planId = input.planId.trim();
  if (!holderName || !unitId || !planId || !input.connectPlanId?.trim() || !input.planName.trim()) {
    throw new Error('Dados da assinatura incompletos.');
  }
  if (!Number.isFinite(input.pricePerMonth) || input.pricePerMonth < 0) {
    throw new Error('Valor do plano inválido.');
  }

  const preview = loadStore();
  const member = findConnectMember(preview, holderName);
  if (!member?.active) {
    throw new Error('Ative um plano app em Minha conta antes de assinar na unidade.');
  }

  const subscribeBlock = primaryGymBlockReason(preview, member, unitId);
  if (subscribeBlock && member.primaryUnitId !== unitId) {
    throw new Error(subscribeBlock);
  }

  const unit = preview.units.find((u) => u.id === unitId);
  if (!unit) {
    throw new Error('Unidade não encontrada.');
  }

  if (!isUnitTierEligibleForMember(member.connectPlanId, input.connectPlanId)) {
    throw new Error('Este plano na unidade exige um tier maior do plano Movly. Faça upgrade em Minha conta.');
  }

  const domainPlan = getConnectPlansFromDomain().find((p) => p.id === input.connectPlanId);
  const pricePerMonth = domainPlan?.pricePerMonth ?? input.pricePerMonth;
  const planName = domainPlan?.name ?? input.planName.trim();

  const now = new Date().toISOString();
  const subscription: UnitGymSubscriptionRecord = {
    unitId,
    unitName: unit.unitName,
    planId,
    connectPlanId: input.connectPlanId,
    planName,
    pricePerMonth,
    since: member.unitSubscription?.since ?? now,
  };

  const holderKey = normalizeHolderKey(holderName);

  const store = updateStore((s) => {
    const members = s.connectMembers ?? [];
    const idx = members.findIndex((m) => m.holderKey === holderKey);
    if (idx < 0) {
      throw new Error('Ative um plano app em Minha conta antes de assinar na unidade.');
    }

    let next = members[idx];
    next = assignPrimaryUnitIfNeeded(s, next, unitId, unit.unitName);
    next = {
      ...next,
      unitSubscription: subscription,
    };
    members[idx] = next;
    s.connectMembers = members;

    syncConnectMemberStudent(s, next);
    recomputeConnectPayouts(s);
  });

  const result = findConnectMember(store, holderName);
  if (!result) throw new Error('Falha ao registrar assinatura na unidade.');
  return toConnectMemberProfile(result);
}