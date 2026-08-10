import type { PendingCheckInRequest } from './pendingCheckIn';
import { dedupeCheckInLogByPersonPerDay, demoMemberCode } from './checkIn';
import {
  applyStudentStatsFromLog,
  dailyPassGrossForEntry,
  datesInMonthWithinRange,
  DEMO_TODAY,
  generateCheckInLog,
  generateModalityReservationsFromTemplates,
  generateTodayCheckIns,
} from './demoSeedGenerators';
import { withDemoCorporateFields } from '../corporate/demo-corporate-companies';
import type {
  ApiStore,
  CheckInLogEntry,
  ConnectPlanId,
  GymStudent,
  GymUnit,
  ModalitySlotTemplate,
  MonthlyPayout,
  UnitPlanSpec,
} from './types';

const FEE = 20;
const net = (g: number) => Math.round(g * 100 * (1 - FEE / 100)) / 100;

function clampDailyStudent(price: number): number {
  return Math.min(59, Math.max(19, price));
}
function dailySaleTotalGross(dailyPrice: number): number {
  return Math.round(clampDailyStudent(dailyPrice) * 100) / 100;
}

const PLAN_PRICE: Record<ConnectPlanId, number> = {
  'connect-start': 39.9,
  'connect-plus': 69.9,
  'connect-multi': 129.9,
  'connect-pro': 189.9,
  'connect-total': 299.9,
};

const BUYER_NAMES = [
  'Pedro Lima',
  'Marina Souza',
  'Ana Costa',
  'João Ferreira',
  'Camila Rocha',
  'Bruno Alves',
  'Juliana Prado',
  'Felipe Nunes',
  'Patricia Dias',
  'Rafael Torres',
  'Fernanda Oliveira',
  'Lucas Mendes',
  'Beatriz Almeida',
  'Gustavo Ribeiro',
  'Larissa Martins',
  'Diego Santana',
  'Carolina Duarte',
  'Thiago Barbosa',
  'Amanda Vieira',
  'Rodrigo Pires',
  'Letícia Moura',
  'Eduardo Campos',
  'Vanessa Lopes',
  'Henrique Azevedo',
  'Gabriela Freitas',
  'Matheus Cardoso',
  'Isabela Ramos',
  'Renato Cavalcanti',
  'Priscila Nogueira',
];

/** Nomes só de tráfego avulso no log — não usar em alunos cadastrados. */
const WALK_IN_ONLY_NAMES = new Set([
  'Visitante app',
  'Turista · diária',
  'Cliente avulso',
  'Aluno convidado',
  'Passante Connect',
  'Diária corporativa',
  'Convidado Connect',
]);

function planSpecsDefault(): UnitPlanSpec[] {
  return [
    { connectPlanId: 'connect-start', enabled: true, includedModalities: [], exactOnly: false },
    { connectPlanId: 'connect-plus', enabled: true, includedModalities: [], exactOnly: false },
    { connectPlanId: 'connect-multi', enabled: true, includedModalities: [], exactOnly: false },
    { connectPlanId: 'connect-pro', enabled: true, includedModalities: [], exactOnly: false },
    { connectPlanId: 'connect-total', enabled: false, includedModalities: [], exactOnly: false },
  ];
}

function demoPortaoScheduleSlots(): ModalitySlotTemplate[] {
  return [
    {
      id: 'mst-nat-seg',
      modality: 'Natação',
      instructorName: 'Ana Silva',
      dayOfWeek: 'mon',
      startTime: '07:00',
      endTime: '08:00',
      capacity: 10,
      active: true,
    },
    {
      id: 'mst-nat-ter',
      modality: 'Natação',
      instructorName: 'José Gomes',
      dayOfWeek: 'tue',
      startTime: '09:00',
      endTime: '10:00',
      capacity: 12,
      active: true,
    },
    {
      id: 'mst-nat-qua',
      modality: 'Natação',
      instructorName: 'Ana Silva',
      dayOfWeek: 'wed',
      startTime: '07:00',
      endTime: '08:00',
      capacity: 10,
      active: true,
    },
    {
      id: 'mst-hid-qui',
      modality: 'Hidroginástica',
      instructorName: 'Maria Costa',
      dayOfWeek: 'thu',
      startTime: '10:00',
      endTime: '11:00',
      capacity: 15,
      active: true,
    },
    {
      id: 'mst-nat-sex',
      modality: 'Natação',
      instructorName: 'Carlos Mendes',
      dayOfWeek: 'fri',
      startTime: '18:00',
      endTime: '19:00',
      capacity: 8,
      active: true,
    },
    {
      id: 'mst-func-sab',
      modality: 'Funcional',
      instructorName: 'Paulo Ribeiro',
      dayOfWeek: 'sat',
      startTime: '08:00',
      endTime: '09:00',
      capacity: 20,
      active: true,
    },
  ];
}

