import type { DayOfWeek, UnitWeeklySchedule } from './weeklySchedule';
import { sanitizeUnitPhotosForApi } from './photoUrls';

export type ModalitySlotTemplate = {
  id: string;
  modality: string;
  instructorName?: string;
  dayOfWeek: DayOfWeek;
  startTime: string;
  endTime: string;
  capacity: number;
  active: boolean;
};

export type ModalitySlotOverride = {
  id: string;
  date: string;
  kind: 'cancel' | 'extra' | 'patch';
  slotTemplateId?: string;
  modality: string;
  instructorName?: string;
  startTime: string;
  endTime: string;
  capacity?: number;
};

export type ModalityReservationStatus = 'confirmed' | 'cancelled' | 'checked_in';

export type ModalityReservation = {
  id: string;
  unitId: string;
  occurrenceDate: string;
  slotTemplateId?: string;
  overrideId?: string;
  modality: string;
  instructorName?: string;
  startTime: string;
  endTime: string;
  holderName: string;
  holderUserId?: string;
  status: ModalityReservationStatus;
  reservedAt: string;
};

export type ConnectPlanId =
  | 'connect-start'
  | 'connect-plus'
  | 'connect-multi'
  | 'connect-pro'
  | 'connect-total';

export type UnitPlanSpec = {
  connectPlanId: ConnectPlanId;
  enabled: boolean;
  includedModalities: string[];
  exactOnly: boolean;
};

export type DailyPassPricingRule = {
  id: string;
  label?: string;
  daysOfWeek: DayOfWeek[];
  startTime: string;
  endTime: string;
  modalities: string[];
  price: number;
  active: boolean;
};

export type DailyPassOfferKind = 'full_day' | 'window';

export type DailyPassOffer = {
  id: string;
  kind: DailyPassOfferKind;
  label: string;
  startTime: string | null;
  endTime: string | null;
  modalities: string[];
  price: number;
  pricingRuleId?: string | null;
};

export type GymUnit = {
  id: string;
  networkId: string;
  unitName: string;
  zip?: string;
  address?: string;
  number?: string;
  complement?: string;
  neighborhood: string;
  city: string;
  state?: string;
  openHours: string;
  weeklySchedule?: UnitWeeklySchedule;
  description: string;
  modalities: string[];
  dailyPassPrice: number;
  dailyPassActive: boolean;
  dailyPassNotes: string;
  dailyPassModalities: string[];
  dailyPassPricingRules?: DailyPassPricingRule[];
  planSpecs: UnitPlanSpec[];
  heroPhotoDataUrl: string | null;
  galleryPhotoDataUrls: string[];
  /** Libera check-ins solicitados pelo app sem confirmação manual na recepção. */
  autoApproveCheckIn?: boolean;
  /** Coordenadas da unidade para check-in automático por geolocalização. */
  latitude?: number;
  longitude?: number;
  modalitySlotTemplates?: ModalitySlotTemplate[];
  modalitySlotOverrides?: ModalitySlotOverride[];
  /** Professores cadastrados na unidade (combo da programação). */
  instructors?: string[];
};

export type StudentChannel = 'daily_pass' | 'connect_primary';

export type GymStudent = {
  id: string;
  userId?: string;
  unitId: string;
  name: string;
  email: string;
  cpf?: string;
  channel: StudentChannel;
  connectPlanId?: ConnectPlanId;
  corporateBenefitPerMonth?: number;
  /** Slug estável da empresa empregadora. */
  companySlug?: string;
  /** Nome fantasia da empresa empregadora. */
  companyName?: string;
  checkInsThisMonth: number;
  lastVisit: string;
  dailyPassesThisMonth: number;
  dailyPassPricePaid?: number;
};

export type IssuedCheckInCode = {
  code: string;
  type: 'daily_pass' | 'connect_member';
  unitId: string;
  holderName: string;
  validUntil: string;
  pricingRuleId?: string | null;
  allowedModalities?: string[];
  validWindowStart?: string;
  validWindowEnd?: string;
  pricePaid?: number;
  occurrenceDate?: string;
};

export type CheckInLogEntry = {
  id: string;
  unitId: string;
  code: string;
  type: 'daily_pass' | 'connect_member';
  holderName: string;
  validatedAt: string;
  receptionNote?: string;
};

export type MonthlyPayout = {
  monthLabel: string;
  dailyPassGross: number;
  dailyPassNet: number;
  connectRepasseTotal: number;
  totalNet: number;
  status: 'open' | 'processing' | 'paid';
  paidAt?: string;
  connectLines: {
    connectPlanId: ConnectPlanId;
    activeMembers: number;
    checkIns: number;
    repasseAmount: number;
  }[];
  recentDailySales: {
    id: string;
    date: string;
    studentName: string;
    gross: number;
    feePercent: number;
    net: number;
  }[];
};

