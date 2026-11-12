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

export type MarketingFieldType = 'text' | 'email' | 'tel' | 'textarea';

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