const PLATFORM_MODALITIES = [
  'Musculação',
  'Natação',
  'Bike Indoor',
  'Hidroginástica',
  'Boxe',
  'Pilates',
  'Hatha Yoga',
  'Full Body',
  'Funcional',
  'FitDance',
] as const;

function demoUnits(): GymUnit[] {
  const networkId = 'net_carpe';
  return [
    {
      id: 'g_carpe',
      networkId,
      unitName: 'Unidade Portão',
      neighborhood: 'Portão',
      city: 'Curitiba/PR',
      openHours: 'Seg–Sex 5h30–23h · Sáb 7h–14h',
      description:
        'Unidade de referência na região do Portão. Musculação, natação e aulas coletivas.',
      modalities: [...PLATFORM_MODALITIES],
      dailyPassPrice: 44.9,
      dailyPassActive: true,
      dailyPassNotes: 'Válida no dia da compra até o fechamento da unidade.',
      dailyPassModalities: ['Musculação', 'Funcional', 'Natação', 'Full Body'],
      planSpecs: planSpecsDefault(),
      heroPhotoDataUrl: null,
      galleryPhotoDataUrls: [],
      autoApproveCheckIn: true,
      latitude: -25.4716,
      longitude: -49.2908,
      modalitySlotTemplates: demoPortaoScheduleSlots(),
      modalitySlotOverrides: [],
    },
    {
      id: 'g_carpe_batel',
      networkId,
      unitName: 'Unidade Batel',
      neighborhood: 'Batel',
      city: 'Curitiba/PR',
      openHours: 'Seg–Sex 6h–22h · Sáb 8h–12h',
      description: 'Unidade Batel · musculação, pilates e aulas coletivas.',
      modalities: [
        'Musculação',
        'Funcional',
        'Pilates',
        'Bike Indoor',
        'Hatha Yoga',
        'Full Body',
        'FitDance',
      ],
      dailyPassPrice: 47.9,
      dailyPassActive: true,
      dailyPassNotes: 'Diária válida apenas na unidade Batel.',
      dailyPassModalities: ['Musculação', 'Funcional'],
      dailyPassPricingRules: [
        {
          id: 'dpr-batel-manha',
          label: 'Manhã tranquila',
          daysOfWeek: ['mon', 'tue', 'wed', 'thu', 'fri'],
          startTime: '10:00',
          endTime: '14:00',
          modalities: ['Musculação'],
          price: 24.9,
          active: true,
        },
      ],
      planSpecs: planSpecsDefault(),
      heroPhotoDataUrl: null,
      galleryPhotoDataUrls: [],
      autoApproveCheckIn: true,
      latitude: -25.4415,
      longitude: -49.2769,
    },
    {
      id: 'g_carpe_centro',
      networkId,
      unitName: 'Unidade Centro',
      neighborhood: 'Centro',
      city: 'Curitiba/PR',
      openHours: 'Seg–Sex 6h–22h',
      description: 'Unidade Centro · musculação, natação e hidroginástica.',
      modalities: ['Musculação', 'Funcional', 'Natação', 'Hidroginástica', 'Boxe'],
      dailyPassPrice: 42.9,
      dailyPassActive: true,
      dailyPassNotes: 'Diária válida na unidade Centro.',
      dailyPassModalities: ['Musculação', 'Funcional', 'Natação'],
      planSpecs: planSpecsDefault(),
      heroPhotoDataUrl: null,
      galleryPhotoDataUrls: [],
      autoApproveCheckIn: true,
      latitude: -25.4284,
      longitude: -49.2733,
    },
  ];
}

type MonthSpec = { key: string; label: string; year: number; month: number; scale: number };

