import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import type { ApiStore } from './types';

@Entity('acaf_partner_store')
export class PartnerStore {
  @PrimaryColumn({ length: 16 })
  id: string;

  @Column({ type: 'json' })
  data: ApiStore;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
