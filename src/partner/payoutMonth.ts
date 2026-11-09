/** Rótulo de mês em pt-BR alinhado ao app (ex.: "novembro de 2025"). */
export function currentMonthLabelBr(date = new Date()): string {
  return date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

export function currentMonthKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

const PT_MONTH_INDEX: Record<string, number> = {
  janeiro: 1,
  fevereiro: 2,
  março: 3,
  marco: 3,
  abril: 4,
  maio: 5,
  junho: 6,
  julho: 7,
  agosto: 8,
  setembro: 9,
  outubro: 10,
  novembro: 11,
  dezembro: 12,
};

function normalizeMonthToken(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

/** Converte rótulo do tipo "julho de 2026" / "Julho 2026" em `YYYY-MM`. */
export function monthKeyFromLabelBr(monthLabel: string): string | null {
  const parts = monthLabel.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  const yearPart = parts.find((p) => /^\d{4}$/.test(p));
  if (!yearPart) return null;
  const year = Number(yearPart);
  const monthToken = normalizeMonthToken(parts[0]!);
  const month = PT_MONTH_INDEX[monthToken];
  if (!month) return null;
  return `${year}-${String(month).padStart(2, '0')}`;
}
