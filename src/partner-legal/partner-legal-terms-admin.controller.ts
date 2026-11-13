import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../access-control/permissions.guard';
import { RequirePermissions } from '../access-control/require-permissions.decorator';
import { PARTNER_LEGAL_SLUG_ONBOARDING } from './partner-legal.constants';
import { PartnerLegalTermsService } from './partner-legal-terms.service';

@ApiTags('Admin · Documentos')
@ApiBearerAuth('admin-jwt')
@Controller('admin/partner-legal-terms')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PartnerLegalTermsAdminController {
  constructor(private readonly terms: PartnerLegalTermsService) {}

  @Get('catalog')
  @RequirePermissions('operacao.termos-parceiro')
  listTypes() {
    return this.terms.listDocumentTypes();
  }

  @Post('catalog')
  @RequirePermissions('operacao.termos-parceiro.manage')
  createType(
    @Body()
    body: {
      slug: string;
      title: string;
      contentHtml?: string;
    },
  ) {
    return this.terms.createDocumentType(body);
  }

  @Get('current')
  @RequirePermissions('operacao.termos-parceiro')
  current(@Query('slug') slug?: string) {
    const resolved = slug?.trim() || PARTNER_LEGAL_SLUG_ONBOARDING;
    return this.terms.getPublishedDocument(resolved);
  }

  @Get('versions')
  @RequirePermissions('operacao.termos-parceiro')
  versions(@Query('slug') slug?: string) {
    const resolved = slug?.trim() || PARTNER_LEGAL_SLUG_ONBOARDING;
    return this.terms.listVersions(resolved);
  }

  @Post('preview-render')
  @RequirePermissions('operacao.termos-parceiro')
  previewRender(
    @Body()
    body: {
      contentHtml: string;
    },
  ) {
    return this.terms.previewTemplateRender(body.contentHtml ?? '');
  }

  @Post('publish')
  @RequirePermissions('operacao.termos-parceiro.manage')
  publish(
    @Body()
    body: {
      slug?: string;
      title: string;
      contentHtml: string;
      effectiveAt?: string | null;
    },
  ) {
    return this.terms.publishNewVersion({
      slug: body.slug?.trim() || PARTNER_LEGAL_SLUG_ONBOARDING,
      title: body.title,
      contentHtml: body.contentHtml,
      effectiveAt: body.effectiveAt,
    });
  }
}
