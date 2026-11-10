import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('acaf_evolution_contact_profiles')
@Index('UQ_evolution_contact_profile', ['instanceId', 'contactKey'], { unique: true })
export class EvolutionContactProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'instance_id', type: 'uuid' })
  instanceId: string;

  @Column({ name: 'contact_key', type: 'varchar', length: 64 })
  contactKey: string;

  @Column({ name: 'display_name', type: 'varchar', length: 160 })
  displayName: string;

  @Column({ name: 'phone_label', type: 'varchar', length: 32, nullable: true })
  phoneLabel: string | null;

  @Column({ name: 'avatar_url', type: 'varchar', length: 1024, nullable: true })
  avatarUrl: string | null;

  @Column({ name: 'avatar_storage_path', type: 'varchar', length: 512, nullable: true })
  avatarStoragePath: string | null;

  @Column({ name: 'avatar_source_fingerprint', type: 'varchar', length: 64, nullable: true })
  avatarSourceFingerprint: string | null;

  @Column({ name: 'avatar_content_hash', type: 'varchar', length: 64, nullable: true })
  avatarContentHash: string | null;

  @Column({ name: 'avatar_checked_at', type: 'datetime', nullable: true })
  avatarCheckedAt: Date | null;

  @Column({ name: 'remote_jid', type: 'varchar', length: 128, nullable: true })
  remoteJid: string | null;

  @Column({ name: 'lead_id', type: 'uuid', nullable: true })
  leadId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
