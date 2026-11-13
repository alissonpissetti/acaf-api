/**
 * Catálogo de variáveis da minuta de parceria (onboarding).
 *
 * Use no HTML do admin como `{{nomeDaVariavel}}`. Valores vazios aparecem como "—".
 *
 * | Variável | Origem |
 * |----------|--------|
 * | movlyLegalName, movlyCnpj | Constantes da contratada (ajustáveis no texto) |
 * | partnerLegalName | Razão social (unidade ACAF / rede) |
 * | partnerTradeName | Nome fantasia da rede |
 * | partnerCnpj | CNPJ da unidade principal ou rede |
 * | partnerAddress, partnerCity, partnerState, partnerZip | Endereço da unidade principal |
 * | networkName, networkId | Rede parceira |
 * | primaryUnitName | Nome da unidade de referência |
 * | responsibleName, responsibleEmail, responsibleCpf | Usuário logado no portal |
 * | connectFeePercent, dailyFeePercent | Taxas vigentes (rede ou padrão global) |
 * | documentTitle, documentVersion, effectiveAt | Metadados do documento publicado |
 * | signedName, signedDocument, signedAt | Preenchidos na assinatura (prévia: traços ou vazio) |
 */
export const PARTNER_LEGAL_VARIABLE_KEYS = [
  'movlyLegalName',
  'movlyCnpj',
  'partnerLegalName',
  'partnerTradeName',
  'partnerCnpj',
  'partnerAddress',
  'partnerCity',
  'partnerState',
  'partnerZip',
  'networkName',
  'networkId',
  'primaryUnitName',
  'responsibleName',
  'responsibleEmail',
  'responsibleCpf',
  'connectFeePercent',
  'dailyFeePercent',
  'documentTitle',
  'documentVersion',
  'effectiveAt',
  'signedName',
  'signedDocument',
  'signedAt',
] as const;

export type PartnerLegalVariableKey = (typeof PARTNER_LEGAL_VARIABLE_KEYS)[number];

export type PartnerLegalTemplateVariables = Record<PartnerLegalVariableKey, string>;

export const PARTNER_LEGAL_VARIABLE_HINTS: Record<PartnerLegalVariableKey, string> = {
  movlyLegalName: 'Razão social Movly',
  movlyCnpj: 'CNPJ Movly',
  partnerLegalName: 'Razão social do parceiro',
  partnerTradeName: 'Nome fantasia da rede',
  partnerCnpj: 'CNPJ do parceiro',
  partnerAddress: 'Endereço da unidade principal',
  partnerCity: 'Cidade',
  partnerState: 'UF',
  partnerZip: 'CEP',
  networkName: 'Nome da rede',
  networkId: 'ID da rede',
  primaryUnitName: 'Unidade de referência',
  responsibleName: 'Responsável (usuário logado)',
  responsibleEmail: 'E-mail do responsável',
  responsibleCpf: 'CPF do responsável',
  connectFeePercent: '% taxa planos',
  dailyFeePercent: '% taxa diárias',
  documentTitle: 'Título do documento',
  documentVersion: 'Versão publicada',
  effectiveAt: 'Data de vigência',
  signedName: 'Preenchido na assinatura',
  signedDocument: 'CPF na assinatura',
  signedAt: 'Data da assinatura',
};

export function partnerLegalVariableCatalog(): Array<{ key: PartnerLegalVariableKey; hint: string }> {
  return PARTNER_LEGAL_VARIABLE_KEYS.map((key) => ({
    key,
    hint: PARTNER_LEGAL_VARIABLE_HINTS[key],
  }));
}

export const MOVLY_CONTRACTOR_LEGAL_NAME = 'SEJA MOVLY TECNOLOGIA LTDA.';
export const MOVLY_CONTRACTOR_CNPJ = '00.000.000/0001-00';

/** Dados fictícios para pré-visualização no admin. */
export function samplePartnerLegalVariables(): PartnerLegalTemplateVariables {
  return {
    movlyLegalName: MOVLY_CONTRACTOR_LEGAL_NAME,
    movlyCnpj: '12.345.678/0001-90',
    partnerLegalName: 'ACADEMIA EXEMPLO LTDA',
    partnerTradeName: 'Academia Exemplo',
    partnerCnpj: '98.765.432/0001-10',
    partnerAddress: 'Rua das Flores, 100 — Centro',
    partnerCity: 'São Paulo',
    partnerState: 'SP',
    partnerZip: '01310-100',
    networkName: 'Rede Academia Exemplo',
    networkId: 'net_exemplo',
    primaryUnitName: 'Unidade Centro',
    responsibleName: 'Maria da Silva Santos',
    responsibleEmail: 'maria@exemplo.com.br',
    responsibleCpf: '123.456.789-09',
    connectFeePercent: '20',
    dailyFeePercent: '20',
    documentTitle: 'Contrato de parceria — Movly',
    documentVersion: '1',
    effectiveAt: new Date().toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    }),
    signedName: 'Maria da Silva Santos',
    signedDocument: '123.456.789-09',
    signedAt: new Date().toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    }),
  };
}

