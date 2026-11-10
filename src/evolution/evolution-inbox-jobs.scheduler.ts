import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EvolutionMessageMediaStorageService } from './evolution-message-media-storage.service';
import { EvolutionInstancesService } from './evolution-instances.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EvolutionInstance } from './evolution-instance.entity';

const JOB_TICK_MS = 15 * 60 * 1000;
const TZ = 'America/Sao_Paulo';

function saoPauloHour(): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    hour: 'numeric',
    hour12: false,
  }).formatToParts(new Date());
  return Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
}

function saoPauloDayKey(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ });
}

@Injectable()
export class EvolutionInboxJobsScheduler implements OnModuleInit {
  private readonly logger = new Logger(EvolutionInboxJobsScheduler.name);
  private nightlyMediaDayKey = '';
  private nightlyInboxDayKey = '';
  private catchupInFlight = false;
  private nightlyInFlight = false;

  constructor(
    private readonly config: ConfigService,
    private readonly messageMediaStorage: EvolutionMessageMediaStorageService,
    private readonly evolutionInstances: EvolutionInstancesService,
    @InjectRepository(EvolutionInstance)
    private readonly instances: Repository<EvolutionInstance>,
  ) {}

  onModuleInit() {
    const enabled = this.jobsEnabled();
    if (!enabled) {
      this.logger.log('Jobs Evolution inbox/mídia desabilitados (EVOLUTION_INBOX_JOBS_ENABLED=0).');
      return;
    }
    void this.tick();
    setInterval(() => void this.tick(), JOB_TICK_MS);
    this.logger.log('Jobs Evolution inbox/mídia agendados (tick 15 min).');
  }

  private jobsEnabled(): boolean {
    const flag = String(this.config.get<string>('EVOLUTION_INBOX_JOBS_ENABLED', 'true')).toLowerCase();
    return flag !== '0' && flag !== 'false';
  }

  private nightWindowBounds(): { start: number; end: number } {
    const start = Number(this.config.get<string>('EVOLUTION_NIGHTLY_HOUR_START', '2'));
    const end = Number(this.config.get<string>('EVOLUTION_NIGHTLY_HOUR_END', '6'));
    return {
      start: Number.isFinite(start) ? start : 2,
      end: Number.isFinite(end) ? end : 6,
    };
  }

  private inNightWindow(): boolean {
    const { start, end } = this.nightWindowBounds();
    const hour = saoPauloHour();
    return hour >= start && hour < end;
  }

  private async tick(): Promise<void> {
    try {
      await this.maybeRunCatchupMedia();
      await this.maybeRunNightlyMedia();
      await this.maybeRunNightlyInboxRepair();
    } catch (err) {
      this.logger.warn(`Tick jobs Evolution: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Lotes pequenos ao longo do dia — não espera a madrugada. */
  private async maybeRunCatchupMedia(): Promise<void> {
    if (this.catchupInFlight) return;
    const flag = String(this.config.get<string>('EVOLUTION_MEDIA_CATCHUP_ENABLED', 'true')).toLowerCase();
    if (flag === '0' || flag === 'false') return;

    const pending = await this.messageMediaStorage.countPendingMediaByInstance();
    if (!pending.size) return;

    const maxPerInstance = Number(this.config.get<string>('EVOLUTION_MEDIA_CATCHUP_MAX', '24'));
    const safeMax = Number.isFinite(maxPerInstance) && maxPerInstance > 0 ? maxPerInstance : 24;

    this.catchupInFlight = true;
    try {
      const outcome = await this.messageMediaStorage.persistMissingMediaForAllInstances({
        maxPerInstance: safeMax,
        concurrencyPerInstance: 1,
      });
      if (outcome.processed > 0) {
        this.logger.log(
          `Catch-up mídia WhatsApp: ${outcome.stored} gravada(s), ${outcome.failed} falha(s), ${outcome.processed} processada(s) em ${outcome.instances} instância(s).`,
        );
      }
    } finally {
      this.catchupInFlight = false;
    }
  }

  private async maybeRunNightlyMedia(): Promise<void> {
    if (this.nightlyInFlight) return;
    if (!this.inNightWindow()) return;

    const dayKey = saoPauloDayKey();
    if (this.nightlyMediaDayKey === dayKey) return;

    const flag = String(this.config.get<string>('EVOLUTION_NIGHTLY_MEDIA_ENABLED', 'true')).toLowerCase();
    if (flag === '0' || flag === 'false') return;

    const maxPerInstance = Number(this.config.get<string>('EVOLUTION_NIGHTLY_MEDIA_MAX', '500'));
    const safeMax = Number.isFinite(maxPerInstance) && maxPerInstance > 0 ? maxPerInstance : 500;

    this.nightlyInFlight = true;
    try {
      const outcome = await this.messageMediaStorage.persistMissingMediaForAllInstances({
        maxPerInstance: safeMax,
        concurrencyPerInstance: 1,
      });
      this.nightlyMediaDayKey = dayKey;
      this.logger.log(
        `Job noturno mídia WhatsApp (${dayKey}): ${outcome.stored} gravada(s), ${outcome.failed} falha(s), ${outcome.processed} processada(s), ${outcome.instances} instância(s).`,
      );
    } finally {
      this.nightlyInFlight = false;
    }
  }

  /** Delta leve por instância conectada (lacunas quando webhook falhou). */
  private async maybeRunNightlyInboxRepair(): Promise<void> {
    if (!this.inNightWindow()) return;

    const dayKey = saoPauloDayKey();
    if (this.nightlyInboxDayKey === dayKey) return;

    const flag = String(this.config.get<string>('EVOLUTION_NIGHTLY_INBOX_ENABLED', 'true')).toLowerCase();
    if (flag === '0' || flag === 'false') return;

    const rows = await this.instances.find({
      where: { active: true },
      select: ['id', 'name', 'connectionState'],
    });
    const connected = rows.filter((row) =>
      /open|connected/i.test(String(row.connectionState ?? '')),
    );

    let repaired = 0;
    for (const inst of connected) {
      try {
        const imported = await this.evolutionInstances.repairInboxIncremental(inst.id);
        if (imported > 0) repaired += 1;
      } catch (err) {
        this.logger.warn(
          `Reparo noturno inbox (${inst.name}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    this.nightlyInboxDayKey = dayKey;
    if (connected.length) {
      this.logger.log(
        `Job noturno inbox (${dayKey}): ${repaired} instância(s) com mensagens reimportadas (de ${connected.length} conectada(s)).`,
      );
    }
  }
}
