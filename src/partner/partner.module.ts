import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AddressesModule } from '../addresses/addresses.module';
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
import { PartnerStorePersistenceService } from './partner-store-persistence.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([UnitSchedule, PartnerStore]),
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
  ],
  exports: [UnitScheduleService, PartnerStorePersistenceService],
})
export class PartnerModule {}
