import { Module } from '@nestjs/common';
import { ComteleClient } from './comtele.client';
import { SmsService } from './sms.service';

@Module({
  providers: [ComteleClient, SmsService],
  exports: [SmsService],
})
export class SmsModule {}