const DEMO_MONTHS: MonthSpec[] = [
  { key: '2026-06', label: 'Junho 2026', year: 2026, month: 6, scale: 0.88 },
  { key: '2026-07', label: 'Julho 2026', year: 2026, month: 7, scale: 0.96 },
  { key: '2026-08', label: 'Agosto 2026', year: 2026, month: 8, scale: 1.05 },
];

type UnitPayoutProfile = {
  unitId: string;
  dailyPrice: number;
  lines: { plan: ConnectPlanId; members: number; checkIns: number }[];
  dailySalesCount: number;
};

const UNIT_PROFILES: UnitPayoutProfile[] = [
  {
    unitId: 'g_carpe',
    dailyPrice: 44.9,
    lines: [
      { plan: 'connect-plus', members: 18, checkIns: 186 },
      { plan: 'connect-multi', members: 12, checkIns: 248 },
      { plan: 'connect-start', members: 6, checkIns: 42 },
      { plan: 'connect-pro', members: 4, checkIns: 88 },
    ],
    dailySalesCount: 32,
  },
  {
    unitId: 'g_carpe_batel',
    dailyPrice: 47.9,
    lines: [
      { plan: 'connect-plus', members: 9, checkIns: 96 },
      { plan: 'connect-multi', members: 6, checkIns: 118 },
      { plan: 'connect-start', members: 3, checkIns: 24 },
    ],
    dailySalesCount: 22,
  },
  {
    unitId: 'g_carpe_centro',
    dailyPrice: 42.9,
    lines: [
      { plan: 'connect-plus', members: 6, checkIns: 68 },
      { plan: 'connect-start', members: 4, checkIns: 36 },
      { plan: 'connect-multi', members: 2, checkIns: 38 },
    ],
    dailySalesCount: 16,
  },
];

function buildMonthPayout(profile: UnitPayoutProfile, month: MonthSpec): MonthlyPayout {
  const scale = month.scale;
  const connectLines = profile.lines.map((l) => {
    const members = Math.max(1, Math.round(l.members * scale));
    const checkIns = Math.max(members, Math.round(l.checkIns * scale));
    const gross = members * PLAN_PRICE[l.plan];
    return {
      connectPlanId: l.plan,
      activeMembers: members,
      checkIns,
      repasseAmount: net(gross),
    };
  });
  const connectGross = profile.lines.reduce(
    (s, l) => s + Math.max(1, Math.round(l.members * scale)) * PLAN_PRICE[l.plan],
    0,
  );
  const connectRepasseTotal = net(connectGross);

  let status: MonthlyPayout['status'] = 'open';
  if (month.key === '2026-06' || month.key === '2026-07') status = 'paid';
  if (month.key === '2026-08') status = 'open';

  return {
    monthLabel: month.label,
    dailyPassGross: 0,
    dailyPassNet: 0,
    connectRepasseTotal,
    totalNet: connectRepasseTotal,
    status,
    paidAt: status === 'paid' ? `${month.year}-${String(month.month).padStart(2, '0')}-28` : undefined,
    connectLines,
    recentDailySales: [],
  };
}

function applyDailySalesFromLog(
  history: Record<string, MonthlyPayout[]>,
  log: CheckInLogEntry[],
): Record<string, MonthlyPayout[]> {
  const result: Record<string, MonthlyPayout[]> = {};
  for (const [unitId, months] of Object.entries(history)) {
    result[unitId] = months.map((month, index) => {
      const monthKey = DEMO_MONTHS[index]?.key;
      if (!monthKey) return month;

      const entries = log
        .filter(
          (e) =>
            e.unitId === unitId &&
            e.type === 'daily_pass' &&
            e.validatedAt.startsWith(monthKey),
        )
        .sort((a, b) => b.validatedAt.localeCompare(a.validatedAt));

      const recentDailySales = entries.map((entry, i) => {
        const gross = dailyPassGrossForEntry(entry);
        return {
          id: `${unitId}-${monthKey}-d${i}`,
          date: entry.validatedAt.slice(0, 10),
          studentName: entry.holderName,
          gross,
          feePercent: FEE,
          net: net(gross),
        };
      });

      const dailyPassGross =
        Math.round(recentDailySales.reduce((sum, row) => sum + row.gross, 0) * 100) / 100;
      const dailyPassNet = net(dailyPassGross);

      return {
        ...month,
        recentDailySales,
        dailyPassGross,
        dailyPassNet,
        totalNet: dailyPassNet + month.connectRepasseTotal,
      };
    });
  }
  return result;
}

