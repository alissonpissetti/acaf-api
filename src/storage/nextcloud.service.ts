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

  private async createPublicShareUrl(relativePath: string): Promise<string> {
    const existing = await this.findPublicShareUrl(relativePath);
    if (existing) return existing;

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
