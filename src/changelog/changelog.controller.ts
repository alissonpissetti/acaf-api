import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../access-control/require-permissions.decorator';
import { PermissionsGuard } from '../access-control/permissions.guard';
import { ChangelogService, type ChangelogListQuery } from './changelog.service';
import type { ChangelogCategory } from './changelog.types';

@ApiTags('Admin · Changelog')
@ApiBearerAuth('admin-jwt')
@Controller('admin/changelog')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ChangelogController {
  constructor(private readonly changelog: ChangelogService) {}

  @Get()
  @RequirePermissions('sistema.changelog')
  list(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('area') area?: string,
    @Query('category') category?: string,
    @Query('audience') audience?: string,
    @Query('q') q?: string,
  ) {
    const query: ChangelogListQuery = {
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
      area,
      category: category as ChangelogCategory | undefined,
      audience:
        audience === 'partner' || audience === 'client' || audience === 'internal'
          ? audience
          : 'internal',
      q,
    };
    return this.changelog.list(query);
  }

  @Post('sync')
  @RequirePermissions('sistema.changelog')
  syncFromGit() {
    return this.changelog.syncFromGit();
  }

  @Post('seed-from-file')
  @RequirePermissions('sistema.changelog')
  seedFromJsonFile() {
    return this.changelog.seedFromJsonFile();
  }
}
