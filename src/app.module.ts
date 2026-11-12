import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AddressesModule } from './addresses/addresses.module';
import { AuthModule } from './auth/auth.module';
import { AuthOtp } from './auth/auth-otp.entity';
import { parseDatabaseUrl } from './database/parse-database-url';
import { PartnerAuthModule } from './partner-auth/partner-auth.module';
import { PartnerOnboardingEmailSend } from './partner-auth/partner-onboarding-email-send.entity';
import { PartnerOnboardingInvite } from './partner-auth/partner-onboarding-invite.entity';
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
import { CommercialLossReason } from './commercial/commercial-loss-reason.entity';
import { CommercialLeadAuditLog } from './commercial/commercial-lead-audit.entity';
import { MarketingModule } from './marketing/marketing.module';
import { SiteModule } from './site/site.module';
import { MarketingCampaign } from './marketing/marketing-campaign.entity';
import { MarketingCreative } from './marketing/marketing-creative.entity';
import { MarketingLandingPage } from './marketing/marketing-landing-page.entity';
import { MarketingFormSubmission } from './marketing/marketing-form-submission.entity';
import { MarketingPageEvent } from './marketing/marketing-page-event.entity';
import { Notification } from './notifications/notification.entity';
import { NotificationsModule } from './notifications/notifications.module';
import { SupportTicketMessage } from './support/support-ticket-message.entity';
import { SupportTicket } from './support/support-ticket.entity';
import { SupportQueue } from './support/support-queue.entity';
import { SupportModule } from './support/support.module';
import { AcafAssociationModule } from './acaf-association/acaf-association.module';
import { EvolutionModule } from './evolution/evolution.module';
import { EvolutionInstance } from './evolution/evolution-instance.entity';
import { EvolutionMessage } from './evolution/evolution-message.entity';
import { EvolutionContactProfile } from './evolution/evolution-contact-profile.entity';
import { EvolutionInboxRead } from './evolution/evolution-inbox-read.entity';
import { EvolutionInboxDeviceRead } from './evolution/evolution-inbox-device-read.entity';
import { EvolutionInboxThreadArchive } from './evolution/evolution-inbox-thread-archive.entity';
import { EvolutionInboxSyncState } from './evolution/evolution-inbox-sync-state.entity';
import { EvolutionLeadIgnoreContact } from './evolution/evolution-lead-ignore-contact.entity';
import { SystemSetting } from './system-settings/system-setting.entity';
import { ChangelogModule } from './changelog/changelog.module';
import { ChangelogEntry } from './changelog/changelog-entry.entity';
import { AssociationsModule } from './associations/associations.module';
import { Association } from './associations/association.entity';

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
            CommercialLossReason,
            CommercialLeadAuditLog,
            MarketingCampaign,
            MarketingCreative,
            MarketingLandingPage,
            MarketingFormSubmission,
            MarketingPageEvent,
            Notification,
            SupportTicket,
            SupportTicketMessage,
            SupportQueue,
            PartnerOnboardingInvite,
            PartnerOnboardingEmailSend,
            EvolutionInstance,
            EvolutionMessage,
            EvolutionContactProfile,
            EvolutionInboxRead,
            EvolutionInboxDeviceRead,
            EvolutionInboxThreadArchive,
            EvolutionInboxSyncState,
            EvolutionLeadIgnoreContact,
            SystemSetting,
            ChangelogEntry,
            Association,
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
            maxIdle: 5,
            idleTimeout: 60_000,
            waitForConnections: true,
            connectTimeout: 30_000,
            enableKeepAlive: true,
            keepAliveInitialDelay: 10_000,
            resetOnRelease: true,
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
    MarketingModule,
    SiteModule,
    NotificationsModule,
    SupportModule,
    AcafAssociationModule,
    EvolutionModule,
    ChangelogModule,
    AssociationsModule,
  ],
})
export class AppModule {}
