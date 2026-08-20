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
import { Supplier } from './supplier.entity';
import { SupplierPixKey } from './supplier-pix-key.entity';

export type PayableAttachmentKind = 'general' | 'payment_receipt';

export type PayableAttachment = {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  path: string;
  publicUrl: string;
  uploadedAt: string;
  kind?: PayableAttachmentKind;
  recordedSettledAt?: string | null;
};

@Entity('acaf_accounts_payable')
export class AccountPayable {
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

  @Column({ name: 'supplier_id', type: 'uuid', nullable: true })
  supplierId: string | null;

  @ManyToOne(() => Supplier, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'supplier_id' })
  supplier: Supplier | null;

  @Column({ name: 'supplier_pix_key_id', type: 'uuid', nullable: true })
  supplierPixKeyId: string | null;

  @ManyToOne(() => SupplierPixKey, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'supplier_pix_key_id' })
  supplierPixKey: SupplierPixKey | null;

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
  attachments: PayableAttachment[] | null;

  @Column({ name: 'created_by_user_id', type: 'uuid' })
  createdByUserId: string;

  @Column({ name: 'reimbursement_source_payable_id', type: 'uuid', nullable: true })
  reimbursementSourcePayableId: string | null;

  @ManyToOne(() => AccountPayable, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'reimbursement_source_payable_id' })
  reimbursementSourcePayable: AccountPayable | null;

  @Column({ name: 'reimbursement_payable_id', type: 'uuid', nullable: true })
  reimbursementPayableId: string | null;

  @ManyToOne(() => AccountPayable, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'reimbursement_payable_id' })
  reimbursementPayable: AccountPayable | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
