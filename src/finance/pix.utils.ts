import {
  formatCnpj,
  formatCpf,
  isValidCnpj,
  isValidCpf,
  normalizeCnpj,
  normalizeCpf,
} from '../users/person.utils';

export type PixKeyType = 'cpf' | 'cnpj' | 'email' | 'phone' | 'random';

export const PIX_KEY_TYPE_LABELS: Record<PixKeyType, string> = {
  cpf: 'CPF',
  cnpj: 'CNPJ',
  email: 'E-mail',
  phone: 'Celular',
  random: 'Chave aleatória',
};

const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizePixPhone(value: string): string {
  const trimmed = String(value ?? '').trim();
  if (trimmed.startsWith('+')) {
    return `+${trimmed.slice(1).replace(/\D/g, '')}`;
  }
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('55')) return `+${digits}`;
  return `+55${digits}`;
}

export function isValidPixPhone(value: string): boolean {
  const normalized = normalizePixPhone(value);
  if (!/^\+55\d{10,11}$/.test(normalized)) return false;
  const local = normalized.slice(3);
  if (local.length === 11) return local[2] === '9';
  return local.length === 10;
}

export function formatPixPhone(value: string): string {
  const normalized = normalizePixPhone(value);
  if (!normalized.startsWith('+55')) return value;
  const local = normalized.slice(3);
  if (local.length === 11) {
    return `+55 (${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  }
  if (local.length === 10) {
    return `+55 (${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  }
  return normalized;
}

export function normalizePixKey(type: PixKeyType, value: string): string {
  const trimmed = String(value ?? '').trim();
  switch (type) {
    case 'cpf':
      return normalizeCpf(trimmed);
    case 'cnpj':
      return normalizeCnpj(trimmed);
    case 'email':
      return trimmed.toLowerCase();
    case 'phone':
      return normalizePixPhone(trimmed);
    case 'random':
      return trimmed.toLowerCase();
    default:
      return trimmed;
  }
}

export function formatPixKey(type: PixKeyType, value: string): string {
  switch (type) {
    case 'cpf':
      return formatCpf(value);
    case 'cnpj':
      return formatCnpj(value);
    case 'email':
      return value;
    case 'phone':
      return formatPixPhone(value);
    case 'random':
      return value.toLowerCase();
    default:
      return value;
  }
}

export function validatePixKey(
  type: PixKeyType,
  value: string,
): { valid: boolean; message?: string; normalized?: string } {
  const normalized = normalizePixKey(type, value);
  if (!normalized) {
    return { valid: false, message: 'Informe a chave PIX.' };
  }

  switch (type) {
    case 'cpf':
      if (!isValidCpf(normalized)) {
        return { valid: false, message: 'CPF inválido para chave PIX.' };
      }
      break;
    case 'cnpj':
      if (!isValidCnpj(normalized)) {
        return { valid: false, message: 'CNPJ inválido para chave PIX.' };
      }
      break;
    case 'email':
      if (!EMAIL_RE.test(normalized) || normalized.length > 77) {
        return { valid: false, message: 'E-mail inválido para chave PIX.' };
      }
      break;
    case 'phone':
      if (!isValidPixPhone(normalized)) {
        return {
          valid: false,
          message: 'Telefone inválido. Use +55, DDD e número do celular.',
        };
      }
      break;
    case 'random':
      if (!UUID_RE.test(normalized)) {
        return { valid: false, message: 'Chave aleatória inválida.' };
      }
      break;
    default:
      return { valid: false, message: 'Tipo de chave PIX inválido.' };
  }

  return { valid: true, normalized };
}

export type PixKeyInput = {
  id?: string;
  type: PixKeyType;
  keyValue: string;
  label?: string | null;
  isPrimary?: boolean;
  active?: boolean;
};

export function normalizeSupplierDocument(value?: string | null): string | null {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return null;

  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 11) {
    if (!isValidCpf(digits)) throw new Error('CPF inválido.');
    return digits;
  }
  if (digits.length === 14) {
    if (!isValidCnpj(digits)) throw new Error('CNPJ inválido.');
    return digits;
  }
  throw new Error('Informe um CPF ou CNPJ válido.');
}

export function formatSupplierDocument(value?: string | null): string | null {
  if (!value) return null;
  if (value.length === 11) return formatCpf(value);
  if (value.length === 14) return formatCnpj(value);
  return value;
}

export function validatePixKeysInput(keys: PixKeyInput[]): PixKeyInput[] {
  const normalizedRows = keys.map((key) => {
    if (key.active === false) {
      return {
        ...key,
        isPrimary: false,
        label: key.label?.trim() || null,
      };
    }

    const result = validatePixKey(key.type, key.keyValue);
    if (!result.valid) {
      throw new Error(result.message ?? 'Chave PIX inválida.');
    }

    return {
      ...key,
      keyValue: result.normalized!,
      label: key.label?.trim() || null,
      active: true,
      isPrimary: Boolean(key.isPrimary),
    };
  });

  const activeRows = normalizedRows.filter((row) => row.active !== false);
  const seen = new Set<string>();
  for (const row of activeRows) {
    const signature = `${row.type}:${row.keyValue}`;
    if (seen.has(signature)) {
      throw new Error('Não repita a mesma chave PIX.');
    }
    seen.add(signature);
  }

  if (!activeRows.length) {
    return normalizedRows;
  }

  const primaryRows = activeRows.filter((row) => row.isPrimary);
  if (primaryRows.length > 1) {
    throw new Error('Selecione apenas uma chave PIX principal.');
  }

  for (const row of normalizedRows) {
    row.isPrimary = false;
  }

  const primary = primaryRows[0] ?? activeRows[0]!;
  primary.isPrimary = true;

  return normalizedRows;
}
