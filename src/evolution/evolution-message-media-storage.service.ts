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

const MEDIA_PERSIST_MAX_ATTEMPTS = 4;
const MEDIA_PERSIST_MAX_ATTEMPTS_TRANSIENT = 3;
const MEDIA_PERSIST_MAX_CONCURRENT = 2;
const MEDIA_PERSIST_GAP_MS = 450;

/** Marca mídia indisponível na Evolution (expirada, rota sem base64, etc.) — evita reprocessar em loop. */
export const MEDIA_PERSIST_UNAVAILABLE_HASH = 'evolution_unavailable';

function mediaPersistBackoffMs(attempt: number): number {
  return Math.min(45_000, 1_500 * (attempt + 1) ** 2);
}

function isTransientMediaStorageError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('MEDIA_PERMANENT:')) return false;
  if (/não foi possível baixar a mídia/i.test(msg)) return false;
  if (/Evolution não retornou base64/i.test(msg)) return false;
  if (/Payload de mídia inválido/i.test(msg)) return false;
  if (/\b404\b/.test(msg) || /cannot\s+post/i.test(msg)) return false;
  if (/fetch failed|ECONNRESET|ETIMEDOUT|socket hang up|timeout/i.test(msg)) return true;
  if (/\b(408|423|429|499|502|503|504)\b/.test(msg)) return true;
  return false;
}

function isPermanentMediaStorageError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('MEDIA_PERMANENT:')) return true;
  if (/não foi possível baixar a mídia/i.test(msg)) return true;
  if (/Evolution não retornou base64/i.test(msg)) return true;
  if (/Payload de mídia inválido/i.test(msg)) return true;
  if (/\b(400|401|403|404|410|422)\b/.test(msg)) return true;
  return !isTransientMediaStorageError(err);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

@Injectable()
export class EvolutionMessageMediaStorageService {
  private readonly logger = new Logger(EvolutionMessageMediaStorageService.name);
  private readonly persistQueued = new Set<string>();
  private readonly persistWaiting: Array<{ id: string; options?: { force?: boolean } }> = [];
  private persistActive = 0;
  private lastPersistStartedAt = 0;

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

  /** Enfileira gravação (webhook / ingestão) — evita rajadas Evolution + Nextcloud. */
  enqueuePersistMessageMedia(messageId: string, options?: { force?: boolean }): void {
    const id = String(messageId ?? '').trim();
    if (!id) return;
    if (!options?.force && this.persistGiveUp.has(id)) return;
    if (this.persistQueued.has(id)) return;
    this.persistQueued.add(id);
    this.persistWaiting.push({ id, options });
    void this.pumpPersistQueue();
  }

  private readonly persistGiveUp = new Set<string>();

  private async pumpPersistQueue(): Promise<void> {
    while (this.persistActive < MEDIA_PERSIST_MAX_CONCURRENT && this.persistWaiting.length) {
      const job = this.persistWaiting.shift();
      if (!job) break;

      const sinceLast = Date.now() - this.lastPersistStartedAt;
      if (sinceLast < MEDIA_PERSIST_GAP_MS) {
        await sleep(MEDIA_PERSIST_GAP_MS - sinceLast);
      }
      this.lastPersistStartedAt = Date.now();
      this.persistActive += 1;

      void this.persistMessageMedia(job.id, job.options)
        .catch(() => {})
        .finally(() => {
          this.persistQueued.delete(job.id);
          this.persistActive -= 1;
          void this.pumpPersistQueue();
        });
    }
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
    if (!options?.force && row.mediaContentHash === MEDIA_PERSIST_UNAVAILABLE_HASH) {
      this.persistGiveUp.add(row.id);
      return false;
    }

    let lastError = 'erro desconhecido';

    for (let attempt = 0; attempt < MEDIA_PERSIST_MAX_ATTEMPTS; attempt += 1) {
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
        this.persistGiveUp.delete(row.id);
        return true;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        const retryable = isTransientMediaStorageError(err);
        const permanent = isPermanentMediaStorageError(err);
        const maxAttempts = retryable ? MEDIA_PERSIST_MAX_ATTEMPTS_TRANSIENT : 1;

        if (permanent || !retryable) {
          await this.markMediaPersistUnavailable(row.id, lastError);
          this.logger.debug(
            `Mídia indisponível na Evolution (msg ${messageId}, ${row.mediaKind}): ${lastError.replace(/^MEDIA_PERMANENT:\s*/i, '')}`,
          );
          return false;
        }

        if (attempt >= maxAttempts - 1) {
          this.logger.warn(`Mídia não gravada após tentativas (msg ${messageId}): ${lastError}`);
          return false;
        }

        await sleep(mediaPersistBackoffMs(attempt));
      }
    }

