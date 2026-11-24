import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Repository } from 'typeorm';
import type { SocialPostAprovacao, SocialPostEnvio, SocialPostEtapa, SocialPostTipo, SocialRede } from './social-post.constants';
import { DEFAULT_BUFFER_CHANNELS } from './social-post.constants';
import { SocialPost } from './social-post.entity';
import { SocialPostArte } from './social-post-arte.entity';
import { SocialPostBuffer } from './social-post-buffer.entity';
import { defaultRedesForEnvio } from './social-post.rules';
import { SocialPostArteStorageService } from '../storage/social-post-arte-storage.service';
import { SocialPostLocalStorageService } from '../storage/social-post-local-storage.service';

type SeedArte = {
  nome?: string;
  drive_id?: string;
  largura?: number;
  altura?: number;
  interacao?: string | null;
};

type SeedPost = {
  id: string;
  n?: string;
  tipo?: string;
  formato?: string;
  pilar?: string;
  titulo?: string;
  visual?: string;
  legenda?: string;
  hashtags?: string;
  telas?: string[];
  link?: string;
  aviso?: string;
  data?: string;
  hora?: string;
  aprovacao?: string;
  etapa?: string;
  nota?: string;
  tipo_envio?: string;
  artes?: SeedArte[];
  buffer?: {
    ids?: string[];
    status?: string;
    due?: string | null;
    link?: string | null;
    error?: string | null;
  };
};

type SeedFile = {
  posts: SeedPost[];
};

@Injectable()
export class SocialPostsSeedService {
  private readonly logger = new Logger(SocialPostsSeedService.name);

  constructor(
    @InjectRepository(SocialPost)
    private readonly posts: Repository<SocialPost>,
    @InjectRepository(SocialPostArte)
    private readonly artes: Repository<SocialPostArte>,
    @InjectRepository(SocialPostBuffer)
    private readonly buffer: Repository<SocialPostBuffer>,
    private readonly arteFiles: SocialPostArteStorageService,
    private readonly arteLocal: SocialPostLocalStorageService,
  ) {}

  resolveSeedPath(): string | null {
    const candidates = [
      join(process.cwd(), 'scripts/seeds/movly-posts-seed.json'),
      join(process.cwd(), '../movly-posts-seed.json'),
    ];
    return candidates.find((p) => existsSync(p)) ?? null;
  }

  async seedIfEmpty(): Promise<void> {
    const count = await this.posts.count();
    if (count > 0) return;
    await this.seedFromJsonFile({ forceUpsert: false });
  }

  async seedFromJsonFile(options?: { forceUpsert?: boolean }): Promise<{ inserted: number; updated: number }> {
    const path = this.resolveSeedPath();
    if (!path) {
      this.logger.warn('movly-posts-seed.json não encontrado.');
      return { inserted: 0, updated: 0 };
    }
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as SeedFile;
    let inserted = 0;
    let updated = 0;

    for (const row of raw.posts ?? []) {
      const codigo = String(row.id ?? '').trim();
      if (!codigo) continue;
      const envio = normalizeEnvio(row.tipo_envio);
      const tipo = normalizeTipo(row.tipo, envio);
      const agendadoPara = parseAgendado(row.data, row.hora);
      const redes = defaultRedesForEnvio(envio);

      let post = await this.posts.findOne({ where: { codigo }, relations: ['artes', 'bufferLinks'] });
      const isNew = !post;
      if (!post) {
        post = this.posts.create({ codigo } as SocialPost);
      } else if (!options?.forceUpsert) {
        continue;
      }

      post.numeroExibicao = String(row.n ?? codigo);
      post.tipo = tipo;
      post.formato = row.formato?.trim() || null;
      post.envio = envio;
      post.pilar = row.pilar?.trim() || null;
      post.titulo = row.titulo?.trim() || codigo;
      post.visual = row.visual?.trim() || null;
      const captions = resolveLegendaHashtags(row);
      post.legenda = captions.legenda;
      post.hashtags = captions.hashtags;
      post.telas = row.telas?.length ? row.telas : null;
      post.link = row.link?.trim() || null;
      post.aviso = row.aviso?.trim() || null;
      post.agendadoPara = agendadoPara;
      post.aprovacao = normalizeAprovacao(row.aprovacao);
      post.etapa = normalizeEtapa(row.etapa);
      post.nota = row.nota?.trim() || null;
      post.redes = redes;

      const saved = await this.posts.save(post);

      await this.artes.delete({ postId: saved.id });
      const arteRows: SocialPostArte[] = (row.artes ?? []).map((a, index) =>
        this.artes.create({
          postId: saved.id,
          ordem: index,
          nome: a.nome?.trim() || null,
          driveId: a.drive_id?.trim() || null,
          urlPublica: null,
          arquivo: null,
          largura: a.largura ?? null,
          altura: a.altura ?? null,
          interacao: normalizeInteracao(a.interacao),
        }),
      );
      if (arteRows.length) {
        const savedArtes = await this.artes.save(arteRows);
        for (const arte of savedArtes) {
          const source = this.arteLocal.findSeedAssetPath(saved.codigo, arte.nome, arte.driveId);
          if (!source) continue;
          const { path, publicUrl } = await this.arteFiles.uploadFromLocalFile(saved.id, arte, source);
          arte.arquivo = path;
          arte.urlPublica = publicUrl;
          await this.artes.save(arte);
        }
      }

      if (row.buffer?.ids?.length) {
        await this.buffer.delete({ postId: saved.id });
        const status = normalizeBufferStatus(row.buffer.status);
        const channel = DEFAULT_BUFFER_CHANNELS.instagram;
        for (let i = 0; i < row.buffer.ids.length; i++) {
          await this.buffer.save(
            this.buffer.create({
              postId: saved.id,
              rede: 'instagram',
              bufferPostId: row.buffer.ids[i]!,
              bufferChannelId: channel.bufferChannelId,
              ordemArte: i,
              status,
              dueAt: row.buffer.due ? new Date(row.buffer.due) : agendadoPara,
              externalLink: row.buffer.link,
              erro: row.buffer.error,
              sincronizadoEm: new Date(),
            }),
          );
        }
      }

      if (isNew) inserted++;
      else updated++;
    }

    this.logger.log(`Seed calendário redes: ${inserted} inseridos, ${updated} atualizados.`);
    return { inserted, updated };
  }

