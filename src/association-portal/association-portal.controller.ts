import { Body, Controller, Get, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  AssociationPortalService,
  type AssociationAssociateUnitPatch,
} from './association-portal.service';

type AuthRequest = Request & { user: { userId: string } };

@ApiTags('Portal · Associação')
@ApiBearerAuth('admin-jwt')
@Controller('association-portal/:slug')
@UseGuards(JwtAuthGuard)
export class AssociationPortalController {
  constructor(private readonly portal: AssociationPortalService) {}

  @Get('units')
  async listUnits(@Req() req: AuthRequest, @Param('slug') slug: string) {
    await this.portal.assertPortalAccess(req.user.userId, slug);
    return this.portal.listAssociatePartnerUnits(slug);
  }

  @Get('units/:id')
  async getUnit(@Req() req: AuthRequest, @Param('slug') slug: string, @Param('id') id: string) {
    await this.portal.assertPortalAccess(req.user.userId, slug);
    return this.portal.getAssociatePartnerUnit(slug, id);
  }

  @Patch('units/:id')
  async patchUnit(
    @Req() req: AuthRequest,
    @Param('slug') slug: string,
    @Param('id') id: string,
    @Body() body: AssociationAssociateUnitPatch,
  ) {
    await this.portal.assertPortalAccess(req.user.userId, slug);
    return this.portal.patchAssociatePartnerUnit(slug, id, body);
  }
}
