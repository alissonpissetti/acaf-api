import type {
  SocialPostAprovacao,
  SocialPostEnvio,
  SocialPostEtapa,
  SocialArteInteracao,
  SocialRede,
} from './social-post.constants';
import { SOCIAL_CALENDAR_TZ } from './social-post.constants';

export type InteractionClass = 'none' | 'full_manual' | 'mixed' | 'reels';

export type ArteLike = { interacao: SocialArteInteracao };

export function defaultRedesForEnvio(envio: SocialPostEnvio): SocialRede[] {
  if (envio === 'feed') return ['instagram', 'facebook', 'linkedin'];
  if (envio === 'stories') return ['instagram', 'facebook'];
  return ['instagram'];
}

export function allowedRedesForEnvio(envio: SocialPostEnvio): SocialRede[] {
  return defaultRedesForEnvio(envio);
}

export function assertRedesValidForEnvio(envio: SocialPostEnvio, redes: SocialRede[]): void {
  if (!redes.length) {
    throw new Error('Selecione ao menos uma rede.');
  }
  const allowed = new Set(allowedRedesForEnvio(envio));
  for (const r of redes) {
    if (!allowed.has(r)) {
      throw new Error(`Rede ${r} não é suportada para envio ${envio}.`);
    }
  }
}

/** Arte marcada com tipo que o Buffer / API Meta não reproduz (link, pergunta, poll, etc.). */
export function arteBlocksBuffer(interacao: SocialArteInteracao): boolean {
  return interacao === 'link' || interacao === 'manual';
}

/** Posts com interação no app (Meta) — publicação manual; Buffer proibido. */
export function requiresManualPosting(_envio: SocialPostEnvio, artes: ArteLike[]): boolean {
  if (!artes.length) return false;
  return artes.some((a) => arteBlocksBuffer(a.interacao));
}

export function bufferPostingAllowed(envio: SocialPostEnvio, artes: ArteLike[]): boolean {
  return !requiresManualPosting(envio, artes);
}

export function assertBufferPostingAllowed(envio: SocialPostEnvio, artes: ArteLike[]): void {
  if (!bufferPostingAllowed(envio, artes)) {
    throw new Error(
      'Este post tem link, enquete, pergunta ou outra interação no app Meta — use só publicação manual. O Buffer não está disponível.',
    );
  }
}

export function classifyInteraction(
  envio: SocialPostEnvio,
  artes: ArteLike[],
): InteractionClass {
  if (envio === 'reels') return 'reels';
  if (!artes.length) return 'none';
  const interactive = artes.filter((a) => arteBlocksBuffer(a.interacao)).length;
  if (interactive === 0) return 'none';
  if (interactive === artes.length) return 'full_manual';
  return 'mixed';
}

export function interactionLabel(
  envio: SocialPostEnvio,
  artes: ArteLike[],
): string {
  const c = classifyInteraction(envio, artes);
  if (c === 'reels') return 'Reels · vídeo obrigatório';
  if (c === 'full_manual') return 'Com interação · só app (Buffer indisponível)';
  if (c === 'mixed') {
    return 'Parte com interação · só app (Buffer indisponível)';
  }
  return 'Sem interação · Buffer';
}

export function assertCanScheduleOrPublish(aprovacao: SocialPostAprovacao): void {
  if (aprovacao !== 'aprovado') {
    throw new Error('Aprove o post antes de programar ou publicar.');
  }
}

type AssigneeLike = {
  active?: boolean;
  roles?: string[] | null;
  userGroupId?: string | null;
  passwordHash?: string | null;
};

/** Espelha o filtro do cronograma no admin (usuários do console, não só app). */
export function isConsoleAssigneeUser(user: AssigneeLike | null | undefined): boolean {
  if (!user?.active) return false;
  const roles = Array.isArray(user.roles) ? user.roles : [];
  if (roles.includes('admin')) return true;
  if (user.userGroupId) return true;
  const onlyAppRoles =
    roles.length > 0 && roles.every((r) => r === 'member' || r === 'corporate' || r === 'partner');
  if (onlyAppRoles) return false;
  if (!roles.length && user.passwordHash) return true;
  return roles.length > 0;
}

export function assertManualPostResponsavel(input: {
  manualRequired: boolean;
  agendadoPara: Date | null;
  etapa: SocialPostEtapa;
  responsavelUserId: string | null;
}): void {
  if (!input.manualRequired) return;
  if (input.etapa === 'publicado' || !input.agendadoPara) return;
  if (!input.responsavelUserId?.trim()) {
    throw new Error(
      'Posts com figurinha de link ou interação manual precisam de um responsável do admin quando há data agendada.',
    );
  }
}

export function assertScheduleTimeInFuture(agendadoPara: Date, now = new Date()): void {
  const min = now.getTime() + 2 * 60 * 1000;
  if (agendadoPara.getTime() < min) {
    throw new Error('O horário agendado precisa estar pelo menos 2 minutos no futuro.');
  }
}

export function buildCaption(legenda: string | null, hashtags: string | null): string {
  const parts = [legenda?.trim(), hashtags?.trim()].filter(Boolean);
  return parts.join('\n\n');
}

export function toBufferDueAtIso(agendadoPara: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SOCIAL_CALENDAR_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(agendadoPara);
  const pick = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  const y = pick('year');
  const m = pick('month');
  const d = pick('day');
  const h = pick('hour');
  const min = pick('minute');
  const sec = pick('second');
  return `${y}-${m}-${d}T${h}:${min}:${sec}-03:00`;
}

export function deriveEtapaFromBufferStatuses(
  statuses: Array<{ status: string }>,
  current: 'rascunho' | 'programado' | 'publicado',
): 'rascunho' | 'programado' | 'publicado' {
  if (!statuses.length) return current === 'publicado' ? 'publicado' : 'rascunho';
  if (statuses.some((s) => s.status === 'error')) {
    return current === 'publicado' ? 'publicado' : 'programado';
  }
  if (statuses.length > 0 && statuses.every((s) => s.status === 'sent')) return 'publicado';
  if (statuses.some((s) => s.status === 'scheduled' || s.status === 'sending')) return 'programado';
  if (statuses.some((s) => s.status === 'draft')) return 'rascunho';
  return current;
}

export function aggregateRedeBufferStatus(links: Array<{ status: string }>): string {
  if (!links.length) return 'draft';
  if (links.some((l) => l.status === 'error')) return 'error';
  if (links.every((l) => l.status === 'sent')) return 'sent';
  if (links.some((l) => l.status === 'sending')) return 'sending';
  if (links.some((l) => l.status === 'scheduled')) return 'scheduled';
  return 'draft';
}

export function effectiveStatusesForEtapa(
  redes: SocialRede[],
  links: Array<{ rede: SocialRede; status: string; manual?: boolean }>,
): Array<{ status: string }> {
  const out: Array<{ status: string }> = [];
  for (const rede of redes) {
    const redeLinks = links.filter((l) => l.rede === rede);
    const manual = redeLinks.find((l) => l.manual);
    if (manual) {
      out.push({ status: manual.status });
      continue;
    }
    const bufferOnly = redeLinks.filter((l) => !l.manual);
    if (!bufferOnly.length) continue;
    out.push({ status: aggregateRedeBufferStatus(bufferOnly) });
  }
  return out;
}