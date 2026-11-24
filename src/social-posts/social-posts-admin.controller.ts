import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../access-control/require-permissions.decorator';
import { PermissionsGuard } from '../access-control/permissions.guard';
import type {
  PatchFluxoPublicacaoBody,
  PatchManualCanalBody,
  PatchSocialPostAprovacaoBody,
  PatchSocialPostBody,
} from './social-posts.dto';
import { SocialPostsBufferService } from './social-posts-buffer.service';
import { SocialPostsService } from './social-posts.service';

type AuthRequest = Request & { user: { userId: string } };

@ApiTags('Admin · Calendário de redes')
@ApiBearerAuth('admin-jwt')
@Controller('admin/social-posts')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SocialPostsAdminController {
  constructor(
    private readonly posts: SocialPostsService,
    private readonly buffer: SocialPostsBufferService,
  ) {}

  @Get()
  @RequirePermissions('marketing.redes-sociais')
  list(
    @Query('filter') filter?: string,
    @Query('hidePublished') hidePublished?: string,
  ) {
    return this.posts.listPosts({
      filter,
      hidePublished: hidePublished === '1' || hidePublished === 'true',
    });
  }

  @Get(':id')
  @RequirePermissions('marketing.redes-sociais')
  get(@Param('id') id: string) {
    return this.posts.getPost(id);
  }

  @Patch(':id')
  @RequirePermissions('marketing.redes-sociais.manage')
  patch(@Param('id') id: string, @Body() body: PatchSocialPostBody, @Req() req: AuthRequest) {
    return this.posts.patchPost(id, body, req.user.userId);
  }

  @Patch(':id/fluxo-publicacao')
  @RequirePermissions('marketing.redes-sociais.manage', 'marketing.redes-sociais.publicar')
  patchFluxo(@Param('id') id: string, @Body() body: PatchFluxoPublicacaoBody) {
    return this.posts.patchFluxoPublicacao(id, body);
  }

  @Patch(':id/canais/:rede/manual')
  @RequirePermissions('marketing.redes-sociais.manage', 'marketing.redes-sociais.publicar')
  patchManualCanal(
    @Param('id') id: string,
    @Param('rede') rede: string,
    @Body() body: PatchManualCanalBody,
  ) {
    const r = parseSingleRede(rede);
    if (!r) throw new BadRequestException('Rede inválida.');
    return this.buffer.setManualCanal(id, r, body);
  }

  @Patch(':id/aprovacao')
  @RequirePermissions('marketing.redes-sociais.aprovar')
  async patchAprovacao(
    @Param('id') id: string,
    @Body() body: PatchSocialPostAprovacaoBody,
    @Req() req: AuthRequest,
  ) {
    const updated = await this.posts.patchAprovacao(id, body, req.user.userId);
    if (body.aprovacao === 'pendente' || body.aprovacao === 'ajustar') {
      await this.buffer.revertDraft(id);
      return this.posts.getPost(id);
    }
    return updated;
  }

  @Post(':id/artes')
  @RequirePermissions('marketing.redes-sociais.manage')
  @UseInterceptors(FileInterceptor('file'))
  uploadArte(@Param('id') id: string, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Envie um arquivo.');
    return this.posts.uploadArte(id, file);
  }

  @Delete(':id/artes/:arteId')
  @RequirePermissions('marketing.redes-sociais.manage')
  removeArte(@Param('id') id: string, @Param('arteId') arteId: string) {
    return this.posts.removeArte(id, arteId);
  }

  @Post('seed/import')
  @RequirePermissions('marketing.redes-sociais.manage')
  seedImport(@Query('force') force?: string) {
    return this.posts.runSeed(force === '1' || force === 'true');
  }

  @Post('artes/sync-local')
  @RequirePermissions('marketing.redes-sociais.manage')
  syncLocalArtes() {
    return this.posts.relinkAllArtesFromAssets();
  }

  @Post('buffer/sync-all')
  @RequirePermissions('marketing.redes-sociais.publicar')
  syncAll() {
    return this.buffer.syncAll();
  }

  @Post(':id/buffer/draft')
  @RequirePermissions('marketing.redes-sociais.publicar')
  bufferDraft(@Param('id') id: string, @Query('rede') rede?: string, @Query('redes') redes?: string) {
    return this.buffer.sendDraft(id, parseRedesQuery(rede, redes));
  }

  @Post(':id/buffer/schedule')
  @RequirePermissions('marketing.redes-sociais.publicar')
  bufferSchedule(@Param('id') id: string, @Query('rede') rede?: string, @Query('redes') redes?: string) {
    return this.buffer.schedule(id, parseRedesQuery(rede, redes));
  }

  @Post(':id/buffer/publish-now')
  @RequirePermissions('marketing.redes-sociais.publicar')
  bufferPublishNow(@Param('id') id: string, @Query('rede') rede?: string, @Query('redes') redes?: string) {
    return this.buffer.publishNow(id, parseRedesQuery(rede, redes));
  }

  @Post(':id/buffer/revert-draft')
  @RequirePermissions('marketing.redes-sociais.publicar')
  bufferRevertDraft(@Param('id') id: string) {
    return this.buffer.revertDraft(id);
  }

  @Post(':id/buffer/remove')
  @RequirePermissions('marketing.redes-sociais.publicar')
  bufferRemove(@Param('id') id: string, @Query('rede') rede?: string) {
    const r = parseSingleRede(rede);
    if (r) return this.buffer.removeRedeFromBuffer(id, r);
    return this.buffer.removeFromBuffer(id);
  }

  @Post(':id/buffer/sync')
  @RequirePermissions('marketing.redes-sociais.publicar')
  bufferSync(@Param('id') id: string, @Query('rede') rede?: string) {
    return this.buffer.syncPost(id, parseSingleRede(rede));
  }

  @Post(':id/publicado-manual')
  @RequirePermissions('marketing.redes-sociais.publicar')
  publishedManual(@Param('id') id: string) {
    return this.buffer.markPublishedManual(id);
  }
}

const REDES = ['instagram', 'facebook', 'linkedin'] as const;

function parseSingleRede(raw?: string) {
  const v = raw?.trim().toLowerCase();
  if (!v) return undefined;
  if (!REDES.includes(v as (typeof REDES)[number])) {
    throw new BadRequestException('Rede inválida. Use instagram, facebook ou linkedin.');
  }
  return v as (typeof REDES)[number];
}

function parseRedesQuery(rede?: string, redesCsv?: string) {
  const list: string[] = [];
  const single = parseSingleRede(rede);
  if (single) list.push(single);
  if (redesCsv?.trim()) {
    for (const part of redesCsv.split(',')) {
      const r = parseSingleRede(part);
      if (r && !list.includes(r)) list.push(r);
    }
  }
  return list.length ? (list as (typeof REDES)[number][]) : undefined;
}