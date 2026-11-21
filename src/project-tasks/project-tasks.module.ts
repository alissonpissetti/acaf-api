import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessControlModule } from '../access-control/access-control.module';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { ProjectTask } from './project-task.entity';
import { ProjectTaskEvent } from './project-task-event.entity';
import { ProjectTasksAdminController } from './project-tasks-admin.controller';
import { ProjectTasksMigrationService } from './project-tasks-migration.service';
import { ProjectTasksSeedService } from './project-tasks-seed.service';
import { ProjectTasksService } from './project-tasks.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ProjectTask, ProjectTaskEvent]),
    AccessControlModule,
    AuthModule,
    UsersModule,
  ],
  controllers: [ProjectTasksAdminController],
  providers: [
    ProjectTasksService,
    ProjectTasksSeedService,
    ProjectTasksMigrationService,
  ],
  exports: [ProjectTasksService],
})
export class ProjectTasksModule {}