import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AddressesModule } from './addresses/addresses.module';
import { AuthModule } from './auth/auth.module';
import { AuthOtp } from './auth/auth-otp.entity';
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
import { AccessControlModule } from './access-control/access-control.module';
import { FinanceModule } from './finance/finance.module';
import { UnitSchedule } from './partner/unit-schedule.entity';
import { PartnerStore } from './partner/partner-store.entity';
import { User } from './users/user.entity';
import { UsersModule } from './users/users.module';
import { NavModule } from './access-control/nav-module.entity';
import { ModuleItem } from './access-control/module-item.entity';
import { Permission } from './access-control/permission.entity';
import { UserGroup } from './access-control/user-group.entity';
import { GroupPermission } from './access-control/group-permission.entity';
import { Department } from './access-control/department.entity';
import { JobPosition } from './access-control/job-position.entity';
import { CostCenter } from './finance/cost-center.entity';
import { AccountPayable } from './finance/account-payable.entity';
import { AccountPlan } from './finance/account-plan.entity';
import { AccountReceivable } from './finance/account-receivable.entity';
import { SupplierPixKey } from './finance/supplier-pix-key.entity';
import { Supplier } from './finance/supplier.entity';
import { CommercialModule } from './commercial/commercial.module';
import { CommercialLead } from './commercial/commercial-lead.entity';
import { CommercialLeadInteraction } from './commercial/commercial-lead-interaction.entity';
import { CommercialLeadContact } from './commercial/commercial-lead-contact.entity';
import { CommercialLeadOwner } from './commercial/commercial-lead-owner.entity';
import { CommercialFunnel } from './commercial/commercial-funnel.entity';
import { CommercialFunnelStage } from './commercial/commercial-funnel-stage.entity';

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
            AuthOtp,
            PlatformUser,
            UnitPartnerAccess,
            Modality,
            Company,
            CompanyAccess,
            CompanyEmployee,
            CompanyInvite,
            CompanyInvoice,
            UnitSchedule,
            PartnerStore,
            NavModule,
            ModuleItem,
            Permission,
            UserGroup,
            GroupPermission,
            Department,
            JobPosition,
            CostCenter,
            AccountPlan,
            AccountPayable,
            AccountReceivable,
            Supplier,
            SupplierPixKey,
            CommercialLead,
            CommercialLeadInteraction,
            CommercialLeadOwner,
            CommercialLeadContact,
            CommercialFunnel,
            CommercialFunnelStage,
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
    AccessControlModule,
    FinanceModule,
    CommercialModule,
  ],
})
export class AppModule {}
