import { Module, forwardRef } from '@nestjs/common';
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
import { CommercialLossReportService } from './commercial-loss-report.service';
import { EvolutionContactProfile } from '../evolution/evolution-contact-profile.entity';
import { EvolutionMessage } from '../evolution/evolution-message.entity';
import { EvolutionModule } from '../evolution/evolution.module';

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
      EvolutionContactProfile,
      EvolutionMessage,
    ]),
    PartnerModule,
    UsersModule,
    AccessControlModule,
    forwardRef(() => EvolutionModule),
  ],
  controllers: [CommercialController],
  providers: [
    CommercialLeadsService,
    CommercialFunnelsService,
    CommercialLossReasonsService,
    CommercialLossReportService,
    CommercialLeadAuditService,
  ],
  exports: [CommercialFunnelsService, CommercialLeadsService, CommercialLossReasonsService],
})
export class CommercialModule {}
