import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Notification } from './notification.entity';
import { NotificationTriggersRegistry } from './notification-triggers.registry';
import { NotificationTriggerHandlers } from './notification-trigger-handlers';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [TypeOrmModule.forFeature([Notification])],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationTriggersRegistry, NotificationTriggerHandlers],
  exports: [NotificationsService, NotificationTriggersRegistry],
})
export class NotificationsModule {}
