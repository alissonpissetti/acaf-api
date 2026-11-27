import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthOtpPurpose } from '../auth/auth-otp.entity';
import { CorporateAuthService } from './corporate-auth.service';
import { CorporateJwtAuthGuard } from './corporate-jwt-auth.guard';
import { CorporateManagerOnboardingService } from './corporate-manager-onboarding.service';

type CorpAuthRequest = Request & {
  user: { userId: string; companyId: string; companyIds: string[] };
};

@ApiTags('Corporativo · Auth')
@Controller('corporate/auth')
export class CorporateAuthController {
  constructor(
    private readonly auth: CorporateAuthService,
    private readonly managerOnboarding: CorporateManagerOnboardingService,
  ) {}

  @Post('onboarding/recover/request')
  @HttpCode(200)
  requestManagerOnboardingCnpjRecovery(
    @Body()
    body: {
      cnpj?: string;
      channel?: 'email' | 'sms';
      contactCorrection?: { name?: string; email?: string; mobilePhone?: string };
    },
  ) {
    const channel = body.channel === 'sms' || body.channel === 'email' ? body.channel : undefined;
    return this.managerOnboarding.requestCnpjRecovery(
      body.cnpj ?? '',
      channel,
      body.contactCorrection,
    );
  }

  @Post('onboarding/recover/verify')
  @HttpCode(200)
  verifyManagerOnboardingCnpjRecovery(@Body() body: { cnpj?: string; code?: string }) {
    return this.managerOnboarding.verifyCnpjRecovery(body.cnpj ?? '', body.code ?? '');
  }

  @Get('onboarding/:token/preview')
  managerOnboardingPreview(@Param('token') token: string) {
    return this.managerOnboarding.getPreviewByToken(token);
  }

  @Post('onboarding/:token/complete')
  managerOnboardingComplete(
    @Param('token') token: string,
    @Body()
    body: {
      name: string;
      email: string;
      cpf: string;
      mobilePhone: string;
      password: string;
    },
  ) {
    return this.managerOnboarding.completeInvite(token, body);
  }

  @Post('signup')
  signup(
    @Body()
    body: {
      legalName: string;
      tradeName?: string;
      cnpj: string;
      companyEmail: string;
      phone?: string;
      managerName: string;
      managerEmail: string;
      managerCpf: string;
      managerPhone: string;
      password: string;
    },
  ) {
    return this.auth.signup({
      ...body,
      tradeName: body.tradeName ?? body.legalName,
    });
  }

  @Post('login')
  login(@Body() body: { login: string; password: string }) {
    return this.auth.login(body.login ?? '', body.password ?? '');
  }

  @Post('otp/request')
  requestOtp(@Body() body: { mobilePhone: string; purpose: AuthOtpPurpose }) {
    return this.auth.requestOtp(body.mobilePhone, body.purpose);
  }

  @Post('otp/login')
  loginWithOtp(@Body() body: { mobilePhone: string; code: string }) {
    return this.auth.loginWithOtp(body.mobilePhone, body.code);
  }

  @Post('password/reset')
  resetPassword(
    @Body() body: { mobilePhone: string; code: string; newPassword: string },
  ) {
    return this.auth.resetPasswordWithOtp(body.mobilePhone, body.code, body.newPassword);
  }

  @Get('me')
  @UseGuards(CorporateJwtAuthGuard)
  @ApiBearerAuth('corporate-jwt')
  me(@Req() req: CorpAuthRequest) {
    return this.auth.me(req.user.userId, req.user.companyId);
  }
}
