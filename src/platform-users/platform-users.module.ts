import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../users/users.module';
import { PartnerAccessService } from './partner-access.service';
import { UnitPartnerAccess } from './unit-partner-access.entity';

@Module({
  imports: [TypeOrmModule.forFeature([UnitPartnerAccess]), UsersModule],
  providers: [PartnerAccessService],
  exports: [PartnerAccessService],
})
export class PlatformUsersModule {}
