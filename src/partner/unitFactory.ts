import type { ApiStore, GymUnit, MonthlyPayout } from './types';
import { defaultPlanSpecsFromDomain } from './planSpecs';
import {
  defaultWeeklySchedule,
  formatOpenHoursSummary,
  normalizeWeeklySchedule,
  type UnitWeeklySchedule,
} from './weeklySchedule';

export function emptyMonthlyPayout(monthLabel: string): MonthlyPayout {
  return {
    monthLabel,
    dailyPassGross: 0,
    dailyPassNet: 0,
    connectRepasseTotal: 0,
    totalNet: 0,
    status: 'open',
    connectLines: [],
    recentDailySales: [],
  };
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 32);
}

export function generateUnitId(store: ApiStore, unitName: string, neighborhood: string): string {
  const netSlug = store.networkId.replace(/^net_/, '') || 'unit';
  const base = slugify(neighborhood || unitName) || 'nova';
  let id = `g_${netSlug}_${base}`;
  if (store.units.some((u) => u.id === id)) {
    id = `g_${netSlug}_${base}_${Date.now().toString(36).slice(-4)}`;
  }
  return id;
}

export type CreateUnitInput = {
  unitName: string;
  zip?: string;
  address?: string;
  number?: string;
  complement?: string;
  neighborhood: string;
  city: string;
  state?: string;
  weeklySchedule?: UnitWeeklySchedule;
  description?: string;
};

export function buildNewUnit(store: ApiStore, input: CreateUnitInput & { networkId: string }): GymUnit {
  const unitName = input.unitName.trim();
  const neighborhood = input.neighborhood.trim();
  const city = input.city.trim();
  const state = input.state?.trim().toUpperCase() ?? '';
  const weeklySchedule = normalizeWeeklySchedule(input.weeklySchedule);
  const id = generateUnitId(store, unitName, neighborhood);
  const modalities = ['Musculação', 'Funcional'];

  return {
    id,
    networkId: input.networkId,
    unitName,
    zip: input.zip?.replace(/\D/g, '') ?? '',
    address: input.address?.trim() ?? '',
    number: input.number?.trim() ?? '',
    complement: input.complement?.trim() ?? '',
    neighborhood,
    city,
    state,
    weeklySchedule,
    openHours: formatOpenHoursSummary(weeklySchedule),
    description:
      input.description?.trim() ||
      `${unitName} · configure fotos, modalidades e planos no portal ACAF Connect.`,
    modalities,
    dailyPassPrice: 44.9,
    dailyPassActive: false,
    dailyPassNotes: 'Ative a diária após revisar preço e modalidades.',
    dailyPassModalities: [...modalities],
    planSpecs: defaultPlanSpecsFromDomain(),
    heroPhotoDataUrl: null,
    galleryPhotoDataUrls: [],
    autoApproveCheckIn: true,
    modalitySlotTemplates: [],
    modalitySlotOverrides: [],
  };
}
