import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const IMAGE_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
};

const WHATSAPP_MEDIA_EXT: Record<string, string> = {
  ...IMAGE_EXT,
  'image/gif': '.gif',
  'video/mp4': '.mp4',
  'video/3gpp': '.3gp',
  'audio/ogg': '.ogg',
  'audio/opus': '.opus',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/aac': '.aac',
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/msword': '.doc',
  'application/octet-stream': '.bin',
};

const WHATSAPP_KIND_EXT: Record<string, string> = {
  image: '.jpg',
  sticker: '.webp',
  video: '.mp4',
  audio: '.ogg',
  document: '.pdf',
};

@Injectable()
export class NextcloudService {
  private readonly baseUrl: string;
  private readonly username: string;
  private readonly password: string;
  private readonly rootFolder: string;

  constructor(config: ConfigService) {
    this.baseUrl = config.getOrThrow<string>('NEXTCLOUD_URL').replace(/\/$/, '');
    this.username = config.getOrThrow<string>('NEXTCLOUD_USERNAME');
    this.password = config.getOrThrow<string>('NEXTCLOUD_PASSWORD');
    this.rootFolder = config.get<string>('NEXTCLOUD_ROOT_FOLDER', 'acaf');
  }

  private authHeader(): string {
    const token = Buffer.from(`${this.username}:${this.password}`).toString('base64');
    return `Basic ${token}`;
  }

  private davUrl(relativePath: string): string {
    const encodedPath = relativePath
      .split('/')
      .filter(Boolean)
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    return `${this.baseUrl}/remote.php/dav/files/${encodeURIComponent(this.username)}/${encodedPath}`;
  }

  private sharePath(relativePath: string): string {
    return `/${relativePath.split('/').filter(Boolean).join('/')}`;
  }

