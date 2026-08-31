import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessControlModule } from '../access-control/access-control.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { User } from '../users/user.entity';
import { UsersModule } from '../users/users.module';
import { CorporateSupportController } from './corporate-support.controller';
import { PartnerSupportController } from './partner-support.controller';
import { SupportNotificationsService } from './support-notifications.service';
import { SupportTicketMessage } from './support-ticket-message.entity';
import { SupportTicket } from './support-ticket.entity';
import { SupportTicketsService } from './support-tickets.service';
import { SupportController } from './support.controller';
import { SupportQueuesService } from './support-queues.service';
import { SupportQueuesController } from './support-queues.controller';
import { SupportQueue } from './support-queue.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([SupportTicket, SupportTicketMessage, SupportQueue, User]),
    UsersModule,
    AccessControlModule,
    NotificationsModule,
  ],
  controllers: [SupportController, SupportQueuesController, PartnerSupportController, CorporateSupportController],
  providers: [SupportTicketsService, SupportQueuesService, SupportNotificationsService],
  exports: [SupportTicketsService, SupportQueuesService],
})
export class SupportModule {}
