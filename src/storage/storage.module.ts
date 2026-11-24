import { Module } from '@nestjs/common';
import { NextcloudService } from './nextcloud.service';
import { SocialPostArteStorageService } from './social-post-arte-storage.service';
import { SocialPostLocalStorageService } from './social-post-local-storage.service';

@Module({
  providers: [NextcloudService, SocialPostLocalStorageService, SocialPostArteStorageService],
  exports: [NextcloudService, SocialPostLocalStorageService, SocialPostArteStorageService],
})
export class StorageModule {}
