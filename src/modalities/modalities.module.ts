import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Modality } from './modality.entity';
import { ModalitiesService } from './modalities.service';

@Module({
  imports: [TypeOrmModule.forFeature([Modality])],
  providers: [ModalitiesService],
  exports: [ModalitiesService],
})
export class ModalitiesModule {}
