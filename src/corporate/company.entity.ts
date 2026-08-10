import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type CompanyStatus = 'pending' | 'active' | 'suspended';

@Entity('acaf_companies')
export class Company {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'legal_name', length: 180 })
  legalName: string;

  @Column({ name: 'trade_name', length: 120 })
  tradeName: string;

  @Column({ type: 'char', length: 14, unique: true })
  cnpj: string;

  @Column({ length: 255 })
  email: string;

  @Column({ type: 'char', length: 11, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: CompanyStatus;

  /** Código de adesão para colaboradores no app (ex.: ACAF-2026). */
  @Column({ name: 'enrollment_code', type: 'varchar', length: 32, nullable: true, unique: true })
  enrollmentCode: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
