import { Controller, Get, Param, Post, Query, Req, Res, StreamableFile, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../access-control/require-permissions.decorator';
import { PermissionsGuard } from '../access-control/permissions.guard';
import { EvolutionInboxService } from './evolution-inbox.service';

type InboxAuthRequest = Request & { user?: { userId: string } };

@ApiTags('Admin · Evolution Inbox')
@ApiBearerAuth('admin-jwt')
@Controller('admin/evolution/inbox')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class EvolutionInboxController {
  constructor(private readonly inbox: EvolutionInboxService) {}

  @Get('threads')
  @RequirePermissions('sistema.evolution', 'comercial.leads')
  listThreads(@Req() req: InboxAuthRequest, @Query('instanceId') instanceId?: string) {
    const userId = req.user?.userId ?? '';
    return this.inbox.listThreads(userId, instanceId ? { instanceId } : undefined);
  }

  @Get('threads/:instanceId/:contactPhone/avatar')
  @RequirePermissions('sistema.evolution', 'comercial.leads')
  async threadAvatar(
    @Param('instanceId') instanceId: string,
    @Param('contactPhone') contactPhone: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { buffer, mime } = await this.inbox.streamContactAvatar(instanceId, decodeURIComponent(contactPhone));
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return new StreamableFile(buffer);
  }

  @Post('threads/:instanceId/:contactPhone/read')
  @RequirePermissions('sistema.evolution', 'comercial.leads')
  async markThreadRead(
    @Req() req: InboxAuthRequest,
    @Param('instanceId') instanceId: string,
    @Param('contactPhone') contactPhone: string,
  ) {
    const userId = req.user?.userId ?? '';
    await this.inbox.markThreadRead(userId, instanceId, decodeURIComponent(contactPhone));
    return { ok: true };
  }

  @Get('threads/:instanceId/:contactPhone/messages')
  @RequirePermissions('sistema.evolution', 'comercial.leads')
  listMessages(
    @Req() req: InboxAuthRequest,
    @Param('instanceId') instanceId: string,
    @Param('contactPhone') contactPhone: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = limit ? Number.parseInt(limit, 10) : 200;
    const userId = req.user?.userId ?? null;
    return this.inbox.listThreadMessages(
      userId,
      instanceId,
      decodeURIComponent(contactPhone),
      Number.isFinite(parsedLimit) ? parsedLimit : 200,
    );
  }

  @Get('link-preview/youtube')
  @RequirePermissions('sistema.evolution', 'comercial.leads')
  youtubeLinkPreview(@Query('url') url?: string) {
    return this.inbox.youtubeLinkPreview(url ?? '');
  }

  @Get('messages/:messageId/media')
  @RequirePermissions('sistema.evolution', 'comercial.leads')
  async messageMedia(
    @Param('messageId') messageId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { buffer, mime, fileName } = await this.inbox.getMessageMedia(messageId);
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    if (fileName) {
      res.setHeader('Content-Disposition', `inline; filename="${fileName.replace(/"/g, '')}"`);
    }
    return new StreamableFile(buffer);
  }
}
