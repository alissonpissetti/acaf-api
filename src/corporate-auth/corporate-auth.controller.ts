import { Controller, Get, Post, Body, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthOtpPurpose } from '../auth/auth-otp.entity';
import { CorporateAuthService } from './corporate-auth.service';
import { CorporateJwtAuthGuard } from './corporate-jwt-auth.guard';

type CorpAuthRequest = Request & {
  user: { userId: string; companyId: string; companyIds: string[] };
};

@ApiTags('Corporativo · Auth')
@Controller('corporate/auth')
export class CorporateAuthController {
  constructor(private readonly auth: CorporateAuthService) {}

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
