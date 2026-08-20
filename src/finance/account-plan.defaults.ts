import type { AccountPlanKind } from './account-plan.entity';

export type DefaultAccountPlanSeed = {
  code: string;
  name: string;
  description: string;
  kind: AccountPlanKind;
};

export const DEFAULT_ACCOUNT_PLANS: DefaultAccountPlanSeed[] = [
  {
    code: '3.1.01',
    name: 'Despesas administrativas',
    description: 'Custos gerais de administração',
    kind: 'expense',
  },
  {
    code: '3.1.02',
    name: 'Pessoal e encargos',
    description: 'Salários, benefícios e encargos trabalhistas',
    kind: 'expense',
  },
  {
    code: '3.2.01',
    name: 'Fornecedores',
    description: 'Pagamentos a fornecedores de produtos e insumos',
    kind: 'expense',
  },
  {
    code: '3.2.02',
    name: 'Serviços contratados',
    description: 'Serviços de terceiros e consultorias',
    kind: 'expense',
  },
  {
    code: '3.3.01',
    name: 'Marketing e publicidade',
    description: 'Campanhas, mídia e ações comerciais',
    kind: 'expense',
  },
  {
    code: '4.1.01',
    name: 'Receita de serviços',
    description: 'Receitas operacionais de serviços',
    kind: 'revenue',
  },
  {
    code: '4.1.02',
    name: 'Receita de assinaturas',
    description: 'Mensalidades e planos recorrentes',
    kind: 'revenue',
  },
  {
    code: '4.2.01',
    name: 'Outras receitas',
    description: 'Receitas financeiras e eventuais',
    kind: 'revenue',
  },
];
