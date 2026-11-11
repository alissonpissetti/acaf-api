import { Module } from '@nestjs/common';
import { CommercialModule } from '../commercial/commercial.module';
import { UsersModule } from '../users/users.module';
import { SitePublicController } from './site-public.controller';
import { SitePublicService } from './site-public.service';

@Module({
  imports: [CommercialModule, UsersModule],
  controllers: [SitePublicController],
  providers: [SitePublicService],
})
export class SiteModule {}
