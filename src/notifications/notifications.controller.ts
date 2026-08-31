import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { NotificationTriggersRegistry } from './notification-triggers.registry';
import { NotificationsService } from './notifications.service';

type AuthRequest = Request & { user: { userId: string } };

@ApiTags('Admin · Notificações')
@ApiBearerAuth('admin-jwt')
@Controller('admin/notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly triggers: NotificationTriggersRegistry,
  ) {}

  @Get()
  list(
    @Req() req: AuthRequest,
    @Query('unreadOnly') unreadOnly?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.notifications.listForUser(req.user.userId, {
      unreadOnly: unreadOnly === '1',
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  @Get('unread-count')
  unreadCount(@Req() req: AuthRequest) {
    return this.notifications.countUnread(req.user.userId);
  }

  @Get('triggers')
  listTriggers() {
    return this.triggers.listCatalog();
  }

  @Patch(':id/read')
  markRead(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.notifications.markRead(req.user.userId, id);
  }

  @Post('read-all')
  markAllRead(@Req() req: AuthRequest) {
    return this.notifications.markAllRead(req.user.userId);
  }

  @Post('read-many')
  markManyRead(@Req() req: AuthRequest, @Body() body: { ids?: string[] }) {
    return this.notifications.markManyRead(req.user.userId, body.ids ?? []);
  }
}
