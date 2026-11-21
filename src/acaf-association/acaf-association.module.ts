import { Module } from '@nestjs/common';
import { AccessControlModule } from '../access-control/access-control.module';
import { AssociationsModule } from '../associations/associations.module';
import { PartnerModule } from '../partner/partner.module';
import { UsersModule } from '../users/users.module';
import { AssociationPortalController } from '../association-portal/association-portal.controller';
import { AssociationPortalService } from '../association-portal/association-portal.service';
import { AcafAssociationController } from './acaf-association.controller';
import { AcafAssociationService } from './acaf-association.service';
import { ProjectTasksModule } from '../project-tasks/project-tasks.module';

@Module({
  imports: [PartnerModule, AccessControlModule, AssociationsModule, UsersModule, ProjectTasksModule],
  controllers: [AcafAssociationController, AssociationPortalController],
  providers: [AssociationPortalService, AcafAssociationService],
})
export class AcafAssociationModule {}