export function buildPayoutHistoryByUnit(): Record<string, MonthlyPayout[]> {
  const history: Record<string, MonthlyPayout[]> = {};
  for (const profile of UNIT_PROFILES) {
    history[profile.unitId] = DEMO_MONTHS.map((m) => buildMonthPayout(profile, m));
  }
  return history;
}

export function buildCurrentPayoutsByUnit(
  history: Record<string, MonthlyPayout[]>,
): Record<string, MonthlyPayout> {
  const current: Record<string, MonthlyPayout> = {};
  for (const [unitId, months] of Object.entries(history)) {
    current[unitId] = months[months.length - 1]!;
  }
  return current;
}

const EXTRA_STUDENT_NAMES = [
  'Paulo Henrique',
  'Natália Reis',
  'Caio Borges',
  'Bianca Teixeira',
  'Vinícius Gomes',
  'Aline Castro',
  'Marcelo Farias',
  'Simone Araujo',
  'Otávio Melo',
  'Cristiane Peixoto',
  'Leandro Coelho',
  'Tatiane Moreira',
  'Fábio Correa',
  'Daniele Machado',
  'André Luiz',
  'Michele Xavier',
  'Ricardo Paiva',
  'Eliane Braga',
  'Sérgio Damasceno',
  'Monique Cunha',
  'Alexandre Pinto',
  'Raquel Figueiredo',
  'Daniel Souza',
  'Luana Brito',
  'Marcos Antunes',
  'Jéssica Lima',
  'William Costa',
  'Alessandra Rios',
];

const DAILY_PRICES: Record<string, number> = {
  g_carpe: 44.9,
  g_carpe_batel: 47.9,
  g_carpe_centro: 42.9,
};

