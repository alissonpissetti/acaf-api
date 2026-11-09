import type { AcafAssociateMeta } from './types';

/** Linha completa da planilha (associado ativo). */
export type ParsedAcafAssociateRowActive = {
  kind: 'active';
  rowNumber: number;
  association: string;
  signedAt: string;
  legalName: string;
  tradeName: string;
  cnpj: string;
  address: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  zip: string;
  contactEmail: string;
  contactPhone: string;
  complement?: string;
  spreadsheetStatusRaw?: string;
  spreadsheetStatus: 'active';
};

/** Linha só com CNPJ — marca unidade existente como fora do catálogo (não apaga cadastro). */
export type ParsedAcafAssociateRowRemoval = {
  kind: 'remocao';
  rowNumber: number;
  cnpj: string;
  spreadsheetStatusRaw?: string;
};

export type ParsedAcafAssociateRow = ParsedAcafAssociateRowActive | ParsedAcafAssociateRowRemoval;

export type ParseAcafSpreadsheetResult = {
  rows: ParsedAcafAssociateRow[];
  errors: { rowNumber: number; message: string }[];
};

type DraftKey =
  | 'association'
  | 'signedAt'
  | 'legalName'
  | 'tradeName'
  | 'cnpj'
  | 'address'
  | 'number'
  | 'complement'
  | 'neighborhood'
  | 'city'
  | 'state'
  | 'zip'
  | 'contactEmail'
  | 'contactPhone'
  | 'spreadsheetStatusRaw';

const HEADER_ALIASES: Record<string, DraftKey> = {
  associacao: 'association',
  'data assinatura': 'signedAt',
  'razao social': 'legalName',
  'nome fantasia': 'tradeName',
  cnpj: 'cnpj',
  endereco: 'address',
  numero: 'number',
  complemento: 'complement',
  bairro: 'neighborhood',
  cidade: 'city',
  estado: 'state',
  cep: 'zip',
  email: 'contactEmail',
  'e-mail': 'contactEmail',
  telefone: 'contactPhone',
  celular: 'contactPhone',
  phone: 'contactPhone',
  status: 'spreadsheetStatusRaw',
  situacao: 'spreadsheetStatusRaw',
};

const UF_BY_NAME: Record<string, string> = {
  acre: 'AC',
  alagoas: 'AL',
  amapa: 'AP',
  amazonas: 'AM',
  bahia: 'BA',
  ceara: 'CE',
  'distrito federal': 'DF',
  'espirito santo': 'ES',
  goias: 'GO',
  maranhao: 'MA',
  'mato grosso': 'MT',
  'mato grosso do sul': 'MS',
  'minas gerais': 'MG',
  para: 'PA',
  paraiba: 'PB',
  parana: 'PR',
  pernambuco: 'PE',
  piaui: 'PI',
  'rio de janeiro': 'RJ',
  'rio grande do norte': 'RN',
  'rio grande do sul': 'RS',
  rondonia: 'RO',
  roraima: 'RR',
  'santa catarina': 'SC',
  'sao paulo': 'SP',
  sergipe: 'SE',
  tocantins: 'TO',
};

function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

