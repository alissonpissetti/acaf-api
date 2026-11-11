import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessControlModule } from '../access-control/access-control.module';
import { PartnerModule } from '../partner/partner.module';
import { UsersModule } from '../users/users.module';
import { CommercialLeadContact } from './commercial-lead-contact.entity';
import { CommercialLeadOwner } from './commercial-lead-owner.entity';
import { CommercialLead } from './commercial-lead.entity';
import { CommercialLeadInteraction } from './commercial-lead-interaction.entity';
import { CommercialFunnel } from './commercial-funnel.entity';
import { CommercialFunnelStage } from './commercial-funnel-stage.entity';
import { CommercialLossReason } from './commercial-loss-reason.entity';
import { CommercialLeadAuditLog } from './commercial-lead-audit.entity';
import { CommercialLeadAuditService } from './commercial-lead-audit.service';
import { CommercialController } from './commercial.controller';
import { CommercialLeadsService } from './commercial-leads.service';
import { CommercialFunnelsService } from './commercial-funnels.service';
import { CommercialLossReasonsService } from './commercial-loss-reasons.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CommercialLead,
      CommercialLeadInteraction,
      CommercialLeadOwner,
      CommercialLeadContact,
      CommercialFunnel,
      CommercialFunnelStage,
      CommercialLossReason,
      CommercialLeadAuditLog,
    ]),
    PartnerModule,
    UsersModule,
    AccessControlModule,
  ],
  controllers: [CommercialController],
  providers: [
    CommercialLeadsService,
    CommercialFunnelsService,
    CommercialLossReasonsService,
    CommercialLeadAuditService,
  ],
  exports: [CommercialFunnelsService, CommercialLeadsService, CommercialLossReasonsService],
})
export class CommercialModule {}
