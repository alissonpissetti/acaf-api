import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ChangelogService, type ChangelogListQuery } from './changelog.service';
import type { ChangelogCategory } from './changelog.types';

@ApiTags('Admin · Changelog')
@ApiBearerAuth('admin-jwt')
@Controller('admin/changelog')
@UseGuards(JwtAuthGuard)
export class ChangelogController {
  constructor(private readonly changelog: ChangelogService) {}

  @Get()
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
}
