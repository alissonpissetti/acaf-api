import { Module } from '@nestjs/common';
import { NextcloudService } from './nextcloud.service';
import { SocialPostLocalStorageService } from './social-post-local-storage.service';

@Module({
  providers: [NextcloudService, SocialPostLocalStorageService],
  exports: [NextcloudService, SocialPostLocalStorageService],
})
export class StorageModule {}
