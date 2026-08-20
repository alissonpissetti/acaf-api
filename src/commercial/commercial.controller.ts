import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../access-control/require-permissions.decorator';
import { PermissionsGuard } from '../access-control/permissions.guard';
import { CommercialLeadsService } from './commercial-leads.service';
import { CommercialFunnelsService } from './commercial-funnels.service';
import type { CommercialLeadType } from './commercial-lead.entity';
import type { FunnelOutcomeAction } from './commercial-funnel.entity';
import type { FunnelStageOutcome } from './commercial-funnel-stage.entity';

type AuthRequest = Request & { user: { userId: string } };

@ApiTags('Admin · Comercial')
@ApiBearerAuth('admin-jwt')
@Controller('admin/commercial')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CommercialController {
  constructor(
    private readonly leads: CommercialLeadsService,
    private readonly funnels: CommercialFunnelsService,
  ) {}

  @Get('funnels')
  @RequirePermissions('comercial.funis')
  listFunnels(@Query('all') all?: string) {
    return this.funnels.list(all === '1');
  }

  @Get('funnels/options')
  @RequirePermissions('comercial.leads')
  listFunnelOptions() {
    return this.funnels.listOptions();
  }

  @Get('funnels/:id')
  @RequirePermissions('comercial.funis')
  getFunnel(@Param('id') id: string) {
    return this.funnels.get(id);
  }

  @Post('funnels')
  @RequirePermissions('comercial.funis.manage')
  createFunnel(
    @Body()
    body: {
      name: string;
      slug?: string;
      description?: string;
      sortOrder?: number;
      isDefault?: boolean;
      active?: boolean;
      winAction?: FunnelOutcomeAction;
      winTargetFunnelId?: string | null;
      winTargetStageId?: string | null;
      lossAction?: FunnelOutcomeAction;
      lossTargetFunnelId?: string | null;
      lossTargetStageId?: string | null;
      stages: Array<{
        name: string;
        slug?: string;
        sortOrder: number;
        outcome: FunnelStageOutcome;
        active?: boolean;
        maxDaysInStage?: number | null;
      }>;
    },
  ) {
    return this.funnels.create(body);
  }

  @Patch('funnels/:id')
  @RequirePermissions('comercial.funis.manage')
  updateFunnel(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      slug?: string;
      description?: string | null;
      sortOrder?: number;
      isDefault?: boolean;
      active?: boolean;
      winAction?: FunnelOutcomeAction;
      winTargetFunnelId?: string | null;
      winTargetStageId?: string | null;
      lossAction?: FunnelOutcomeAction;
      lossTargetFunnelId?: string | null;
      lossTargetStageId?: string | null;
      stages?: Array<{
        id?: string;
        name: string;
        slug?: string;
        sortOrder: number;
        outcome: FunnelStageOutcome;
        active?: boolean;
        maxDaysInStage?: number | null;
      }>;
    },
  ) {
    return this.funnels.update(id, body);
  }

  @Delete('funnels/:id')
  @RequirePermissions('comercial.funis.manage')
  deactivateFunnel(@Param('id') id: string) {
    return this.funnels.deactivate(id);
  }

  @Get('leads')
  @RequirePermissions('comercial.leads')
  listLeads(
    @Query('funnelId') funnelId?: string,
    @Query('ownerUserId') ownerUserId?: string,
    @Query('type') type?: CommercialLeadType,
  ) {
    return this.leads.list({ funnelId, ownerUserId, type });
  }

  @Get('leads/:id')
  @RequirePermissions('comercial.leads')
  getLead(@Param('id') id: string) {
    return this.leads.get(id);
  }

  @Post('leads')
  @RequirePermissions('comercial.leads.manage')
  createLead(
    @Req() req: AuthRequest,
    @Body()
    body: {
      title: string;
      type?: CommercialLeadType | null;
      funnelId?: string;
      legalName?: string;
      cnpj?: string;
      email?: string;
      phone?: string;
      contactName?: string;
      contacts?: Array<{
        id?: string;
        name: string;
        role?: string | null;
        phone?: string | null;
        email?: string | null;
        isPrimary?: boolean;
      }>;
      notes?: string;
      ownerUserId?: string;
      ownerUserIds?: string[];
      temperature?: 'cold' | 'warm' | 'hot';
    },
  ) {
    return this.leads.create(body, req.user.userId);
  }

  @Patch('leads/:id')
  @RequirePermissions('comercial.leads.manage')
  updateLead(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body()
    body: {
      title?: string;
      type?: CommercialLeadType | null;
      stageId?: string;
      legalName?: string | null;
      cnpj?: string | null;
      email?: string | null;
      phone?: string | null;
      contactName?: string | null;
      contacts?: Array<{
        id?: string;
        name: string;
        role?: string | null;
        phone?: string | null;
        email?: string | null;
        isPrimary?: boolean;
      }>;
      notes?: string | null;
      ownerUserId?: string;
      ownerUserIds?: string[];
      temperature?: 'cold' | 'warm' | 'hot';
      sortOrder?: number;
    },
  ) {
    return this.leads.update(id, body, req.user.userId);
  }

  @Post('leads/:id/convert')
  @RequirePermissions('comercial.leads.manage')
  convertLead(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.leads.convert(id, req.user.userId);
  }

  @Get('leads/:id/interactions')
  @RequirePermissions('comercial.leads')
  listLeadInteractions(@Param('id') id: string) {
    return this.leads.listInteractions(id);
  }

  @Post('leads/:id/interactions')
  @RequirePermissions('comercial.leads.manage')
  addLeadInteraction(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: { content: string },
  ) {
    return this.leads.addInteraction(id, req.user.userId, body.content);
  }

  @Post('leads/:id/interaction')
  @RequirePermissions('comercial.leads.manage')
  recordLeadInteraction(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: { kind?: 'call' | 'whatsapp' | 'email' },
  ) {
    return this.leads.recordInteraction(id, req.user.userId, body?.kind);
  }
}
