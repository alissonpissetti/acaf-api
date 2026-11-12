export type MarketingPlatform =
  | 'instagram'
  | 'facebook'
  | 'linkedin'
  | 'tiktok'
  | 'google'
  | 'youtube'
  | 'other';

export type MarketingCampaignStatus = 'draft' | 'active' | 'paused' | 'finished';

export type MarketingCreativeFormat =
  | 'image'
  | 'video'
  | 'carousel'
  | 'story'
  | 'reels'
  | 'search'
  | 'other';

export type MarketingFieldType = 'text' | 'email' | 'tel' | 'textarea' | 'select';

export type MarketingFieldSelectOption = {
  label: string;
  value: string;
};

const MARKETING_FIELD_TYPES: MarketingFieldType[] = ['text', 'email', 'tel', 'textarea', 'select'];

export function isMarketingFieldType(value: unknown): value is MarketingFieldType {
  return typeof value === 'string' && MARKETING_FIELD_TYPES.includes(value as MarketingFieldType);
}

export function slugifyMarketingOptionValue(label: string, index: number): string {
  const base = label
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return base || `opcao_${index + 1}`;
}

export function normalizeMarketingSelectOptions(
  options: MarketingFieldSelectOption[] | undefined,
): MarketingFieldSelectOption[] {
  if (!options?.length) return [];
  const used = new Set<string>();
  const normalized: MarketingFieldSelectOption[] = [];
  options.forEach((option, index) => {
    const label = String(option?.label ?? '').trim();
    if (!label) return;
    let value = String(option?.value ?? '').trim();
    if (!value) value = slugifyMarketingOptionValue(label, index);
    let unique = value;
    let suffix = 2;
    while (used.has(unique)) {
      unique = `${value}_${suffix}`;
      suffix += 1;
    }
    used.add(unique);
    normalized.push({ label, value: unique });
  });
  return normalized;
}

export type MarketingFieldKind = 'field' | 'section';

export type MarketingFieldMapTo =
  | 'title'
  | 'contactName'
  | 'email'
  | 'phone'
  | 'legalName'
  | 'cnpj'
  | 'notes';

export type MarketingLandingField = {
  key: string;
  label: string;
  kind?: MarketingFieldKind;
  type?: MarketingFieldType;
  required?: boolean;
  placeholder?: string;
  description?: string;
  sectionStyle?: 'default' | 'highlight';
  mapTo?: MarketingFieldMapTo;
  /** Opções para campos do tipo `select`. */
  options?: MarketingFieldSelectOption[];
};

export const MARKETING_APP_DEFAULT_FONT = 'app-default';

export type MarketingLandingTheme = {
  backgroundType?: 'solid' | 'gradient' | 'image';
  backgroundColor?: string;
  backgroundGradient?: string;
  backgroundImageUrl?: string | null;
  cardColor?: string;
  cardTextColor?: string;
  /** `app-default` = Figtree do movimento (storage público). */
  fontFamily?: string;
  buttonColor?: string;
  buttonTextColor?: string;
  buttonStyle?: 'rounded' | 'pill' | 'square';
  hideHeadline?: boolean;
  hideDescription?: boolean;
};

export const DEFAULT_MARKETING_THEME: MarketingLandingTheme = {
  backgroundType: 'solid',
  backgroundColor: '#eef0f4',
  cardColor: '#ffffff',
  cardTextColor: '#1c1c1e',
  fontFamily: MARKETING_APP_DEFAULT_FONT,
  buttonColor: '#0f766e',
  buttonTextColor: '#ffffff',
  buttonStyle: 'rounded',
  hideHeadline: false,
  hideDescription: false,
};

export const DEFAULT_LANDING_FIELDS: MarketingLandingField[] = [
  {
    key: 'name',
    label: 'Nome',
    type: 'text',
    required: true,
    mapTo: 'contactName',
  },
  {
    key: 'email',
    label: 'E-mail',
    type: 'email',
    required: true,
    mapTo: 'email',
  },
  {
    key: 'phone',
    label: 'Telefone',
    type: 'tel',
    required: false,
    mapTo: 'phone',
  },
  {
    key: 'company',
    label: 'Empresa / academia',
    type: 'text',
    required: false,
    mapTo: 'title',
  },
  {
    key: 'message',
    label: 'Mensagem',
    type: 'textarea',
    required: false,
    mapTo: 'notes',
  },
];

export function slugifyMarketing(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
