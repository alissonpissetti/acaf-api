import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthOtp } from '../auth/auth-otp.entity';
import { AuthOtpService } from '../auth/auth-otp.service';
import { CorporateModule } from '../corporate/corporate.module';
import { MailModule } from '../mail/mail.module';
import { SmsModule } from '../sms/sms.module';
import { UsersModule } from '../users/users.module';
import { MemberAuthController } from './member-auth.controller';
import { MemberAuthService } from './member-auth.service';
import { MemberJwtStrategy } from './member-jwt.strategy';
import { MemberJwtAuthGuard } from './member-jwt-auth.guard';
import { MemberOptionalJwtAuthGuard } from './member-optional-jwt.guard';

@Module({
  imports: [
    forwardRef(() => UsersModule),
    CorporateModule,
    TypeOrmModule.forFeature([AuthOtp]),
    MailModule,
    SmsModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: '30d' },
      }),
    }),
  ],
  controllers: [MemberAuthController],
  providers: [
    MemberAuthService,
    MemberJwtStrategy,
    MemberJwtAuthGuard,
    MemberOptionalJwtAuthGuard,
    AuthOtpService,
  ],
  exports: [MemberAuthService, MemberJwtStrategy, MemberJwtAuthGuard, MemberOptionalJwtAuthGuard],
})
export class MemberAuthModule {}