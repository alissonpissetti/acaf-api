import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { BrandFontsService } from './brand-fonts.service';

@Module({
  imports: [StorageModule],
  providers: [BrandFontsService],
  exports: [BrandFontsService],
})
export class BrandingModule {}
