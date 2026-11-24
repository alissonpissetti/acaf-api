import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Express } from 'express';
import { In, Repository } from 'typeorm';
import { SocialPostLocalStorageService } from '../storage/social-post-local-storage.service';
import { User } from '../users/user.entity';
import type {
  PatchFluxoPublicacaoBody,
  PatchSocialPostAprovacaoBody,
  PatchSocialPostBody,
  SocialCalendarSummaryDto,
  SocialPostDto,
  SocialPostResponsavelDto,
} from './social-posts.dto';
import type { SocialPostAprovacao, SocialPostEtapa, SocialRede } from './social-post.constants';
import { SOCIAL_POST_APROVACAO, SOCIAL_POST_ETAPA } from './social-post.constants';
import { SocialPost } from './social-post.entity';
import { SocialPostArte } from './social-post-arte.entity';
import { SocialPostBuffer } from './social-post-buffer.entity';
import { SocialChannel } from './social-channel.entity';
import {
  assertManualPostResponsavel,
  assertRedesValidForEnvio,
  buildCaption,
  classifyInteraction,
  interactionLabel,
  isConsoleAssigneeUser,
  bufferPostingAllowed,
  requiresManualPosting,
} from './social-post.rules';
import { SocialPostsNotificationsService } from './social-posts-notifications.service';
import { SocialPostsSeedService } from './social-posts-seed.service';

const MAX_ARTE_BYTES = 20 * 1024 * 1024;
const MAX_REEL_VIDEO_BYTES = 100 * 1024 * 1024;

@Injectable()
export class SocialPostsService implements OnModuleInit {
  constructor(
    @InjectRepository(SocialPost)
    private readonly posts: Repository<SocialPost>,
    @InjectRepository(SocialPostArte)
    private readonly artes: Repository<SocialPostArte>,
    @InjectRepository(SocialPostBuffer)
    private readonly bufferLinks: Repository<SocialPostBuffer>,
    @InjectRepository(SocialChannel)
    private readonly channels: Repository<SocialChannel>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly seed: SocialPostsSeedService,
    private readonly postNotifications: SocialPostsNotificationsService,
    private readonly arteStorage: SocialPostLocalStorageService,
  ) {}

  async onModuleInit() {
    await this.seed.seedIfEmpty();
    await this.seed.backfillCaptionsFromSeed();
    await this.relinkAllArtesFromAssets();
  }

  async runSeed(force = false) {
    const seedResult = await this.seed.seedFromJsonFile({ forceUpsert: force });
    const assets = await this.relinkAllArtesFromAssets();
    return { ...seedResult, assets };
  }

  /** Copia de `storage/social-posts/assets/` → `files/` e atualiza URLs servidas pela API. */
  async relinkAllArtesFromAssets(): Promise<{ linked: number; alreadyOk: number; missing: number }> {
    const rows = await this.artes.find({ relations: ['post'] });
    let linked = 0;
    let alreadyOk = 0;
    let missing = 0;

    for (const arte of rows) {
      const postCodigo = arte.post?.codigo ?? '';
      const hadGoogle =
        arte.urlPublica?.includes('googleusercontent') || arte.urlPublica?.includes('drive.google');

      if (!this.arteStorage.canServeArte(arte, postCodigo)) {
        if (hadGoogle) {
          arte.urlPublica = null;
          await this.artes.save(arte);
        }
        missing++;
        continue;
      }

      const materialized = await this.arteStorage.ensureArteFile(arte);
      if (!materialized) {
        missing++;
        continue;
      }

      const needsSave =
        arte.arquivo !== materialized.path ||
        arte.urlPublica !== materialized.publicUrl ||
        hadGoogle;

      if (needsSave) {
        arte.arquivo = materialized.path;
        arte.urlPublica = materialized.publicUrl;
        await this.artes.save(arte);
        linked++;
      } else {
        alreadyOk++;
      }
    }

    return { linked, alreadyOk, missing };
  }

