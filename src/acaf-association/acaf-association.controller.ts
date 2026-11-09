import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../access-control/permissions.guard';
import { RequirePermissions } from '../access-control/require-permissions.decorator';
import { AcafAssociationService, type AcafAssociateUnitPatch } from './acaf-association.service';

@ApiTags('Admin · Associação movly.')
@ApiBearerAuth('admin-jwt')
@Controller('acaf-association')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AcafAssociationController {
  constructor(private readonly association: AcafAssociationService) {}

  /** Lista academias que são parceiras associadas movly. (metadados da importação). Outras unidades não aparecem. */
  @Get('units')
  @RequirePermissions('associacao.acaf.parceiros')
  listUnits() {
    return this.association.listAssociatePartnerUnits();
  }

  @Get('units/:id')
  @RequirePermissions('associacao.acaf.parceiros')
  getUnit(@Param('id') id: string) {
    return this.association.getAssociatePartnerUnit(id);
  }

  @Patch('units/:id')
  @RequirePermissions('associacao.acaf.parceiros')
  patchUnit(@Param('id') id: string, @Body() body: AcafAssociateUnitPatch) {
    return this.association.patchAssociatePartnerUnit(id, body);
  }
}
