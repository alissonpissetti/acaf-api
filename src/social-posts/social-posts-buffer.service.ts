import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { BufferClient } from '../buffer/buffer.client';
import type { BufferAssetInput, BufferCreatePostInput } from '../buffer/buffer.types';
import { SocialPostBuffer } from './social-post-buffer.entity';
import {
  DEFAULT_BUFFER_CHANNELS,
  SOCIAL_BUFFER_STATUS,
  SOCIAL_MANUAL_ORDEM_ARTE,
  type SocialBufferStatus,
  type SocialRede,
} from './social-post.constants';
import type { PatchManualCanalBody } from './social-posts.dto';
import { planBufferUnits } from './social-post-buffer.planner';
import {
  assertBufferPostingAllowed,
  assertCanScheduleOrPublish,
  assertRedesValidForEnvio,
  assertScheduleTimeInFuture,
  buildCaption,
  defaultRedesForEnvio,
  deriveEtapaFromBufferStatuses,
  effectiveStatusesForEtapa,
  toBufferDueAtIso,
} from './social-post.rules';
import { SocialPostsService } from './social-posts.service';
import { SocialPostLocalStorageService } from '../storage/social-post-local-storage.service';

type BufferActionResult = {
  post: Awaited<ReturnType<SocialPostsService['getPost']>>;
  errors: string[];
};

@Injectable()
export class SocialPostsBufferService {
  private readonly logger = new Logger(SocialPostsBufferService.name);

  constructor(
    private readonly postsService: SocialPostsService,
    private readonly bufferClient: BufferClient,
    private readonly arteStorage: SocialPostLocalStorageService,
    @InjectRepository(SocialPostBuffer)
    private readonly bufferLinks: Repository<SocialPostBuffer>,
  ) {}

  async sendDraft(postId: string, onlyRedes?: SocialRede[]): Promise<BufferActionResult> {
    return this.pushToBuffer(postId, { saveToDraft: true }, onlyRedes);
  }

  async schedule(postId: string, onlyRedes?: SocialRede[]): Promise<BufferActionResult> {
    const post = await this.postsService.loadPost(postId);
    assertCanScheduleOrPublish(post.aprovacao);
    if (!post.agendadoPara) throw new BadRequestException('Defina data e horário.');
    assertScheduleTimeInFuture(post.agendadoPara);
    return this.pushToBuffer(postId, { saveToDraft: false, mode: 'customScheduled' }, onlyRedes);
  }

  async publishNow(postId: string, onlyRedes?: SocialRede[]): Promise<BufferActionResult> {
    const post = await this.postsService.loadPost(postId);
    assertCanScheduleOrPublish(post.aprovacao);
    return this.pushToBuffer(postId, { saveToDraft: false, mode: 'shareNow' }, onlyRedes);
  }

  async revertDraft(postId: string): Promise<BufferActionResult> {
    const links = await this.bufferLinks.find({ where: { postId } });
    const errors: string[] = [];
    for (const link of links) {
      if (link.manual || !link.bufferPostId || link.status === 'sent') continue;
      try {
        const result = await this.bufferClient.editPost({
          postId: link.bufferPostId,
          saveToDraft: true,
        });
        if (!result.ok) errors.push(result.message);
        else {
          link.status = 'draft';
          await this.bufferLinks.save(link);
        }
      } catch (e) {
        errors.push(e instanceof Error ? e.message : 'Erro ao reverter rascunho.');
      }
    }
    await this.refreshEtapa(postId);
    return { post: await this.postsService.getPost(postId), errors };
  }

  async removeRedeFromBuffer(postId: string, rede: SocialRede): Promise<BufferActionResult> {
    const links = await this.bufferLinks.find({ where: { postId, rede } });
    const errors: string[] = [];
    for (const link of links) {
      if (link.manual || !link.bufferPostId) continue;
      try {
        const result = await this.bufferClient.deletePost(link.bufferPostId);
        if (!result.ok) errors.push(result.message);
      } catch (e) {
        errors.push(e instanceof Error ? e.message : 'Erro ao remover do Buffer.');
      }
    }
    await this.bufferLinks.delete({ postId, rede, manual: false });
    await this.refreshEtapa(postId);
    return { post: await this.postsService.getPost(postId), errors };
  }

