import { getDomain } from './store';
import type { AdminNetwork, ApiStore, GymUnit } from './types';

type DomainFees = {
  connectFeePercent?: number;
  dailyFeePercent?: number;
};

export function clampPlatformFeePercent(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return 20;
  return Math.min(100, Math.max(0, n));
}

export function domainConnectFeePercent(): number {
  const d = getDomain() as DomainFees;
  return clampPlatformFeePercent(d.connectFeePercent ?? 20);
}

export function domainDailyFeePercent(): number {
  const d = getDomain() as DomainFees;
  if (d.dailyFeePercent != null && Number.isFinite(d.dailyFeePercent)) {
    return clampPlatformFeePercent(d.dailyFeePercent);
  }
  return domainConnectFeePercent();
}

function networkById(store: ApiStore, networkId: string): AdminNetwork | undefined {
  return store.networks.find((n) => n.id === networkId);
}

/** Hierarquia: override da unidade → override da rede → % global (domínio). */
export function resolveConnectFeePercentForUnit(store: ApiStore, unitId: string): number {
  const unit = store.units.find((u) => u.id === unitId);
  if (!unit) return domainConnectFeePercent();
  if (
    unit.connectFeePercentOverride != null &&
    Number.isFinite(unit.connectFeePercentOverride)
  ) {
    return clampPlatformFeePercent(unit.connectFeePercentOverride);
  }
  const net = networkById(store, unit.networkId);
  if (
    net?.connectFeePercentOverride != null &&
    Number.isFinite(net.connectFeePercentOverride)
  ) {
    return clampPlatformFeePercent(net.connectFeePercentOverride);
  }
  return domainConnectFeePercent();
}

export function resolveDailyFeePercentForUnit(store: ApiStore, unitId: string): number {
  const unit = store.units.find((u) => u.id === unitId);
  if (!unit) return domainDailyFeePercent();
  if (
    unit.dailyFeePercentOverride != null &&
    Number.isFinite(unit.dailyFeePercentOverride)
  ) {
    return clampPlatformFeePercent(unit.dailyFeePercentOverride);
  }
  const net = networkById(store, unit.networkId);
  if (net?.dailyFeePercentOverride != null && Number.isFinite(net.dailyFeePercentOverride)) {
    return clampPlatformFeePercent(net.dailyFeePercentOverride);
  }
  return domainDailyFeePercent();
}

/** Para validação no admin: aplica a mesma hierarquia sem exigir unit completo. */
export function previewConnectFeePercent(
  store: ApiStore,
  unit: Pick<GymUnit, 'networkId' | 'connectFeePercentOverride'>,
): number {
  if (
    unit.connectFeePercentOverride != null &&
    Number.isFinite(unit.connectFeePercentOverride)
  ) {
    return clampPlatformFeePercent(unit.connectFeePercentOverride);
  }
  const net = networkById(store, unit.networkId);
  if (
    net?.connectFeePercentOverride != null &&
    Number.isFinite(net.connectFeePercentOverride)
  ) {
    return clampPlatformFeePercent(net.connectFeePercentOverride);
  }
  return domainConnectFeePercent();
}

export function previewDailyFeePercent(
  store: ApiStore,
  unit: Pick<GymUnit, 'networkId' | 'dailyFeePercentOverride'>,
): number {
  if (
    unit.dailyFeePercentOverride != null &&
    Number.isFinite(unit.dailyFeePercentOverride)
  ) {
    return clampPlatformFeePercent(unit.dailyFeePercentOverride);
  }
  const net = networkById(store, unit.networkId);
  if (net?.dailyFeePercentOverride != null && Number.isFinite(net.dailyFeePercentOverride)) {
    return clampPlatformFeePercent(net.dailyFeePercentOverride);
  }
  return domainDailyFeePercent();
}
