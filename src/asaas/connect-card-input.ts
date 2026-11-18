import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { isValidCpf } from '../users/person.utils';
import type { AsaasCreditCardHolderInfo, AsaasCreditCardInput } from './asaas.client';
import { isValidMobilePhone, normalizeMobilePhone } from '../users/person.utils';

const SANDBOX_DEFAULT_CPF = '24971563792';

export type ParsedConnectCardInput = {
  cardNumber: string;
  cvv: string;
  expiryMonth: string;
  expiryYear: string;
  holderName: string;
  brand: string;
  lastFour: string;
  creditCard: AsaasCreditCardInput;
};

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

export function normalizeExpiryYear(year: string): string {
  const d = digitsOnly(year);
  if (d.length === 2) return `20${d}`;
  return d;
}

export function isValidExpiry(month: string, year: string): boolean {
  const m = Number(month);
  const y = Number(year);
  if (!Number.isFinite(m) || m < 1 || m > 12) return false;
  if (!Number.isFinite(y) || y < 2000) return false;
  const now = new Date();
  const expires = new Date(y, m, 0, 23, 59, 59);
  return expires >= new Date(now.getFullYear(), now.getMonth(), 1);
}

export function inferCardBrand(cardNumber: string): string {
  if (cardNumber.startsWith('4')) return 'Visa';
  if (/^5[1-5]/.test(cardNumber) || /^2[2-7]/.test(cardNumber)) return 'Mastercard';
  if (cardNumber.startsWith('3')) return 'Amex';
  if (cardNumber.startsWith('6')) return 'Elo';
  return 'Cartão';
}

export function resolveConnectCheckoutCpf(raw: string | undefined, config: ConfigService): string {
  const digits = digitsOnly(raw ?? '');
  if (digits.length === 11) {
    if (!isValidCpf(digits)) {
      throw new BadRequestException('CPF do titular inválido.');
    }
    return digits;
  }
  if (digits.length === 14) {
    return digits;
  }
  const fallback = config.get<string>('ASAAS_CHECKOUT_DEFAULT_CPF')?.trim();
  const fbDigits = digitsOnly(fallback ?? '');
  if (fbDigits.length === 11 || fbDigits.length === 14) {
    return fbDigits;
  }
  const sandboxUrl = (config.get<string>('ASAAS_API_URL') ?? '').includes('sandbox');
  if (sandboxUrl || !config.get<string>('ASAAS_API_URL')) {
    return SANDBOX_DEFAULT_CPF;
  }
  throw new BadRequestException('Informe o CPF do titular para cobrança.');
}

export function parseConnectCardInput(input: {
  holderName: string;
  number: string;
  expiryMonth: string;
  expiryYear: string;
  cvv: string;
  brandHint?: string;
}): ParsedConnectCardInput {
  const cardNumber = digitsOnly(input.number);
  if (cardNumber.length < 13) {
    throw new BadRequestException('Número do cartão inválido.');
  }
  const cvv = digitsOnly(input.cvv);
  if (cvv.length < 3) {
    throw new BadRequestException('CVV inválido.');
  }

  const expiryMonth = input.expiryMonth.padStart(2, '0');
  const expiryYear = normalizeExpiryYear(input.expiryYear);
  if (!isValidExpiry(expiryMonth, expiryYear)) {
    throw new BadRequestException('Validade do cartão inválida.');
  }

  const holderName = input.holderName.trim();
  if (holderName.length < 3) {
    throw new BadRequestException('Informe o nome impresso no cartão.');
  }

  const brand = input.brandHint?.trim() || inferCardBrand(cardNumber);
  const creditCard: AsaasCreditCardInput = {
    holderName,
    number: cardNumber,
    expiryMonth,
    expiryYear,
    ccv: cvv,
  };

  return {
    cardNumber,
    cvv,
    expiryMonth,
    expiryYear,
    holderName,
    brand,
    lastFour: cardNumber.slice(-4),
    creditCard,
  };
}

export function buildCreditCardHolderInfo(input: {
  holderName: string;
  email: string;
  cpfCnpj: string;
  phone: string;
  config: ConfigService;
}): AsaasCreditCardHolderInfo {
  return {
    name: input.holderName,
    email: input.email,
    cpfCnpj: input.cpfCnpj,
    postalCode: input.config.get<string>('ASAAS_DEFAULT_POSTAL_CODE')?.trim() || '01310100',
    addressNumber: input.config.get<string>('ASAAS_DEFAULT_ADDRESS_NUMBER')?.trim() || '100',
    phone: input.phone,
    mobilePhone: input.phone,
  };
}

/** IP do pagador para o Asaas (não usar IP do servidor). */
export function resolveAsaasRemoteIp(config: ConfigService, clientIp?: string | null): string {
  const raw = clientIp?.trim();
  if (raw) {
    const first = raw.split(',')[0]?.trim();
    if (first && first !== '127.0.0.1' && first !== '::1' && first !== '::ffff:127.0.0.1') {
      return first.slice(0, 64);
    }
  }
  return config.get<string>('ASAAS_DEFAULT_REMOTE_IP')?.trim() || '203.0.113.10';
}

export function resolveHolderPhone(holderPhone: string | undefined, config: ConfigService): string {
  const fromInput = normalizeMobilePhone(holderPhone ?? '');
  if (isValidMobilePhone(fromInput)) {
    return fromInput;
  }
  const fromEnv = normalizeMobilePhone(config.get<string>('ASAAS_DEFAULT_CUSTOMER_PHONE') ?? '');
  if (isValidMobilePhone(fromEnv)) {
    return fromEnv;
  }
  throw new BadRequestException('Informe um celular válido com DDD (11 dígitos).');
}