function demoStudents(): GymStudent[] {
  const base: GymStudent[] = [
    {
      id: 's1',
      unitId: 'g_carpe',
      name: 'Marina Souza',
      email: 'marina.s@email.com',
      channel: 'connect_primary',
      connectPlanId: 'connect-multi',
      corporateBenefitPerMonth: 44.9,
      checkInsThisMonth: 0,
      lastVisit: DEMO_TODAY,
      dailyPassesThisMonth: 0,
    },
    {
      id: 's2',
      unitId: 'g_carpe',
      name: 'Pedro Lima',
      email: 'pedro.l@email.com',
      channel: 'daily_pass',
      dailyPassPricePaid: 44.9,
      checkInsThisMonth: 0,
      lastVisit: DEMO_TODAY,
      dailyPassesThisMonth: 0,
    },
    {
      id: 's3',
      unitId: 'g_carpe',
      name: 'Ana Beatriz Costa',
      email: 'ana.c@email.com',
      channel: 'connect_primary',
      connectPlanId: 'connect-plus',
      corporateBenefitPerMonth: 44.9,
      checkInsThisMonth: 0,
      lastVisit: '2026-07-31',
      dailyPassesThisMonth: 0,
    },
    {
      id: 's4',
      unitId: 'g_carpe',
      name: 'Lucas Mendes',
      email: 'lucas.m@email.com',
      channel: 'connect_primary',
      connectPlanId: 'connect-start',
      corporateBenefitPerMonth: 44.9,
      checkInsThisMonth: 0,
      lastVisit: '2026-07-28',
      dailyPassesThisMonth: 0,
    },
    {
      id: 's5',
      unitId: 'g_carpe',
      name: 'Fernanda Oliveira',
      email: 'fe.oliveira@email.com',
      channel: 'connect_primary',
      connectPlanId: 'connect-plus',
      corporateBenefitPerMonth: 44.9,
      checkInsThisMonth: 0,
      lastVisit: '2026-07-29',
      dailyPassesThisMonth: 0,
    },
    {
      id: 's13',
      unitId: 'g_carpe',
      name: 'Beatriz Almeida',
      email: 'bia.almeida@email.com',
      channel: 'connect_primary',
      connectPlanId: 'connect-multi',
      corporateBenefitPerMonth: 44.9,
      checkInsThisMonth: 0,
      lastVisit: '2026-07-25',
      dailyPassesThisMonth: 0,
    },
    {
      id: 's14',
      unitId: 'g_carpe',
      name: 'Gustavo Ribeiro',
      email: 'gustavo.r@email.com',
      channel: 'connect_primary',
      connectPlanId: 'connect-start',
      corporateBenefitPerMonth: 44.9,
      checkInsThisMonth: 0,
      lastVisit: '2026-07-22',
      dailyPassesThisMonth: 0,
    },
    {
      id: 's15',
      unitId: 'g_carpe',
      name: 'Larissa Martins',
      email: 'lari.m@email.com',
      channel: 'daily_pass',
      dailyPassPricePaid: 24.9,
      checkInsThisMonth: 0,
      lastVisit: '2026-07-24',
      dailyPassesThisMonth: 0,
    },
    {
      id: 's16',
      unitId: 'g_carpe',
      name: 'Diego Santana',
      email: 'diego.s@email.com',
      channel: 'connect_primary',
      connectPlanId: 'connect-pro',
      corporateBenefitPerMonth: 44.9,
      checkInsThisMonth: 0,
      lastVisit: '2026-07-30',
      dailyPassesThisMonth: 0,
    },
    {
      id: 's17',
      unitId: 'g_carpe',
      name: 'Carolina Duarte',
      email: 'carol.d@email.com',
      channel: 'connect_primary',
      connectPlanId: 'connect-plus',
      corporateBenefitPerMonth: 44.9,
      checkInsThisMonth: 0,
      lastVisit: '2026-07-27',
      dailyPassesThisMonth: 0,
    },
    {
      id: 's18',
      unitId: 'g_carpe',
      name: 'Thiago Barbosa',
      email: 'thiago.b@email.com',
      channel: 'daily_pass',
      dailyPassPricePaid: 44.9,
      checkInsThisMonth: 0,
      lastVisit: '2026-07-26',
      dailyPassesThisMonth: 0,
    },
    {
      id: 's6',
      unitId: 'g_carpe_batel',
      name: 'Rafael Torres',
      email: 'rafa.t@email.com',
      channel: 'connect_primary',
      connectPlanId: 'connect-plus',
      corporateBenefitPerMonth: 44.9,
      checkInsThisMonth: 0,
      lastVisit: '2026-07-31',
      dailyPassesThisMonth: 0,
    },
    {
      id: 's7',
      unitId: 'g_carpe_batel',
      name: 'Camila Rocha',
      email: 'camila.r@email.com',
      channel: 'connect_primary',
      connectPlanId: 'connect-multi',
      corporateBenefitPerMonth: 44.9,
      checkInsThisMonth: 0,
      lastVisit: DEMO_TODAY,
      dailyPassesThisMonth: 0,
    },
    {
      id: 's8',
      unitId: 'g_carpe_batel',
      name: 'Bruno Alves',
      email: 'bruno.a@email.com',
      channel: 'daily_pass',
      dailyPassPricePaid: 24.9,
      checkInsThisMonth: 0,
      lastVisit: '2026-07-28',
      dailyPassesThisMonth: 0,
    },
    {
      id: 's19',
      unitId: 'g_carpe_batel',
      name: 'Amanda Vieira',
      email: 'amanda.v@email.com',
      channel: 'connect_primary',
      connectPlanId: 'connect-plus',
      corporateBenefitPerMonth: 44.9,
      checkInsThisMonth: 0,
      lastVisit: '2026-07-29',
      dailyPassesThisMonth: 0,
    },
    {
      id: 's20',
      unitId: 'g_carpe_batel',
      name: 'Rodrigo Pires',
      email: 'rodrigo.p@email.com',
      channel: 'connect_primary',
      connectPlanId: 'connect-start',
      corporateBenefitPerMonth: 44.9,
      checkInsThisMonth: 0,
      lastVisit: '2026-07-23',
      dailyPassesThisMonth: 0,
    },
    {
      id: 's21',
      unitId: 'g_carpe_batel',
      name: 'Letícia Moura',
      email: 'let.m@email.com',
      channel: 'daily_pass',
      dailyPassPricePaid: 47.9,
      checkInsThisMonth: 0,
      lastVisit: '2026-07-21',
      dailyPassesThisMonth: 0,
    },
    {
      id: 's9',
      unitId: 'g_carpe_centro',
      name: 'Juliana Prado',
      email: 'ju.prado@email.com',
      channel: 'connect_primary',
      connectPlanId: 'connect-plus',
      corporateBenefitPerMonth: 44.9,
      checkInsThisMonth: 0,
      lastVisit: DEMO_TODAY,
      dailyPassesThisMonth: 0,
    },
    {
      id: 's10',
      unitId: 'g_carpe_centro',
      name: 'Felipe Nunes',
      email: 'felipe.n@email.com',
      channel: 'connect_primary',
      connectPlanId: 'connect-start',
      corporateBenefitPerMonth: 44.9,
      checkInsThisMonth: 0,
      lastVisit: '2026-07-27',
      dailyPassesThisMonth: 0,
    },
    {
      id: 's11',
      unitId: 'g_carpe',
      name: 'Patricia Dias',
      email: 'pat.dias@email.com',
      channel: 'daily_pass',
      dailyPassPricePaid: 44.9,
      checkInsThisMonth: 0,
      lastVisit: '2026-07-22',
      dailyPassesThisMonth: 0,
    },
    {
      id: 's12',
      unitId: 'g_carpe_centro',
      name: 'João Ferreira',
      email: 'joao.f@email.com',
      channel: 'daily_pass',
      dailyPassPricePaid: 42.9,
      checkInsThisMonth: 0,
      lastVisit: '2026-07-24',
      dailyPassesThisMonth: 0,
    },
    {
      id: 's22',
      unitId: 'g_carpe_centro',
      name: 'Eduardo Campos',
      email: 'edu.c@email.com',
      channel: 'connect_primary',
      connectPlanId: 'connect-multi',
      corporateBenefitPerMonth: 44.9,
      checkInsThisMonth: 0,
      lastVisit: '2026-07-30',
      dailyPassesThisMonth: 0,
    },
    {
      id: 's23',
      unitId: 'g_carpe_centro',
      name: 'Vanessa Lopes',
      email: 'vanessa.l@email.com',
      channel: 'daily_pass',
      dailyPassPricePaid: 42.9,
      checkInsThisMonth: 0,
      lastVisit: '2026-07-20',
      dailyPassesThisMonth: 0,
    },
    {
      id: 's24',
      unitId: 'g_carpe_centro',
      name: 'Henrique Azevedo',
      email: 'henrique.a@email.com',
      channel: 'connect_primary',
      connectPlanId: 'connect-plus',
      corporateBenefitPerMonth: 44.9,
      checkInsThisMonth: 0,
      lastVisit: '2026-07-26',
      dailyPassesThisMonth: 0,
    },
  ];

  const used = new Set(base.map((s) => s.name));
  const pool = [...BUYER_NAMES, ...EXTRA_STUDENT_NAMES].filter(
    (n) => !used.has(n) && !WALK_IN_ONLY_NAMES.has(n),
  );
  const unitTargets = [
    { unitId: 'g_carpe', extra: 8, dailyEvery: 4 },
    { unitId: 'g_carpe_batel', extra: 6, dailyEvery: 3 },
    { unitId: 'g_carpe_centro', extra: 6, dailyEvery: 3 },
  ] as const;

  let seq = 100;
  let poolIdx = 0;
  const extras: GymStudent[] = [];

  for (const target of unitTargets) {
    for (let i = 0; i < target.extra; i += 1) {
      const name = pool[poolIdx++] ?? `Aluno demo ${seq}`;
      const isDaily = i % target.dailyEvery === 0;
      const plan: ConnectPlanId =
        i % 7 === 0 ? 'connect-pro' : i % 3 === 0 ? 'connect-multi' : i % 2 === 0 ? 'connect-plus' : 'connect-start';

      extras.push({
        id: `s${seq++}`,
        unitId: target.unitId,
        name,
        email: `${name.split(' ')[0]!.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')}.${seq}@email.com`,
        channel: isDaily ? 'daily_pass' : 'connect_primary',
        connectPlanId: isDaily ? undefined : plan,
        corporateBenefitPerMonth: isDaily ? undefined : 44.9,
        dailyPassPricePaid: isDaily
          ? i % 2 === 0 && target.unitId === 'g_carpe_batel'
            ? 24.9
            : DAILY_PRICES[target.unitId]
          : undefined,
        checkInsThisMonth: 0,
        lastVisit: DEMO_TODAY,
        dailyPassesThisMonth: 0,
      });
    }
  }

  return [...base, ...extras].map((s) => withDemoCorporateFields(s));
}