export const DEFAULT_ONBOARDING_CONTRACT_TITLE = 'Contrato de parceria comercial — portal Movly';

/** Minuta inicial (placeholders `{{…}}`). Tom jurídico em português (Brasil). */
export const DEFAULT_ONBOARDING_CONTRACT_HTML = `<h1>Contrato de parceria comercial</h1>
<p class="legal-preamble"><strong>CONTRATADA:</strong> {{movlyLegalName}}, inscrita no CNPJ sob nº {{movlyCnpj}}, doravante "MOVLY".</p>
<p class="legal-preamble"><strong>CONTRATANTE/PARCEIRO:</strong> {{partnerLegalName}}, nome fantasia {{partnerTradeName}}, inscrita no CNPJ sob nº {{partnerCnpj}}, com sede em {{partnerAddress}}, {{partnerCity}}/{{partnerState}}, CEP {{partnerZip}}, doravante "PARCEIRO".</p>
<p>O presente instrumento tem por objeto a celebração de parceria comercial para disponibilização e gestão de planos de assinatura Movly, diárias e demais serviços correlatos por meio do portal parceiro e aplicativos da MOVLY, na rede <strong>{{networkName}}</strong>.</p>

<h2>Cláusula 1 — Do objeto e da operação</h2>
<p>1.1. O PARCEIRO autoriza a MOVLY a intermediar a oferta de planos, benefícios e diárias aos usuários finais, vinculados às suas unidades (incluindo <strong>{{primaryUnitName}}</strong> e demais unidades cadastradas sob a mesma rede).</p>
<p>1.2. O PARCEIRO compromete-se a manter cadastro atualizado de unidades, horários, modalidades, valores e demais informações exibidas ao consumidor, respondendo pela veracidade dos dados.</p>

<h2>Cláusula 2 — Das taxas e repasses</h2>
<p>2.1. Sobre as transações elegíveis aplicam-se as taxas de intermediação vigentes: <strong>{{connectFeePercent}}%</strong> sobre planos de assinatura e <strong>{{dailyFeePercent}}%</strong> sobre diárias, salvo acordo escrito distinto ou override cadastrado por unidade/rede.</p>
<p>2.2. Os repasses seguirão o calendário e as regras exibidas no portal parceiro e na política comercial da MOVLY, podendo ser atualizados mediante comunicação prévia.</p>

<h2>Cláusula 3 — Obrigações do parceiro</h2>
<p>3.1. Cumprir a legislação aplicável ao serviço de atividade física, relações de consumo, proteção de dados (LGPD) e normas sanitárias.</p>
<p>3.2. Designar responsável com poderes para aceitar este contrato e operar o portal: <strong>{{responsibleName}}</strong> (e-mail {{responsibleEmail}}, CPF {{responsibleCpf}}).</p>
<p>3.3. Não utilizar a marca MOVLY de forma que induza o público a erro, nem praticar concorrência desleal ou fraude em check-ins e vendas.</p>

<h2>Cláusula 4 — Obrigações da Movly</h2>
<p>4.1. Disponibilizar o portal parceiro, infraestrutura tecnológica e suporte nos canais informados, dentro de padrões razoáveis de disponibilidade.</p>
<p>4.2. Processar pagamentos e repasses conforme regras comerciais acordadas, observadas limitações de meios de pagamento e instituições financeiras.</p>

<h2>Cláusula 5 — Vigência e alterações</h2>
<p>5.1. Este contrato entra em vigor na data da assinatura eletrônica abaixo ou na data de vigência da versão publicada ({{effectiveAt}}), prevalecendo a mais recente.</p>
<p>5.2. A MOVLY poderá publicar novas versões deste instrumento. Quando exigido no fluxo de onboarding ou no portal, o PARCEIRO deverá manifestar novo aceite para continuar a utilização.</p>

<h2>Cláusula 6 — Disposições gerais</h2>
<p>6.1. Fica eleito o foro da comarca de São Paulo/SP, com renúncia a qualquer outro, salvo disposição legal em contrário.</p>
<p>6.2. A invalidade de qualquer cláusula não afetará as demais.</p>

<h2>Assinatura</h2>
<p>Documento: {{documentTitle}} (versão {{documentVersion}}).</p>
<p>Declaro que li integralmente este contrato e concordo com seus termos.</p>
<p><strong>Nome completo do signatário:</strong> {{signedName}}</p>
<p><strong>CPF:</strong> {{signedDocument}}</p>
<p><strong>Data:</strong> {{signedAt}}</p>`;