  async removeFromBuffer(postId: string): Promise<BufferActionResult> {
    const post = await this.postsService.loadPost(postId);
    const links = post.bufferLinks ?? [];
    const errors: string[] = [];
    for (const link of links) {
      if (link.manual || !link.bufferPostId) continue;
      try {
        const result = await this.bufferClient.deletePost(link.bufferPostId);
        if (!result.ok) errors.push(result.message);
      } catch (e) {
        errors.push(e instanceof Error ? e.message : 'Erro ao remover do Buffer.');
      }
    }
    await this.bufferLinks.delete({ postId, manual: false });
    await this.refreshEtapa(postId);
    return { post: await this.postsService.getPost(postId), errors };
  }

  async setManualCanal(
    postId: string,
    rede: SocialRede,
    body: PatchManualCanalBody,
  ): Promise<BufferActionResult> {
    const post = await this.postsService.loadPost(postId);
    try {
      assertRedesValidForEnvio(post.envio, [rede]);
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'Rede inválida.');
    }

    if (body.status === 'clear') {
      await this.bufferLinks.delete({
        postId,
        rede,
        manual: true,
      });
      await this.refreshEtapa(postId);
      return { post: await this.postsService.getPost(postId), errors: [] };
    }

    if (!SOCIAL_BUFFER_STATUS.includes(body.status)) {
      throw new BadRequestException('Status inválido.');
    }

