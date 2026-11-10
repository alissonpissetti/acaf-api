import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ChangelogController } from './changelog.controller';
import { ChangelogService } from './changelog.service';

@Module({
  imports: [ConfigModule],
  controllers: [ChangelogController],
  providers: [ChangelogService],
  exports: [ChangelogService],
})
export class ChangelogModule {}
