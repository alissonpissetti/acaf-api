import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { syncAssociateRepasseState } from './associateRepasseHysteresis';
import { PartnerStorePersistenceService } from './partner-store-persistence.service';
import { updateStoreIf } from './store';

/**
 * Grava um snapshot diário de vidas pagantes (idempotente por data civil America/Sao_Paulo).
 * Intervalo de 1 hora: na primeira execução após virar o dia, o registro é criado mesmo sem
 * acesso ao admin.
 */
const TICK_MS = 60 * 60 * 1000;

@Injectable()
export class AssociateRepasseDailyScheduler implements OnModuleInit {
  private readonly logger = new Logger(AssociateRepasseDailyScheduler.name);

  constructor(private readonly partnerStore: PartnerStorePersistenceService) {}

  onModuleInit() {
    void this.tick();
    setInterval(() => void this.tick(), TICK_MS);
  }

  private async tick() {
    try {
      await this.partnerStore.whenReady();
      updateStoreIf((draft) => syncAssociateRepasseState(draft, new Date()));
    } catch (err) {
      this.logger.warn(`Snapshot diário associados: ${(err as Error).message}`);
    }
  }
}
