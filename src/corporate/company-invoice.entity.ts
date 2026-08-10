import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Company } from './company.entity';

export type CompanyInvoiceStatus = 'open' | 'paid';

@Entity('acaf_company_invoices')
@Index(['companyId', 'monthKey'], { unique: true })
export class CompanyInvoice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'company_id', type: 'uuid' })
  companyId: string;

  @Column({ name: 'month_key', length: 7 })
  monthKey: string;

  @Column({ name: 'active_employees', type: 'int', default: 0 })
  activeEmployees: number;

  @Column({ name: 'unit_amount', type: 'decimal', precision: 10, scale: 2 })
  unitAmount: number;

  @Column({ name: 'total_amount', type: 'decimal', precision: 10, scale: 2 })
  totalAmount: number;

  @Column({ type: 'varchar', length: 16, default: 'open' })
  status: CompanyInvoiceStatus;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @CreateDateColumn({ name: 'generated_at' })
  generatedAt: Date;
}
