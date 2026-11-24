import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SocialPostsBufferService } from './social-posts-buffer.service';

const TICK_MS = 12 * 60 * 1000;

@Injectable()
export class SocialPostsSyncScheduler implements OnModuleInit {
  private readonly logger = new Logger(SocialPostsSyncScheduler.name);

  constructor(
    private readonly config: ConfigService,
    private readonly buffer: SocialPostsBufferService,
  ) {}

  onModuleInit() {
    const enabled = this.config.get('BUFFER_SYNC_ENABLED', '1') === '1';
    if (!enabled) {
      this.logger.log('Sincronização Buffer desabilitada (BUFFER_SYNC_ENABLED=0).');
      return;
    }
    void this.tick();
    setInterval(() => void this.tick(), TICK_MS);
    this.logger.log('Sincronização Buffer agendada (tick 12 min).');
  }

  private async tick() {
    try {
      const result = await this.buffer.syncAll();
      if (result.errors.length) {
        this.logger.warn(`Buffer sync: ${result.errors.slice(0, 3).join(' · ')}`);
      }
    } catch (e) {
      this.logger.warn(e instanceof Error ? e.message : 'Falha no job Buffer.');
    }
  }
}