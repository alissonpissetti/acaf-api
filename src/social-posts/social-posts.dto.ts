import type {
  SocialPostAprovacao,
  SocialPostEnvio,
  SocialPostEtapa,
  SocialPostTipo,
  SocialRede,
  SocialBufferStatus,
} from './social-post.constants';
import type { InteractionClass } from './social-post.rules';

export type SocialPostArteDto = {
  id: string;
  ordem: number;
  nome: string | null;
  arquivo: string | null;
  urlPublica: string | null;
  driveId: string | null;
  largura: number | null;
  altura: number | null;
  interacao: 'link' | 'manual' | null;
};

export type SocialPostBufferDto = {
  id: string;
  rede: SocialRede;
  bufferPostId: string | null;
  bufferChannelId: string;
  ordemArte: number;
  status: SocialBufferStatus;
  dueAt: string | null;
  externalLink: string | null;
  erro: string | null;
  manual: boolean;
  sincronizadoEm: string | null;
};

export type PatchManualCanalBody = {
  status: SocialBufferStatus | 'clear';
  externalLink?: string | null;
  dueAt?: string | null;
};

export type PatchFluxoPublicacaoBody = {
  etapa?: SocialPostEtapa;
  agendadoPara?: string | null;
};

export type SocialPostResponsavelDto = {
  id: string;
  name: string;
  email: string;
  mobilePhone: string | null;
};

export type SocialPostDto = {
  id: string;
  codigo: string;
  numeroExibicao: string;
  tipo: SocialPostTipo;
  formato: string | null;
  envio: SocialPostEnvio;
  pilar: string | null;
  titulo: string;
  visual: string | null;
  legenda: string | null;
  hashtags: string | null;
  telas: string[] | null;
  link: string | null;
  aviso: string | null;
  agendadoPara: string | null;
  aprovacao: SocialPostAprovacao;
  etapa: SocialPostEtapa;
  nota: string | null;
  redes: SocialRede[];
  aprovadoPor: string | null;
  aprovadoEm: string | null;
  interactionClass: InteractionClass;
  interactionLabel: string;
  manualPostingRequired: boolean;
  bufferAllowed: boolean;
  responsavelUserId: string | null;
  responsavel: SocialPostResponsavelDto | null;
  manualReminderSentAt: string | null;
  artes: SocialPostArteDto[];
  bufferLinks: SocialPostBufferDto[];
  captionPreview: string;
};

export type SocialCalendarSummaryDto = {
  totalFeed: number;
  publishedFeed: number;
  scheduled: number;
  approved: number;
  pending: number;
  adjust: number;
};

export type PatchSocialPostBody = {
  titulo?: string;
  visual?: string | null;
  legenda?: string | null;
  hashtags?: string | null;
  telas?: string[] | null;
  link?: string | null;
  aviso?: string | null;
  agendadoPara?: string | null;
  nota?: string | null;
  redes?: SocialRede[];
  etapa?: SocialPostEtapa;
  responsavelUserId?: string | null;
};

export type PatchSocialPostAprovacaoBody = {
  aprovacao: SocialPostAprovacao;
};