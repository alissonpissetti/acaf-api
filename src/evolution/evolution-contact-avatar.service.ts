import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NextcloudService } from '../storage/nextcloud.service';
import { EvolutionInstance } from './evolution-instance.entity';
import { EvolutionContactProfile } from './evolution-contact-profile.entity';
import { EvolutionRemoteContactsService } from './evolution-remote-contacts.service';

export type AvatarRefreshResult = {
  checked: number;
  updated: number;
  unchanged: number;
  missing: number;
};

@Injectable()
export class EvolutionContactAvatarService {
  private readonly logger = new Logger(EvolutionContactAvatarService.name);

  constructor(
    private readonly storage: NextcloudService,
    private readonly remoteContacts: EvolutionRemoteContactsService,
    @InjectRepository(EvolutionInstance)
    private readonly instances: Repository<EvolutionInstance>,
    @InjectRepository(EvolutionContactProfile)
    private readonly profiles: Repository<EvolutionContactProfile>,
  ) {}

  fingerprintFromSource(source: string): string {
    const value = source.trim();
    const payload = value.startsWith('data:') ? (value.split(',')[1] ?? value) : value;
    return createHash('sha256').update(payload).digest('hex');
  }

  hashBuffer(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('hex');
  }

  async persistProfileAvatar(
    instanceId: string,
    contactKey: string,
    sourceUrl: string,
    options?: { force?: boolean },
  ): Promise<boolean> {
    const existing = await this.profiles.findOne({
      where: { instanceId, contactKey },
    });
    if (existing?.avatarStoragePath && !options?.force) {
      return false;
    }

    try {
      const { buffer, mime } = await this.downloadAvatarBytes(instanceId, sourceUrl);
      const contentHash = this.hashBuffer(buffer);
      const sourceFingerprint = this.fingerprintFromSource(sourceUrl);
      const { path } = await this.storage.uploadWhatsappContactAvatar(
        instanceId,
        contactKey,
        buffer,
        mime,
      );
      const nextAvatarUrl =
        existing?.avatarUrl && !this.storage.isHostedPublicUrl(existing.avatarUrl)
          ? existing.avatarUrl
          : null;
      await this.profiles.update(
        { instanceId, contactKey },
        {
          avatarUrl: nextAvatarUrl,
          avatarStoragePath: path,
          avatarContentHash: contentHash,
          avatarSourceFingerprint: sourceFingerprint,
          avatarCheckedAt: new Date(),
        },
      );
      return true;
    } catch (err) {
      this.logger.warn(
        `Avatar não gravado (${contactKey}): ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  /**
   * Consulta a Evolution, compara fingerprint com o último conhecido e só regrava no storage se mudou.
   */
  async refreshAvatarsDetectingChanges(instanceId: string, max = 500): Promise<AvatarRefreshResult> {
    const rows = await this.profiles.find({
      where: { instanceId },
      order: { avatarCheckedAt: 'ASC', updatedAt: 'DESC' },
      take: max,
    });

    const result: AvatarRefreshResult = { checked: 0, updated: 0, unchanged: 0, missing: 0 };

    for (const row of rows) {
      result.checked += 1;
      let source =
        row.remoteJid != null
          ? await this.remoteContacts.fetchAvatarForContact(instanceId, {
              contactKey: row.contactKey,
              remoteJid: row.remoteJid,
              phoneLabel: row.phoneLabel,
            })
          : null;

      if (!source) {
        const fallback = row.avatarUrl?.trim();
        if (fallback && !this.storage.isHostedPublicUrl(fallback)) {
          source = fallback;
        }
      }

      if (!source) {
        result.missing += 1;
        await this.profiles.update(
          { instanceId, contactKey: row.contactKey },
          { avatarCheckedAt: new Date() },
        );
        continue;
      }

      const fingerprint = this.fingerprintFromSource(source);
      const unchanged =
        Boolean(row.avatarStoragePath) &&
        Boolean(row.avatarSourceFingerprint) &&
        row.avatarSourceFingerprint === fingerprint;

      if (unchanged) {
        result.unchanged += 1;
        await this.profiles.update(
          { instanceId, contactKey: row.contactKey },
          { avatarCheckedAt: new Date() },
        );
        continue;
      }

      const ok = await this.persistProfileAvatar(instanceId, row.contactKey, source, {
        force: Boolean(row.avatarStoragePath),
      });
      if (ok) result.updated += 1;
      else if (row.avatarStoragePath) {
        await this.profiles.update(
          { instanceId, contactKey: row.contactKey },
          {
            avatarSourceFingerprint: fingerprint,
            avatarCheckedAt: new Date(),
          },
        );
        result.unchanged += 1;
      } else {
        result.missing += 1;
      }
    }

    return result;
  }

  async syncAllAvatarsToStorage(instanceId: string, max = 500): Promise<number> {
    const outcome = await this.refreshAvatarsDetectingChanges(instanceId, max);
    return outcome.updated;
  }

  async persistMissingAvatarsForInstance(instanceId: string): Promise<number> {
    const rows = await this.profiles.find({
      where: { instanceId },
      select: ['contactKey', 'avatarUrl', 'avatarStoragePath'],
    });
    let saved = 0;
    for (const row of rows) {
      if (!row.avatarUrl || row.avatarStoragePath) continue;
      if (this.storage.isHostedPublicUrl(row.avatarUrl)) continue;
      const ok = await this.persistProfileAvatar(instanceId, row.contactKey, row.avatarUrl);
      if (ok) saved += 1;
    }
    return saved;
  }

  async readStoredAvatar(storagePath: string): Promise<{ buffer: Buffer; mime: string }> {
    return this.storage.readFileBuffer(storagePath);
  }

  async downloadAvatarBytes(
    instanceId: string,
    source: string,
  ): Promise<{ buffer: Buffer; mime: string }> {
    if (source.startsWith('data:')) {
      const match = /^data:([^;]+);base64,(.+)$/i.exec(source);
      if (!match) throw new Error('data URL inválida');
      return {
        mime: match[1]!.trim() || 'image/jpeg',
        buffer: Buffer.from(match[2]!, 'base64'),
      };
    }

    const instance = await this.instances
      .createQueryBuilder('inst')
      .addSelect('inst.apiKey')
      .where('inst.id = :id', { id: instanceId })
      .getOne();

    const headers: Record<string, string> = {};
    const apiKey = instance?.apiKey?.trim();
    if (apiKey) headers.apikey = apiKey;

    const response = await fetch(source, { headers });
    if (!response.ok) {
      throw new Error(`download ${response.status}`);
    }
    const mime = response.headers.get('content-type')?.split(';')[0]?.trim() || 'image/jpeg';
    const buffer = Buffer.from(await response.arrayBuffer());
    return { buffer, mime };
  }
}
