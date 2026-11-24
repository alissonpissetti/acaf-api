import type { SocialPostEnvio, SocialRede } from './social-post.constants';
import type { ArteLike } from './social-post.rules';
import { bufferPostingAllowed, buildCaption } from './social-post.rules';

export type BufferPlannedUnit = {
  rede: SocialRede;
  arteOrdem: number;
  arteId: string | null;
  arteIds: string[];
  schedulingType: 'automatic' | 'notification';
  includeText: boolean;
  instagramLinkSticker?: string;
  skip: boolean;
  skipReason?: string;
};

export type PlanBufferUnitsInput = {
  envio: SocialPostEnvio;
  redes: SocialRede[];
  artes: Array<
    ArteLike & { id: string; ordem: number; urlPublica: string | null; interacao: ArteLike['interacao'] }
  >;
  legenda: string | null;
  hashtags: string | null;
  postLink: string | null;
};

export function planBufferUnits(input: PlanBufferUnitsInput): BufferPlannedUnit[] {
  if (!bufferPostingAllowed(input.envio, input.artes)) return [];
  if (input.envio === 'reels') {
    if (!input.artes.length) {
      return input.redes.map((rede) => ({
        rede,
        arteOrdem: 0,
        arteId: null,
        arteIds: [],
        schedulingType: 'automatic',
        includeText: true,
        skip: true,
        skipReason: 'Reels exige arquivo de vídeo.',
      }));
    }
    return input.redes.map((rede) => ({
      rede,
      arteOrdem: 0,
      arteId: input.artes[0]!.id,
      arteIds: [input.artes[0]!.id],
      schedulingType: 'automatic',
      includeText: true,
      skip: false,
    }));
  }

  if (input.envio === 'feed') {
    const autoArtes = input.artes.filter((a) => !a.interacao);
    if (!autoArtes.length) return [];
    const text = buildCaption(input.legenda, input.hashtags);
    const arteIds = autoArtes.map((a) => a.id);
    return input.redes.map((rede) => ({
      rede,
      arteOrdem: 0,
      arteId: autoArtes[0]!.id,
      arteIds,
      schedulingType: 'automatic',
      includeText: Boolean(text.trim()),
      skip: arteIds.some((id) => !input.artes.find((a) => a.id === id)?.urlPublica),
      skipReason: 'Arte sem URL pública.',
    }));
  }

  const units: BufferPlannedUnit[] = [];
  for (const rede of input.redes) {
    for (const arte of input.artes) {
      if (arte.interacao) continue;
      units.push({
        rede,
        arteOrdem: arte.ordem,
        arteId: arte.id,
        arteIds: [arte.id],
        schedulingType: 'automatic',
        includeText: false,
        skip: !arte.urlPublica,
        skipReason: !arte.urlPublica ? 'Arte sem URL pública.' : undefined,
      });
    }
  }
  return units;
}