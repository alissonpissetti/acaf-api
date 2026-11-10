import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
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
import { EvolutionContactProfile } from './evolution-contact-profile.entity';
import { EvolutionInboxService } from './evolution-inbox.service';
import { EvolutionInboxController } from './evolution-inbox.controller';
import { EvolutionRemoteMediaService } from './evolution-remote-media.service';
import { EvolutionRemoteContactsService } from './evolution-remote-contacts.service';
import { CommercialLead } from '../commercial/commercial-lead.entity';
import { StorageModule } from '../storage/storage.module';
import { EvolutionContactAvatarService } from './evolution-contact-avatar.service';
import { EvolutionMessageMediaStorageService } from './evolution-message-media-storage.service';
import { EvolutionInboxGateway } from './evolution-inbox.gateway';
import { EvolutionInboxRealtimeService } from './evolution-inbox-realtime.service';
import { EvolutionInboxRead } from './evolution-inbox-read.entity';
import { EvolutionInboxDeviceRead } from './evolution-inbox-device-read.entity';
import { EvolutionInboxThreadArchive } from './evolution-inbox-thread-archive.entity';
import { EvolutionInboxSyncState } from './evolution-inbox-sync-state.entity';
import { EvolutionRemoteChatsService } from './evolution-remote-chats.service';
import { EvolutionRemoteMessagesService } from './evolution-remote-messages.service';
import { EvolutionInboxJobsScheduler } from './evolution-inbox-jobs.scheduler';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([
      EvolutionInstance,
      EvolutionMessage,
      EvolutionContactProfile,
      EvolutionInboxRead,
      EvolutionInboxDeviceRead,
      EvolutionInboxThreadArchive,
      EvolutionInboxSyncState,
      Department,
      User,
      CommercialLead,
    ]),
    AccessControlModule,
    CommercialModule,
    UsersModule,
    SystemSettingsModule,
    StorageModule,
  ],
  controllers: [EvolutionInstancesController, EvolutionWebhookController, EvolutionInboxController],
  providers: [
    EvolutionInstancesService,
    EvolutionInboundService,
    EvolutionInboxService,
    EvolutionRemoteMediaService,
    EvolutionRemoteContactsService,
    EvolutionContactAvatarService,
    EvolutionMessageMediaStorageService,
    EvolutionInboxRealtimeService,
    EvolutionInboxGateway,
    EvolutionRemoteChatsService,
    EvolutionRemoteMessagesService,
    EvolutionInboxJobsScheduler,
  ],
  exports: [EvolutionInstancesService],
})
export class EvolutionModule {}
