import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ApiStore } from './types';
import { buildDemoStore } from './demoSeed';
import { mergeDemoSeedIntoStore } from './demoSeedMerge';
import { regenerateDemoModalityReservations } from './demoSeedGenerators';
import { loadStore, saveStore } from './store';

const STORE_PATH = join(process.cwd(), 'data', 'store.json');

export function runSeedStore(): ApiStore {
  const generated = buildDemoStore();

  if (!existsSync(STORE_PATH)) {
    const created = buildDemoStore();
    created.modalityReservations = regenerateDemoModalityReservations(created);
    saveStore(created);
    console.log(
      `Store demo criado: ${created.units.length} unidades, ${created.students.length} alunos, ${created.checkInLog.length} check-ins.`,
    );
    return created;
  }

  const existing = loadStore();
  const before = {
    units: existing.units.length,
    students: existing.students.length,
    checkIns: existing.checkInLog.length,
    reservations: existing.modalityReservations?.length ?? 0,
  };

  const merged = mergeDemoSeedIntoStore(existing, generated);
  merged.modalityReservations = regenerateDemoModalityReservations(merged);
  saveStore(merged);

  console.log(
    `Store demo mesclado (dados existentes preservados): ${merged.units.length} unidades (+${merged.units.length - before.units}), ${merged.students.length} alunos (+${merged.students.length - before.students}), ${merged.checkInLog.length} check-ins (+${merged.checkInLog.length - before.checkIns}), ${merged.modalityReservations?.length ?? 0} reservas.`,
  );
  return merged;
}

runSeedStore();
