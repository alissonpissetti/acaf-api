import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { UsersModule } from '../users/users.module';
import { CorporateModule } from '../corporate/corporate.module';
import { CorporateAuthController } from './corporate-auth.controller';
import { CorporateAuthService } from './corporate-auth.service';
import { CorporateJwtStrategy } from './corporate-jwt.strategy';

@Module({
  imports: [
    UsersModule,
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
  providers: [CorporateAuthService, CorporateJwtStrategy],
  exports: [CorporateAuthService, CorporateJwtStrategy],
})
export class CorporateAuthModule {}
