import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { normalizeHolderKey } from '../partner/checkIn';
import { purgeHolderFromStoreDraft } from '../partner/purgeHolderFromStore';
import type { GymStudent } from '../partner/types';
import { loadStore, saveStore, updateStore, whenStoreReady } from '../partner/store';
import { UsersService } from './users.service';

@Injectable()
export class UsersStoreSyncService implements OnModuleInit {
  private readonly logger = new Logger(UsersStoreSyncService.name);

  constructor(private readonly users: UsersService) {}

  async onModuleInit() {
    setImmediate(() => {
      void this.syncStoreStudents()
        .then(() => this.pruneOrphanConnectMembers())
        .catch((err) => this.logger.error('Falha ao sincronizar clientes do store', err));
    });
  }

  async syncStoreStudents(): Promise<void> {
    await whenStoreReady();
    let store;
    try {
      store = loadStore();
    } catch {
      return;
    }

    const { students, changed } = await this.linkStudentsToUsers(store.students);
    if (!changed) return;

    store.students = students;
    saveStore(store);
    this.logger.log(`Sincronizados ${students.length} aluno(s)/cliente(s) com acaf_users.`);
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

  async linkStudentsToUsers(students: GymStudent[]): Promise<{ students: GymStudent[]; changed: boolean }> {
    let changed = false;
    const next: GymStudent[] = [];

    for (const student of students) {
      const userId = await this.users.ensureMemberUser({
        name: student.name,
        email: student.email,
        cpf: student.cpf,
      });
      if (student.userId !== userId) changed = true;
      next.push({ ...student, userId });
    }

    return { students: next, changed };
  }
}
