import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SocialPostArte } from './social-post-arte.entity';
import { SocialPostArteStorageService } from '../storage/social-post-arte-storage.service';
import { SocialPostLocalStorageService } from '../storage/social-post-local-storage.service';

@ApiTags('Calendário de redes · mídia')
@Controller('social-posts')
export class SocialPostsMediaController {
  constructor(
    @InjectRepository(SocialPostArte)
    private readonly artes: Repository<SocialPostArte>,
    private readonly arteFiles: SocialPostArteStorageService,
    private readonly arteLocal: SocialPostLocalStorageService,
  ) {}

  /**
   * Compatibilidade: redireciona para URL pública no storage.
   * Se a arte ainda estiver só no disco local, sobe para o Nextcloud e redireciona.
   */
  @Get('media/:arteId')
  async serveMedia(@Param('arteId') arteId: string, @Res() res: Response): Promise<void> {
    const arte = await this.artes.findOne({ where: { id: arteId }, relations: ['post'] });
    if (!arte) throw new NotFoundException('Arte não encontrada.');

    let url = this.arteFiles.isRemoteArte(arte) ? arte.urlPublica : null;
    if (!url) {
      const uploaded = await this.arteFiles.ensureRemoteArte(arte);
      if (uploaded) {
        arte.arquivo = uploaded.path;
        arte.urlPublica = uploaded.publicUrl;
        await this.artes.save(arte);
        url = uploaded.publicUrl;
      }
    }

    if (url) {
      res.redirect(302, url);
      return;
    }

    if (!this.arteLocal.arteFileExists(arte)) {
      throw new NotFoundException('Arte não encontrada no storage.');
    }

    const { stream, mime } = await this.arteLocal.readArteStream(arte);
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'public, max-age=300');
    stream.pipe(res);
  }
}