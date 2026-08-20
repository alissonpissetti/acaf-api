export type SeedModuleItem = {
  slug: string;
  label: string;
  route: string;
  sortOrder: number;
  permissionKey: string;
};

export type SeedModule = {
  slug: string;
  name: string;
  description: string;
  icon: string;
  sortOrder: number;
  items: SeedModuleItem[];
};

export const ACCESS_CONTROL_SEED: SeedModule[] = [
  {
    slug: 'operacao',
    name: 'Operação',
    description: 'Dashboard e gestão operacional da plataforma',
    icon: 'Activity',
    sortOrder: 1,
    items: [
      {
        slug: 'dashboard',
        label: 'Dashboard',
        route: '/m/operacao/dashboard',
        sortOrder: 1,
        permissionKey: 'operacao.dashboard',
      },
      {
        slug: 'redes',
        label: 'Parceiros',
        route: '/m/operacao/redes',
        sortOrder: 2,
        permissionKey: 'operacao.redes',
      },
      {
        slug: 'modalidades',
        label: 'Modalidades',
        route: '/m/operacao/modalidades',
        sortOrder: 3,
        permissionKey: 'operacao.modalidades',
      },
      {
        slug: 'connect',
        label: 'Planos',
        route: '/m/operacao/planos',
        sortOrder: 4,
        permissionKey: 'plataforma.connect',
      },
      {
        slug: 'usuarios',
        label: 'Usuários',
        route: '/m/operacao/usuarios',
        sortOrder: 5,
        permissionKey: 'plataforma.usuarios',
      },
    ],
  },
  {
    slug: 'corporativo',
    name: 'Corporativo',
    description: 'Empresas e gestão corporativa',
    icon: 'Building2',
    sortOrder: 3,
    items: [
      {
        slug: 'empresas',
        label: 'Empresas',
        route: '/m/corporativo/empresas',
        sortOrder: 1,
        permissionKey: 'corporativo.empresas',
      },
    ],
  },
  {
    slug: 'comercial',
    name: 'Comercial',
    description: 'Pipeline de leads e conversão em parceiros ou empresas',
    icon: 'Briefcase',
    sortOrder: 4,
    items: [
      {
        slug: 'leads',
        label: 'Funil de vendas',
        route: '/m/comercial/leads',
        sortOrder: 1,
        permissionKey: 'comercial.leads',
      },
      {
        slug: 'funis',
        label: 'Funis',
        route: '/m/comercial/funis',
        sortOrder: 2,
        permissionKey: 'comercial.funis',
      },
    ],
  },
  {
    slug: 'financeiro',
    name: 'Financeiro',
    description: 'Contas a pagar, receber e fluxo de caixa',
    icon: 'Wallet',
    sortOrder: 5,
    items: [
      {
        slug: 'contas-pagar',
        label: 'Contas a Pagar',
        route: '/m/financeiro/contas-pagar',
        sortOrder: 1,
        permissionKey: 'financeiro.contas-pagar',
      },
      {
        slug: 'contas-receber',
        label: 'Contas a Receber',
        route: '/m/financeiro/contas-receber',
        sortOrder: 2,
        permissionKey: 'financeiro.contas-receber',
      },
      {
        slug: 'fluxo-caixa',
        label: 'Fluxo de Caixa',
        route: '/m/financeiro/fluxo-caixa',
        sortOrder: 3,
        permissionKey: 'financeiro.fluxo-caixa',
      },
      {
        slug: 'centros-custo',
        label: 'Centros de Custo',
        route: '/m/financeiro/centros-custo',
        sortOrder: 4,
        permissionKey: 'financeiro.centros-custo',
      },
      {
        slug: 'fornecedores',
        label: 'Fornecedores',
        route: '/m/financeiro/fornecedores',
        sortOrder: 5,
        permissionKey: 'financeiro.fornecedores',
      },
      {
        slug: 'planos-conta',
        label: 'Planos de Conta',
        route: '/m/financeiro/planos-conta',
        sortOrder: 6,
        permissionKey: 'financeiro.planos-conta',
      },
    ],
  },
  {
    slug: 'sistema',
    name: 'Sistema',
    description: 'Módulos, permissões e estrutura organizacional',
    icon: 'Settings',
    sortOrder: 6,
    items: [
      {
        slug: 'modulos',
        label: 'Módulos',
        route: '/m/sistema/modulos',
        sortOrder: 1,
        permissionKey: 'sistema.modulos',
      },
      {
        slug: 'grupos',
        label: 'Grupos',
        route: '/m/sistema/grupos',
        sortOrder: 2,
        permissionKey: 'sistema.grupos',
      },
      {
        slug: 'departamentos',
        label: 'Departamentos',
        route: '/m/sistema/departamentos',
        sortOrder: 3,
        permissionKey: 'sistema.departamentos',
      },
      {
        slug: 'cargos',
        label: 'Cargos',
        route: '/m/sistema/cargos',
        sortOrder: 4,
        permissionKey: 'sistema.cargos',
      },
      {
        slug: 'configuracoes',
        label: 'Configurações',
        route: '/m/sistema/configuracoes',
        sortOrder: 5,
        permissionKey: 'plataforma.configuracoes',
      },
    ],
  },
];

export const ADMIN_GROUP_NAME = 'Administradores';
export const COMMERCIAL_GROUP_NAME = 'Comercial';
export const FINANCE_GROUP_NAME = 'Financeiro';
