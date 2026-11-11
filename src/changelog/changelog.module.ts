import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessControlModule } from '../access-control/access-control.module';
import { AuthModule } from '../auth/auth.module';
import { ChangelogController } from './changelog.controller';
import { ChangelogEntry } from './changelog-entry.entity';
import { ChangelogGitService } from './changelog-git.service';
import { ChangelogService } from './changelog.service';

@Module({
  imports: [
    ConfigModule,
    AuthModule,
    AccessControlModule,
    TypeOrmModule.forFeature([ChangelogEntry]),
  ],
  controllers: [ChangelogController],
  providers: [ChangelogService, ChangelogGitService],
  exports: [ChangelogService],
})
export class ChangelogModule {}
