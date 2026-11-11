import { Body, Controller, Get, Param, Post, Query, Req, Res, StreamableFile, UseGuards } from '@nestjs/common';
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

  @Get('leads/:leadId/whatsapp')
  @RequirePermissions('sistema.evolution', 'comercial.leads')
  listLeadWhatsAppHistory(@Param('leadId') leadId: string, @Query('limit') limit?: string) {
    const parsed = limit ? Number.parseInt(limit, 10) : 150;
    const safeLimit = Number.isFinite(parsed) ? parsed : 150;
    return this.inbox.listCommercialLeadWhatsAppHistory(leadId, safeLimit);
  }

  @Get('instances')
  @RequirePermissions('sistema.evolution', 'comercial.leads')
  listInstancesWithHistory() {
    return this.inbox.listInstancesWithMessageHistory();
  }

  @Get('threads')
  @RequirePermissions('sistema.evolution', 'comercial.leads')
  listThreads(
    @Req() req: InboxAuthRequest,
    @Query('instanceId') instanceId?: string,
    @Query('view') view?: 'active' | 'archived' | 'all',
    @Query('light') light?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const userId = req.user?.userId ?? '';
    const safeView =
      view === 'archived' || view === 'all' || view === 'active' ? view : 'active';
    const lightList = light === '1' || light === 'true';
    const parsedLimit = limit ? Number.parseInt(limit, 10) : undefined;
    const parsedOffset = offset ? Number.parseInt(offset, 10) : undefined;
    const pageLimit =
      parsedLimit != null && Number.isFinite(parsedLimit) && parsedLimit > 0
        ? parsedLimit
        : undefined;
    const pageOffset =
      parsedOffset != null && Number.isFinite(parsedOffset) && parsedOffset >= 0
        ? parsedOffset
        : undefined;
    const filters = {
      view: safeView,
      light: lightList,
      limit: pageLimit,
      offset: pageOffset,
      ...(instanceId ? { instanceId } : {}),
    };
    return this.inbox.listThreads(userId, filters);
  }

  @Post('avatars/batch')
  @RequirePermissions('sistema.evolution', 'comercial.leads')
  batchAvatars(@Body() body: { items?: Array<{ instanceId: string; contactPhone: string }> }) {
    return this.inbox.readContactAvatarsBatch(body?.items ?? []);
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
    res.setHeader('Cache-Control', 'private, max-age=86400, stale-while-revalidate=604800');
    return new StreamableFile(buffer);
  }

  @Post('instances/:instanceId/sync-archives')
  @RequirePermissions('sistema.evolution', 'comercial.leads')
  async syncArchives(@Param('instanceId') instanceId: string) {
    const updated = await this.inbox.syncChatArchiveFromRemote(instanceId);
    return { ok: true, updated };
  }

  @Post('instances/:instanceId/reconcile-lid-phones')
  @RequirePermissions('sistema.evolution', 'comercial.leads')
  async reconcileLidPhonesForLeads(@Param('instanceId') instanceId: string) {
    return this.inbox.reconcileLidPhonesForLeads(instanceId);
  }

  @Post('threads/:instanceId/:contactPhone/archive')
  @RequirePermissions('sistema.evolution', 'comercial.leads')
  async setThreadArchived(
    @Param('instanceId') instanceId: string,
    @Param('contactPhone') contactPhone: string,
    @Body() body: { archive?: boolean; syncWhatsApp?: boolean },
  ) {
    return this.inbox.setThreadArchived({
      instanceId,
      contactKey: decodeURIComponent(contactPhone),
      archive: body?.archive !== false,
      syncWhatsApp: body?.syncWhatsApp,
    });
  }

  @Post('threads/:instanceId/:contactPhone/unarchive')
  @RequirePermissions('sistema.evolution', 'comercial.leads')
  async setThreadUnarchived(
    @Param('instanceId') instanceId: string,
    @Param('contactPhone') contactPhone: string,
    @Body() body: { syncWhatsApp?: boolean },
  ) {
    return this.inbox.setThreadArchived({
      instanceId,
      contactKey: decodeURIComponent(contactPhone),
      archive: false,
      syncWhatsApp: body?.syncWhatsApp,
    });
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
    @Query('remote') remote?: string,
    @Query('watch') watch?: string,
  ) {
    const parsedLimit = limit ? Number.parseInt(limit, 10) : 200;
    const userId = req.user?.userId ?? null;
    const remoteFlag = String(remote ?? '')
      .trim()
      .toLowerCase();
    let syncRemote: boolean | 'auto' = 'auto';
    if (remoteFlag === '0' || remoteFlag === 'false') syncRemote = false;
    else if (remoteFlag === '1' || remoteFlag === 'true') syncRemote = true;
    const watchFlag = String(watch ?? '')
      .trim()
      .toLowerCase();
    const watchThread = watchFlag === '1' || watchFlag === 'true';
    return this.inbox.listThreadMessages(
      userId,
      instanceId,
      decodeURIComponent(contactPhone),
      Number.isFinite(parsedLimit) ? parsedLimit : 200,
      { syncRemote, watch: watchThread },
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
