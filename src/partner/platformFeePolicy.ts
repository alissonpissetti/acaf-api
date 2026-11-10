import {
  getConnectFeePercentFromMemory,
  getDailyFeePercentFromMemory,
} from '../system-settings/system-settings.service';
import type { AdminNetwork, ApiStore, GymUnit } from './types';

export function clampPlatformFeePercent(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return 20;
  return Math.min(100, Math.max(0, n));
}

export function domainConnectFeePercent(): number {
  return clampPlatformFeePercent(getConnectFeePercentFromMemory());
}

export function domainDailyFeePercent(): number {
  return clampPlatformFeePercent(getDailyFeePercentFromMemory());
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
