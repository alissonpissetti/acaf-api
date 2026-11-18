import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { MemberAuthService } from './member-auth.service';
import { MemberJwtAuthGuard } from './member-jwt-auth.guard';

type MemberAuthRequest = Request & { user: { userId: string } };

@ApiTags('App · Auth')
@Controller('member/auth')
export class MemberAuthController {
  constructor(private readonly auth: MemberAuthService) {}

  @Post('signup')
  signup(
    @Body()
    body: {
      name: string;
      email: string;
      password: string;
      cpf?: string;
      mobilePhone?: string;
      enrollmentCode?: string;
    },
  ) {
    return this.auth.signup(body);
  }

  @Post('password-reset/request')
  requestPasswordReset(@Body() body: { login: string; channel: 'sms' | 'email' }) {
    return this.auth.requestPasswordReset(body.login ?? '', body.channel);
  }

  @Post('password-reset/confirm')
  confirmPasswordReset(
    @Body()
    body: {
      login: string;
      channel: 'sms' | 'email';
      code: string;
      newPassword: string;
    },
  ) {
    return this.auth.resetPasswordWithOtp({
      login: body.login ?? '',
      channel: body.channel,
      code: body.code ?? '',
      newPassword: body.newPassword ?? '',
    });
  }

  @Post('login')
  login(
    @Body()
    body: {
      email?: string;
      login?: string;
      password: string;
      enrollmentCode?: string;
    },
  ) {
    const login = body.login?.trim() || body.email?.trim() || '';
    return this.auth.login(login, body.password ?? '', body.enrollmentCode);
  }

  @Get('me')
  @UseGuards(MemberJwtAuthGuard)
  @ApiBearerAuth('member-jwt')
  me(@Req() req: MemberAuthRequest) {
    return this.auth.me(req.user.userId);
  }

  @Post('sync-connect')
  @UseGuards(MemberJwtAuthGuard)
  @ApiBearerAuth('member-jwt')
  async syncConnect(@Req() req: MemberAuthRequest) {
    const user = await this.auth.me(req.user.userId);
    return { ok: true, connectProfile: user.connectProfile };
  }

  @Post('me/avatar')
  @UseGuards(MemberJwtAuthGuard)
  @ApiBearerAuth('member-jwt')
  @UseInterceptors(
    FileInterceptor('avatar', {
      limits: { fileSize: 15 * 1024 * 1024 },
    }),
  )
  uploadAvatar(@Req() req: MemberAuthRequest, @UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Envie a imagem do avatar.');
    }
    return this.auth.uploadAvatar(req.user.userId, file);
  }

  @Delete('me/avatar')
  @UseGuards(MemberJwtAuthGuard)
  @ApiBearerAuth('member-jwt')
  removeAvatar(@Req() req: MemberAuthRequest) {
    return this.auth.removeAvatar(req.user.userId);
  }
}