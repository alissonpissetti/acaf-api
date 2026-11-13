import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { PartnerJwtAuthGuard } from '../partner-auth/partner-jwt-auth.guard';
import { PARTNER_LEGAL_SLUG_ONBOARDING } from './partner-legal.constants';
import { PartnerLegalTermsService } from './partner-legal-terms.service';

type PartnerLegalRequest = Request & {
  user: { platformUserId: string; unitIds: string[] };
};

@ApiTags('Parceiro · Termos')
@Controller('partner/legal-terms')
export class PartnerLegalTermsController {
  constructor(private readonly terms: PartnerLegalTermsService) {}

  @Get('onboarding')
  getOnboardingTerms() {
    return this.terms.getPublishedPublic(PARTNER_LEGAL_SLUG_ONBOARDING);
  }

  @Get('onboarding/render')
  @UseGuards(PartnerJwtAuthGuard)
  @ApiBearerAuth('partner-jwt')
  renderOnboardingTerms(@Req() req: PartnerLegalRequest) {
    return this.terms.renderOnboardingTermsForPartner(req.user.platformUserId, req.user.unitIds);
  }

  @Get('onboarding/acceptance')
  @UseGuards(PartnerJwtAuthGuard)
  @ApiBearerAuth('partner-jwt')
  onboardingAcceptanceStatus(@Req() req: PartnerLegalRequest) {
    const networkId = this.terms.resolveNetworkIdFromUnitIds(req.user.unitIds);
    return this.terms.getAcceptanceStatus(
      req.user.platformUserId,
      networkId,
      PARTNER_LEGAL_SLUG_ONBOARDING,
    );
  }

  @Post('onboarding/accept')
  @UseGuards(PartnerJwtAuthGuard)
  @ApiBearerAuth('partner-jwt')
  acceptOnboardingTerms(
    @Req() req: PartnerLegalRequest,
    @Body()
    body: {
      signedName: string;
      signedDocument: string;
      signatureImageBase64?: string | null;
    },
  ) {
    return this.terms.acceptCurrentTerms(
      req.user.platformUserId,
      req.user.unitIds,
      PARTNER_LEGAL_SLUG_ONBOARDING,
      body,
      req,
    );
  }
}
