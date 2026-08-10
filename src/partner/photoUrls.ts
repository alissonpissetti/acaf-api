import type { GymUnit } from './types';

export function isRemotePhotoUrl(url: string | null | undefined): boolean {
  return Boolean(url?.startsWith('http://') || url?.startsWith('https://'));
}

export function isDataPhotoUrl(url: string | null | undefined): boolean {
  return Boolean(url?.startsWith('data:'));
}

/** Retorna URL pública do storage ou caminho proxy legado para data URLs. */
export function resolveCatalogPhotoUrl(
  photoRef: string | null | undefined,
  proxyPath: string,
): string | null {
  if (!photoRef) return null;
  if (isRemotePhotoUrl(photoRef)) return photoRef;
  if (isDataPhotoUrl(photoRef)) return proxyPath;
  return photoRef.startsWith('/') ? photoRef : proxyPath;
}

/** Expõe apenas referências remotas — fotos ficam no storage, não no payload JSON. */
export function sanitizeUnitPhotosForApi(unit: GymUnit): GymUnit {
  return {
    ...unit,
    heroPhotoDataUrl: isRemotePhotoUrl(unit.heroPhotoDataUrl) ? unit.heroPhotoDataUrl : null,
    galleryPhotoDataUrls: unit.galleryPhotoDataUrls.filter(isRemotePhotoUrl),
  };
}
