export type DefaultFunnelSeed = {
  slug: string;
  name: string;
  description: string;
  sortOrder: number;
  isDefault?: boolean;
  winAction?: 'none' | 'transfer_funnel' | 'convert';
  lossAction?: 'none' | 'transfer_funnel' | 'convert';
  stages: Array<{
    slug: string;
    name: string;
    sortOrder: number;
    outcome: 'pipeline' | 'won' | 'lost';
  }>;
};

export const DEFAULT_COMMERCIAL_FUNNELS: DefaultFunnelSeed[] = [
  {
    slug: 'vendas',
    name: 'Vendas',
    description: 'Captação e negociação de novos parceiros e empresas.',
    sortOrder: 1,
    isDefault: true,
    winAction: 'convert',
    lossAction: 'none',
    stages: [
      { slug: 'novo', name: 'Novos', sortOrder: 1, outcome: 'pipeline' },
      { slug: 'contato', name: 'Em contato', sortOrder: 2, outcome: 'pipeline' },
      { slug: 'qualificacao', name: 'Qualificação', sortOrder: 3, outcome: 'pipeline' },
      { slug: 'proposta', name: 'Proposta', sortOrder: 4, outcome: 'pipeline' },
      { slug: 'negociacao', name: 'Negociação', sortOrder: 5, outcome: 'pipeline' },
      { slug: 'ganho', name: 'Ganho', sortOrder: 6, outcome: 'won' },
      { slug: 'perdido', name: 'Perdido', sortOrder: 7, outcome: 'lost' },
    ],
  },
  {
    slug: 'pos-venda',
    name: 'Pós-venda',
    description: 'Acompanhamento após fechamento comercial.',
    sortOrder: 2,
    winAction: 'none',
    lossAction: 'none',
    stages: [
      { slug: 'onboarding', name: 'Onboarding', sortOrder: 1, outcome: 'pipeline' },
      { slug: 'implementacao', name: 'Implementação', sortOrder: 2, outcome: 'pipeline' },
      { slug: 'ativo', name: 'Cliente ativo', sortOrder: 3, outcome: 'won' },
      { slug: 'cancelado', name: 'Cancelado', sortOrder: 4, outcome: 'lost' },
    ],
  },
];

export function slugifyFunnel(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
