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

  @Column({ name: 'contact_phone', type: 'varchar', length: 24 })
  contactPhone: string;

  @Column({ name: 'contact_name', type: 'varchar', length: 120, nullable: true })
  contactName: string | null;

  @Column({ name: 'remote_jid', type: 'varchar', length: 128, nullable: true })
  remoteJid: string | null;

  @Column({ type: 'varchar', length: 8 })
  direction: EvolutionMessageDirection;

  @Column({ type: 'varchar', length: 2000 })
  body: string;

  @Column({ name: 'external_id', type: 'varchar', length: 128 })
  externalId: string;

  @Column({ name: 'lead_id', type: 'uuid', nullable: true })
  leadId: string | null;

  @Column({ name: 'message_at', type: 'datetime' })
  messageAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
