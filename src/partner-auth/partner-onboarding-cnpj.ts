import type { ApiStore } from '../partner/types';
import { normalizeCnpj } from '../users/person.utils';

export function cnpjDigits(value: string | null | undefined): string {
  return normalizeCnpj(String(value ?? ''));
}

/** Rede da unidade cujo CNPJ (planilha ACAF) ou CNPJ legado da rede coincide. */
export function findNetworkIdForCnpj(store: ApiStore, rawCnpj: string): string | null {
  const needle = cnpjDigits(rawCnpj);
  if (needle.length !== 14) return null;

  const unit = store.units.find((u) => cnpjDigits(u.acafAssociate?.cnpj) === needle);
  if (unit?.networkId) return unit.networkId;

  const network = store.networks.find((n) => cnpjDigits(n.cnpj) === needle);
  return network?.id ?? null;
}