    return false;
  }

  private async markMediaPersistUnavailable(messageId: string, reason: string): Promise<void> {
    const id = String(messageId ?? '').trim();
    if (!id) return;
    this.persistGiveUp.add(id);
    const detail = reason.replace(/^MEDIA_PERMANENT:\s*/i, '').slice(0, 240);
    await this.messages
      .update(
        { id },
        {
          mediaContentHash: MEDIA_PERSIST_UNAVAILABLE_HASH,
          mediaStoredAt: null,
        },
      )
      .catch(() => {});

  }

  async persistMissingMediaForInstance(
    instanceId: string,
    max = 400,
    concurrency = 1,
  ): Promise<MessageMediaSyncResult> {
    const rows = await this.messages
      .createQueryBuilder('m')
      .select(['m.id', 'm.mediaPayload'])
      .where('m.instance_id = :instanceId', { instanceId })
      .andWhere('m.media_kind IS NOT NULL')
      .andWhere('m.media_storage_path IS NULL')
      .andWhere(
        '(m.media_content_hash IS NULL OR m.media_content_hash <> :unavailable)',
        { unavailable: MEDIA_PERSIST_UNAVAILABLE_HASH },
      )
      .orderBy('m.message_at', 'DESC')
      .limit(max)
      .getMany();

    const result: MessageMediaSyncResult = {
      processed: 0,
      stored: 0,
      skipped: 0,
      failed: 0,
    };

    const queue = rows.filter((row) => row.mediaPayload?.trim());
    result.skipped = rows.length - queue.length;

    let index = 0;
    const workers = Array.from({ length: Math.max(1, Math.min(concurrency, 2)) }, async () => {
      while (index < queue.length) {
        const current = index;
        index += 1;
        const row = queue[current];
        if (!row) break;
        result.processed += 1;
        const ok = await this.persistMessageMedia(row.id);
        if (ok) result.stored += 1;
        else result.failed += 1;
        await sleep(MEDIA_PERSIST_GAP_MS);
      }
    });

    await Promise.all(workers);
    return result;
  }

  async countPendingMediaByInstance(): Promise<Map<string, number>> {
    const rows = await this.messages
      .createQueryBuilder('m')
      .innerJoin('m.instance', 'inst', 'inst.active = :active', { active: true })
      .select('m.instance_id', 'instanceId')
      .addSelect('COUNT(*)', 'pending')
      .where('m.media_kind IS NOT NULL')
      .andWhere('m.media_storage_path IS NULL')
      .andWhere("m.media_payload IS NOT NULL AND TRIM(m.media_payload) <> ''")
      .andWhere('(m.media_content_hash IS NULL OR m.media_content_hash <> :unavailable)', {
        unavailable: MEDIA_PERSIST_UNAVAILABLE_HASH,
      })
      .groupBy('m.instance_id')
      .getRawMany<{ instanceId: string; pending: string }>();

    const map = new Map<string, number>();
    for (const row of rows) {
      const id = String(row.instanceId ?? '').trim();
      const pending = Number.parseInt(String(row.pending ?? '0'), 10);
      if (id && pending > 0) map.set(id, pending);
    }
    return map;
  }

  async persistMissingMediaForAllInstances(options?: {
    maxPerInstance?: number;
    concurrencyPerInstance?: number;
  }): Promise<MessageMediaSyncResult & { instances: number }> {
    const pendingByInstance = await this.countPendingMediaByInstance();
    const instanceIds = [...pendingByInstance.keys()];
    const maxPerInstance = Math.max(1, options?.maxPerInstance ?? 400);
    const concurrencyPerInstance = options?.concurrencyPerInstance ?? 1;

    const total: MessageMediaSyncResult & { instances: number } = {
      instances: instanceIds.length,
      processed: 0,
      stored: 0,
      skipped: 0,
      failed: 0,
    };

    for (const instanceId of instanceIds) {
      const cap = Math.min(maxPerInstance, pendingByInstance.get(instanceId) ?? maxPerInstance);
      const outcome = await this.persistMissingMediaForInstance(
        instanceId,
        cap,
        concurrencyPerInstance,
      );
      total.processed += outcome.processed;
      total.stored += outcome.stored;
      total.skipped += outcome.skipped;
      total.failed += outcome.failed;
    }

    return total;
  }
}
