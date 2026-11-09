/**
 * Faixas de % de repasse para academias associadas à ACAF (vidas pagantes = membros com plano ativo
 * e academia principal em unidade com cadastro ACAF listado).
 *
 * Limites inclusivos: 0–2499, 2500–4999, 5000–9999, ≥10 000.
 */
export type AcafRepasseTier = {
  id: string;
  /** Mínimo de vidas inclusivo */
  min: number;
  /** Máximo de vidas inclusivo; null = sem teto */
  max: number | null;
  repassePercent: number;
};

export const ACAF_REPASSE_TIERS: readonly AcafRepasseTier[] = [
  { id: 'l1', min: 0, max: 2499, repassePercent: 22.01 },
  { id: 'l2', min: 2500, max: 4999, repassePercent: 21.05 },
  { id: 'l3', min: 5000, max: 9999, repassePercent: 20.05 },
  { id: 'l4', min: 10000, max: null, repassePercent: 19.95 },
];

/** Rótulo curto para telas (pt-BR). */
export function formatAcafLivesBand(tier: AcafRepasseTier): string {
  if (tier.max == null) {
    return `≥ ${tier.min.toLocaleString('pt-BR')} vidas`;
  }
  return `${tier.min.toLocaleString('pt-BR')} – ${tier.max.toLocaleString('pt-BR')} vidas`;
}

export function resolveAcafRepasseTier(payingLivesCount: number): AcafRepasseTier {
  const n = Math.max(0, Math.floor(Number(payingLivesCount) || 0));
  for (const tier of ACAF_REPASSE_TIERS) {
    if (tier.max == null) {
      if (n >= tier.min) return tier;
    } else if (n >= tier.min && n <= tier.max) {
      return tier;
    }
  }
  return ACAF_REPASSE_TIERS[ACAF_REPASSE_TIERS.length - 1];
}
