import { PARTNER_LEGAL_SLUG_ONBOARDING } from './partner-legal.constants';
import {
  DEFAULT_ONBOARDING_CONTRACT_HTML,
  DEFAULT_ONBOARDING_CONTRACT_TITLE,
} from './partner-legal-template.variables';

/**
 * Catálogo de tipos nativos do gerador de documentos (Operação → Documentos).
 *
 * Para adicionar um tipo nativo:
 * 1. Inclua um item em `LEGAL_DOCUMENT_TYPES` (slug estável, rótulo e descrição).
 * 2. Opcionalmente defina `defaultTitle` / `defaultContentHtml` para a primeira versão.
 * 3. Se o tipo for usado em um fluxo da plataforma, ligue `usedInOnboarding`
 *    (ou um flag equivalente) e referencie o mesmo slug nesse fluxo.
 *
 * Tipos extras também podem ser criados pela tela do admin; eles reutilizam
 * o mesmo motor de template `{{variavel}}`.
 */
export type LegalDocumentTypeDefinition = {
  slug: string;
  label: string;
  description: string;
  builtIn: boolean;
  usedInOnboarding: boolean;
  defaultTitle: string;
  defaultContentHtml: string;
};

export const LEGAL_DOCUMENT_TYPES: LegalDocumentTypeDefinition[] = [
  {
    slug: PARTNER_LEGAL_SLUG_ONBOARDING,
    label: 'Termos de parceiro',
    description: 'Minuta de parceria comercial aceita no onboarding do portal parceiro.',
    builtIn: true,
    usedInOnboarding: true,
    defaultTitle: DEFAULT_ONBOARDING_CONTRACT_TITLE,
    defaultContentHtml: DEFAULT_ONBOARDING_CONTRACT_HTML,
  },
];

export const LEGAL_DOCUMENT_TYPE_BY_SLUG = new Map(
  LEGAL_DOCUMENT_TYPES.map((item) => [item.slug, item]),
);

/** Slugs reservados para rotas da API/admin — não usar como identificador de documento. */
export const RESERVED_DOCUMENT_SLUGS = new Set([
  'novo',
  'types',
  'catalog',
  'current',
  'versions',
  'publish',
  'preview-render',
]);

export const DEFAULT_CUSTOM_DOCUMENT_TITLE = 'Novo documento';

export const DEFAULT_CUSTOM_DOCUMENT_HTML = `<h1>{{documentTitle}}</h1>
<p><strong>MOVLY:</strong> {{movlyLegalName}}, inscrita no CNPJ sob nº {{movlyCnpj}}.</p>
<p>Edite este modelo. A pré-visualização preenche placeholders como {{partnerLegalName}} e {{documentTitle}} com dados de exemplo.</p>
<p>Documento versão {{documentVersion}}, vigente em {{effectiveAt}}.</p>`;

export function findLegalDocumentType(slug: string): LegalDocumentTypeDefinition | undefined {
  return LEGAL_DOCUMENT_TYPE_BY_SLUG.get(slug.trim());
}
