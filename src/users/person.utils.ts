export function normalizeCpf(value: string): string {
  return String(value ?? '').replace(/\D/g, '').slice(0, 11);
}

export function formatCpf(digits: string): string {
  if (digits.length !== 11) return digits;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

export function isValidCpf(digits: string): boolean {
  if (digits.length !== 11 || /^(\d)\1+$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(digits[i]) * (10 - i);
  let check = (sum * 10) % 11;
  if (check === 10) check = 0;
  if (check !== Number(digits[9])) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += Number(digits[i]) * (11 - i);
  check = (sum * 10) % 11;
  if (check === 10) check = 0;
  return check === Number(digits[10]);
}

export function normalizeMobilePhone(value: string): string {
  return String(value ?? '').replace(/\D/g, '').slice(0, 11);
}

export function formatMobilePhone(digits: string): string {
  if (digits.length !== 11) return digits;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

export function isValidMobilePhone(digits: string): boolean {
  return digits.length === 11 && digits[2] === '9';
}

/** Extrai celular BR (11 dígitos, 3º = 9) de chaves WhatsApp, JID ou número com DDI. */
export function resolveBrazilMobilePhone(value: string | null | undefined): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (/^lid:/i.test(raw)) return null;
  if (raw.includes('@lid')) return null;

  const numeric = raw.replace(/\D/g, '');
  if (!numeric) return null;

  if (numeric.length >= 12 && numeric.startsWith('55')) {
    const afterDdi = numeric.slice(2);
    if (afterDdi.length === 11 && isValidMobilePhone(afterDdi)) return afterDdi;
    if (afterDdi.length === 10) {
      const withNine = `${afterDdi.slice(0, 2)}9${afterDdi.slice(2)}`;
      if (isValidMobilePhone(withNine)) return withNine;
      if (afterDdi[2] === '9') return afterDdi;
    }
    const local = numeric.slice(-11);
    if (isValidMobilePhone(local)) return local;
  }

  if (numeric.length === 11 && isValidMobilePhone(numeric)) return numeric;

  if (numeric.length === 10) {
    const candidate = `${numeric.slice(0, 2)}9${numeric.slice(2)}`;
    if (isValidMobilePhone(candidate)) return candidate;
  }

  const trimmed = normalizeMobilePhone(numeric);
  if (isValidMobilePhone(trimmed)) return trimmed;

  return null;
}

export function normalizeCnpj(value: string): string {
  return String(value ?? '').replace(/\D/g, '').slice(0, 14);
}

export function formatCnpj(digits: string): string {
  if (digits.length !== 14) return digits;
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}

export function isValidCnpj(digits: string): boolean {
  if (digits.length !== 14 || /^(\d)\1+$/.test(digits)) return false;
  const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(digits[i]) * weights1[i]!;
  let mod = sum % 11;
  const d1 = mod < 2 ? 0 : 11 - mod;
  if (d1 !== Number(digits[12])) return false;
  sum = 0;
  for (let i = 0; i < 13; i++) sum += Number(digits[i]) * weights2[i]!;
  mod = sum % 11;
  const d2 = mod < 2 ? 0 : 11 - mod;
  return d2 === Number(digits[13]);
}
