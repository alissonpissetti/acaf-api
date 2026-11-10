import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ChangelogController } from './changelog.controller';
import { ChangelogGitService } from './changelog-git.service';
import { ChangelogService } from './changelog.service';

@Module({
  imports: [ConfigModule],
  controllers: [ChangelogController],
  providers: [ChangelogService, ChangelogGitService],
  exports: [ChangelogService],
})
export class ChangelogModule {}
