import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../access-control/require-permissions.decorator';
import { PermissionsGuard } from '../access-control/permissions.guard';
import type { CommercialLeadType } from '../commercial/commercial-lead.entity';
import { MarketingCampaignsService } from './marketing-campaigns.service';
import { MarketingLandingPagesService } from './marketing-landing-pages.service';
import type {
  MarketingCampaignStatus,
  MarketingCreativeFormat,
  MarketingLandingField,
  MarketingLandingTheme,
  MarketingPlatform,
} from './marketing.types';

type AuthRequest = Request & { user: { userId: string } };

@ApiTags('Admin · Marketing')
@ApiBearerAuth('admin-jwt')
@Controller('admin/marketing')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class MarketingController {
  constructor(
    private readonly campaigns: MarketingCampaignsService,
    private readonly landingPages: MarketingLandingPagesService,
  ) {}

  @Get('dashboard')
  @RequirePermissions('marketing.painel')
  dashboard() {
    return this.landingPages.getDashboardStats();
  }

  @Get('campaigns')
  @RequirePermissions('marketing.campanhas')
  listCampaigns(@Query('all') all?: string) {
    return this.campaigns.listCampaigns(all === '1');
  }

  @Get('campaigns/options')
  @RequirePermissions('marketing.formularios')
  listCampaignOptions() {
    return this.campaigns.listCampaignOptions();
  }

  @Get('campaigns/:id')
  @RequirePermissions('marketing.campanhas')
  getCampaign(@Param('id') id: string) {
    return this.campaigns.getCampaign(id);
  }

  @Post('campaigns')
  @RequirePermissions('marketing.campanhas.manage')
  createCampaign(
    @Body()
    body: {
      name: string;
      slug?: string;
      description?: string;
      platform?: MarketingPlatform;
      status?: MarketingCampaignStatus;
      startDate?: string | null;
      endDate?: string | null;
      budgetCents?: number;
      notes?: string;
      ownerUserId?: string | null;
      active?: boolean;
    },
  ) {
    return this.campaigns.createCampaign(body);
  }

  @Patch('campaigns/:id')
  @RequirePermissions('marketing.campanhas.manage')
  updateCampaign(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      slug?: string;
      description?: string | null;
      platform?: MarketingPlatform;
      status?: MarketingCampaignStatus;
      startDate?: string | null;
      endDate?: string | null;
      budgetCents?: number;
      notes?: string | null;
      ownerUserId?: string | null;
      active?: boolean;
    },
  ) {
    return this.campaigns.updateCampaign(id, body);
  }

  @Delete('campaigns/:id')
  @RequirePermissions('marketing.campanhas.manage')
  deactivateCampaign(@Param('id') id: string) {
    return this.campaigns.deactivateCampaign(id);
  }

  @Post('campaigns/:id/creatives')
  @RequirePermissions('marketing.campanhas.manage')
  createCreative(
    @Param('id') campaignId: string,
    @Body()
    body: {
      name: string;
      slug?: string;
      platform?: MarketingPlatform;
      format?: MarketingCreativeFormat;
      externalUrl?: string | null;
      landingPageId?: string | null;
      utmSource?: string | null;
      utmMedium?: string | null;
      utmCampaign?: string | null;
      utmContent?: string | null;
      utmTerm?: string | null;
      impressions?: number;
      clicks?: number;
      spendCents?: number;
      sortOrder?: number;
      active?: boolean;
    },
  ) {
    return this.campaigns.createCreative(campaignId, body);
  }

  @Patch('campaigns/:campaignId/creatives/:creativeId')
  @RequirePermissions('marketing.campanhas.manage')
  updateCreative(
    @Param('campaignId') campaignId: string,
    @Param('creativeId') creativeId: string,
    @Body()
    body: {
      name?: string;
      slug?: string;
      platform?: MarketingPlatform;
      format?: MarketingCreativeFormat;
      externalUrl?: string | null;
      landingPageId?: string | null;
      utmSource?: string | null;
      utmMedium?: string | null;
      utmCampaign?: string | null;
      utmContent?: string | null;
      utmTerm?: string | null;
      impressions?: number;
      clicks?: number;
      spendCents?: number;
      sortOrder?: number;
      active?: boolean;
    },
  ) {
    return this.campaigns.updateCreative(campaignId, creativeId, body);
  }

  @Delete('campaigns/:campaignId/creatives/:creativeId')
  @RequirePermissions('marketing.campanhas.manage')
  deactivateCreative(
    @Param('campaignId') campaignId: string,
    @Param('creativeId') creativeId: string,
  ) {
    return this.campaigns.deactivateCreative(campaignId, creativeId);
  }

  @Get('landing-pages')
  @RequirePermissions('marketing.formularios')
  listLandingPages(@Query('all') all?: string) {
    return this.landingPages.listPages(all === '1');
  }

  @Get('landing-pages/options')
  @RequirePermissions('marketing.campanhas')
  listLandingPageOptions(@Query('campaignId') campaignId?: string) {
    return this.landingPages.listPageOptions(campaignId || undefined);
  }

  @Get('landing-pages/:id')
  @RequirePermissions('marketing.formularios')
  getLandingPage(@Param('id') id: string) {
    return this.landingPages.getPage(id);
  }

  @Post('landing-pages')
  @RequirePermissions('marketing.formularios.manage')
  createLandingPage(
    @Body()
    body: {
      name: string;
      slug?: string;
      headline: string;
      description?: string;
      thankYouMessage?: string;
      primaryColor?: string;
      logoUrl?: string | null;
      coverImageUrl?: string | null;
      theme?: MarketingLandingTheme | null;
      campaignId?: string | null;
      creativeId?: string | null;
      funnelId?: string | null;
      leadType?: CommercialLeadType | null;
      ownerUserId?: string | null;
      fields?: MarketingLandingField[];
      active?: boolean;
    },
  ) {
    return this.landingPages.createPage(body);
  }

  @Post('landing-pages/:id/logo')
  @RequirePermissions('marketing.formularios.manage')
  @UseInterceptors(
    FileInterceptor('image', {
      limits: { fileSize: 2 * 1024 * 1024 },
    }),
  )
  uploadLandingPageLogo(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Envie o arquivo do logo.');
    }
    return this.landingPages.uploadLandingPageLogo(id, file);
  }

  @Post('landing-pages/:id/cover')
  @RequirePermissions('marketing.formularios.manage')
  @UseInterceptors(
    FileInterceptor('image', {
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  uploadLandingPageCover(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Envie o arquivo da foto de capa.');
    }
    return this.landingPages.uploadLandingPageCover(id, file);
  }

  @Patch('landing-pages/:id')
  @RequirePermissions('marketing.formularios.manage')
  updateLandingPage(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      slug?: string;
      headline?: string;
      description?: string | null;
      thankYouMessage?: string | null;
      primaryColor?: string;
      logoUrl?: string | null;
      coverImageUrl?: string | null;
      theme?: MarketingLandingTheme | null;
      campaignId?: string | null;
      creativeId?: string | null;
      funnelId?: string | null;
      leadType?: CommercialLeadType | null;
      ownerUserId?: string | null;
      fields?: MarketingLandingField[];
      active?: boolean;
    },
  ) {
    return this.landingPages.updatePage(id, body);
  }

  /** Resposta de sucesso na exclusão definitiva (`?force=1`, padrão): `{ ok: true, removed: true }`. Com `?force=0`, apenas inativa: `{ ok: true, removed: false }`. */
  @Delete('landing-pages/:id')
  @RequirePermissions('marketing.formularios.manage')
  deactivateLandingPage(@Param('id') id: string, @Query('force') force?: string) {
    const forceDelete = force !== '0' && force !== 'false';
    return this.landingPages.deactivatePage(id, { force: forceDelete });
  }

  @Get('landing-pages/:id/metrics')
  @RequirePermissions('marketing.formularios')
  getLandingPageMetrics(
    @Param('id') id: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('period') period?: string,
  ) {
    return this.landingPages.getPageMetrics(id, { from, to, period });
  }

  @Delete('landing-pages/:id/metrics')
  @RequirePermissions('marketing.formularios.manage')
  clearLandingPageMetrics(@Param('id') id: string) {
    return this.landingPages.clearPageMetrics(id);
  }
}

