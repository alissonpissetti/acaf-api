import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type {
  SupportTicketCategory,
  SupportTicketPriority,
  SupportTicketQueue,
  SupportTicketSource,
  SupportTicketStatus,
} from './support.types';

@Entity('acaf_support_tickets')
@Index(['requesterUserId', 'createdAt'])
@Index(['source', 'status'])
@Index(['queue', 'status'])
export class SupportTicket {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 24, unique: true })
  code: string;

  @Column({ type: 'varchar', length: 16 })
  source: SupportTicketSource;

  @Column({ type: 'varchar', length: 200 })
  subject: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'varchar', length: 24 })
  category: SupportTicketCategory;

  @Column({ type: 'varchar', length: 48, default: 'atendimento' })
  queue: SupportTicketQueue;

  @Column({ type: 'varchar', length: 16, default: 'normal' })
  priority: SupportTicketPriority;

  @Column({ type: 'varchar', length: 24, default: 'open' })
  status: SupportTicketStatus;

  @Column({ name: 'requester_user_id', type: 'uuid' })
  requesterUserId: string;

  @Column({ name: 'requester_name', type: 'varchar', length: 120 })
  requesterName: string;

  @Column({ name: 'requester_email', type: 'varchar', length: 255 })
  requesterEmail: string;

  @Column({ name: 'company_id', type: 'uuid', nullable: true })
  companyId: string | null;

  @Column({ name: 'unit_id', type: 'varchar', length: 64, nullable: true })
  unitId: string | null;

  @Column({ name: 'context_url', type: 'varchar', length: 512, nullable: true })
  contextUrl: string | null;

  @Column({ name: 'context_label', type: 'varchar', length: 200, nullable: true })
  contextLabel: string | null;

  @Column({ name: 'context_metadata', type: 'json', nullable: true })
  contextMetadata: Record<string, unknown> | null;

  @Column({ name: 'assigned_to_user_id', type: 'uuid', nullable: true })
  assignedToUserId: string | null;

  @Column({ name: 'closed_at', type: 'datetime', nullable: true })
  closedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
