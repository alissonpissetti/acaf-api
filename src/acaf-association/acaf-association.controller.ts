import { Body, Controller, Get, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../access-control/permissions.guard';
import { RequirePermissions } from '../access-control/require-permissions.decorator';
import { AcafAssociationService, type AcafAssociateUnitPatch } from './acaf-association.service';

type AuthRequest = Request & { user: { userId: string } };

@ApiTags('Admin · Associação movly.')
@ApiBearerAuth('admin-jwt')
@Controller('acaf-association')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AcafAssociationController {
  constructor(private readonly association: AcafAssociationService) {}

  /** Lista academias que são parceiras associadas movly. (metadados da importação). Outras unidades não aparecem. */
  @Get('units')
  @RequirePermissions('associacao.acaf.parceiros')
  listUnits(@Req() req: AuthRequest) {
    return this.association.listAssociatePartnerUnits(req.user.userId);
  }

  @Get('units/:id')
  @RequirePermissions('associacao.acaf.parceiros')
  getUnit(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.association.getAssociatePartnerUnit(req.user.userId, id);
  }

  @Patch('units/:id')
  @RequirePermissions('associacao.acaf.parceiros')
  patchUnit(@Req() req: AuthRequest, @Param('id') id: string, @Body() body: AcafAssociateUnitPatch) {
    return this.association.patchAssociatePartnerUnit(req.user.userId, id, body);
  }
}