@ApiTags('Public · Marketing')
@Controller('public/marketing')
export class MarketingPublicController {
  constructor(private readonly landingPages: MarketingLandingPagesService) {}

  @Get('brand-fonts')
  getBrandFonts() {
    return this.landingPages.getPublicBrandTypography();
  }

  @Get('pages/:slug')
  getPage(
    @Param('slug') slug: string,
    @Query('utm_source') utmSource?: string,
    @Query('utm_medium') utmMedium?: string,
    @Query('utm_campaign') utmCampaign?: string,
    @Query('utm_content') utmContent?: string,
    @Query('utm_term') utmTerm?: string,
    @Query('cr') creativeId?: string,
    @Req() req?: Request,
  ) {
    return this.landingPages.getPublicPage(
      slug,
      { utmSource, utmMedium, utmCampaign, utmContent, utmTerm, creativeId },
      req,
    );
  }

  @Post('pages/:slug/click')
  recordClick(
    @Param('slug') slug: string,
    @Body()
    body: {
      creativeId?: string;
      utmSource?: string;
      utmMedium?: string;
      utmCampaign?: string;
      utmContent?: string;
      utmTerm?: string;
    },
    @Req() req: Request,
  ) {
    return this.landingPages.recordPublicClick(slug, body, req);
  }

  @Post('pages/:slug/submit')
  submitPage(
    @Param('slug') slug: string,
    @Body()
    body: {
      data?: Record<string, string>;
      creativeId?: string;
      utmSource?: string;
      utmMedium?: string;
      utmCampaign?: string;
      utmContent?: string;
      utmTerm?: string;
    },
    @Req() req: Request,
  ) {
    return this.landingPages.submitPublicForm(slug, body, req);
  }
}
