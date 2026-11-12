import { aggregatePayouts, type UnitScope } from './aggregatePayout';
import { recentCheckInsForPortal } from './checkInLog';
import type { PendingCheckInRequest } from './pendingCheckIn';
import { clampPlatformFeePercent } from './platformFeePolicy';
import { createEmptyStore } from './store-normalize';
import { getDomain } from './store';
import type { DayOfWeek, UnitWeeklySchedule } from './weeklySchedule';
import { sanitizeUnitPhotosForApi } from './photoUrls';
import type { AssociateImportSource } from './associate-meta';

/** Uma linha do histórico diário de vidas pagantes (associados) para faixas de repasse. */
export type AssociateRepasseDailySnapshot = {
  /** Data civil YYYY-MM-DD (America/Sao_Paulo) */
  date: string;
  payingLivesCount: number;
  instantaneousTierId: string;
  instantaneousRepassePercent: number;
};

/** Repasse vigente após regras de permanência no histórico. */
export type AssociateRepasseEffectiveState = {
  tierId: string;
  repassePercent: number;
  /** Primeiro dia civil em que vale este repasse (após regra de permanência). */
  sinceDate: string;
  updatedAt: string;
};

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
  | 'connect-max'
  | 'connect-prime'
  | 'connect-elite'
  | 'connect-signature'
  | 'connect-infinite';

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
  /** Metadados da planilha de associados ACAF (importação admin). */
  acafAssociate?: AcafAssociateMeta;
  /** Resumo da entidade `associations` (somente respostas admin). */
  associateAssociation?: { id: string; name: string; slug: string };
  /**
   * Override opcional (%): taxa sobre planos de assinatura para esta unidade.
   * Tem precedência sobre a rede e sobre o padrão global.
   */
  connectFeePercentOverride?: number | null;
  /**
   * Override opcional (%): taxa sobre diárias para esta unidade.
   * Tem precedência sobre a rede e sobre o padrão global.
   */
  dailyFeePercentOverride?: number | null;
};

/** Cadastro de academia associada (planilha NOVA ASSINATURA e futuras importações). */
export type AcafAssociateMeta = {
  /** FK opcional da entidade `associations` (agrupador comercial / portal). */
  associationId?: string;
  /** CNPJ só dígitos — chave de upsert na reimportação. */
  cnpj: string;
  legalName: string;
  /** Rótulo da coluna «Associação» na planilha (texto livre). */
  association: string;
  /** ISO date (YYYY-MM-DD). */
  signedAt: string;
  contactEmail: string;
  importSource: AssociateImportSource;
  importedAt: string;
  /** false = removido da planilha na última sincronização (some do catálogo app). */
  listed?: boolean;
  /** Valor bruto da coluna de status na planilha, quando existir. */
  spreadsheetStatusRaw?: string;
  /**
   * Normalizado a partir da planilha: linha marcada como remoção / cancelamento
   * → unidade permanece cadastrada, só inativa no catálogo (`listed: false`).
   */
  spreadsheetStatus?: 'active' | 'remocao';
  /** Demais colunas da planilha “NOVA ASSINATURA” para cobrança e cadastro. */
  contactPhone?: string;
  complement?: string;
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
    unitId?: string;
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
  /**
   * Override opcional (%): taxa sobre planos de assinatura para todas as unidades desta rede.
   * Se ausente, usa o padrão global (`connectFeePercent` em Configurações).
   */
  connectFeePercentOverride?: number | null;
  /**
   * Override opcional (%): taxa sobre diárias para todas as unidades desta rede.
   * Se ausente, usa o padrão global (`dailyFeePercent` em Configurações).
   */
  dailyFeePercentOverride?: number | null;
  /** Usuário admin/comercial que cadastrou a rede parceira. */
  commercialOwnerUserId?: string | null;
  /**
   * E-mail do responsável pelo parceiro (convite de onboarding).
   * Tem prioridade sobre o e-mail da planilha ACAF por unidade.
   */
  partnerContactEmail?: string | null;
  /**
   * Campo legado; CNPJ pertence à unidade (`acafAssociate.cnpj`), não à rede.
   * Mantido opcional para dados antigos — novas importações ACAF não preenchem.
   */
  cnpj?: string | null;
  /** Rede criada manualmente no admin (não pela importação ACAF). */
  createdFromAdmin?: boolean;
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
  /** Assinantes com plano registrados pelo app (titular → academia principal). */
  connectMembers?: ConnectMemberRecord[];
  /** Histórico de trocas de academia principal. */
  primaryGymChanges?: PrimaryGymChangeRecord[];
  /** Snapshots diários de vidas pagantes (associados) para faixas de repasse — auditável. */
  associateRepasseSnapshots?: AssociateRepasseDailySnapshot[];
  /** Repasse vigente após regras de permanência (90d para melhorar, 30d para reduzir). */
  associateRepasseEffective?: AssociateRepasseEffectiveState | null;
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

export type { UnitScope };

export type PortalPayload = {
  loggedIn: boolean;
  networkId: string;
  networkName: string;
  defaultConnectFeePercent: number;
  defaultDailyFeePercent: number;
  networkConnectFeePercentOverride: number | null;
  networkDailyFeePercentOverride: number | null;
  activeUnitId: string;
  unitScope: UnitScope;
  units: GymUnit[];
  students: GymStudent[];
  payout: MonthlyPayout;
  payoutsByUnit: Record<string, MonthlyPayout>;
  payoutHistoryByUnit: Record<string, MonthlyPayout[]>;
  checkInLog: CheckInLogEntry[];
};

export function portalFeeFieldsFromStore(store: ApiStore): Pick<
  PortalPayload,
  | 'defaultConnectFeePercent'
  | 'defaultDailyFeePercent'
  | 'networkConnectFeePercentOverride'
  | 'networkDailyFeePercentOverride'
> {
  const domain = getDomain() as { connectFeePercent?: number; dailyFeePercent?: number };
  const connect = clampPlatformFeePercent(domain.connectFeePercent ?? 20);
  const daily =
    domain.dailyFeePercent != null && Number.isFinite(domain.dailyFeePercent)
      ? clampPlatformFeePercent(domain.dailyFeePercent)
      : connect;
  const net = store.networks.find((n) => n.id === store.networkId);
  return {
    defaultConnectFeePercent: connect,
    defaultDailyFeePercent: daily,
    networkConnectFeePercentOverride:
      net?.connectFeePercentOverride != null && Number.isFinite(net.connectFeePercentOverride)
        ? clampPlatformFeePercent(net.connectFeePercentOverride)
        : null,
    networkDailyFeePercentOverride:
      net?.dailyFeePercentOverride != null && Number.isFinite(net.dailyFeePercentOverride)
        ? clampPlatformFeePercent(net.dailyFeePercentOverride)
        : null,
  };
}

export function portalPayloadFromStore(
  store: ApiStore,
  loggedIn: boolean,
  unitScope: UnitScope = 'single',
): PortalPayload {
  const payoutsByUnit = store.payoutsByUnit;
  const payoutHistoryByUnit = store.payoutHistoryByUnit ?? {};

  const feeFields = portalFeeFieldsFromStore(store);

  if (unitScope === 'all') {
    return {
      loggedIn,
      networkId: store.networkId,
      networkName: store.networkName,
      ...feeFields,
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
    ...feeFields,
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
