import { BadRequestException, Body, Controller, Delete, Get, Patch, Post, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthOtpPurpose } from './auth-otp.entity';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

type AuthRequest = Request & { user: { userId: string } };

@ApiTags('Admin · Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  login(@Body() body: { email?: string; password?: string }) {
    const email = body.email?.trim();
    const password = body.password ?? '';
    if (!email) {
      throw new BadRequestException('Informe o e-mail.');
    }
    return this.auth.login(email, password);
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
  resetPassword(@Body() body: { mobilePhone: string; code: string; newPassword: string }) {
    return this.auth.resetPasswordWithOtp(body.mobilePhone, body.code, body.newPassword);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('admin-jwt')
  me(@Req() req: AuthRequest) {
    return this.auth.me(req.user.userId);
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('admin-jwt')
  updateMe(@Req() req: AuthRequest, @Body() body: { avatarColor?: string }) {
    return this.auth.updateProfile(req.user.userId, body);
  }

  @Post('me/avatar')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('admin-jwt')
  @UseInterceptors(
    FileInterceptor('avatar', {
      limits: { fileSize: 15 * 1024 * 1024 },
    }),
  )
  uploadAvatar(@Req() req: AuthRequest, @UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Envie a imagem do avatar.');
    }
    return this.auth.uploadAvatar(req.user.userId, file);
  }

  @Delete('me/avatar')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('admin-jwt')
  removeAvatar(@Req() req: AuthRequest) {
    return this.auth.removeAvatar(req.user.userId);
  }
}
