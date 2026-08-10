import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { PartnerAuthService } from './partner-auth.service';
import { PartnerJwtAuthGuard } from './partner-jwt-auth.guard';

type PartnerAuthRequest = Request & {
  user: { platformUserId: string; unitIds: string[]; kind?: 'platform' | 'admin' };
};

@Controller('partner/auth')
export class PartnerAuthController {
  constructor(private readonly auth: PartnerAuthService) {}

  @Post('login')
  login(@Body() body: { login: string; password: string }) {
    return this.auth.login(body.login ?? '', body.password ?? '');
  }

  @Get('me')
  @UseGuards(PartnerJwtAuthGuard)
  me(@Req() req: PartnerAuthRequest) {
    return this.auth.me(req.user.platformUserId);
  }
}
