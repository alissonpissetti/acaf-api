import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../access-control/require-permissions.decorator';
import { PermissionsGuard } from '../access-control/permissions.guard';
import { EvolutionInstancesService } from './evolution-instances.service';
import type {
  CreateEvolutionInstanceInput,
  UpdateEvolutionInstanceInput,
} from './evolution-instances.service';
import {
  EvolutionLeadIgnoreContactsService,
  type CreateEvolutionLeadIgnoreContactInput,
} from './evolution-lead-ignore-contacts.service';

@ApiTags('Admin · Evolution API')
@ApiBearerAuth('admin-jwt')
@Controller('admin/evolution/instances')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class EvolutionInstancesController {
  constructor(
    private readonly evolution: EvolutionInstancesService,
    private readonly leadIgnores: EvolutionLeadIgnoreContactsService,
  ) {}

  @Get('overview')
  @RequirePermissions('sistema.evolution')
  overview() {
    return this.evolution.overview();
  }

  @Get('status')
  @RequirePermissions('sistema.evolution')
  connectionStatus() {
    return this.evolution.getConnectionStatus();
  }

  @Post('test-platform')
  @RequirePermissions('sistema.evolution.manage')
  testPlatform() {
    return this.evolution.testPlatformConnection();
  }

  @Get()
  @RequirePermissions('sistema.evolution')
  list(@Query('all') all?: string) {
    return this.evolution.list(all === '1');
  }

  @Get(':id')
  @RequirePermissions('sistema.evolution')
  get(@Param('id') id: string) {
    return this.evolution.getById(id);
  }

  @Post()
  @RequirePermissions('sistema.evolution.manage')
  create(@Body() body: CreateEvolutionInstanceInput) {
    return this.evolution.create(body);
  }

  @Patch(':id')
  @RequirePermissions('sistema.evolution.manage')
  update(@Param('id') id: string, @Body() body: UpdateEvolutionInstanceInput) {
    return this.evolution.update(id, body);
  }

  @Delete(':id')
  @RequirePermissions('sistema.evolution.manage')
  remove(@Param('id') id: string) {
    return this.evolution.remove(id);
  }

  @Post(':id/test-connection')
  @RequirePermissions('sistema.evolution.manage')
  testConnection(@Param('id') id: string) {
    return this.evolution.testConnection(id);
  }

  @Post(':id/refresh-connection')
  @RequirePermissions('sistema.evolution.manage')
  refreshConnection(@Param('id') id: string) {
    return this.evolution.refreshConnection(id);
  }

  @Post(':id/connect')
  @RequirePermissions('sistema.evolution.manage')
  connect(@Param('id') id: string) {
    return this.evolution.connect(id);
  }

  @Post(':id/sync-inbox')
  @RequirePermissions('sistema.evolution.manage', 'comercial.leads')
  syncInbox(@Param('id') id: string) {
    return this.evolution.syncInbox(id);
  }

  @Post(':id/sync-avatars')
  @RequirePermissions('sistema.evolution.manage', 'comercial.leads')
  syncAvatars(@Param('id') id: string) {
    return this.evolution.syncAvatars(id);
  }

  @Post(':id/sync-media')
  @RequirePermissions('sistema.evolution.manage', 'comercial.leads')
  syncMessageMedia(@Param('id') id: string) {
    return this.evolution.syncMessageMedia(id);
  }

  @Get(':id/lead-ignore-contacts')
  @RequirePermissions('sistema.evolution.manage')
  listLeadIgnoreContacts(@Param('id') id: string) {
    return this.leadIgnores.listForInstance(id);
  }

  @Post(':id/lead-ignore-contacts')
  @RequirePermissions('sistema.evolution.manage')
  addLeadIgnoreContact(
    @Param('id') id: string,
    @Body() body: CreateEvolutionLeadIgnoreContactInput,
  ) {
    return this.leadIgnores.add(id, body);
  }

  @Delete(':id/lead-ignore-contacts/:ignoreId')
  @RequirePermissions('sistema.evolution.manage')
  removeLeadIgnoreContact(@Param('id') id: string, @Param('ignoreId') ignoreId: string) {
    return this.leadIgnores.remove(id, ignoreId);
  }
}
