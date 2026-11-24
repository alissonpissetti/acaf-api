import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createReadStream, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { copyFile, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import type { Express } from 'express';
import type { SocialPostArte } from '../social-posts/social-post-arte.entity';

const IMAGE_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};

const VIDEO_EXT: Record<string, string> = {
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
};

const UPLOAD_EXT: Record<string, string> = { ...IMAGE_EXT, ...VIDEO_EXT };

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
};

const ASSET_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.mp4', '.mov'] as const;

@Injectable()
export class SocialPostLocalStorageService {
  constructor(private readonly config: ConfigService) {}

  rootDir(): string {
    const custom = this.config.get<string>('SOCIAL_POST_STORAGE_DIR')?.trim();
    if (custom) return custom.replace(/\/$/, '');
    return join(process.cwd(), 'storage', 'social-posts');
  }

  assetsDir(): string {
    return join(this.rootDir(), 'assets');
  }

  filesDir(): string {
    return join(this.rootDir(), 'files');
  }

  apiPublicBase(): string {
    const fromEnv =
      this.config.get<string>('API_PUBLIC_URL')?.trim() ||
      this.config.get<string>('ACAF_API_PUBLIC_URL')?.trim() ||
      '';
    if (fromEnv) return fromEnv.replace(/\/$/, '');
    const port = this.config.get<string>('PORT') ?? '8787';
    return `http://127.0.0.1:${port}`;
  }

  publicUrlForArteId(arteId: string): string {
    return `${this.apiPublicBase()}/api/social-posts/media/${arteId}`;
  }

  canServeArte(
    arte: Pick<SocialPostArte, 'id' | 'arquivo' | 'nome' | 'driveId'>,
    postCodigo?: string | null,
  ): boolean {
    if (this.arteFileExists(arte)) return true;
    if (postCodigo) {
      return Boolean(this.findSeedAssetPath(postCodigo, arte.nome, arte.driveId ?? null));
    }
    return false;
  }

  /** URL absoluta para Buffer / terceiros — nunca Google Drive. */
  resolvePublicUrl(
    arte: Pick<SocialPostArte, 'id' | 'arquivo' | 'nome' | 'driveId' | 'urlPublica'>,
    postCodigo?: string | null,
  ): string | null {
    if (!this.canServeArte(arte, postCodigo)) return null;
    return this.publicUrlForArteId(arte.id);
  }

  /** Monta `files/{id}.png` a partir de `assets/` se ainda não existir. */
  async ensureArteFile(
    arte: Pick<SocialPostArte, 'id' | 'arquivo' | 'nome' | 'driveId'> & {
      post?: { codigo: string } | null;
    },
  ): Promise<{ path: string; publicUrl: string } | null> {
    if (this.arteFileExists(arte)) {
      const ext = extname(this.arteAbsolutePath(arte)!) || '.png';
      return {
        path: arte.arquivo ?? `files/${arte.id}${ext}`,
        publicUrl: this.publicUrlForArteId(arte.id),
      };
    }
    const codigo = arte.post?.codigo;
    if (!codigo) return null;
    const source = this.findSeedAssetPath(codigo, arte.nome, arte.driveId ?? null);
    if (!source) return null;
    return this.importFromSeedSource(arte.id, source);
  }

  arteAbsolutePath(arte: Pick<SocialPostArte, 'id' | 'arquivo'>): string | null {
    if (arte.arquivo?.trim()) {
      const relative = arte.arquivo.replace(/^\/+/, '');
      const fromArquivo = join(this.rootDir(), relative);
      if (existsSync(fromArquivo)) return fromArquivo;
    }
    const fromId = this.filePathForArteId(arte.id);
    if (existsSync(fromId)) return fromId;
    return null;
  }

  arteFileExists(arte: Pick<SocialPostArte, 'id' | 'arquivo'>): boolean {
    return Boolean(this.arteAbsolutePath(arte));
  }

  filePathForArteId(arteId: string): string {
    const dir = this.filesDir();
    for (const ext of ASSET_EXTENSIONS) {
      const candidate = join(dir, `${arteId}${ext}`);
      if (existsSync(candidate)) return candidate;
    }
    return join(dir, `${arteId}.bin`);
  }

  async saveUpload(arteId: string, file: Express.Multer.File): Promise<{ path: string; publicUrl: string }> {
    const ext = UPLOAD_EXT[file.mimetype];
    if (!ext) {
      throw new BadRequestException('Envie imagem (PNG, JPG, WEBP) ou vídeo (MP4, MOV).');
    }
    mkdirSync(this.filesDir(), { recursive: true });
    const relative = `files/${arteId}${ext}`;
    const absolute = join(this.rootDir(), relative);
    await writeFile(absolute, file.buffer);
    return { path: relative, publicUrl: this.publicUrlForArteId(arteId) };
  }

  async importFromSeedSource(
    arteId: string,
    sourceAbsolute: string,
  ): Promise<{ path: string; publicUrl: string }> {
    const ext = extname(sourceAbsolute).toLowerCase();
    if (!MIME_BY_EXT[ext]) {
      throw new InternalServerErrorException(`Extensão não suportada: ${ext}`);
    }
    mkdirSync(this.filesDir(), { recursive: true });
    const relative = `files/${arteId}${ext}`;
    const absolute = join(this.rootDir(), relative);
    await copyFile(sourceAbsolute, absolute);
    return { path: relative, publicUrl: this.publicUrlForArteId(arteId) };
  }

  /**
   * Busca arte no disco: `assets/{codigoPost}/{nome}.{png,jpg,...}` ou `assets/{codigo}/{driveId}.*`
   */
  findSeedAssetPath(postCodigo: string, nome: string | null | undefined, driveId: string | null | undefined) {
    const code = String(postCodigo ?? '').trim().toLowerCase();
    if (!code) return null;
    const folder = join(this.assetsDir(), code);
    if (!existsSync(folder)) return null;

    const names = new Set<string>();
    if (nome?.trim()) {
      names.add(nome.trim());
      names.add(nome.trim().toUpperCase());
      names.add(nome.trim().toLowerCase());
    }
    if (driveId?.trim()) names.add(driveId.trim());

    for (const base of names) {
      for (const ext of ASSET_EXTENSIONS) {
        const full = join(folder, `${base}${ext}`);
        if (existsSync(full)) return full;
      }
    }

    const files = readdirSync(folder).filter((f) =>
      ASSET_EXTENSIONS.includes(extname(f).toLowerCase() as (typeof ASSET_EXTENSIONS)[number]),
    );
    if (files.length === 1) return join(folder, files[0]!);
    return null;
  }

  async readArteStream(
    arte: Pick<SocialPostArte, 'id' | 'arquivo' | 'nome' | 'driveId'> & {
      post?: { codigo: string } | null;
    },
  ): Promise<{ stream: ReturnType<typeof createReadStream>; mime: string }> {
    await this.ensureArteFile(arte);
    const absolute = this.arteAbsolutePath(arte);
    if (!absolute) throw new NotFoundException('Arquivo da arte não encontrado.');
    const mime = MIME_BY_EXT[extname(absolute).toLowerCase()] ?? 'application/octet-stream';
    return { stream: createReadStream(absolute), mime };
  }

  /** Só para diagnóstico local — não usar em hot path de listagem. */
  seedAssetsHint(): string {
    return join(this.assetsDir(), '{codigo-do-post}', '{nome-da-arte}.png');
  }
}
