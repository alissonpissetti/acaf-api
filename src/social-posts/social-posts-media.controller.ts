import { basename } from 'node:path';
import { Controller, Get, NotFoundException, Param, Res, StreamableFile } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SocialPostArte } from './social-post-arte.entity';
import { SocialPostLocalStorageService } from '../storage/social-post-local-storage.service';

@ApiTags('Calendário de redes · mídia')
@Controller('social-posts')
export class SocialPostsMediaController {
  constructor(
    @InjectRepository(SocialPostArte)
    private readonly artes: Repository<SocialPostArte>,
    private readonly storage: SocialPostLocalStorageService,
  ) {}

  /** Público: preview no admin e URL para o Buffer (precisa ser acessível na internet em produção). */
  @Get('media/:arteId')
  async serveMedia(
    @Param('arteId') arteId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const arte = await this.artes.findOne({ where: { id: arteId }, relations: ['post'] });
    if (!arte) throw new NotFoundException('Arte não encontrada.');
    const materialized = await this.storage.ensureArteFile(arte);
    if (materialized) {
      arte.arquivo = materialized.path;
      arte.urlPublica = materialized.publicUrl;
      await this.artes.save(arte);
    }
    const { stream, mime } = await this.storage.readArteStream(arte);
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    const name = arte.nome?.trim() || basename(arte.arquivo ?? arteId);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(name)}"`);
    return new StreamableFile(stream);
  }
}