    const cfg = DEFAULT_BUFFER_CHANNELS[rede];
    let row = await this.bufferLinks.findOne({
      where: { postId, rede, ordemArte: SOCIAL_MANUAL_ORDEM_ARTE },
    });
    if (!row) {
      row = this.bufferLinks.create({
        postId,
        rede,
        ordemArte: SOCIAL_MANUAL_ORDEM_ARTE,
        bufferChannelId: cfg.bufferChannelId,
        manual: true,
        bufferPostId: null,
        status: body.status,
      });
    } else {
      row.manual = true;
      row.bufferPostId = null;
      row.status = body.status;
    }
    if (body.externalLink !== undefined) {
      row.externalLink = body.externalLink?.trim() || null;
    }
    if (body.dueAt !== undefined) {
      row.dueAt = body.dueAt ? new Date(body.dueAt) : null;
    } else if (body.status === 'scheduled' && !row.dueAt && post.agendadoPara) {
      row.dueAt = post.agendadoPara;
    }
    row.erro = null;
    row.sincronizadoEm = new Date();
    await this.bufferLinks.save(row);
    await this.refreshEtapa(postId);
    return { post: await this.postsService.getPost(postId), errors: [] };
  }

  /** Legado — marca etapa publicado; prefira setManualCanal por rede. */
  async markPublishedManual(postId: string): Promise<BufferActionResult> {
    const post = await this.postsService.loadPost(postId);
    const redes = post.redes?.length ? post.redes : defaultRedesForEnvio(post.envio);
    for (const rede of redes) {
      await this.setManualCanal(postId, rede, { status: 'sent' });
    }
    return { post: await this.postsService.getPost(postId), errors: [] };
  }

  async syncPost(postId: string, onlyRede?: SocialRede): Promise<BufferActionResult> {
    const links = await this.bufferLinks.find({
      where: onlyRede ? { postId, rede: onlyRede } : { postId },
    });
    const errors: string[] = [];
    for (const link of links) {
      if (link.manual || !link.bufferPostId) continue;
      try {
        const remote = await this.bufferClient.getPost(link.bufferPostId);
        if (remote) {
          link.status = mapRemoteStatus(remote.status);
          link.dueAt = remote.dueAt ? new Date(remote.dueAt) : link.dueAt;
          link.externalLink = remote.externalLink ?? link.externalLink;
          link.erro = remote.error?.message ?? null;
          link.sincronizadoEm = new Date();
          await this.bufferLinks.save(link);
        }
      } catch (e) {
        errors.push(e instanceof Error ? e.message : 'Falha ao sincronizar.');
      }
    }
    await this.refreshEtapa(postId);
    return { post: await this.postsService.getPost(postId), errors };
  }

  async syncAll(): Promise<{ synced: number; errors: string[] }> {
    const links = await this.bufferLinks.find({
      where: { status: In(['scheduled', 'sending', 'error']) },
    });
    const errors: string[] = [];
    const postIds = new Set<string>();
    for (const link of links) {
      postIds.add(link.postId);
      if (link.manual || !link.bufferPostId) continue;
      try {
        const remote = await this.bufferClient.getPost(link.bufferPostId);
        if (remote) {
          link.status = mapRemoteStatus(remote.status);
          link.dueAt = remote.dueAt ? new Date(remote.dueAt) : link.dueAt;
          link.externalLink = remote.externalLink ?? link.externalLink;
          link.erro = remote.error?.message ?? null;
          link.sincronizadoEm = new Date();
          await this.bufferLinks.save(link);
        }
      } catch (e) {
        errors.push(e instanceof Error ? e.message : 'Falha na sincronização.');
      }
    }
    for (const id of postIds) await this.refreshEtapa(id);
    return { synced: postIds.size, errors };
  }

  private async refreshEtapa(postId: string) {
    const post = await this.postsService.loadPost(postId);
    const links = post.bufferLinks ?? [];
    const redes = post.redes?.length ? post.redes : defaultRedesForEnvio(post.envio);
    const effective = effectiveStatusesForEtapa(
      redes,
      links.map((l) => ({ rede: l.rede, status: l.status, manual: l.manual })),
    );
    if (effective.length) {
      post.etapa = deriveEtapaFromBufferStatuses(effective, post.etapa);
    }
    const linksText = links
      .filter((l) => l.externalLink)
      .map((l) => `${l.rede}: ${l.externalLink}`)
      .join(' · ');
    if (linksText && post.etapa === 'publicado' && !post.nota?.includes(linksText)) {
      post.nota = [post.nota?.trim(), linksText].filter(Boolean).join('\n');
    }
    await this.postsService.saveEtapa(postId, post.etapa, post.nota);
  }

  private async pushToBuffer(
    postId: string,
    opts: { saveToDraft: boolean; mode?: 'customScheduled' | 'shareNow' },
    onlyRedes?: SocialRede[],
  ): Promise<BufferActionResult> {
    const post = await this.postsService.loadPost(postId);
    try {
      assertBufferPostingAllowed(post.envio, post.artes ?? []);
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'Buffer indisponível.');
    }
    const channels = await this.postsService.channelMap();
    const artes = (post.artes ?? []).map((a) => ({
      id: a.id,
      ordem: a.ordem,
      urlPublica: this.arteStorage.resolvePublicUrl(a, post.codigo),
      interacao: a.interacao,
    }));
    let units = planBufferUnits({
      envio: post.envio,
      redes: post.redes,
      artes,
      legenda: post.legenda,
      hashtags: post.hashtags,
      postLink: post.link,
    }).filter((u) => !u.skip);

    if (onlyRedes?.length) {
      const allowed = new Set(onlyRedes);
      units = units.filter((u) => allowed.has(u.rede));
    }

    if (!units.length) {
      throw new BadRequestException('Nenhuma unidade elegível para o Buffer (interação manual ou sem arte).');
    }

    const errors: string[] = [];
    const caption = buildCaption(post.legenda, post.hashtags);
    const dueAt =
      post.agendadoPara && opts.mode === 'customScheduled'
        ? toBufferDueAtIso(post.agendadoPara)
        : undefined;

    for (const unit of units) {
      const channel = channels[unit.rede];
      if (!channel) {
        errors.push(`Canal Buffer não configurado para ${unit.rede}.`);
        continue;
      }

      const manualPublished = await this.bufferLinks.findOne({
        where: { postId, rede: unit.rede, manual: true, status: 'sent' },
      });
      if (manualPublished) {
        errors.push(`${unit.rede}: publicado manualmente (Meta/app) — limpe o status manual para usar o Buffer.`);
        continue;
      }
      const assetUrls = unit.arteIds
        .map((id) => artes.find((a) => a.id === id)?.urlPublica)
        .filter(Boolean) as string[];

      const input: BufferCreatePostInput = {
        channelId: channel.bufferChannelId,
        schedulingType: unit.schedulingType,
        text: unit.includeText ? caption : undefined,
        saveToDraft: opts.saveToDraft,
        mode: opts.mode ?? (opts.saveToDraft ? undefined : 'customScheduled'),
        dueAt,
        assets: assetUrls.map((url) => buildBufferAsset(post.envio, url, post.titulo)),
        metadata: this.buildMetadata(post.envio, unit.rede, unit.instagramLinkSticker),
      };

      const existing = await this.bufferLinks.findOne({
        where: { postId, rede: unit.rede, ordemArte: unit.arteOrdem },
      });

      if (existing?.status === 'sent' && !opts.saveToDraft) {
        errors.push(`${unit.rede}: já publicado no Buffer — use outro canal ou remova o vínculo antes de reenviar.`);
        continue;
      }

      try {
        const result = existing?.bufferPostId
          ? await this.bufferClient.editPost({ postId: existing.bufferPostId, ...input })
          : await this.bufferClient.createPost(input);
        if (!result.ok) {
          errors.push(`${unit.rede}: ${result.message}`);
          continue;
        }
        const row =
          existing ??
          this.bufferLinks.create({
            postId,
            rede: unit.rede,
            ordemArte: unit.arteOrdem,
            bufferChannelId: channel.bufferChannelId,
          });
        row.bufferPostId = result.post.id;
        row.status = mapRemoteStatus(result.post.status);
        row.dueAt = result.post.dueAt ? new Date(result.post.dueAt) : post.agendadoPara;
        row.externalLink = result.post.externalLink ?? null;
        row.erro = result.post.error?.message ?? null;
        row.sincronizadoEm = new Date();
        await this.bufferLinks.save(row);
      } catch (e) {
        errors.push(e instanceof Error ? e.message : 'Erro no Buffer.');
      }
    }

    if (!opts.saveToDraft && errors.length === 0) {
      await this.postsService.saveEtapa(
        postId,
        opts.mode === 'shareNow' ? 'publicado' : 'programado',
      );
    }

    return { post: await this.postsService.getPost(postId), errors };
  }

  private buildMetadata(
    envio: string,
    rede: string,
    instagramLink?: string,
  ): BufferCreatePostInput['metadata'] {
    if (rede === 'instagram') {
      const type = envio === 'stories' ? 'story' : envio === 'reels' ? 'reel' : 'post';
      return {
        instagram: {
          type,
          shouldShareToFeed: type === 'reel',
          ...(instagramLink ? { link: instagramLink } : {}),
        },
      };
    }
    if (rede === 'facebook' && envio === 'stories') {
      return { facebook: { type: 'story' } };
    }
    if (rede === 'facebook') return { facebook: { type: 'post' } };
    return undefined;
  }
}

function buildBufferAsset(envio: string, url: string, altOrTitle: string): BufferAssetInput {
  if (envio === 'reels') {
    return { video: { url, metadata: { thumbnailOffset: 1500 } } };
  }
  return { image: { url, metadata: { altText: altOrTitle } } };
}

function mapRemoteStatus(status: string): SocialBufferStatus {
  const v = status.toLowerCase();
  if (v === 'scheduled' || v === 'sending' || v === 'sent' || v === 'error' || v === 'draft') {
    return v;
  }
  return 'draft';
}