import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessControlModule } from '../access-control/access-control.module';
import { Association } from '../associations/association.entity';
import { SmsModule } from '../sms/sms.module';
import { UsersModule } from '../users/users.module';
import { AuthOtp } from './auth-otp.entity';
import { AuthOtpService } from './auth-otp.service';
import { AuthController } from './auth.controller';
import { AuthPortalEligibilityService } from './auth-portal-eligibility.service';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';

@Module({
  imports: [
    UsersModule,
    AccessControlModule,
    SmsModule,
    TypeOrmModule.forFeature([AuthOtp, Association]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: '7d' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthOtpService, AuthPortalEligibilityService, JwtStrategy],
  exports: [AuthService, AuthOtpService, AuthPortalEligibilityService, JwtModule],
})
export class AuthModule {}
