import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { MailService } from './mail.service';

@Module({
  imports: [StorageModule],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
