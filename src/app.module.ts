import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AddressesModule } from './addresses/addresses.module';
import { AuthModule } from './auth/auth.module';
import { parseDatabaseUrl } from './database/parse-database-url';
import { PartnerAuthModule } from './partner-auth/partner-auth.module';
import { PartnerModule } from './partner/partner.module';
import { PlatformUser } from './platform-users/platform-user.entity';
import { PlatformUsersModule } from './platform-users/platform-users.module';
import { UnitPartnerAccess } from './platform-users/unit-partner-access.entity';
import { Modality } from './modalities/modality.entity';
import { ModalitiesModule } from './modalities/modalities.module';
import { Company } from './corporate/company.entity';
import { CompanyAccess } from './corporate/company-access.entity';
import { CompanyEmployee } from './corporate/company-employee.entity';
import { CompanyInvite } from './corporate/company-invite.entity';
import { CompanyInvoice } from './corporate/company-invoice.entity';
import { CorporateModule } from './corporate/corporate.module';
import { UnitSchedule } from './partner/unit-schedule.entity';
import { User } from './users/user.entity';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const databaseUrl = config.getOrThrow<string>('DATABASE_URL');
        const db = parseDatabaseUrl(databaseUrl);
        return {
          type: db.type,
          host: db.host,
          port: db.port,
          username: db.username,
          password: db.password,
          database: db.database,
          entities: [
            User,
            PlatformUser,
            UnitPartnerAccess,
            Modality,
            Company,
            CompanyAccess,
            CompanyEmployee,
            CompanyInvite,
            CompanyInvoice,
            UnitSchedule,
          ],
          synchronize: config.get('DB_SYNC', 'true') === 'true',
          retryAttempts: 5,
          retryDelay: 2000,
          ssl:
            config.get('DATABASE_SSL', 'true') === 'true'
              ? { rejectUnauthorized: false }
              : undefined,
          extra: {
            connectionLimit: 10,
            waitForConnections: true,
            connectTimeout: 30_000,
            enableKeepAlive: true,
            keepAliveInitialDelay: 10_000,
          },
        };
      },
    }),
    AuthModule,
    AddressesModule,
    UsersModule,
    PlatformUsersModule,
    PartnerAuthModule,
    PartnerModule,
    ModalitiesModule,
    CorporateModule,
  ],
})
export class AppModule {}
