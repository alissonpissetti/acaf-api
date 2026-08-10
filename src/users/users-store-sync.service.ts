import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { GymStudent } from '../partner/types';
import { loadStore, saveStore } from '../partner/store';
import { UsersService } from './users.service';

@Injectable()
export class UsersStoreSyncService implements OnModuleInit {
  private readonly logger = new Logger(UsersStoreSyncService.name);

  constructor(private readonly users: UsersService) {}

  async onModuleInit() {
    setImmediate(() => {
      void this.syncStoreStudents().catch((err) =>
        this.logger.error('Falha ao sincronizar clientes do store', err),
      );
    });
  }

  async syncStoreStudents(): Promise<void> {
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
