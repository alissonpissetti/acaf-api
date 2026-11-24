import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SocialPostsManualReminderService } from './social-posts-manual-reminder.service';

const TICK_MS = 60_000;

@Injectable()
export class SocialPostsManualReminderScheduler implements OnModuleInit {
  private readonly logger = new Logger(SocialPostsManualReminderScheduler.name);

  constructor(
    private readonly config: ConfigService,
    private readonly reminders: SocialPostsManualReminderService,
  ) {}

  onModuleInit() {
    const enabled = this.config.get('SOCIAL_MANUAL_REMINDER_ENABLED', '1') === '1';
    if (!enabled) {
      this.logger.log('Lembretes de publicação manual desabilitados (SOCIAL_MANUAL_REMINDER_ENABLED=0).');
      return;
    }
    void this.tick();
    setInterval(() => void this.tick(), TICK_MS);
    this.logger.log('Lembretes de publicação manual agendados (tick 1 min, -15 min).');
  }

  private async tick() {
    try {
      const result = await this.reminders.processDueReminders();
      if (result.sent) {
        this.logger.log(`Lembretes manuais enviados: ${result.sent}`);
      }
      if (result.errors.length) {
        this.logger.warn(result.errors.slice(0, 5).join(' · '));
      }
    } catch (e) {
      this.logger.warn(e instanceof Error ? e.message : 'Falha no job de lembretes manuais.');
    }
  }
}