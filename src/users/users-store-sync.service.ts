import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { normalizeHolderKey } from '../partner/checkIn';
import { purgeHolderFromStoreDraft } from '../partner/purgeHolderFromStore';
import { updateStore, whenStoreReady } from '../partner/store';
import { UsersService } from './users.service';

@Injectable()
export class UsersStoreSyncService implements OnModuleInit {
  private readonly logger = new Logger(UsersStoreSyncService.name);

  constructor(private readonly users: UsersService) {}

  async onModuleInit() {
    setImmediate(() => {
      void this.pruneOrphanConnectMembers().catch((err) =>
        this.logger.error('Falha ao limpar assinantes Connect órfãos do store', err),
      );
    });
  }

  async pruneOrphanConnectMembers(): Promise<void> {
    await whenStoreReady();

    const rows = await this.users.findAll();
    const holderKeys = new Set(rows.map((user) => normalizeHolderKey(user.name)));

    let removed = 0;
    updateStore((store) => {
      const orphanKeys = [...new Set((store.connectMembers ?? []).map((member) => member.holderKey))].filter(
        (holderKey) => !holderKeys.has(holderKey),
      );

      for (const holderKey of orphanKeys) {
        if (purgeHolderFromStoreDraft(store, holderKey)) {
          removed += 1;
        }
      }
    });

    if (removed > 0) {
      this.logger.log(`Removidos ${removed} assinante(s) Connect órfão(s) do store.`);
    }
  }
}
