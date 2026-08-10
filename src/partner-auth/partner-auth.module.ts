import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PlatformUsersModule } from '../platform-users/platform-users.module';
import { UsersModule } from '../users/users.module';
import { PartnerAuthController } from './partner-auth.controller';
import { PartnerAuthService } from './partner-auth.service';
import { PartnerJwtStrategy } from './partner-jwt.strategy';

@Module({
  imports: [
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
  providers: [PartnerAuthService, PartnerJwtStrategy],
  exports: [PartnerAuthService, PartnerJwtStrategy],
})
export class PartnerAuthModule {}