export function demoPendingCheckIns(): PendingCheckInRequest[] {
  const base = `${DEMO_TODAY}T`;
  return [
    {
      id: 'pend-1',
      unitId: 'g_carpe',
      holderName: 'Felipe Nunes',
      code: demoMemberCode('g_carpe'),
      type: 'connect_member',
      requestedAt: `${base}14:02:00.000Z`,
      status: 'pending',
    },
    {
      id: 'pend-2',
      unitId: 'g_carpe',
      holderName: 'Visitante · diária',
      code: 'ACAF-MCK-DEMO-G_CARPE',
      type: 'daily_pass',
      requestedAt: `${base}14:08:00.000Z`,
      status: 'pending',
    },
    {
      id: 'pend-3',
      unitId: 'g_carpe_batel',
      holderName: 'Camila Rocha',
      code: demoMemberCode('g_carpe_batel'),
      type: 'connect_member',
      requestedAt: `${base}13:55:00.000Z`,
      status: 'pending',
    },
    {
      id: 'pend-4',
      unitId: 'g_carpe_centro',
      holderName: 'João Ferreira',
      code: demoMemberCode('g_carpe_centro'),
      type: 'connect_member',
      requestedAt: `${base}14:11:00.000Z`,
      status: 'pending',
    },
    {
      id: 'pend-5',
      unitId: 'g_carpe',
      holderName: 'Larissa Martins',
      code: 'ACAF-AUG1-LM-G_CARPE',
      type: 'daily_pass',
      requestedAt: `${base}15:20:00.000Z`,
      status: 'pending',
    },
  ];
}

