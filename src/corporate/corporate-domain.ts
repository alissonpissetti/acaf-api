export const DEFAULT_CORPORATE_BENEFIT_PER_MONTH = 44.9;

export function getCorporateBenefitPerMonth(domain?: { corporateBenefitPerMonth?: number }): number {
  const value = domain?.corporateBenefitPerMonth ?? DEFAULT_CORPORATE_BENEFIT_PER_MONTH;
  return Math.round(value * 100) / 100;
}

export function currentMonthKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}
