import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type EvolutionLeadIgnoreMatchKind = 'phone' | 'contact_key' | 'remote_jid';

@Entity('acaf_evolution_lead_ignore_contacts')
@Index('UQ_evolution_lead_ignore', ['instanceId', 'matchKind', 'matchValue'], { unique: true })
export class EvolutionLeadIgnoreContact {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'instance_id', type: 'uuid' })
  instanceId: string;

  @Column({ name: 'match_kind', type: 'varchar', length: 16 })
  matchKind: EvolutionLeadIgnoreMatchKind;

  @Column({ name: 'match_value', type: 'varchar', length: 128 })
  matchValue: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  label: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  note: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
