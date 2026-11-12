import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessControlModule } from '../access-control/access-control.module';
import { CommercialModule } from '../commercial/commercial.module';
import { BrandingModule } from '../branding/branding.module';
import { StorageModule } from '../storage/storage.module';
import { UsersModule } from '../users/users.module';
import { MarketingCampaign } from './marketing-campaign.entity';
import { MarketingCreative } from './marketing-creative.entity';
import { MarketingFormSubmission } from './marketing-form-submission.entity';
import { MarketingLandingPage } from './marketing-landing-page.entity';
import { MarketingPageEvent } from './marketing-page-event.entity';
import { MarketingController, MarketingPublicController } from './marketing.controller';
import { MarketingCampaignsService } from './marketing-campaigns.service';
import { MarketingLandingPagesService } from './marketing-landing-pages.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      MarketingCampaign,
      MarketingCreative,
      MarketingLandingPage,
      MarketingFormSubmission,
      MarketingPageEvent,
    ]),
    UsersModule,
    CommercialModule,
    AccessControlModule,
    StorageModule,
    BrandingModule,
  ],
  controllers: [MarketingController, MarketingPublicController],
  providers: [MarketingCampaignsService, MarketingLandingPagesService],
})
export class MarketingModule {}
