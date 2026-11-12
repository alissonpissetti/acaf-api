import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../access-control/permissions.guard';
import { RequirePermissions } from '../access-control/require-permissions.decorator';
import { AssociationsService } from './associations.service';

@ApiTags('Admin · Associações')
@ApiBearerAuth('admin-jwt')
@Controller('admin/associations')
@UseGuards(JwtAuthGuard)
export class AssociationsController {
  constructor(private readonly associations: AssociationsService) {}

  @Get()
  @UseGuards(PermissionsGuard)
  @RequirePermissions('sistema.associacoes')
  list() {
    return this.associations.listAdmin();
  }

  @Post()
  @UseGuards(PermissionsGuard)
  @RequirePermissions('sistema.associacoes.manage')
  create(
    @Body()
    body: {
      slug: string;
      name: string;
      description?: string;
      portalPublicUrl?: string;
      sortOrder?: number;
      active?: boolean;
    },
  ) {
    return this.associations.create(body);
  }

  @Patch(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('sistema.associacoes.manage')
  update(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      description?: string | null;
      portalPublicUrl?: string | null;
      sortOrder?: number;
      active?: boolean;
    },
  ) {
    return this.associations.update(id, body);
  }
}
