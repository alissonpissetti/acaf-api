import type { Repository } from 'typeorm';
import { Company } from '../corporate/company.entity';
import type { ReceivablePayerKind } from '../finance/receivable-counterparty.types';
import { normalizeHolderKey } from '../partner/checkIn';
import { User, UserRole, userHasRole } from '../users/user.entity';
import { isPlatformUserUuid } from './connect-checkout-identity';
import { isValidCpf, normalizeCpf } from '../users/person.utils';

export type ConnectReceivablePayer = {
  kind: ReceivablePayerKind;
  refId: string;
  name: string;
};

function normalizeLookupToken(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function findCompanyByName(rows: Company[], companyName: string): Company | null {
  const needle = normalizeLookupToken(companyName);
  if (!needle) return null;
  return (
    rows.find((company) => {
      const tokens = [company.tradeName, company.legalName]
        .filter(Boolean)
        .map((name) => normalizeLookupToken(String(name)));
      return tokens.some((token) => token === needle || token.includes(needle) || needle.includes(token));
    }) ?? null
  );
}

export type ConnectReceivablePayerInput = {
  holderName: string;
  holderKey: string;
  companyName?: string | null;
  platformUserId?: string | null;
  cpf?: string | null;
  mobilePhone?: string | null;
};

export class ConnectPayerUnresolvedError extends Error {
  constructor(
    public readonly holderKey: string,
    message: string,
  ) {
    super(message);
    this.name = 'ConnectPayerUnresolvedError';
  }
}

function identityHintsPresent(input: ConnectReceivablePayerInput): boolean {
  const cpfDigits = input.cpf ? normalizeCpf(input.cpf) : '';
  if (cpfDigits && isValidCpf(cpfDigits)) return true;
  const hintedUserId = input.platformUserId?.trim();
  if (hintedUserId && isPlatformUserUuid(hintedUserId)) return true;
  const phone = input.mobilePhone?.replace(/\D/g, '') ?? '';
  if (phone.length >= 10) return true;
  return false;
}

async function resolveClientById(users: Repository<User>, userId: string): Promise<User | null> {
  const row = await users.findOne({ where: { id: userId, active: true } });
  if (!row || !userHasRole(row, UserRole.MEMBER)) return null;
  return row;
}

export async function resolveConnectReceivablePayer(
  users: Repository<User>,
  companies: Repository<Company>,
  input: ConnectReceivablePayerInput,
): Promise<ConnectReceivablePayer> {
  const holderName = input.holderName.trim();
  const holderKey = input.holderKey.trim().toLowerCase();
  if (!holderName || !holderKey) {
    throw new Error('Titular da assinatura inválido para vincular pagador.');
  }

  const companyName = input.companyName?.trim();
  if (companyName) {
    const companyRows = await companies.find({ order: { tradeName: 'ASC' } });
    const company = findCompanyByName(companyRows, companyName);
    if (company) {
      return {
        kind: 'company',
        refId: company.id,
        name: company.tradeName || company.legalName,
      };
    }
  }

  const hintedUserId = input.platformUserId?.trim();
  if (hintedUserId && isPlatformUserUuid(hintedUserId)) {
    const hinted = await resolveClientById(users, hintedUserId);
    if (hinted) {
      return { kind: 'client', refId: hinted.id, name: hinted.name };
    }
  }

  const cpfDigits = input.cpf ? normalizeCpf(input.cpf) : '';
  if (cpfDigits && isValidCpf(cpfDigits)) {
    const byCpf = await users.findOne({ where: { cpf: cpfDigits, active: true } });
    if (byCpf && userHasRole(byCpf, UserRole.MEMBER)) {
      return { kind: 'client', refId: byCpf.id, name: byCpf.name };
    }
  }

  const userRows = await users.find({ where: { active: true }, order: { name: 'ASC' } });
  const member = userRows.find(
    (user) => userHasRole(user, UserRole.MEMBER) && normalizeHolderKey(user.name) === holderKey,
  );
  if (member) {
    return { kind: 'client', refId: member.id, name: member.name };
  }

  if (isPlatformUserUuid(holderKey)) {
    const byKeyAsId = await resolveClientById(users, holderKey);
    if (byKeyAsId) {
      return { kind: 'client', refId: byKeyAsId.id, name: byKeyAsId.name };
    }
  }

  if (identityHintsPresent(input)) {
    throw new ConnectPayerUnresolvedError(
      holderKey,
      `Não foi possível vincular pagador da assinatura ao usuário da plataforma (titular=${holderName}, holderKey=${holderKey}).`,
    );
  }

  return { kind: 'client', refId: holderKey, name: holderName };
}

export function connectReceivablePlatformUserId(payer: ConnectReceivablePayer): string | null {
  if (payer.kind !== 'client') return null;
  return isPlatformUserUuid(payer.refId) ? payer.refId : null;
}
