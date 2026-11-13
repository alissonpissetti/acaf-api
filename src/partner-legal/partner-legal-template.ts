import { getDomain, loadStore } from '../partner/store';
import type { AdminNetwork, GymUnit } from '../partner/types';
import { formatCnpj, formatCpf, normalizeCpf } from '../users/person.utils';
import type { PartnerLegalDocument } from './partner-legal-document.entity';
import {
  MOVLY_CONTRACTOR_CNPJ,
  MOVLY_CONTRACTOR_LEGAL_NAME,
  type PartnerLegalTemplateVariables,
} from './partner-legal-template.variables';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderPartnerLegalTemplate(
  contentHtml: string,
  variables: Partial<PartnerLegalTemplateVariables>,
): string {
  return contentHtml.replace(/\{\{(\w+)\}\}/g, (_, rawKey: string) => {
    const key = rawKey as keyof PartnerLegalTemplateVariables;
    const raw = variables[key];
    if (raw === undefined || raw === '') return '—';
    return escapeHtml(raw);
  });
}

function formatAddressLine(unit: GymUnit): string {
  const parts: string[] = [];
  if (unit.address) parts.push(unit.address);
  if (unit.number) parts.push(unit.number);
  if (unit.complement) parts.push(unit.complement);
  const line = parts.join(', ');
  const hood = unit.neighborhood ? ` — ${unit.neighborhood}` : '';
  return (line + hood).trim() || '—';
}

function resolveFeePercents(network: AdminNetwork): { connect: string; daily: string } {
  const domain = getDomain() as { connectFeePercent?: number; dailyFeePercent?: number };
  const connect = network.connectFeePercentOverride ?? domain.connectFeePercent ?? 20;
  const daily = network.dailyFeePercentOverride ?? domain.dailyFeePercent ?? connect;
  const formatPercent = (value: number): string => {
    const rounded = Math.round(value * 100) / 100;
    if (Number.isInteger(rounded)) return String(rounded);
    return rounded.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  };
  return {
    connect: formatPercent(Number(connect)),
    daily: formatPercent(Number(daily)),
  };
}

function pickPrimaryUnit(units: GymUnit[]): GymUnit | null {
  if (!units.length) return null;
  const withLegal = units.find((u) => u.acafAssociate?.legalName || u.acafAssociate?.cnpj);
  return withLegal ?? units[0];
}

export type BuildPartnerLegalContextInput = {
  networkId: string;
  partnerUser?: { name: string; email: string; cpf: string | null } | null;
  document?: PartnerLegalDocument | null;
  signature?: {
    signedName?: string;
    signedDocument?: string;
    signedAt?: Date;
  };
};

export function buildPartnerOnboardingLegalContext(
  input: BuildPartnerLegalContextInput,
): PartnerLegalTemplateVariables {
  const store = loadStore();
  const network = store.networks.find((n) => n.id === input.networkId.trim());
  const units = store.units.filter((u) => u.networkId === input.networkId.trim());
  const primary = pickPrimaryUnit(units);
  const associate = primary?.acafAssociate;

  const partnerLegalName =
    associate?.legalName?.trim() ||
    network?.name?.trim() ||
    primary?.unitName?.trim() ||
    '—';
  const partnerTradeName = network?.name?.trim() || primary?.unitName?.trim() || '—';

  const cnpjDigits =
    associate?.cnpj?.replace(/\D/g, '') || network?.cnpj?.replace(/\D/g, '') || '';
  const partnerCnpj = cnpjDigits ? formatCnpj(cnpjDigits) : '—';

  const fees = network ? resolveFeePercents(network) : { connect: '20', daily: '20' };

  const user = input.partnerUser;
  const responsibleCpf =
    user?.cpf && normalizeCpf(user.cpf).length >= 11 ? formatCpf(normalizeCpf(user.cpf)) : '—';

  const signedAt = input.signature?.signedAt;
  const signedAtLabel = signedAt
    ? signedAt.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
    : '—';

  const signedDocDigits = input.signature?.signedDocument
    ? normalizeCpf(input.signature.signedDocument)
    : '';
  const signedDocument =
    signedDocDigits.length >= 11 ? formatCpf(signedDocDigits) : input.signature?.signedDocument?.trim() || '—';

  const effectiveSource = input.document?.effectiveAt ?? input.document?.publishedAt;
  const effectiveAt = effectiveSource
    ? effectiveSource.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
    : '—';

  return {
    movlyLegalName: MOVLY_CONTRACTOR_LEGAL_NAME,
    movlyCnpj: MOVLY_CONTRACTOR_CNPJ,
    partnerLegalName,
    partnerTradeName,
    partnerCnpj,
    partnerAddress: primary ? formatAddressLine(primary) : '—',
    partnerCity: primary?.city?.trim() || '—',
    partnerState: primary?.state?.trim() || '—',
    partnerZip: primary?.zip?.trim() || '—',
    networkName: network?.name?.trim() || '—',
    networkId: network?.id?.trim() || input.networkId,
    primaryUnitName: primary?.unitName?.trim() || '—',
    responsibleName: user?.name?.trim() || '—',
    responsibleEmail: user?.email?.trim() || '—',
    responsibleCpf,
    connectFeePercent: fees.connect,
    dailyFeePercent: fees.daily,
    documentTitle: input.document?.title?.trim() || '—',
    documentVersion: input.document?.version != null ? String(input.document.version) : '—',
    effectiveAt,
    signedName: input.signature?.signedName?.trim() || '—',
    signedDocument,
    signedAt: signedAtLabel,
  };
}
