/** Empresas do cenário demo — espelhadas no store de alunos e no seed corporativo. */
export type DemoCorporateCompanyDef = {
  slug: string;
  legalName: string;
  tradeName: string;
  cnpj: string;
  email: string;
  phone: string;
  status: 'active' | 'pending' | 'suspended';
};

export const DEMO_CORPORATE_COMPANIES: DemoCorporateCompanyDef[] = [
  {
    slug: 'corp_tagsa',
    legalName: 'Tagsa Tecnologia Ltda',
    tradeName: 'Tagsa Tecnologia',
    cnpj: '11222333000181',
    email: 'rh@tagsa.com.br',
    phone: '1130304040',
    status: 'active',
  },
  {
    slug: 'corp_nexus',
    legalName: 'Nexus Logística S.A.',
    tradeName: 'Nexus Logística',
    cnpj: '22333444000192',
    email: 'beneficios@nexuslog.com.br',
    phone: '1140405050',
    status: 'active',
  },
  {
    slug: 'corp_verde',
    legalName: 'Verde Saúde Corporativo Ltda',
    tradeName: 'Verde Saúde Corp',
    cnpj: '33444555000103',
    email: 'rh@verdesaude.com.br',
    phone: '1150506060',
    status: 'active',
  },
  {
    slug: 'corp_inovare',
    legalName: 'Inovare Soluções Empresariais Ltda',
    tradeName: 'Inovare Soluções',
    cnpj: '44555666000114',
    email: 'people@inovare.com.br',
    phone: '1160607070',
    status: 'active',
  },
];

function hashString(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) {
    h = (h * 31 + value.charCodeAt(i)) >>> 0;
  }
  return h;
}

export function demoCompanyForEmail(email: string): {
  companySlug: string;
  companyName: string;
} {
  const normalized = email.trim().toLowerCase();
  const idx = hashString(normalized) % DEMO_CORPORATE_COMPANIES.length;
  const company = DEMO_CORPORATE_COMPANIES[idx]!;
  return { companySlug: company.slug, companyName: company.tradeName };
}

export function demoCompanyBySlug(slug: string): DemoCorporateCompanyDef | undefined {
  return DEMO_CORPORATE_COMPANIES.find((c) => c.slug === slug);
}

/** Códigos de adesão do app associado → slug demo corporativo. */
export const APP_ENROLLMENT_CODE_TO_SLUG: Record<string, string> = {
  'ACAF-2026': 'corp_tagsa',
  'RH-CURITIBA': 'corp_nexus',
  'WELLNESS-01': 'corp_verde',
};

export function normalizeEnrollmentCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s/g, '');
}

export function demoCompanyForEnrollmentCode(code: string): DemoCorporateCompanyDef | undefined {
  const normalized = normalizeEnrollmentCode(code);
  const slug = APP_ENROLLMENT_CODE_TO_SLUG[normalized];
  if (!slug) return undefined;
  return demoCompanyBySlug(slug);
}

export function withDemoCorporateFields<T extends { email: string }>(
  student: T,
): T & { companySlug: string; companyName: string } {
  const { companySlug, companyName } = demoCompanyForEmail(student.email);
  return { ...student, companySlug, companyName };
}