export function buildDemoStore(): ApiStore {
  const baseStudents = demoStudents();
  const historicalLog = generateCheckInLog(baseStudents);
  const todayLog = generateTodayCheckIns(baseStudents);
  const todayKeys = new Set(todayLog.map((e) => `${e.holderName}|${e.unitId}`));
  const dedupedHistorical = historicalLog.filter(
    (e) => !e.validatedAt.startsWith(DEMO_TODAY) || !todayKeys.has(`${e.holderName}|${e.unitId}`),
  );
  const units = demoUnits();
  const checkInLog = dedupeCheckInLogByPersonPerDay(
    [...todayLog, ...dedupedHistorical].sort((a, b) =>
      b.validatedAt.localeCompare(a.validatedAt),
    ),
    units,
  );

  const payoutHistoryByUnit = applyDailySalesFromLog(buildPayoutHistoryByUnit(), checkInLog);
  const payoutsByUnit = buildCurrentPayoutsByUnit(payoutHistoryByUnit);
  const students = applyStudentStatsFromLog(baseStudents, checkInLog, '2026-08');
  const endOfDay = new Date(`${DEMO_TODAY}T23:59:59`);
  const portaoStudents = students.filter((s) => s.unitId === 'g_carpe').map((s) => s.name);
  const portaoUnit = demoUnits().find((u) => u.id === 'g_carpe')!;

  return {
    networkId: 'net_carpe',
    networkName: 'Carpe Diem Academia',
    networks: [{
      id: 'net_carpe',
      name: 'Carpe Diem Academia',
      logoUrl: null,
      social: {
        website: '',
        instagram: '',
        facebook: '',
        whatsapp: '',
        tiktok: '',
        youtube: '',
        linkedin: '',
      },
    }],
    activeUnitId: 'g_carpe',
    units: demoUnits(),
    students,
    payoutsByUnit,
    payoutHistoryByUnit,
    issuedCodes: [
      {
        code: 'ACAF-MCK-DEMO-G_CARPE',
        type: 'daily_pass',
        unitId: 'g_carpe',
        holderName: 'Pedro Lima (demo)',
        validUntil: endOfDay.toISOString(),
      },
    ],
    checkInLog,
    pendingCheckIns: demoPendingCheckIns(),
    modalityReservations: generateModalityReservationsFromTemplates(
      'g_carpe',
      portaoUnit.modalitySlotTemplates ?? demoPortaoScheduleSlots(),
      portaoStudents,
    ),
  };
}
