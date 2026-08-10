import { randomBytes } from 'node:crypto';

export function normalizeEnrollmentCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s/g, '');
}

/** Código compartilhado da empresa (ex.: ACAF-A1B2C3). */
export function generateEnrollmentCode(): string {
  const suffix = randomBytes(3).toString('hex').toUpperCase();
  return `ACAF-${suffix}`;
}
