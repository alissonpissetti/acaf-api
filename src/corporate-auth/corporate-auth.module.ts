import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthOtp } from '../auth/auth-otp.entity';
import { AuthOtpService } from '../auth/auth-otp.service';
import { SmsModule } from '../sms/sms.module';
import { UsersModule } from '../users/users.module';
import { CorporateModule } from '../corporate/corporate.module';
import { CorporateAuthController } from './corporate-auth.controller';
import { CorporateAuthService } from './corporate-auth.service';
import { CorporateJwtStrategy } from './corporate-jwt.strategy';

@Module({
  imports: [
    UsersModule,
    SmsModule,
    TypeOrmModule.forFeature([AuthOtp]),
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
  providers: [CorporateAuthService, CorporateJwtStrategy, AuthOtpService],
  exports: [CorporateAuthService, CorporateJwtStrategy],
})
export class CorporateAuthModule {}