export function normalizeCnpjDigits(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

export function isValidCnpjDigits(digits: string): boolean {
  if (digits.length !== 14 || /^(\d)\1+$/.test(digits)) return false;
  const calc = (base: string, factors: number[]) => {
    const sum = factors.reduce((acc, factor, index) => acc + Number(base[index]) * factor, 0);
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
  };
  const d1 = calc(digits.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = calc(digits.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return digits.endsWith(`${d1}${d2}`);
}

export function normalizeBrazilianState(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const upper = raw.toUpperCase();
  if (/^[A-Z]{2}$/.test(upper)) return upper;
  const key = raw
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim();
  return UF_BY_NAME[key] ?? upper.slice(0, 2);
}

export function parseStreetAndNumber(addressLine: string): { address: string; number: string } {
  const line = addressLine.trim();
  if (!line) return { address: '', number: '' };
  const match = line.match(/^(.+?),\s*(\d[\d\s./-]*)$/);
  if (match) {
    return { address: match[1].trim(), number: match[2].trim() };
  }
  return { address: line, number: '' };
}

export function parseSignedAt(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const text = String(value ?? '').trim();
  if (!text) return '';
  const br = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (br) {
    const day = br[1].padStart(2, '0');
    const month = br[2].padStart(2, '0');
    return `${br[3]}-${month}-${day}`;
  }
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return '';
}

function cellText(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

function rowIsEmpty(cells: unknown[]): boolean {
  return cells.every((cell) => !cellText(cell));
}

function normalizePhoneDigits(value: string): string {
  return value.replace(/\D/g, '').slice(0, 11);
}

/** Status na planilha: remoção / cancelamento → só inativa no app, mantém cadastro. */
function interpretSpreadsheetStatus(raw: string): {
  raw: string;
  normalized: 'active' | 'remocao';
} {
  const t = raw.trim();
  if (!t) return { raw: '', normalized: 'active' };
  const key = t
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim();
  const removal =
    /^(remov|cancel|deslig|exclu|inativ)/.test(key) ||
    key.includes('remocao') ||
    key.includes('remoção') ||
    key.includes('cancelamento') ||
    /\binativ/i.test(raw);
  return { raw: t, normalized: removal ? 'remocao' : 'active' };
}

export function parseAcafAssociateSheetRows(matrix: unknown[][]): ParseAcafSpreadsheetResult {
  const errors: ParseAcafSpreadsheetResult['errors'] = [];
  const rows: ParsedAcafAssociateRow[] = [];

  if (!matrix.length) {
    return { rows, errors: [{ rowNumber: 1, message: 'Planilha vazia.' }] };
  }

  const headerRow = matrix[0] ?? [];
  const columnKeys = headerRow.map((header) => {
    const normalized = normalizeHeader(header);
    return HEADER_ALIASES[normalized] ?? null;
  });

  if (!columnKeys.includes('cnpj')) {
    return {
      rows,
      errors: [{ rowNumber: 1, message: 'Coluna CNPJ não encontrada na planilha.' }],
    };
  }

  const seenCnpj = new Set<string>();

  for (let index = 1; index < matrix.length; index += 1) {
    const cells = matrix[index] ?? [];
    if (rowIsEmpty(cells)) continue;

    const rowNumber = index + 1;
    const draft: Partial<Record<DraftKey, string>> = {};

    columnKeys.forEach((key, colIndex) => {
      if (!key) return;
      draft[key] = cellText(cells[colIndex]);
    });

    const cnpj = normalizeCnpjDigits(draft.cnpj);
    if (!cnpj) {
      errors.push({ rowNumber, message: 'CNPJ ausente.' });
      continue;
    }
    if (!isValidCnpjDigits(cnpj)) {
      errors.push({ rowNumber, message: `CNPJ inválido (${draft.cnpj ?? ''}).` });
      continue;
    }
    if (seenCnpj.has(cnpj)) {
      errors.push({ rowNumber, message: `CNPJ duplicado na planilha (${cnpj}).` });
      continue;
    }
    seenCnpj.add(cnpj);

    const statusCell = draft.spreadsheetStatusRaw?.trim() ?? '';
    const statusInfo = interpretSpreadsheetStatus(statusCell);

    if (statusInfo.normalized === 'remocao') {
      rows.push({
        kind: 'remocao',
        rowNumber,
        cnpj,
        spreadsheetStatusRaw: statusInfo.raw || statusCell || undefined,
      });
      continue;
    }

    const tradeName = draft.tradeName?.trim() || draft.legalName?.trim();
    if (!tradeName) {
      errors.push({ rowNumber, message: 'Informe nome fantasia ou razão social.' });
      continue;
    }

    const neighborhood = draft.neighborhood?.trim();
    const city = draft.city?.trim();
    if (!neighborhood || !city) {
      errors.push({ rowNumber, message: 'Bairro e cidade são obrigatórios.' });
      continue;
    }

    const zip = normalizeCnpjDigits(draft.zip);
    if (zip.length !== 8) {
      errors.push({ rowNumber, message: 'CEP inválido (informe 8 dígitos).' });
      continue;
    }

    let address = (draft.address ?? '').trim();
    let number = (draft.number ?? '').trim();
    if (!number && address) {
      const parsed = parseStreetAndNumber(address);
      address = parsed.address;
      number = parsed.number;
    }
    if (!address) {
      errors.push({ rowNumber, message: 'Endereço ausente.' });
      continue;
    }

    const signedAt = parseSignedAt(draft.signedAt);
    if (!signedAt) {
      errors.push({ rowNumber, message: 'Data de assinatura inválida.' });
      continue;
    }

    const contactPhone = normalizePhoneDigits(draft.contactPhone ?? '');

    rows.push({
      kind: 'active',
      rowNumber,
      association: draft.association?.trim() || 'movly.',
      signedAt,
      legalName: draft.legalName?.trim() || tradeName,
      tradeName,
      cnpj,
      address,
      number,
      neighborhood,
      city,
      state: normalizeBrazilianState(draft.state),
      zip,
      contactEmail: draft.contactEmail?.trim().toLowerCase() ?? '',
      contactPhone,
      complement: draft.complement?.trim() || undefined,
      spreadsheetStatusRaw: statusInfo.raw || undefined,
      spreadsheetStatus: 'active',
    });
  }

  return { rows, errors };
}

export function buildAcafAssociateMeta(
  row: ParsedAcafAssociateRowActive,
  importedAt: string,
  listed: boolean,
): AcafAssociateMeta {
  return {
    cnpj: row.cnpj,
    legalName: row.legalName,
    association: row.association,
    signedAt: row.signedAt,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone || undefined,
    complement: row.complement,
    spreadsheetStatusRaw: row.spreadsheetStatusRaw,
    spreadsheetStatus: row.spreadsheetStatus,
    importSource: 'acaf_associates_xlsx',
    importedAt,
    listed,
  };
}