  /** Preenche legenda/hashtags vazios no banco a partir do JSON (sem alterar artes). */
  async backfillCaptionsFromSeed(): Promise<number> {
    const path = this.resolveSeedPath();
    if (!path) return 0;
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as SeedFile;
    let filled = 0;
    for (const row of raw.posts ?? []) {
      const codigo = String(row.id ?? '').trim();
      if (!codigo) continue;
      const post = await this.posts.findOne({ where: { codigo } });
      if (!post) continue;
      const { legenda, hashtags } = resolveLegendaHashtags(row);
      let changed = false;
      if (!post.legenda?.trim() && legenda) {
        post.legenda = legenda;
        changed = true;
      }
      if (!post.hashtags?.trim() && hashtags) {
        post.hashtags = hashtags;
        changed = true;
      }
      if (changed) {
        await this.posts.save(post);
        filled++;
      }
    }
    if (filled) this.logger.log(`Legendas/hashtags preenchidas em ${filled} post(s) a partir do seed.`);
    return filled;
  }
}

export function resolveLegendaHashtags(row: SeedPost): { legenda: string | null; hashtags: string | null } {
  const fromSeedLegenda = row.legenda?.trim() || null;
  const fromSeedHashtags = row.hashtags?.trim() || null;
  const legenda =
    fromSeedLegenda ||
    (row.telas?.length
      ? `Roteiro:\n\n${row.telas.map((t, i) => `${i + 1}. ${t}`).join('\n')}`
      : row.titulo?.trim() || null);
  const hashtags = fromSeedHashtags || hashtagsForPilar(row.pilar);
  return { legenda, hashtags };
}

function hashtagsForPilar(pilar?: string | null): string {
  const p = String(pilar ?? '').toLowerCase();
  if (p.includes('rh') || p.includes('empresa')) {
    return '#Movly #RH #BenefíciosCorporativos #BemEstarCorporativo';
  }
  if (p.includes('academia') || p.includes('estúdio')) {
    return '#Movly #AcademiaParceira #GestãoDeAcademia';
  }
  if (p.includes('lançamento')) return '#Movly #Lançamento #BemEstarCorporativo';
  if (p.includes('vida leve')) return '#Movly #VidaLeve #SeMexer #BemEstar';
  if (p.includes('como funciona')) return '#Movly #MovlyEmMovimento #ComoFunciona #BemEstar';
  if (p.includes('rede')) return '#Movly #MovlyEmMovimento #BemEstar #SeMexer';
  return '#Movly #BemEstar #BemEstarCorporativo';
}

function normalizeEnvio(raw?: string): SocialPostEnvio {
  const v = String(raw ?? 'feed').toLowerCase();
  if (v === 'stories' || v === 'reels') return v;
  return 'feed';
}

function normalizeTipo(raw?: string, envio?: SocialPostEnvio): SocialPostTipo {
  const t = String(raw ?? '').toLowerCase();
  if (t.includes('stor')) return 'stories';
  if (envio === 'stories') return 'stories';
  return 'feed';
}

function normalizeAprovacao(raw?: string): SocialPostAprovacao {
  const v = String(raw ?? 'pendente').toLowerCase();
  if (v === 'aprovado' || v === 'ajustar') return v;
  return 'pendente';
}

function normalizeEtapa(raw?: string): SocialPostEtapa {
  const v = String(raw ?? 'rascunho').toLowerCase();
  if (v === 'programado' || v === 'publicado') return v;
  return 'rascunho';
}

function normalizeInteracao(raw?: string | null): 'link' | 'manual' | null {
  if (raw === 'link' || raw === 'manual') return raw;
  return null;
}

function normalizeBufferStatus(raw?: string): import('./social-post.constants').SocialBufferStatus {
  const v = String(raw ?? 'draft').toLowerCase();
  if (v === 'scheduled' || v === 'sending' || v === 'sent' || v === 'error') return v;
  return 'draft';
}

function parseAgendado(data?: string, hora?: string): Date | null {
  if (!data) return null;
  const time = hora?.trim() || '12:00';
  const iso = `${data}T${time.length === 5 ? `${time}:00` : time}-03:00`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}