import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ConfigService } from '@nestjs/config';
import type { NextcloudService } from '../storage/nextcloud.service';

export type PartnerOnboardingWelcomeEmailAssets = {
  logoUrl: string | null;
  fontFaceCss: string;
};

type FontPublishSpec = {
  family: 'Figtree' | 'Unbounded';
  fileName: string;
  weight: number;
};

const EMAIL_FONTS: FontPublishSpec[] = [
  { family: 'Figtree', fileName: 'figtree-latin-400-normal.woff2', weight: 400 },
  { family: 'Figtree', fileName: 'figtree-latin-500-normal.woff2', weight: 500 },
  { family: 'Figtree', fileName: 'figtree-latin-600-normal.woff2', weight: 600 },
  { family: 'Figtree', fileName: 'figtree-latin-700-normal.woff2', weight: 700 },
  { family: 'Unbounded', fileName: 'unbounded-latin-400-normal.woff2', weight: 400 },
  { family: 'Unbounded', fileName: 'unbounded-latin-500-normal.woff2', weight: 500 },
  { family: 'Unbounded', fileName: 'unbounded-latin-600-normal.woff2', weight: 600 },
  { family: 'Unbounded', fileName: 'unbounded-latin-700-normal.woff2', weight: 700 },
];

function localFontPath(fileName: string): string | null {
  const candidates = [
    join(process.cwd(), 'assets/fonts', fileName),
    join(__dirname, '../../assets/fonts', fileName),
    join(process.cwd(), '../acaf-adm/public/fonts', fileName),
  ];
  return candidates.find((path) => existsSync(path)) ?? null;
}

function escapeCssString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function buildFontFaceCss(faces: Array<{ family: string; weight: number; url: string }>): string {
  return faces
    .map(
      (face) => `@font-face{font-family:'${face.family}';font-style:normal;font-weight:${face.weight};font-display:swap;src:url('${escapeCssString(face.url)}') format('woff2');}`,
    )
    .join('');
}

export async function resolvePartnerOnboardingWelcomeEmailAssets(
  storage: NextcloudService,
  config: ConfigService,
  logoUrl: string | null,
): Promise<PartnerOnboardingWelcomeEmailAssets> {
  const envBase = config.get<string>('BRAND_FONTS_PUBLIC_BASE_URL')?.trim().replace(/\/+$/, '');
  const brandBase = config
    .get<string>('BRAND_ASSETS_PUBLIC_URL')
    ?.trim()
    .replace(/\/+$/, '');

  const published: Array<{ family: string; weight: number; url: string }> = [];

  for (const spec of EMAIL_FONTS) {
    if (envBase && /^https?:\/\//i.test(envBase)) {
      published.push({
        family: spec.family,
        weight: spec.weight,
        url: `${envBase}/${spec.fileName}`,
      });
      continue;
    }

    const localPath = localFontPath(spec.fileName);
    if (!localPath) {
      if (brandBase && /^https?:\/\//i.test(brandBase)) {
        published.push({
          family: spec.family,
          weight: spec.weight,
          url: `${brandBase}/fonts/${spec.fileName}`,
        });
      }
      continue;
    }

    try {
      const buffer = await readFile(localPath);
      const storageName = `fonts/${spec.fileName}`;
      const { publicUrl } = await storage.ensurePublicBrandAsset(storageName, buffer, 'font/woff2');
      published.push({
        family: spec.family,
        weight: spec.weight,
        url: publicUrl,
      });
    } catch {
      if (brandBase && /^https?:\/\//i.test(brandBase)) {
        published.push({
          family: spec.family,
          weight: spec.weight,
          url: `${brandBase}/fonts/${spec.fileName}`,
        });
      }
    }
  }

  const fontFaceCss = published.length ? buildFontFaceCss(published) : '';
  return { logoUrl: logoUrl?.trim() || null, fontFaceCss };
}