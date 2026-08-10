import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlatformUser } from '../platform-users/platform-user.entity';
import { UnitPartnerAccess } from '../platform-users/unit-partner-access.entity';
import { User } from './user.entity';
import { UsersController } from './users.controller';
import { UsersMigrationService } from './users-migration.service';
import { UsersStoreSyncService } from './users-store-sync.service';
import { UsersService } from './users.service';

@Module({
  imports: [TypeOrmModule.forFeature([User, PlatformUser, UnitPartnerAccess])],
  controllers: [UsersController],
  providers: [UsersService, UsersMigrationService, UsersStoreSyncService],
  exports: [UsersService, UsersStoreSyncService],
})
export class UsersModule {}
