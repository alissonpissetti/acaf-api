import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StorageModule } from '../storage/storage.module';
import { AccessControlModule } from '../access-control/access-control.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { User } from '../users/user.entity';
import { UsersModule } from '../users/users.module';
import { ProjectTask } from './project-task.entity';
import { ProjectTaskAttachment } from './project-task-attachment.entity';
import { ProjectTaskComment } from './project-task-comment.entity';
import { ProjectTaskEvent } from './project-task-event.entity';
import { ProjectTasksAdminController } from './project-tasks-admin.controller';
import { ProjectTasksMigrationService } from './project-tasks-migration.service';
import { ProjectTasksSeedService } from './project-tasks-seed.service';
import { ProjectTaskNotificationsService } from './project-task-notifications.service';
import { ProjectTaskWatcher } from './project-task-watcher.entity';
import { ProjectTasksService } from './project-tasks.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ProjectTask,
      ProjectTaskEvent,
      ProjectTaskComment,
      ProjectTaskAttachment,
      ProjectTaskWatcher,
      User,
    ]),
    NotificationsModule,
    StorageModule,
    AccessControlModule,
    AuthModule,
    UsersModule,
  ],
  controllers: [ProjectTasksAdminController],
  providers: [
    ProjectTasksService,
    ProjectTaskNotificationsService,
    ProjectTasksSeedService,
    ProjectTasksMigrationService,
  ],
  exports: [ProjectTasksService],
})
export class ProjectTasksModule {}