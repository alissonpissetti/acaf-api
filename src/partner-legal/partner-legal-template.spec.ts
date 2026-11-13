import { buildPartnerOnboardingLegalContext, renderPartnerLegalTemplate } from './partner-legal-template';
import {
  DEFAULT_ONBOARDING_CONTRACT_HTML,
  DEFAULT_ONBOARDING_CONTRACT_TITLE,
  samplePartnerLegalVariables,
} from './partner-legal-template.variables';

jest.mock('../partner/store', () => ({
  loadStore: () => ({
    networks: [
      {
        id: 'net-1',
        name: 'Rede Teste',
        connectFeePercentOverride: 18,
        dailyFeePercentOverride: null,
      },
    ],
    units: [
      {
        id: 'u1',
        networkId: 'net-1',
        unitName: 'Unidade A',
        neighborhood: 'Centro',
        city: 'Curitiba',
        state: 'PR',
        address: 'Rua A',
        number: '10',
        acafAssociate: {
          cnpj: '11222333000181',
          legalName: 'ACADEMIA TESTE LTDA',
          association: 'ACAF',
          signedAt: '2024-01-01',
          contactEmail: 'a@test.com',
          importSource: 'acaf_spreadsheet',
          importedAt: '2024-01-01',
        },
      },
    ],
  }),
  getDomain: () => ({ connectFeePercent: 22, dailyFeePercent: 20 }),
}));

describe('partner-legal-template', () => {
  it('substitui placeholders com escape HTML', () => {
    const html = '<p>Olá {{partnerLegalName}}</p><script>{{networkName}}</script>';
    const vars = samplePartnerLegalVariables();
    vars.partnerLegalName = 'Foo <Bar>';
    const out = renderPartnerLegalTemplate(html, vars);
    expect(out).toContain('Foo &lt;Bar&gt;');
    expect(out).toContain('<script>Rede Academia Exemplo</script>');
    expect(out).toContain('Rede Academia Exemplo');
  });

  it('monta contexto a partir da rede e do usuário', () => {
    const vars = buildPartnerOnboardingLegalContext({
      networkId: 'net-1',
      partnerUser: { name: 'João', email: 'joao@test.com', cpf: '52998224725' },
      document: {
        id: 'd1',
        slug: 'partner_onboarding',
        title: 'Contrato',
        contentHtml: '',
        version: 2,
        publishedAt: new Date('2026-06-01'),
        active: true,
        effectiveAt: new Date('2026-06-01'),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    expect(vars.partnerLegalName).toBe('ACADEMIA TESTE LTDA');
    expect(vars.partnerCnpj).toContain('/');
    expect(vars.connectFeePercent).toBe('18');
    expect(vars.dailyFeePercent).toBe('20');
    expect(vars.documentVersion).toBe('2');
    expect(vars.responsibleName).toBe('João');
  });

  it('minuta padrão usa o nome de produto Movly, sem Connect', () => {
    expect(DEFAULT_ONBOARDING_CONTRACT_TITLE).toMatch(/Movly/);
    expect(DEFAULT_ONBOARDING_CONTRACT_TITLE).not.toMatch(/\bConnect\b/i);
    expect(DEFAULT_ONBOARDING_CONTRACT_HTML).toMatch(/Movly/);
    expect(DEFAULT_ONBOARDING_CONTRACT_HTML).not.toMatch(/\bConnect\b/i);
    expect(DEFAULT_ONBOARDING_CONTRACT_HTML).not.toMatch(/Movly Connect/i);
  });
});
