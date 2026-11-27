import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessControlModule } from '../access-control/access-control.module';
import { User } from '../users/user.entity';
import { Notification } from './notification.entity';
import { NotificationTriggersRegistry } from './notification-triggers.registry';
import { NotificationTriggerHandlers } from './notification-trigger-handlers';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { OnboardingNotificationsService } from './onboarding-notifications.service';

@Module({
  imports: [TypeOrmModule.forFeature([Notification, User]), AccessControlModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationTriggersRegistry,
    NotificationTriggerHandlers,
    OnboardingNotificationsService,
  ],
  exports: [NotificationsService, NotificationTriggersRegistry, OnboardingNotificationsService],
})
export class NotificationsModule {}
