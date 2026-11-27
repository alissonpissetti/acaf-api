import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthOtp } from '../auth/auth-otp.entity';
import { AuthOtpService } from '../auth/auth-otp.service';
import { SmsModule } from '../sms/sms.module';
import { UsersModule } from '../users/users.module';
import { MailModule } from '../mail/mail.module';
import { Company } from '../corporate/company.entity';
import { CorporateModule } from '../corporate/corporate.module';
import { CorporateAuthController } from './corporate-auth.controller';
import { CorporateAuthService } from './corporate-auth.service';
import { CorporateJwtStrategy } from './corporate-jwt.strategy';
import { CorporateManagerOnboardingCnpjChallenge } from './corporate-manager-onboarding-cnpj-challenge.entity';
import { CorporateManagerOnboardingInvite } from './corporate-manager-onboarding-invite.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { CorporateManagerOnboardingService } from './corporate-manager-onboarding.service';

@Module({
  imports: [
    NotificationsModule,
    forwardRef(() => UsersModule),
    SmsModule,
    TypeOrmModule.forFeature([
      AuthOtp,
      CorporateManagerOnboardingInvite,
      CorporateManagerOnboardingCnpjChallenge,
      Company,
    ]),
    MailModule,
    forwardRef(() => CorporateModule),
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: '7d' },
      }),
    }),
  ],
  controllers: [CorporateAuthController],
  providers: [
    CorporateAuthService,
    CorporateJwtStrategy,
    AuthOtpService,
    CorporateManagerOnboardingService,
  ],
  exports: [CorporateAuthService, CorporateJwtStrategy, CorporateManagerOnboardingService],
})
export class CorporateAuthModule {}
