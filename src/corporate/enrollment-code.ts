export function normalizeEnrollmentCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s/g, '');
}
