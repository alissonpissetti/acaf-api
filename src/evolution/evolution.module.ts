import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessControlModule } from '../access-control/access-control.module';
import { CommercialModule } from '../commercial/commercial.module';
import { User } from '../users/user.entity';
import { UsersModule } from '../users/users.module';
import { Department } from '../access-control/department.entity';
import { EvolutionInstance } from './evolution-instance.entity';
import { EvolutionInboundService } from './evolution-inbound.service';
import { EvolutionInstancesController } from './evolution-instances.controller';
import { EvolutionInstancesService } from './evolution-instances.service';
import { EvolutionWebhookController } from './evolution-webhook.controller';
import { SystemSettingsModule } from '../system-settings/system-settings.module';
import { EvolutionMessage } from './evolution-message.entity';
import { EvolutionInboxService } from './evolution-inbox.service';
import { EvolutionInboxController } from './evolution-inbox.controller';
import { CommercialLead } from '../commercial/commercial-lead.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([EvolutionInstance, EvolutionMessage, Department, User, CommercialLead]),
    AccessControlModule,
    CommercialModule,
    UsersModule,
    SystemSettingsModule,
  ],
  controllers: [EvolutionInstancesController, EvolutionWebhookController, EvolutionInboxController],
  providers: [EvolutionInstancesService, EvolutionInboundService, EvolutionInboxService],
  exports: [EvolutionInstancesService],
})
export class EvolutionModule {}
