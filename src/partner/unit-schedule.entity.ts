import {
  Column,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { ModalitySlotOverride, ModalitySlotTemplate } from './types';

@Entity('acaf_unit_schedules')
export class UnitSchedule {
  @PrimaryColumn({ name: 'unit_id', length: 64 })
  unitId: string;

  @Column({ type: 'json' })
  templates: ModalitySlotTemplate[];

  @Column({ type: 'json' })
  overrides: ModalitySlotOverride[];

  @Column({ type: 'json' })
  instructors: string[];

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
