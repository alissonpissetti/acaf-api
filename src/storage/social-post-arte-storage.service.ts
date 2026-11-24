import { Injectable } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import type { Express } from 'express';
import type { SocialPostArte } from '../social-posts/social-post-arte.entity';
import { NextcloudService } from './nextcloud.service';
import { SocialPostLocalStorageService } from './social-post-local-storage.service';

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
};

@Injectable()
export class SocialPostArteStorageService {
  constructor(
    private readonly local: SocialPostLocalStorageService,
    private readonly nextcloud: NextcloudService,
  ) {}

  /** Arte já publicada no Nextcloud com link externo. */
  isRemoteArte(arte: Pick<SocialPostArte, 'arquivo' | 'urlPublica'>): boolean {
    const url = arte.urlPublica?.trim() ?? '';
    if (!url) return false;
    if (url.includes('/api/social-posts/media/')) return false;
    if (url.includes('googleusercontent') || url.includes('drive.google')) return false;
    return true;
  }

  resolvePublicUrl(
    arte: Pick<SocialPostArte, 'id' | 'arquivo' | 'nome' | 'driveId' | 'urlPublica'>,
    postCodigo?: string | null,
  ): string | null {
    if (this.isRemoteArte(arte)) return arte.urlPublica;
    if (postCodigo && this.local.canServeArte(arte, postCodigo)) {
      return this.local.publicUrlForArteId(arte.id);
    }
    return null;
  }

  async saveUpload(
    postId: string,
    arteId: string,
    file: Express.Multer.File,
  ): Promise<{ path: string; publicUrl: string }> {
    return this.nextcloud.uploadSocialPostArte(postId, arteId, file);
  }

  async uploadFromLocalFile(
    postId: string,
    arte: Pick<SocialPostArte, 'id' | 'nome'>,
    absolutePath: string,
  ): Promise<{ path: string; publicUrl: string }> {
    const buffer = await readFile(absolutePath);
    const ext = extname(absolutePath).toLowerCase();
    const mime = MIME_BY_EXT[ext] ?? 'application/octet-stream';
    const name = arte.nome?.trim() || basename(absolutePath);
    return this.nextcloud.uploadSocialPostArteBuffer(postId, arte.id, buffer, mime, name);
  }

  /**
   * Garante cópia no storage remoto a partir de `files/` local ou `assets/{codigo}/` do seed.
   */
  async ensureRemoteArte(
    arte: Pick<SocialPostArte, 'id' | 'postId' | 'arquivo' | 'nome' | 'driveId' | 'urlPublica'> & {
      post?: { codigo: string } | null;
    },
    options?: { force?: boolean },
  ): Promise<{ path: string; publicUrl: string } | null> {
    if (!options?.force && this.isRemoteArte(arte) && arte.arquivo?.trim()) {
      return { path: arte.arquivo, publicUrl: arte.urlPublica! };
    }

    const postId = arte.postId;
    if (!postId) return null;

    await this.local.ensureArteFile(arte);
    const absolute = this.local.arteAbsolutePath(arte);
    if (!absolute) return null;

    return this.uploadFromLocalFile(postId, arte, absolute);
  }

  async deleteStoredArte(arte: Pick<SocialPostArte, 'arquivo'>): Promise<void> {
    const path = arte.arquivo?.trim();
    if (!path || path.startsWith('files/') || path.startsWith('assets/')) return;
    try {
      await this.nextcloud.deleteFile(path);
    } catch {
      /* metadados seguem sendo removidos */
    }
  }
}