import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { NextcloudService } from '../storage/nextcloud.service';
import { EvolutionMessage } from './evolution-message.entity';
import { EvolutionRemoteMediaService } from './evolution-remote-media.service';

export type MessageMediaSyncResult = {
  processed: number;
  stored: number;
  skipped: number;
  failed: number;
};

@Injectable()
export class EvolutionMessageMediaStorageService {
  private readonly logger = new Logger(EvolutionMessageMediaStorageService.name);

  constructor(
    private readonly storage: NextcloudService,
    private readonly remoteMedia: EvolutionRemoteMediaService,
    @InjectRepository(EvolutionMessage)
    private readonly messages: Repository<EvolutionMessage>,
  ) {}

  hashBuffer(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('hex');
  }

  async readStoredMedia(
    storagePath: string,
    fallbackMime?: string | null,
  ): Promise<{ buffer: Buffer; mime: string; fileName?: string }> {
    const { buffer, mime } = await this.storage.readFileBuffer(storagePath);
    const fileName = storagePath.split('/').pop() ?? undefined;
    return {
      buffer,
      mime: mime && mime !== 'application/octet-stream' ? mime : fallbackMime || mime,
      fileName,
    };
  }

  async persistMessageMedia(
    messageId: string,
    options?: { force?: boolean },
  ): Promise<boolean> {
    const row = await this.messages.findOne({
      where: { id: messageId },
      select: [
        'id',
        'instanceId',
        'mediaKind',
        'mediaPayload',
        'mediaMimeType',
        'mediaStoragePath',
        'mediaContentHash',
      ],
    });
    if (!row?.mediaKind) return false;
    if (row.mediaStoragePath && !options?.force) return false;
    if (!row.mediaPayload?.trim()) return false;

    try {
      const fetched = await this.remoteMedia.fetchStoredMessageMedia(row.instanceId, {
        payloadJson: row.mediaPayload,
        mimeType: row.mediaMimeType,
        kind: row.mediaKind,
      });
      const contentHash = this.hashBuffer(fetched.buffer);
      if (
        !options?.force &&
        row.mediaStoragePath &&
        row.mediaContentHash &&
        row.mediaContentHash === contentHash
      ) {
        return false;
      }

      const { path } = await this.storage.uploadWhatsappMessageMedia(
        row.instanceId,
        row.id,
        fetched.buffer,
        fetched.mime,
        row.mediaKind,
        fetched.fileName,
      );

      await this.messages.update(
        { id: row.id },
        {
          mediaStoragePath: path,
          mediaContentHash: contentHash,
          mediaStoredAt: new Date(),
          mediaMimeType: row.mediaMimeType || fetched.mime,
        },
      );
      return true;
    } catch (err) {
      this.logger.warn(
        `Mídia não gravada (msg ${messageId}): ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  async persistMissingMediaForInstance(
    instanceId: string,
    max = 400,
    concurrency = 1,
  ): Promise<MessageMediaSyncResult> {
    const rows = await this.messages.find({
      where: {
        instanceId,
        mediaKind: Not(IsNull()),
        mediaStoragePath: IsNull(),
      },
      select: ['id', 'mediaPayload'],
      order: { messageAt: 'DESC' },
      take: max,
    });

    const result: MessageMediaSyncResult = {
      processed: 0,
      stored: 0,
      skipped: 0,
      failed: 0,
    };

    const queue = rows.filter((row) => row.mediaPayload?.trim());
    result.skipped = rows.length - queue.length;

    let index = 0;
    const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
      while (index < queue.length) {
        const current = index;
        index += 1;
        const row = queue[current];
        if (!row) break;
        result.processed += 1;
        const ok = await this.persistMessageMedia(row.id);
        if (ok) result.stored += 1;
        else result.failed += 1;
      }
    });

    await Promise.all(workers);
    return result;
  }
}
