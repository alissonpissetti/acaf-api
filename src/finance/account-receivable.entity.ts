import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { CashEntryStatus } from './cash-entry.types';
import { AccountPlan } from './account-plan.entity';
import { CostCenter } from './cost-center.entity';
import type { ReceivableAttachment, ReceivablePayerKind } from './receivable-counterparty.types';

@Entity('acaf_accounts_receivable')
export class AccountReceivable {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  description: string;

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  amount: string;

  @Column({ name: 'due_date', type: 'date' })
  dueDate: string;

  @Column({ name: 'settled_at', type: 'datetime', nullable: true })
  settledAt: Date | null;

  @Column({ name: 'expected_settled_at', type: 'date', nullable: true })
  expectedSettledAt: string | null;

  @Column({ name: 'recurrence_group_id', type: 'uuid', nullable: true })
  recurrenceGroupId: string | null;

  @Column({ name: 'recurrence_index', type: 'int', nullable: true })
  recurrenceIndex: number | null;

  @Column({ name: 'recurrence_total', type: 'int', nullable: true })
  recurrenceTotal: number | null;

  @Column({ type: 'enum', enum: CashEntryStatus, default: CashEntryStatus.PENDING })
  status: CashEntryStatus;

  @Column({ name: 'cost_center_id', type: 'uuid' })
  costCenterId: string;

  @ManyToOne(() => CostCenter)
  @JoinColumn({ name: 'cost_center_id' })
  costCenter: CostCenter;

  @Column({ name: 'counterpart_name', type: 'varchar', length: 160 })
  counterpartName: string;

  @Column({ name: 'payer_kind', type: 'varchar', length: 16, nullable: true })
  payerKind: ReceivablePayerKind | null;

  @Column({ name: 'payer_ref_id', type: 'varchar', length: 64, nullable: true })
  payerRefId: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  category: string | null;

  @Column({ name: 'account_plan_id', type: 'uuid', nullable: true })
  accountPlanId: string | null;

  @ManyToOne(() => AccountPlan, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'account_plan_id' })
  accountPlan: AccountPlan | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'json', nullable: true })
  attachments: ReceivableAttachment[] | null;

  @Column({ name: 'created_by_user_id', type: 'uuid' })
  createdByUserId: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