  private async ensureFolder(folderPath: string): Promise<void> {
    const segments = folderPath.split('/').filter(Boolean);
    let current = '';

    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      const response = await fetch(this.davUrl(current), {
        method: 'MKCOL',
        headers: { Authorization: this.authHeader() },
      });

      if (response.status !== 201 && response.status !== 405) {
        const body = await response.text();
        throw new InternalServerErrorException(
          `Falha ao preparar pasta no storage (${response.status}): ${body.slice(0, 120)}`,
        );
      }
    }
  }

  private ocsShareRows<T>(data: T[] | T | undefined | null): T[] {
    if (data == null) return [];
    return Array.isArray(data) ? data : [data];
  }

  private async findPublicShareUrl(relativePath: string): Promise<string | null> {
    const path = this.sharePath(relativePath);
    const url = `${this.baseUrl}/ocs/v2.php/apps/files_sharing/api/v1/shares?format=json&path=${encodeURIComponent(path)}`;
    const response = await fetch(url, {
      headers: {
        Authorization: this.authHeader(),
        'OCS-APIRequest': 'true',
      },
    });

    if (!response.ok) return null;

    const payload = (await response.json()) as {
      ocs?: { data?: Array<{ url?: string }> | { url?: string } };
    };
    const share = this.ocsShareRows(payload.ocs?.data)[0];
    return share?.url ? `${share.url}/download` : null;
  }

  private async waitForStorageBackoff(attempt: number) {
    const waitMs = Math.min(30_000, 750 * (attempt + 1) ** 2);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  private async createPublicShareUrl(relativePath: string): Promise<string> {
    const existing = await this.findPublicShareUrl(relativePath);
    if (existing) return existing;

    let lastStatus = 0;
    let lastBody = '';

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await fetch(
        `${this.baseUrl}/ocs/v2.php/apps/files_sharing/api/v1/shares?format=json`,
        {
          method: 'POST',
          headers: {
            Authorization: this.authHeader(),
            'OCS-APIRequest': 'true',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            path: this.sharePath(relativePath),
            shareType: '3',
            permissions: '1',
          }),
        },
      );

      if (response.status === 429 || response.status === 503) {
        lastStatus = response.status;
        lastBody = await response.text();
        await this.waitForStorageBackoff(attempt);
        continue;
      }

      if (!response.ok) {
        const body = await response.text();
        throw new InternalServerErrorException(
          `Falha ao publicar arquivo no storage (${response.status}): ${body.slice(0, 120)}`,
        );
      }

      const payload = (await response.json()) as {
        ocs?: { data?: { url?: string } };
      };
      const shareUrl = payload.ocs?.data?.url;
      if (!shareUrl) {
        throw new InternalServerErrorException('Storage não retornou link público do arquivo.');
      }

      return `${shareUrl}/download`;
    }

    throw new InternalServerErrorException(
      `Falha ao publicar arquivo no storage (${lastStatus || 429}): ${lastBody.slice(0, 120)}`,
    );
  }

  async uploadNetworkLogo(
    networkId: string,
    file: Express.Multer.File,
  ): Promise<{ path: string; publicUrl: string }> {
    const ext = IMAGE_EXT[file.mimetype];
    if (!ext) {
      throw new BadRequestException('Envie uma imagem PNG, JPG, WEBP ou SVG.');
    }

    const folder = `${this.rootFolder}/network-logos`;
    const relativePath = `${folder}/${networkId}${ext}`;

    await this.ensureFolder(folder);

    const response = await fetch(this.davUrl(relativePath), {
      method: 'PUT',
      headers: {
        Authorization: this.authHeader(),
        'Content-Type': file.mimetype,
      },
      body: new Uint8Array(file.buffer),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new InternalServerErrorException(
        `Falha ao enviar logo (${response.status}): ${body.slice(0, 120)}`,
      );
    }

    const publicUrl = await this.createPublicShareUrl(relativePath);
    return { path: relativePath, publicUrl };
  }

  async uploadUnitPhoto(
    unitId: string,
    file: Express.Multer.File,
    fileName: string,
  ): Promise<{ path: string; publicUrl: string }> {
    const ext = IMAGE_EXT[file.mimetype];
    if (!ext) {
      throw new BadRequestException('Envie uma imagem PNG, JPG, WEBP ou SVG.');
    }

    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const folder = `${this.rootFolder}/unit-photos/${unitId}`;
    const relativePath = `${folder}/${safeName}${ext}`;

    await this.ensureFolder(folder);

    const response = await fetch(this.davUrl(relativePath), {
      method: 'PUT',
      headers: {
        Authorization: this.authHeader(),
        'Content-Type': file.mimetype,
      },
      body: new Uint8Array(file.buffer),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new InternalServerErrorException(
        `Falha ao enviar foto (${response.status}): ${body.slice(0, 120)}`,
      );
    }

    const publicUrl = await this.createPublicShareUrl(relativePath);
    return { path: relativePath, publicUrl };
  }

  async uploadUserAvatar(
    userId: string,
    file: Express.Multer.File,
  ): Promise<{ path: string; publicUrl: string }> {
    const ext = IMAGE_EXT[file.mimetype];
    if (!ext) {
      throw new BadRequestException('Envie uma imagem PNG, JPG, WEBP ou SVG.');
    }

    const folder = `${this.rootFolder}/user-avatars`;
    const relativePath = `${folder}/${userId}${ext}`;

    await this.ensureFolder(folder);

    const response = await fetch(this.davUrl(relativePath), {
      method: 'PUT',
      headers: {
        Authorization: this.authHeader(),
        'Content-Type': file.mimetype,
      },
      body: new Uint8Array(file.buffer),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new InternalServerErrorException(
        `Falha ao enviar avatar (${response.status}): ${body.slice(0, 120)}`,
      );
    }

    const publicUrl = await this.createPublicShareUrl(relativePath);
    await this.deleteUserAvatarFiles(userId, relativePath);
    return { path: relativePath, publicUrl };
  }

  async uploadWhatsappContactAvatar(
    instanceId: string,
    contactKey: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<{ path: string; publicUrl: string | null }> {
    const ext = IMAGE_EXT[mimeType] ?? '.jpg';
    const safeKey = contactKey.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
    const folder = `${this.rootFolder}/whatsapp-contacts/${instanceId}`;
    const relativePath = `${folder}/${safeKey}${ext}`;

    await this.ensureFolder(folder);

    const response = await fetch(this.davUrl(relativePath), {
      method: 'PUT',
      headers: {
        Authorization: this.authHeader(),
        'Content-Type': mimeType || 'image/jpeg',
      },
      body: new Uint8Array(buffer),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new InternalServerErrorException(
        `Falha ao enviar foto WhatsApp (${response.status}): ${body.slice(0, 120)}`,
      );
    }

    // Inbox lê via DAV (avatarStoragePath + proxy da API) — não cria link público OCS (evita rate limit 429).
    return { path: relativePath, publicUrl: null };
  }

  private resolveWhatsappMediaExtension(
    mimeType: string,
    mediaKind?: string | null,
    fileName?: string | null,
  ): string {
    const mime = mimeType.split(';')[0]?.trim().toLowerCase() || '';
    if (mime && WHATSAPP_MEDIA_EXT[mime]) return WHATSAPP_MEDIA_EXT[mime]!;

    const fromName = String(fileName ?? '').trim();
    if (fromName.includes('.')) {
      const ext = fromName.slice(fromName.lastIndexOf('.')).toLowerCase();
      if (/^\.[a-z0-9]{2,8}$/.test(ext)) return ext;
    }

    const kind = String(mediaKind ?? '').trim().toLowerCase();
    if (kind && WHATSAPP_KIND_EXT[kind]) return WHATSAPP_KIND_EXT[kind]!;

    return '.bin';
  }

  private isRetryableDavStatus(status: number): boolean {
    return [408, 423, 429, 499, 502, 503, 504].includes(status);
  }

  private async putDavFileWithRetry(
    relativePath: string,
    buffer: Buffer,
    contentType: string,
    errorLabel: string,
  ): Promise<void> {
    let lastError = 'erro desconhecido';

    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const response = await fetch(this.davUrl(relativePath), {
          method: 'PUT',
          headers: {
            Authorization: this.authHeader(),
            'Content-Type': contentType,
          },
          body: new Uint8Array(buffer),
          signal: AbortSignal.timeout(240_000),
        });

        if (response.ok) return;

        const body = await response.text();
        lastError = `${response.status}: ${body.slice(0, 120)}`;
        if (this.isRetryableDavStatus(response.status)) {
          await this.waitForStorageBackoff(attempt);
          continue;
        }

        throw new InternalServerErrorException(`${errorLabel} (${response.status}): ${body.slice(0, 120)}`);
      } catch (err) {
        if (err instanceof InternalServerErrorException) throw err;
        const message = err instanceof Error ? err.message : String(err);
        const timedOut = err instanceof Error && err.name === 'TimeoutError';
        if (timedOut || /fetch failed|ECONNRESET|ETIMEDOUT|socket hang up/i.test(message)) {
          lastError = timedOut ? 'timeout' : message;
          await this.waitForStorageBackoff(attempt);
          continue;
        }
        throw err;
      }
    }

    throw new InternalServerErrorException(`${errorLabel} (${lastError})`);
  }

  async uploadWhatsappMessageMedia(
    instanceId: string,
    messageId: string,
    buffer: Buffer,
    mimeType: string,
    mediaKind?: string | null,
    originalName?: string | null,
  ): Promise<{ path: string }> {
    const ext = this.resolveWhatsappMediaExtension(mimeType, mediaKind, originalName);
    const folder = `${this.rootFolder}/whatsapp-messages/${instanceId}`;
    const relativePath = `${folder}/${messageId}${ext}`;

    await this.ensureFolder(folder);

    const contentType = mimeType?.split(';')[0]?.trim() || 'application/octet-stream';
    await this.putDavFileWithRetry(
      relativePath,
      buffer,
      contentType,
      'Falha ao enviar mídia WhatsApp',
    );

    return { path: relativePath };
  }

  async readFileBuffer(relativePath: string): Promise<{ buffer: Buffer; mime: string }> {
    const response = await fetch(this.davUrl(relativePath), {
      method: 'GET',
      headers: { Authorization: this.authHeader() },
    });
    if (!response.ok) {
      throw new InternalServerErrorException(`Arquivo não encontrado no storage (${response.status}).`);
    }
    const mime = response.headers.get('content-type')?.split(';')[0]?.trim() || 'application/octet-stream';
    const buffer = Buffer.from(await response.arrayBuffer());
    return { buffer, mime };
  }

  isHostedPublicUrl(url: string | null | undefined): boolean {
    const value = String(url ?? '').trim();
    if (!value.startsWith('http')) return false;
    return value.startsWith(this.baseUrl);
  }

  private async listDavEntryNames(folderRelativePath: string): Promise<string[]> {
    const response = await fetch(this.davUrl(folderRelativePath), {
      method: 'PROPFIND',
      headers: {
        Authorization: this.authHeader(),
        Depth: '1',
        'Content-Type': 'application/xml; charset=utf-8',
      },
      body: `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop><d:displayname/></d:prop>
</d:propfind>`,
    });

    if (response.status === 404) return [];
    if (!response.ok) return [];

    const xml = await response.text();
    const names = new Set<string>();
    const hrefPattern = /<(?:[a-zA-Z0-9]+:)?href[^>]*>([^<]+)<\/(?:[a-zA-Z0-9]+:)?href>/gi;
    let match: RegExpExecArray | null;

    while ((match = hrefPattern.exec(xml)) !== null) {
      const href = decodeURIComponent(match[1]);
      const segment = href.split('/').filter(Boolean).pop();
      if (!segment || segment === 'user-avatars') continue;
      names.add(segment);
    }

    return [...names];
  }

  private async deletePublicSharesForPath(relativePath: string): Promise<void> {
    const path = this.sharePath(relativePath);
    const url = `${this.baseUrl}/ocs/v2.php/apps/files_sharing/api/v1/shares?format=json&path=${encodeURIComponent(path)}`;
    const response = await fetch(url, {
      headers: {
        Authorization: this.authHeader(),
        'OCS-APIRequest': 'true',
      },
    });

    if (!response.ok) return;

    const payload = (await response.json()) as {
      ocs?: { data?: Array<{ id?: number | string }> | { id?: number | string } };
    };

    for (const share of this.ocsShareRows(payload.ocs?.data)) {
      if (share.id == null) continue;
      await fetch(
        `${this.baseUrl}/ocs/v2.php/apps/files_sharing/api/v1/shares/${share.id}?format=json`,
        {
          method: 'DELETE',
          headers: {
            Authorization: this.authHeader(),
            'OCS-APIRequest': 'true',
          },
        },
      );
    }
  }

  /** Remove avatar do usuário: caminho salvo no banco + varredura por id no storage. */
  async deleteUserAvatarForUser(userId: string, storedPath?: string | null): Promise<void> {
    const path = storedPath?.trim();
    if (path) {
      await this.deletePublicSharesForPath(path);
      await this.deleteFile(path, { skipTrash: true });
    }
    await this.deleteUserAvatarFiles(userId);
  }

  /** Remove todos os arquivos de avatar do usuário no storage (e links públicos associados). */
  async deleteUserAvatarFiles(userId: string, exceptRelativePath?: string): Promise<void> {
    const folder = `${this.rootFolder}/user-avatars`;
    const pathsToDelete = new Set<string>();

    for (const ext of [...new Set(Object.values(IMAGE_EXT))]) {
      pathsToDelete.add(`${folder}/${userId}${ext}`);
    }

    const listed = await this.listDavEntryNames(folder);
    for (const name of listed) {
      if (name === userId || name.startsWith(`${userId}.`)) {
        pathsToDelete.add(`${folder}/${name}`);
      }
    }

    for (const relativePath of pathsToDelete) {
      if (exceptRelativePath && relativePath === exceptRelativePath) continue;
      await this.deletePublicSharesForPath(relativePath);
      await this.deleteFile(relativePath, { skipTrash: true });
    }
  }

  private safeFileName(name: string) {
    const trimmed = name.trim().replace(/[^a-zA-Z0-9._-]+/g, '_');
    return trimmed.slice(0, 120) || 'arquivo';
  }

  private payableMimeAllowed(mime: string) {
    const allowed = new Set([
      'application/pdf',
      'image/png',
      'image/jpeg',
      'image/jpg',
      'image/webp',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
      'text/plain',
      'application/zip',
      'application/x-zip-compressed',
    ]);
    return allowed.has(mime);
  }

  async uploadPayableAttachment(
    payableId: string,
    file: Express.Multer.File,
  ): Promise<{ path: string; publicUrl: string }> {
    if (!this.payableMimeAllowed(file.mimetype)) {
      throw new BadRequestException(
        'Formato não suportado. Envie PDF, imagem, Word, Excel, CSV, TXT ou ZIP.',
      );
    }

    const folder = `${this.rootFolder}/payables/${payableId}`;
    const relativePath = `${folder}/${Date.now()}-${this.safeFileName(file.originalname)}`;

    await this.ensureFolder(folder);

    const response = await fetch(this.davUrl(relativePath), {
      method: 'PUT',
      headers: {
        Authorization: this.authHeader(),
        'Content-Type': file.mimetype || 'application/octet-stream',
      },
      body: new Uint8Array(file.buffer),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new InternalServerErrorException(
        `Falha ao enviar anexo (${response.status}): ${body.slice(0, 120)}`,
      );
    }

    const publicUrl = await this.createPublicShareUrl(relativePath);
    return { path: relativePath, publicUrl };
  }

  async uploadReceivableAttachment(
    receivableId: string,
    file: Express.Multer.File,
  ): Promise<{ path: string; publicUrl: string }> {
    if (!this.payableMimeAllowed(file.mimetype)) {
      throw new BadRequestException(
        'Formato não suportado. Envie PDF, imagem, Word, Excel, CSV, TXT ou ZIP.',
      );
    }

    const folder = `${this.rootFolder}/receivables/${receivableId}`;
    const relativePath = `${folder}/${Date.now()}-${this.safeFileName(file.originalname)}`;

    await this.ensureFolder(folder);

    const response = await fetch(this.davUrl(relativePath), {
      method: 'PUT',
      headers: {
        Authorization: this.authHeader(),
        'Content-Type': file.mimetype || 'application/octet-stream',
      },
      body: new Uint8Array(file.buffer),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new InternalServerErrorException(
        `Falha ao enviar anexo (${response.status}): ${body.slice(0, 120)}`,
      );
    }

    const publicUrl = await this.createPublicShareUrl(relativePath);
    return { path: relativePath, publicUrl };
  }

  async deleteFile(relativePath: string, options?: { skipTrash?: boolean }): Promise<void> {
    const headers: Record<string, string> = { Authorization: this.authHeader() };
    if (options?.skipTrash) {
      headers['X-NC-Skip-Trashbin'] = '1';
    }

    const response = await fetch(this.davUrl(relativePath), {
      method: 'DELETE',
      headers,
    });

    const ok = [200, 202, 204, 404].includes(response.status);
    if (!ok) {
      const body = await response.text();
      throw new InternalServerErrorException(
        `Falha ao remover arquivo (${response.status}): ${body.slice(0, 120)}`,
      );
    }
  }
}
