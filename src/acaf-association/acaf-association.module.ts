import { Module } from '@nestjs/common';
import { AccessControlModule } from '../access-control/access-control.module';
import { PartnerModule } from '../partner/partner.module';
import { AcafAssociationController } from './acaf-association.controller';
import { AcafAssociationService } from './acaf-association.service';

@Module({
  imports: [PartnerModule, AccessControlModule],
  controllers: [AcafAssociationController],
  providers: [AcafAssociationService],
})
export class AcafAssociationModule {}
