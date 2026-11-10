import { Column, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('acaf_evolution_inbox_reads')
@Index('UQ_evolution_inbox_read', ['userId', 'instanceId', 'contactKey'], { unique: true })
export class EvolutionInboxRead {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'instance_id', type: 'uuid' })
  instanceId: string;

  @Column({ name: 'contact_key', type: 'varchar', length: 64 })
  contactKey: string;

  @Column({ name: 'last_read_at', type: 'datetime' })
  lastReadAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
