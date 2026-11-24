import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessControlModule } from '../access-control/access-control.module';
import { ModuleItem } from '../access-control/module-item.entity';
import { Permission } from '../access-control/permission.entity';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { BufferClient } from '../buffer/buffer.client';
import { MailModule } from '../mail/mail.module';
import { SmsModule } from '../sms/sms.module';
import { StorageModule } from '../storage/storage.module';
import { User } from '../users/user.entity';
import { UsersModule } from '../users/users.module';
import { SocialChannel } from './social-channel.entity';
import { SocialPost } from './social-post.entity';
import { SocialPostArte } from './social-post-arte.entity';
import { SocialPostBuffer } from './social-post-buffer.entity';
import { SocialPostsAdminController } from './social-posts-admin.controller';
import { SocialPostsMediaController } from './social-posts-media.controller';
import { SocialPostsBufferService } from './social-posts-buffer.service';
import { SocialPostsMigrationService } from './social-posts-migration.service';
import { SocialPostsSeedService } from './social-posts-seed.service';
import { SocialPostsService } from './social-posts.service';
import { SocialPostsManualReminderScheduler } from './social-posts-manual-reminder.scheduler';
import { SocialPostsManualReminderService } from './social-posts-manual-reminder.service';
import { SocialPostsNotificationsService } from './social-posts-notifications.service';
import { SocialPostsSyncScheduler } from './social-posts-sync.scheduler';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SocialPost,
      SocialPostArte,
      SocialPostBuffer,
      SocialChannel,
      Permission,
      ModuleItem,
      User,
    ]),
    AccessControlModule,
    AuthModule,
    StorageModule,
    MailModule,
    SmsModule,
    NotificationsModule,
    UsersModule,
  ],
  controllers: [SocialPostsAdminController, SocialPostsMediaController],
  providers: [
    SocialPostsService,
    SocialPostsNotificationsService,
    SocialPostsSeedService,
    SocialPostsMigrationService,
    SocialPostsBufferService,
    SocialPostsSyncScheduler,
    SocialPostsManualReminderService,
    SocialPostsManualReminderScheduler,
    BufferClient,
  ],
  exports: [SocialPostsService],
})
export class SocialPostsModule {}