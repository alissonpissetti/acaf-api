export const COMMERCIAL_LEAD_SOURCES = {
  public_site: {
    label: 'Site público',
    color: '#6d28d9',
    soft: 'rgba(109, 40, 217, 0.14)',
  },
  marketing_form: {
    label: 'Formulário marketing',
    color: '#0e7490',
    soft: 'rgba(14, 116, 144, 0.14)',
  },
  whatsapp: {
    label: 'WhatsApp',
    color: '#15803d',
    soft: 'rgba(21, 128, 61, 0.14)',
  },
  manual: {
    label: 'Cadastro manual',
    color: '#475569',
    soft: 'rgba(71, 85, 105, 0.12)',
  },
} as const;

export type CommercialLeadSource = keyof typeof COMMERCIAL_LEAD_SOURCES;

const SOURCE_KEYS = new Set<string>(Object.keys(COMMERCIAL_LEAD_SOURCES));

export function isCommercialLeadSource(value: string): value is CommercialLeadSource {
  return SOURCE_KEYS.has(value);
}

export function leadSourceMeta(source: CommercialLeadSource) {
  return COMMERCIAL_LEAD_SOURCES[source];
}

export function inferCommercialLeadSource(input: {
  stored?: string | null;
  notes?: string | null;
  latestInteraction?: string | null;
}): CommercialLeadSource {
  if (input.stored && isCommercialLeadSource(input.stored)) {
    return input.stored;
  }

  const haystack = `${input.latestInteraction ?? ''}\n${input.notes ?? ''}`.toLowerCase();

  if (haystack.includes('site público') || haystack.includes('site institucional')) {
    return 'public_site';
  }
  if (haystack.includes('formulário') || haystack.includes('formulario')) {
    return 'marketing_form';
  }
  if (haystack.includes('whatsapp') || haystack.includes('instância whatsapp')) {
    return 'whatsapp';
  }

  return 'manual';
}
