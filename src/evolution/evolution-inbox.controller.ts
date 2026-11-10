import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../access-control/require-permissions.decorator';
import { PermissionsGuard } from '../access-control/permissions.guard';
import { EvolutionInboxService } from './evolution-inbox.service';

@ApiTags('Admin · Evolution Inbox')
@ApiBearerAuth('admin-jwt')
@Controller('admin/evolution/inbox')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class EvolutionInboxController {
  constructor(private readonly inbox: EvolutionInboxService) {}

  @Get('threads')
  @RequirePermissions('sistema.evolution', 'comercial.leads')
  listThreads(@Query('instanceId') instanceId?: string) {
    return this.inbox.listThreads(instanceId ? { instanceId } : undefined);
  }

  @Get('threads/:instanceId/:contactPhone/messages')
  @RequirePermissions('sistema.evolution', 'comercial.leads')
  listMessages(
    @Param('instanceId') instanceId: string,
    @Param('contactPhone') contactPhone: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = limit ? Number.parseInt(limit, 10) : 200;
    return this.inbox.listThreadMessages(instanceId, contactPhone, Number.isFinite(parsedLimit) ? parsedLimit : 200);
  }
}
