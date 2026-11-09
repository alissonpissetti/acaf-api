import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { PlatformUsersModule } from '../platform-users/platform-users.module';
import { SmsModule } from '../sms/sms.module';
import { UsersModule } from '../users/users.module';
import { PartnerAuthController } from './partner-auth.controller';
import { PartnerAuthService } from './partner-auth.service';
import { PartnerJwtStrategy } from './partner-jwt.strategy';
import { PartnerOnboardingInvite } from './partner-onboarding-invite.entity';
import { PartnerOnboardingService } from './partner-onboarding.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([PartnerOnboardingInvite]),
    AuthModule,
    SmsModule,
    PlatformUsersModule,
    UsersModule,
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
  controllers: [PartnerAuthController],
  providers: [PartnerAuthService, PartnerJwtStrategy, PartnerOnboardingService],
  exports: [PartnerAuthService, PartnerJwtStrategy, PartnerOnboardingService],
})
export class PartnerAuthModule {}
