import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { EvolutionInstance } from './evolution-instance.entity';

export type EvolutionMessageDirection = 'in' | 'out';

@Entity('acaf_evolution_messages')
@Index('UQ_evolution_msg_instance_external', ['instanceId', 'externalId'], { unique: true })
@Index('IDX_evolution_msg_thread', ['instanceId', 'contactPhone', 'messageAt'])
export class EvolutionMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'instance_id', type: 'uuid' })
  instanceId: string;

  @ManyToOne(() => EvolutionInstance, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'instance_id' })
  instance?: EvolutionInstance;

  @Column({ name: 'contact_phone', type: 'varchar', length: 64 })
  contactPhone: string;

  @Column({ name: 'contact_name', type: 'varchar', length: 120, nullable: true })
  contactName: string | null;

  @Column({ name: 'sender_name', type: 'varchar', length: 120, nullable: true })
  senderName: string | null;

  @Column({ name: 'sender_jid', type: 'varchar', length: 128, nullable: true })
  senderJid: string | null;

  @Column({ name: 'remote_jid', type: 'varchar', length: 128, nullable: true })
  remoteJid: string | null;

  @Column({ type: 'varchar', length: 8 })
  direction: EvolutionMessageDirection;

  @Column({ type: 'varchar', length: 2000 })
  body: string;

  @Column({ name: 'media_kind', type: 'varchar', length: 16, nullable: true })
  mediaKind: string | null;

  @Column({ name: 'media_mime_type', type: 'varchar', length: 64, nullable: true })
  mediaMimeType: string | null;

  @Column({ name: 'media_payload', type: 'longtext', nullable: true })
  mediaPayload: string | null;

  @Column({ name: 'media_storage_path', type: 'varchar', length: 512, nullable: true })
  mediaStoragePath: string | null;

  @Column({ name: 'media_content_hash', type: 'varchar', length: 64, nullable: true })
  mediaContentHash: string | null;

  @Column({ name: 'media_stored_at', type: 'datetime', nullable: true })
  mediaStoredAt: Date | null;

  @Column({ name: 'external_id', type: 'varchar', length: 128 })
  externalId: string;

  @Column({ name: 'reaction_target_external_id', type: 'varchar', length: 128, nullable: true })
  reactionTargetExternalId: string | null;

  @Column({ name: 'lead_id', type: 'uuid', nullable: true })
  leadId: string | null;

  @Column({ name: 'message_at', type: 'datetime' })
  messageAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
