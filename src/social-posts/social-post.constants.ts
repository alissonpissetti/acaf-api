export const SOCIAL_POST_TIPO = ['feed', 'stories'] as const;
export type SocialPostTipo = (typeof SOCIAL_POST_TIPO)[number];

export const SOCIAL_POST_ENVIO = ['feed', 'stories', 'reels'] as const;
export type SocialPostEnvio = (typeof SOCIAL_POST_ENVIO)[number];

export const SOCIAL_POST_APROVACAO = ['pendente', 'aprovado', 'ajustar'] as const;
export type SocialPostAprovacao = (typeof SOCIAL_POST_APROVACAO)[number];

export const SOCIAL_POST_ETAPA = ['rascunho', 'programado', 'publicado'] as const;
export type SocialPostEtapa = (typeof SOCIAL_POST_ETAPA)[number];

export const SOCIAL_REDE = ['instagram', 'facebook', 'linkedin'] as const;
export type SocialRede = (typeof SOCIAL_REDE)[number];

export const SOCIAL_ARTE_INTERACAO = ['link', 'manual'] as const;
export type SocialArteInteracao = (typeof SOCIAL_ARTE_INTERACAO)[number] | null;

export const SOCIAL_BUFFER_STATUS = ['draft', 'scheduled', 'sending', 'sent', 'error'] as const;
export type SocialBufferStatus = (typeof SOCIAL_BUFFER_STATUS)[number];

/** Slot fixo na tabela de vínculos para status manual por canal (Meta Business Suite / app). */
export const SOCIAL_MANUAL_ORDEM_ARTE = 9999;

export const DEFAULT_BUFFER_CHANNELS: Record<SocialRede, { bufferChannelId: string; nomeExibicao: string }> = {
  instagram: { bufferChannelId: '6b04f9328541f09ecb8212f5', nomeExibicao: 'Instagram' },
  facebook: { bufferChannelId: '6b04fc0d8541f09ecb822699', nomeExibicao: 'Facebook' },
  linkedin: { bufferChannelId: '6b04fe0f8541f09ecb8245c8', nomeExibicao: 'LinkedIn' },
};

export const SOCIAL_CALENDAR_TZ = 'America/Sao_Paulo';

export const SOCIAL_EXTRA_PERMISSIONS = [
  { key: 'marketing.redes-sociais.aprovar', label: 'Aprovar posts do calendário de redes' },
  { key: 'marketing.redes-sociais.publicar', label: 'Publicar e sincronizar Buffer (calendário de redes)' },
] as const;