  async listPosts(query?: {
    filter?: string;
    hidePublished?: boolean;
  }): Promise<{ summary: SocialCalendarSummaryDto; posts: SocialPostDto[] }> {
    const rows = await this.posts.find({
      relations: ['artes', 'bufferLinks'],
      order: { agendadoPara: 'ASC', codigo: 'ASC' },
    });
    const artesSorted = (post: SocialPost) =>
      [...(post.artes ?? [])].sort((a, b) => a.ordem - b.ordem);

    const responsavelMap = await this.loadResponsavelMap(
      rows.map((p) => p.responsavelUserId).filter(Boolean) as string[],
    );
    let filtered = rows.map((post) =>
      this.toDto({ ...post, artes: artesSorted(post) }, responsavelMap),
    );

    if (query?.hidePublished) {
      filtered = filtered.filter((p) => p.etapa !== 'publicado');
    }

    const chip = query?.filter?.trim();
    if (chip && chip !== 'all') {
      filtered = filtered.filter((p) => matchesFilter(chip, p));
    }

    return { summary: this.buildSummary(filtered), posts: filtered };
  }

  async getPost(id: string): Promise<SocialPostDto> {
    const post = await this.loadPost(id);
    const responsavelMap = await this.loadResponsavelMap(
      post.responsavelUserId ? [post.responsavelUserId] : [],
    );
    return this.toDto(post, responsavelMap);
  }

