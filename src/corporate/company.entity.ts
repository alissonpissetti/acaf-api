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

  @Column({ type: 'char', length: 14, unique: true, nullable: true })
  cnpj: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email: string | null;

  @Column({ type: 'char', length: 11, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: CompanyStatus;

  /** Código de adesão para colaboradores no app (ex.: TAGSA, CARPEDIEM). */
  @Column({ name: 'enrollment_code', type: 'varchar', length: 32, nullable: true, unique: true })
  enrollmentCode: string | null;

  /** Usuário admin/comercial que trouxe ou cadastrou a empresa. */
  @Column({ name: 'commercial_owner_user_id', type: 'uuid', nullable: true })
  commercialOwnerUserId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
