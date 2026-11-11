import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type CommercialLeadAuditChange = {
  field: string;
  label: string;
  from: string | null;
  to: string | null;
};

@Entity('acaf_commercial_lead_audit_logs')
export class CommercialLeadAuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'lead_id', type: 'uuid' })
  leadId: string;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ type: 'varchar', length: 500 })
  summary: string;

  @Column({ type: 'json' })
  changes: CommercialLeadAuditChange[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
