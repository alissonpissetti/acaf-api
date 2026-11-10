import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { normalizeEvolutionBaseUrl, SystemSettingsService } from '../system-settings/system-settings.service';
import { EvolutionInstance } from './evolution-instance.entity';
import {
  resolveMessageEnvelope,
  tryDecodeInlineMediaFromPayload,
  unwrapWhatsAppMessageNode,
} from './evolution-message-media';

@Injectable()
export class EvolutionRemoteMediaService {
  constructor(
    @InjectRepository(EvolutionInstance)
    private readonly instances: Repository<EvolutionInstance>,
    private readonly systemSettings: SystemSettingsService,
  ) {}

  async fetchStoredMessageMedia(
    instanceId: string,
    input: { payloadJson: string; mimeType: string | null; kind: string | null },
  ): Promise<{ buffer: Buffer; mime: string; fileName?: string }> {
    const inline = tryDecodeInlineMediaFromPayload(input.payloadJson, input.kind, input.mimeType);
    if (inline) return { buffer: inline.buffer, mime: inline.mime };

    const row = await this.instances
      .createQueryBuilder('inst')
      .addSelect('inst.apiKey')
      .where('inst.id = :id', { id: instanceId })
      .getOne();
    if (!row) throw new NotFoundException('Instância não encontrada.');

    let messagePayload: Record<string, unknown>;
    try {
      messagePayload = JSON.parse(input.payloadJson) as Record<string, unknown>;
    } catch {
      throw new BadRequestException('Payload de mídia inválido.');
    }

    const remote = await this.resolveRemoteApi(row);
    const paths = [
      `/chat/getBase64FromMediaMessage/${encodeURIComponent(row.instanceKey)}`,
      `/message/getBase64FromMediaMessage/${encodeURIComponent(row.instanceKey)}`,
      `/chat/downloadMediaMessage/${encodeURIComponent(row.instanceKey)}`,
      `/message/downloadMediaMessage/${encodeURIComponent(row.instanceKey)}`,
    ];

    const requests = this.buildMediaDownloadRequests(messagePayload, input.kind);
    let lastError = '';
    for (const path of paths) {
      for (const body of requests) {
        try {
          const response = await fetch(`${remote.baseUrl}${path}`, {
            method: 'POST',
            headers: {
              apikey: remote.apiKey,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
          });
          const text = await response.text();
          if (!response.ok) {
            lastError = `${response.status}: ${text.slice(0, 240)}`;
            continue;
          }
          let json: Record<string, unknown> = {};
          try {
            json = JSON.parse(text) as Record<string, unknown>;
          } catch {
            lastError = 'Resposta inválida da Evolution.';
            continue;
          }
          const parsed = this.parseEvolutionMediaResponse(json, input.mimeType, input.kind);
          if (parsed) return parsed;
          lastError = 'Evolution não retornou base64 da mídia.';
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
        }
      }
    }

    throw new BadRequestException(
      `Não foi possível baixar a mídia na Evolution (${lastError || 'erro desconhecido'}).`,
    );
  }

  private buildMediaDownloadRequests(
    messagePayload: Record<string, unknown>,
    kind: string | null,
  ): Record<string, unknown>[] {
    const key = (messagePayload.key ?? {}) as Record<string, unknown>;
    const { rawMessage } = resolveMessageEnvelope(messagePayload, key);
    const wrapped = Object.keys(rawMessage).length ? rawMessage : messagePayload.message;
    const inner = unwrapWhatsAppMessageNode((wrapped ?? {}) as Record<string, unknown>);

    const convertToMp4 = kind === 'video' || kind === 'audio';
    const envelopes = [
      { key, message: wrapped },
      { key, message: inner },
      messagePayload,
      { key, message: { ...rawMessage } },
    ];

    const bodies: Record<string, unknown>[] = [];
    const push = (body: Record<string, unknown>) => {
      const sig = JSON.stringify(body);
      if (!bodies.some((item) => JSON.stringify(item) === sig)) bodies.push(body);
    };

    for (const envelope of envelopes) {
      push({ message: envelope });
      if (convertToMp4) {
        push({ message: envelope, convertToMp4: true });
        push({ message: envelope, convertToMp4: false });
      }
    }

    return bodies;
  }

  private async resolveRemoteApi(row: EvolutionInstance): Promise<{ baseUrl: string; apiKey: string }> {
    const platform = await this.systemSettings.readEvolutionPlatformConfig();
    const baseUrl = normalizeEvolutionBaseUrl(platform.baseUrl || row.baseUrl || '');
    const apiKey = String(platform.apiKey || row.apiKey || '').trim();
    if (!apiKey) {
      throw new BadRequestException('Configure a chave da Evolution em Sistema → Configurações.');
    }
    return { baseUrl, apiKey };
  }

  private parseEvolutionMediaResponse(
    json: Record<string, unknown>,
    fallbackMime: string | null,
    kind: string | null,
  ): { buffer: Buffer; mime: string; fileName?: string } | null {
    const base64Raw =
      json.base64 ??
      json.mediaBase64 ??
      json.data ??
      (json.response as Record<string, unknown> | undefined)?.base64 ??
      (json.message as Record<string, unknown> | undefined)?.base64;
    const base64 = String(base64Raw ?? '').trim();
    if (!base64) return null;

    const dataPart = base64.includes(',') ? base64.split(',')[1]! : base64;
    const mime =
      String(json.mimetype ?? json.mimeType ?? fallbackMime ?? '').trim() ||
      (kind === 'image' || kind === 'sticker'
        ? 'image/jpeg'
        : kind === 'audio'
          ? 'audio/ogg; codecs=opus'
          : kind === 'video'
            ? 'video/mp4'
            : 'application/octet-stream');
    const fileName = String(json.fileName ?? '').trim() || undefined;

    return { buffer: Buffer.from(dataPart, 'base64'), mime, fileName };
  }
}