  async patchPost(id: string, body: PatchSocialPostBody, userId: string): Promise<SocialPostDto> {
    const post = await this.loadPost(id);
    if (body.titulo !== undefined) post.titulo = body.titulo.trim() || post.titulo;
    if (body.visual !== undefined) post.visual = body.visual;
    if (body.legenda !== undefined) post.legenda = body.legenda;
    if (body.hashtags !== undefined) post.hashtags = body.hashtags;
    if (body.telas !== undefined) post.telas = body.telas;
    if (body.link !== undefined) post.link = body.link;
    if (body.aviso !== undefined) post.aviso = body.aviso;
    if (body.nota !== undefined) post.nota = body.nota;
    if (body.agendadoPara !== undefined) {
      const prev = post.agendadoPara?.toISOString() ?? null;
      const next = body.agendadoPara ? new Date(body.agendadoPara) : null;
      post.agendadoPara = next;
      if (prev !== (next?.toISOString() ?? null)) post.manualReminderSentAt = null;
    }
    let previousResponsavelUserId: string | null = null;
    if (body.responsavelUserId !== undefined) {
      previousResponsavelUserId = post.responsavelUserId;
      const next = body.responsavelUserId?.trim() || null;
      if (next) await this.assertAssigneeUserId(next);
      if (next !== post.responsavelUserId) post.manualReminderSentAt = null;
      post.responsavelUserId = next;
    }
    if (body.redes !== undefined) {
      try {
        assertRedesValidForEnvio(post.envio, body.redes);
      } catch (e) {
        throw new BadRequestException(e instanceof Error ? e.message : 'Redes inválidas.');
      }
      post.redes = body.redes;
    }
    if (body.etapa !== undefined) {
      if (!SOCIAL_POST_ETAPA.includes(body.etapa)) throw new BadRequestException('Etapa inválida.');
      post.etapa = body.etapa;
    }
    try {
      this.validateManualResponsavel(post);
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'Responsável obrigatório.');
    }
    await this.posts.save(post);
    if (body.responsavelUserId !== undefined) {
      void this.postNotifications.onResponsavelChanged(post, previousResponsavelUserId, userId);
    }
    return this.getPost(id);
  }

  async patchFluxoPublicacao(id: string, body: PatchFluxoPublicacaoBody): Promise<SocialPostDto> {
    const post = await this.loadPost(id);
    if (body.etapa !== undefined) {
      if (!SOCIAL_POST_ETAPA.includes(body.etapa)) throw new BadRequestException('Etapa inválida.');
      post.etapa = body.etapa;
    }
    if (body.agendadoPara !== undefined) {
      const prev = post.agendadoPara?.toISOString() ?? null;
      const next = body.agendadoPara ? new Date(body.agendadoPara) : null;
      post.agendadoPara = next;
      if (prev !== (next?.toISOString() ?? null)) post.manualReminderSentAt = null;
    }
    try {
      this.validateManualResponsavel(post);
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'Responsável obrigatório.');
    }
    await this.posts.save(post);
    return this.getPost(id);
  }

  async patchAprovacao(
    id: string,
    body: PatchSocialPostAprovacaoBody,
    userId: string,
  ): Promise<SocialPostDto> {
    if (!SOCIAL_POST_APROVACAO.includes(body.aprovacao)) {
      throw new BadRequestException('Aprovação inválida.');
    }
    const post = await this.loadPost(id);
    post.aprovacao = body.aprovacao;
    if (body.aprovacao === 'aprovado') {
      post.aprovadoPor = userId;
      post.aprovadoEm = new Date();
    } else {
      post.aprovadoPor = null;
      post.aprovadoEm = null;
      if (post.etapa === 'programado') post.etapa = 'rascunho';
    }
    await this.posts.save(post);
    return this.getPost(id);
  }

  async uploadArte(postId: string, file: Express.Multer.File): Promise<SocialPostDto> {
    if (!file?.buffer?.length) throw new BadRequestException('Arquivo inválido.');
    const post = await this.loadPost(postId);
    const isVideo = Boolean(file.mimetype?.startsWith('video/'));
    const isImage = Boolean(file.mimetype?.startsWith('image/'));
    if (post.envio === 'reels') {
      if (!isVideo) throw new BadRequestException('Reels exige vídeo MP4 ou MOV (vertical 9:16).');
      if (file.size > MAX_REEL_VIDEO_BYTES) throw new BadRequestException('Vídeo acima de 100 MB.');
    } else {
      if (!isImage) throw new BadRequestException('Envie imagem PNG, JPG ou WEBP.');
      if (file.size > MAX_ARTE_BYTES) throw new BadRequestException('Imagem acima de 20 MB.');
    }
    const ordem = post.artes?.length ? Math.max(...post.artes.map((a) => a.ordem)) + 1 : 0;
    const arte = await this.artes.save(
      this.artes.create({
        postId,
        ordem,
        nome: file.originalname,
        arquivo: null,
        urlPublica: null,
        largura: null,
        altura: null,
        interacao: null,
      }),
    );
    const { path, publicUrl } = await this.arteStorage.saveUpload(arte.id, file);
    arte.arquivo = path;
    arte.urlPublica = publicUrl;
    await this.artes.save(arte);
    return this.getPost(postId);
  }

  async removeArte(postId: string, arteId: string): Promise<SocialPostDto> {
    await this.loadPost(postId);
    const arte = await this.artes.findOne({ where: { id: arteId, postId } });
    if (!arte) throw new NotFoundException('Arte não encontrada.');
    await this.artes.remove(arte);
    return this.getPost(postId);
  }

  async loadPost(id: string): Promise<SocialPost> {
    const post = await this.posts.findOne({
      where: { id },
      relations: ['artes', 'bufferLinks'],
    });
    if (!post) throw new NotFoundException('Post não encontrado.');
    post.artes = [...(post.artes ?? [])].sort((a, b) => a.ordem - b.ordem);
    post.bufferLinks = [...(post.bufferLinks ?? [])].sort(
      (a, b) => a.rede.localeCompare(b.rede) || a.ordemArte - b.ordemArte,
    );
    return post;
  }

  async saveEtapa(postId: string, etapa: SocialPostEtapa, nota?: string | null) {
    const post = await this.loadPost(postId);
    post.etapa = etapa;
    if (nota !== undefined) post.nota = nota;
    await this.posts.save(post);
  }

  async channelMap(): Promise<Record<string, SocialChannel>> {
    const rows = await this.channels.find();
    const map: Record<string, SocialChannel> = {};
    for (const row of rows) map[row.rede] = row;
    return map;
  }

  private async loadResponsavelMap(ids: string[]): Promise<Map<string, SocialPostResponsavelDto>> {
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) return new Map();
    const rows = await this.users.find({ where: { id: In(unique) } });
    const map = new Map<string, SocialPostResponsavelDto>();
    for (const u of rows) {
      map.set(u.id, {
        id: u.id,
        name: u.name,
        email: u.email,
        mobilePhone: u.mobilePhone ?? null,
      });
    }
    return map;
  }

  private async assertAssigneeUserId(userId: string): Promise<void> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!isConsoleAssigneeUser(user)) {
      throw new BadRequestException('Responsável deve ser um usuário ativo do console admin.');
    }
  }

  private validateManualResponsavel(post: SocialPost): void {
    const manualRequired = requiresManualPosting(post.envio, post.artes ?? []);
    assertManualPostResponsavel({
      manualRequired,
      agendadoPara: post.agendadoPara,
      etapa: post.etapa,
      responsavelUserId: post.responsavelUserId,
    });
  }

  private buildSummary(posts: SocialPostDto[]): SocialCalendarSummaryDto {
    const feed = posts.filter((p) => p.envio === 'feed');
    return {
      totalFeed: feed.length,
      publishedFeed: feed.filter((p) => p.etapa === 'publicado').length,
      scheduled: posts.filter((p) => p.etapa === 'programado').length,
      approved: posts.filter((p) => p.aprovacao === 'aprovado').length,
      pending: posts.filter((p) => p.aprovacao === 'pendente').length,
      adjust: posts.filter((p) => p.aprovacao === 'ajustar').length,
    };
  }

  private toDto(
    post: SocialPost,
    responsavelMap: Map<string, SocialPostResponsavelDto> = new Map(),
  ): SocialPostDto {
    const artes = [...(post.artes ?? [])].sort((a, b) => a.ordem - b.ordem);
    const manualPostingRequired = requiresManualPosting(post.envio, artes);
    const responsavel = post.responsavelUserId
      ? (responsavelMap.get(post.responsavelUserId) ?? null)
      : null;
    return {
      id: post.id,
      codigo: post.codigo,
      numeroExibicao: post.numeroExibicao,
      tipo: post.tipo,
      formato: post.formato,
      envio: post.envio,
      pilar: post.pilar,
      titulo: post.titulo,
      visual: post.visual,
      legenda: post.legenda,
      hashtags: post.hashtags,
      telas: post.telas,
      link: post.link,
      aviso: post.aviso,
      agendadoPara: post.agendadoPara?.toISOString() ?? null,
      aprovacao: post.aprovacao,
      etapa: post.etapa,
      nota: post.nota,
      redes: post.redes as SocialRede[],
      aprovadoPor: post.aprovadoPor,
      aprovadoEm: post.aprovadoEm?.toISOString() ?? null,
      interactionClass: classifyInteraction(post.envio, artes),
      interactionLabel: interactionLabel(post.envio, artes),
      manualPostingRequired,
      bufferAllowed: bufferPostingAllowed(post.envio, artes),
      responsavelUserId: post.responsavelUserId,
      responsavel,
      manualReminderSentAt: post.manualReminderSentAt?.toISOString() ?? null,
      captionPreview: buildCaption(post.legenda, post.hashtags),
      artes: artes.map((a) => ({
        id: a.id,
        ordem: a.ordem,
        nome: a.nome,
        arquivo: a.arquivo,
        urlPublica: this.arteStorage.resolvePublicUrl(a, post.codigo),
        driveId: a.driveId,
        largura: a.largura,
        altura: a.altura,
        interacao: a.interacao,
      })),
      bufferLinks: (post.bufferLinks ?? []).map((b) => ({
        id: b.id,
        rede: b.rede,
        bufferPostId: b.bufferPostId,
        bufferChannelId: b.bufferChannelId,
        ordemArte: b.ordemArte,
        status: b.status,
        dueAt: b.dueAt?.toISOString() ?? null,
        externalLink: b.externalLink,
        erro: b.erro,
        manual: Boolean(b.manual),
        sincronizadoEm: b.sincronizadoEm?.toISOString() ?? null,
      })),
    };
  }
}

function matchesFilter(chip: string, post: SocialPostDto): boolean {
  switch (chip) {
    case 'pending':
      return post.aprovacao === 'pendente';
    case 'adjust':
      return post.aprovacao === 'ajustar';
    case 'approved':
      return post.aprovacao === 'aprovado';
    case 'scheduled':
      return post.etapa === 'programado';
    case 'published':
      return post.etapa === 'publicado';
    case 'buffer_auto':
      return post.interactionClass === 'none';
    case 'buffer_manual':
      return post.interactionClass === 'full_manual' || post.interactionClass === 'mixed';
    case 'reels':
      return post.envio === 'reels';
    default:
      return true;
  }
}