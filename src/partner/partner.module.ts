import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AddressesModule } from '../addresses/addresses.module';
import { CommercialLead } from '../commercial/commercial-lead.entity';
import { AccountPayable } from '../finance/account-payable.entity';
import { AccountReceivable } from '../finance/account-receivable.entity';
import { Supplier } from '../finance/supplier.entity';
import { PlatformUsersModule } from '../platform-users/platform-users.module';
import { UsersModule } from '../users/users.module';
import { StorageModule } from '../storage/storage.module';
import { ModalitiesModule } from '../modalities/modalities.module';
import { CorporateModule } from '../corporate/corporate.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { PartnerController, SharedController } from './partner.controller';
import { PartnerService } from './partner.service';
import { UnitSchedule } from './unit-schedule.entity';
import { PartnerStore } from './partner-store.entity';
import { UnitScheduleService } from './unit-schedule.service';
import { UnitCoordinatesService } from './unit-coordinates.service';
import { AcafAssociatesImportService } from './acaf-associates-import.service';
import { PartnerStorePersistenceService } from './partner-store-persistence.service';
import { PartnerAuthModule } from '../partner-auth/partner-auth.module';
import { AssociateRepasseDailyScheduler } from './associate-repasse-daily.scheduler';

@Module({
  imports: [
    PartnerAuthModule,
    TypeOrmModule.forFeature([
      UnitSchedule,
      PartnerStore,
      CommercialLead,
      AccountPayable,
      AccountReceivable,
      Supplier,
    ]),
    AddressesModule,
    StorageModule,
    PlatformUsersModule,
    UsersModule,
    ModalitiesModule,
    CorporateModule,
  ],
  controllers: [PartnerController, SharedController, AdminController],
  providers: [
    PartnerStorePersistenceService,
    PartnerService,
    AdminService,
    UnitScheduleService,
    UnitCoordinatesService,
    AcafAssociatesImportService,
    AssociateRepasseDailyScheduler,
  ],
  exports: [UnitScheduleService, PartnerStorePersistenceService, AdminService],
})
export class PartnerModule {}
