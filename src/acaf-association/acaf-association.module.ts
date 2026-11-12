import { Module } from '@nestjs/common';
import { AccessControlModule } from '../access-control/access-control.module';
import { AssociationsModule } from '../associations/associations.module';
import { PartnerModule } from '../partner/partner.module';
import { AssociationPortalController } from '../association-portal/association-portal.controller';
import { AssociationPortalService } from '../association-portal/association-portal.service';
import { AcafAssociationController } from './acaf-association.controller';
import { AcafAssociationService } from './acaf-association.service';

@Module({
  imports: [PartnerModule, AccessControlModule, AssociationsModule],
  controllers: [AcafAssociationController, AssociationPortalController],
  providers: [AssociationPortalService, AcafAssociationService],
})
export class AcafAssociationModule {}
