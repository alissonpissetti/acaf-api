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
      ocs?: { data?: Array<{ url?: string }> };
    };
    const share = payload.ocs?.data?.[0];
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
    return { path: relativePath, publicUrl };
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

  async deleteFile(relativePath: string): Promise<void> {
    const response = await fetch(this.davUrl(relativePath), {
      method: 'DELETE',
      headers: { Authorization: this.authHeader() },
    });

    if (response.status !== 204 && response.status !== 404) {
      const body = await response.text();
      throw new InternalServerErrorException(
        `Falha ao remover arquivo (${response.status}): ${body.slice(0, 120)}`,
      );
    }
  }
}