export type NetworkSocialContacts = {
  website: string;
  instagram: string;
  facebook: string;
  whatsapp: string;
  tiktok: string;
  youtube: string;
  linkedin: string;
};

export function emptyNetworkSocialContacts(): NetworkSocialContacts {
  return {
    website: '',
    instagram: '',
    facebook: '',
    whatsapp: '',
    tiktok: '',
    youtube: '',
    linkedin: '',
  };
}

export type AdminNetwork = {
  id: string;
  name: string;
  logoUrl?: string | null;
  social?: NetworkSocialContacts;
  /** Usuário admin/comercial que cadastrou a rede parceira. */
  commercialOwnerUserId?: string | null;
};

export type ApiStore = {
  networkId: string;
  networkName: string;
  networks: AdminNetwork[];
  activeUnitId: string;
  units: GymUnit[];
  students: GymStudent[];
  payoutsByUnit: Record<string, MonthlyPayout>;
  /** Últimos meses por unidade (mais antigo → mais recente). */
  payoutHistoryByUnit: Record<string, MonthlyPayout[]>;
  issuedCodes: IssuedCheckInCode[];
  checkInLog: CheckInLogEntry[];
  pendingCheckIns: PendingCheckInRequest[];
  modalityReservations?: ModalityReservation[];
  /** Assinantes Connect registrados pelo app (titular → academia principal). */
  connectMembers?: ConnectMemberRecord[];
  /** Histórico de trocas de academia principal. */
  primaryGymChanges?: PrimaryGymChangeRecord[];
};

export type ConnectMemberRecord = {
  holderKey: string;
  holderName: string;
  connectPlanId: ConnectPlanId;
  active: boolean;
  since: string;
  primaryUnitId: string | null;
  primaryUnitName: string | null;
  primaryChosenAt: string | null;
  primaryFirstCheckInAt: string | null;
  primaryCheckInsSinceFirst: number;
  companyName?: string;
};

export type PrimaryGymChangeRecord = {
  id: string;
  holderKey: string;
  fromUnitId: string | null;
  fromUnitName: string | null;
  toUnitId: string;
  toUnitName: string;
  changedAt: string;
};

import { aggregatePayouts, type UnitScope } from './aggregatePayout';
import { recentCheckInsForPortal } from './checkInLog';
import type { PendingCheckInRequest } from './pendingCheckIn';
import { createEmptyStore } from './store-normalize';

export type { UnitScope };

export type PortalPayload = {
  loggedIn: boolean;
  networkId: string;
  networkName: string;
  activeUnitId: string;
  unitScope: UnitScope;
  units: GymUnit[];
  students: GymStudent[];
  payout: MonthlyPayout;
  payoutsByUnit: Record<string, MonthlyPayout>;
  payoutHistoryByUnit: Record<string, MonthlyPayout[]>;
  checkInLog: CheckInLogEntry[];
};

export function portalPayloadFromStore(
  store: ApiStore,
  loggedIn: boolean,
  unitScope: UnitScope = 'single',
): PortalPayload {
  const payoutsByUnit = store.payoutsByUnit;
  const payoutHistoryByUnit = store.payoutHistoryByUnit ?? {};

  if (unitScope === 'all') {
    return {
      loggedIn,
      networkId: store.networkId,
      networkName: store.networkName,
      activeUnitId: store.activeUnitId,
      unitScope: 'all',
      units: store.units.map(sanitizeUnitPhotosForApi),
      students: store.students,
      payout: aggregatePayouts(payoutsByUnit),
      payoutsByUnit,
      payoutHistoryByUnit,
      checkInLog: recentCheckInsForPortal(store.checkInLog, undefined, 80, store.units),
    };
  }

  const payout =
    payoutsByUnit[store.activeUnitId] ??
    Object.values(payoutsByUnit)[0] ??
    aggregatePayouts(payoutsByUnit);
  const students = store.students.filter((s) => s.unitId === store.activeUnitId);
  const checkInLog = recentCheckInsForPortal(store.checkInLog, store.activeUnitId, 50, store.units);

  return {
    loggedIn,
    networkId: store.networkId,
    networkName: store.networkName,
    activeUnitId: store.activeUnitId,
    unitScope: 'single',
    units: store.units.map(sanitizeUnitPhotosForApi),
    students,
    payout,
    payoutsByUnit,
    payoutHistoryByUnit,
    checkInLog,
  };
}
