import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { NextcloudService } from '../storage/nextcloud.service';

export const MARKETING_APP_DEFAULT_FONT = 'app-default';

export type BrandFontFace = {
  family: string;
  weight: number;
  style: 'normal';
  url: string;
};

export type BrandTypography = {
  family: string;
  cssFamily: string;
  faces: BrandFontFace[];
};

const FIGTREE_FAMILY = 'Figtree';
const FIGTREE_CSS_FAMILY = `'${FIGTREE_FAMILY}', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;

const FIGTREE_FILES: Array<{ fileName: string; weight: number }> = [
  { fileName: 'figtree-latin-400-normal.woff2', weight: 400 },
  { fileName: 'figtree-latin-500-normal.woff2', weight: 500 },
  { fileName: 'figtree-latin-600-normal.woff2', weight: 600 },
  { fileName: 'figtree-latin-700-normal.woff2', weight: 700 },
];

@Injectable()
export class BrandFontsService {
  private readonly logger = new Logger(BrandFontsService.name);
  private typographyReady: Promise<BrandTypography> | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly storage: NextcloudService,
  ) {}

  async getBrandTypography(): Promise<BrandTypography> {
    if (!this.typographyReady) {
      this.typographyReady = this.resolveTypography();
    }
    return this.typographyReady;
  }

  private localFontPath(fileName: string): string | null {
    const candidates = [
      join(process.cwd(), 'assets/fonts', fileName),
      join(__dirname, '../../assets/fonts', fileName),
      join(process.cwd(), '../acaf-adm/public/fonts', fileName),
    ];
    return candidates.find((path) => existsSync(path)) ?? null;
  }

  private async resolveTypography(): Promise<BrandTypography> {
    const envBase = this.config.get<string>('BRAND_FONTS_PUBLIC_BASE_URL')?.trim().replace(/\/+$/, '');
    if (envBase && /^https?:\/\//i.test(envBase)) {
      return {
        family: FIGTREE_FAMILY,
        cssFamily: FIGTREE_CSS_FAMILY,
        faces: FIGTREE_FILES.map((item) => ({
          family: FIGTREE_FAMILY,
          weight: item.weight,
          style: 'normal' as const,
          url: `${envBase}/${item.fileName}`,
        })),
      };
    }

    const faces: BrandFontFace[] = [];

    for (const item of FIGTREE_FILES) {
      const localPath = this.localFontPath(item.fileName);
      if (!localPath) {
        this.logger.warn(`Arquivo de fonte não encontrado: ${item.fileName}`);
        continue;
      }

      try {
        const buffer = await readFile(localPath);
        const storageName = `fonts/${item.fileName}`;
        const { publicUrl } = await this.storage.ensurePublicBrandAsset(
          storageName,
          buffer,
          'font/woff2',
        );
        faces.push({
          family: FIGTREE_FAMILY,
          weight: item.weight,
          style: 'normal',
          url: publicUrl,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Falha ao publicar ${item.fileName}: ${message}`);
      }
    }

    if (!faces.length) {
      const fallbackBase = this.config
        .get<string>('BRAND_ASSETS_PUBLIC_URL')
        ?.trim()
        .replace(/\/+$/, '');
      if (fallbackBase && /^https?:\/\//i.test(fallbackBase)) {
        return {
          family: FIGTREE_FAMILY,
          cssFamily: FIGTREE_CSS_FAMILY,
          faces: FIGTREE_FILES.map((item) => ({
            family: FIGTREE_FAMILY,
            weight: item.weight,
            style: 'normal' as const,
            url: `${fallbackBase}/fonts/${item.fileName}`,
          })),
        };
      }
    }

    return {
      family: FIGTREE_FAMILY,
      cssFamily: FIGTREE_CSS_FAMILY,
      faces,
    };
  }
}
