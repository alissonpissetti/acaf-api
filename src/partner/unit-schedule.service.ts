import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { mergeInstructorRegistry } from './instructors';
import {
  normalizeModalitySlotOverrides,
  normalizeModalitySlotTemplates,
} from './modalitySchedule';
import { loadStore, whenStoreReady } from './store';
import type { GymUnit, ModalitySlotOverride, ModalitySlotTemplate } from './types';
import { UnitSchedule } from './unit-schedule.entity';

export type UnitSchedulePayload = {
  templates: ModalitySlotTemplate[];
  overrides: ModalitySlotOverride[];
  instructors: string[];
};

@Injectable()
export class UnitScheduleService implements OnModuleInit {
  private readonly logger = new Logger(UnitScheduleService.name);

  constructor(
    @InjectRepository(UnitSchedule)
    private readonly repo: Repository<UnitSchedule>,
  ) {}

  async onModuleInit() {
    try {
      await whenStoreReady();
      await this.migrateFromStoreIfNeeded();
    } catch (err) {
      this.logger.error('Falha ao migrar agendas do store para o banco', err);
    }
  }

  private async migrateFromStoreIfNeeded() {
    const count = await this.repo.count();
    if (count > 0) return;

    let store;
    try {
      store = loadStore();
    } catch {
      return;
    }

    let migrated = 0;
    for (const unit of store.units) {
      const templates = unit.modalitySlotTemplates ?? [];
      const overrides = unit.modalitySlotOverrides ?? [];
      if (!templates.length && !overrides.length) continue;

      const instructors = mergeInstructorRegistry(unit, templates, overrides);
      await this.repo.save(
        this.repo.create({
          unitId: unit.id,
          templates: normalizeModalitySlotTemplates(unit, templates),
          overrides: normalizeModalitySlotOverrides(unit, overrides),
          instructors,
        }),
      );
      migrated += 1;
    }

    if (migrated > 0) {
      this.logger.log(`${migrated} agenda(s) migrada(s) para MariaDB.`);
    }
  }

  async getSchedule(unitId: string, unit: GymUnit): Promise<UnitSchedulePayload> {
    let row = await this.repo.findOne({ where: { unitId } });
    if (!row) {
      const templates = normalizeModalitySlotTemplates(unit, unit.modalitySlotTemplates ?? []);
      const overrides = normalizeModalitySlotOverrides(unit, unit.modalitySlotOverrides ?? []);
      if (!templates.length && !overrides.length) {
        return { templates: [], overrides: [], instructors: [] };
      }
      row = await this.repo.save(
        this.repo.create({
          unitId,
          templates,
          overrides,
          instructors: mergeInstructorRegistry(unit, templates, overrides),
        }),
      );
    }
    return {
      templates: row.templates ?? [],
      overrides: row.overrides ?? [],
      instructors: row.instructors ?? [],
    };
  }

  async saveTemplates(
    unit: GymUnit,
    templates: ModalitySlotTemplate[],
    instructors?: string[],
  ): Promise<UnitSchedulePayload> {
    const normalized = normalizeModalitySlotTemplates(unit, templates);
    let row = await this.repo.findOne({ where: { unitId: unit.id } });
    const overrides = row?.overrides ?? normalizeModalitySlotOverrides(unit, unit.modalitySlotOverrides ?? []);
    const mergedInstructors = mergeInstructorRegistry(unit, normalized, overrides, instructors ?? row?.instructors ?? []);

    if (!row) {
      row = this.repo.create({
        unitId: unit.id,
        templates: normalized,
        overrides,
        instructors: mergedInstructors,
      });
    } else {
      row.templates = normalized;
      row.instructors = mergedInstructors;
    }

    const saved = await this.repo.save(row);
    return {
      templates: saved.templates,
      overrides: saved.overrides,
      instructors: saved.instructors,
    };
  }

  async saveOverrides(unit: GymUnit, overrides: ModalitySlotOverride[]): Promise<UnitSchedulePayload> {
    const normalized = normalizeModalitySlotOverrides(unit, overrides);
    let row = await this.repo.findOne({ where: { unitId: unit.id } });
    const templates = row?.templates ?? normalizeModalitySlotTemplates(unit, unit.modalitySlotTemplates ?? []);
    const instructors = mergeInstructorRegistry(unit, templates, normalized, row?.instructors ?? []);

    if (!row) {
      row = this.repo.create({
        unitId: unit.id,
        templates,
        overrides: normalized,
        instructors,
      });
    } else {
      row.overrides = normalized;
      row.instructors = instructors;
    }

    const saved = await this.repo.save(row);
    return {
      templates: saved.templates,
      overrides: saved.overrides,
      instructors: saved.instructors,
    };
  }

  attachToUnit(unit: GymUnit, schedule: UnitSchedulePayload): GymUnit {
    return {
      ...unit,
      modalitySlotTemplates: schedule.templates,
      modalitySlotOverrides: schedule.overrides,
      instructors: schedule.instructors,
    };
  }

  async unitWithSchedule(unit: GymUnit): Promise<GymUnit> {
    const schedule = await this.getSchedule(unit.id, unit);
    return this.attachToUnit(unit, schedule);
  }
}
