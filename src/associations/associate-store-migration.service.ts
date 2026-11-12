import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PartnerStorePersistenceService } from '../partner/partner-store-persistence.service';
import { updateStoreIf } from '../partner/store';
import { AssociationsService } from './associations.service';

/**
 * Preenche `acafAssociate.associationId` em unidades importadas antes da introdução do modelo multi-associação.
 */
@Injectable()
export class AssociateStoreMigrationService implements OnModuleInit {
  private readonly logger = new Logger(AssociateStoreMigrationService.name);

  constructor(
    private readonly associations: AssociationsService,
    private readonly storePersistence: PartnerStorePersistenceService,
  ) {}

  async onModuleInit() {
    const acaf = await this.associations.ensureAcafAssociation();
    await this.storePersistence.whenReady();

    const updated = updateStoreIf((store) => {
      let changed = false;
      for (const unit of store.units) {
        const meta = unit.acafAssociate;
        if (!meta || meta.associationId) continue;
        if (meta.importSource === 'acaf_associates_xlsx') {
          unit.acafAssociate = { ...meta, associationId: acaf.id };
          changed = true;
        }
      }
      return changed;
    });

    if (updated) {
      this.logger.log('Store: associationId ACAF aplicado a associados importados legados.');
    }
  }
}
