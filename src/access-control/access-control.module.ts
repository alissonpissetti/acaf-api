import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/user.entity';
import { CostCenter } from '../finance/cost-center.entity';
import { AccessControlController } from './access-control.controller';
import {
  AccessControlSeedService,
  DepartmentsService,
  JobPositionsService,
  ModulesAdminService,
  NavigationService,
  PermissionsService,
  UserGroupsService,
} from './access-control.service';
import { Department } from './department.entity';
import { GroupPermission } from './group-permission.entity';
import { JobPosition } from './job-position.entity';
import { ModuleItem } from './module-item.entity';
import { NavModule } from './nav-module.entity';
import { Permission } from './permission.entity';
import { PermissionsGuard } from './permissions.guard';
import { UserGroup } from './user-group.entity';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([
      NavModule,
      ModuleItem,
      Permission,
      UserGroup,
      GroupPermission,
      Department,
      JobPosition,
      User,
      CostCenter,
    ]),
  ],
  controllers: [AccessControlController],
  providers: [
    PermissionsService,
    AccessControlSeedService,
    NavigationService,
    ModulesAdminService,
    UserGroupsService,
    DepartmentsService,
    JobPositionsService,
    PermissionsGuard,
  ],
  exports: [PermissionsService, NavigationService, PermissionsGuard],
})
export class AccessControlModule {}
