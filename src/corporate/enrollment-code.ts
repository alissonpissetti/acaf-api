const CORPORATE_SUFFIXES =
  /\b(ltda\.?|s\.?a\.?|me|epp|eireli|limitada|servicos|serviços|comercio|comércio|industria|indústria|group|grupo|holding|filial)\b/gi;

const GENERIC_PREFIXES = new Set([
  'ACADEMIA',
  'EMPRESA',
  'GRUPO',
  'CIA',
  'COMPANHIA',
  'INSTITUTO',
  'CENTRO',
  'CLUBE',
  'ASSOCIACAO',
  'ASSOCIAÇÃO',
]);

const MIN_CODE_LENGTH = 3;
const MAX_CODE_LENGTH = 16;

/** Entrada do usuário: maiúsculas, sem espaços extras (preserva hífen para códigos legados). */
export function normalizeEnrollmentCode(raw: string): string {
  return raw
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, '');
}

/** Forma canônica para novos códigos e busca flexível (só letras e números). */
export function canonicalEnrollmentCode(raw: string): string {
  return normalizeEnrollmentCode(raw).replace(/[^A-Z0-9]/g, '');
}

function stripAccents(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function tokenizeName(name: string): string[] {
  const cleaned = stripAccents(name)
    .replace(CORPORATE_SUFFIXES, ' ')
    .replace(/[^a-zA-Z0-9\s-]/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return [];

  let words = cleaned.split(' ').filter((word) => word.length > 0);
  while (words.length > 1 && GENERIC_PREFIXES.has(words[0]!.toUpperCase())) {
    words = words.slice(1);
  }
  return words;
}

/** Deriva um slug legível a partir do nome fantasia (ex.: "Carpe Diem" → CARPEDIEM). */
export function slugFromTradeName(tradeName: string, fallbackName?: string): string {
  const source = tradeName.trim() || fallbackName?.trim() || '';
  const words = tokenizeName(source);

  if (words.length === 0) {
    const fallbackWords = tokenizeName(fallbackName ?? '');
    if (fallbackWords.length === 0) return 'EMPRESA';
    words.push(...fallbackWords);
  }

  let slug: string;
  if (words.length === 1) {
    slug = words[0]!.toUpperCase();
  } else {
    slug = words
      .slice(0, 2)
      .join('')
      .toUpperCase();
  }

  slug = slug.replace(/[^A-Z0-9]/g, '').slice(0, MAX_CODE_LENGTH);

  if (slug.length < MIN_CODE_LENGTH) {
    const padded = tokenizeName(fallbackName ?? tradeName)
      .join('')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, MAX_CODE_LENGTH);
    slug = padded.length >= MIN_CODE_LENGTH ? padded : 'EMPRESA';
  }

  return slug.slice(0, MAX_CODE_LENGTH);
}

/**
 * Gera candidato a código de adesão com base no nome fantasia.
 * `attempt` 0 → TAGSA; 1 → TAGSA2; 2 → TAGSA3 …
 */
export function generateEnrollmentCode(tradeName: string, attempt = 0, fallbackName?: string): string {
  const base = slugFromTradeName(tradeName, fallbackName);
  const raw = attempt === 0 ? base : `${base}${attempt + 1}`;
  return canonicalEnrollmentCode(raw);
}

/** Variantes de busca para aceitar digitação com ou sem hífen/espaços. */
export function enrollmentCodeLookupKeys(raw: string): string[] {
  const loose = normalizeEnrollmentCode(raw);
  const canonical = canonicalEnrollmentCode(raw);
  const keys = new Set<string>();
  if (loose) keys.add(loose);
  if (canonical) keys.add(canonical);
  return [...keys];
}
