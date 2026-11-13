import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { PartnerAuthService } from './partner-auth.service';
import { PartnerJwtAuthGuard } from './partner-jwt-auth.guard';
import { PartnerOnboardingService } from './partner-onboarding.service';

type PartnerAuthRequest = Request & {
  user: { platformUserId: string; unitIds: string[]; kind?: 'platform' | 'admin' };
};

@ApiTags('Parceiro · Auth')
@Controller('partner/auth')
export class PartnerAuthController {
  constructor(
    private readonly auth: PartnerAuthService,
    private readonly onboarding: PartnerOnboardingService,
  ) {}

  @Post('login')
  login(@Body() body: { login: string; password: string }) {
    return this.auth.login(body.login ?? '', body.password ?? '');
  }

  @Get('me')
  @UseGuards(PartnerJwtAuthGuard)
  @ApiBearerAuth('partner-jwt')
  me(@Req() req: PartnerAuthRequest) {
    return this.auth.me(req.user.platformUserId);
  }

  @Post('onboarding/recover/request')
  @HttpCode(200)
  requestOnboardingCnpjRecovery(@Body() body: { cnpj?: string }) {
    return this.onboarding.requestCnpjRecovery(body.cnpj ?? '');
  }

  @Post('onboarding/recover/verify')
  @HttpCode(200)
  verifyOnboardingCnpjRecovery(@Body() body: { cnpj?: string; code?: string }) {
    return this.onboarding.verifyCnpjRecovery(body.cnpj ?? '', body.code ?? '');
  }

  @Get('onboarding/:token/preview')
  onboardingPreview(@Param('token') token: string) {
    return this.onboarding.getPreviewByToken(token);
  }

  @Post('onboarding/:token/complete')
  onboardingComplete(
    @Param('token') token: string,
    @Body()
    body: {
      name: string;
      email: string;
      cpf: string;
      mobilePhone: string;
      password: string;
      confirmUpdateExisting?: boolean;
    },
  ) {
    return this.onboarding.completeInvite(token, body);
  }

  @Post('otp/request')
  requestOtp(@Body() body: { mobilePhone: string }) {
    return this.auth.requestLoginOtp(body.mobilePhone ?? '');
  }

  @Post('otp/login')
  loginWithOtp(@Body() body: { mobilePhone: string; code: string }) {
    return this.auth.loginWithOtp(body.mobilePhone ?? '', body.code ?? '');
  }
}
