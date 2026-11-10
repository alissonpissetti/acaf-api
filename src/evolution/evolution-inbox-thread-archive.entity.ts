import { Column, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('acaf_evolution_inbox_thread_archives')
@Index('UQ_evolution_thread_archive', ['instanceId', 'contactKey'], { unique: true })
export class EvolutionInboxThreadArchive {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'instance_id', type: 'uuid' })
  instanceId: string;

  @Column({ name: 'contact_key', type: 'varchar', length: 64 })
  contactKey: string;

  @Column({ name: 'is_archived', type: 'boolean', default: false })
  isArchived: boolean;

  @Column({ name: 'synced_from_device', type: 'boolean', default: true })
  syncedFromDevice: boolean;

  @Column({ name: 'archived_at', type: 'datetime', nullable: true })
  archivedAt: Date | null;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
