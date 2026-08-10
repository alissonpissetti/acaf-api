import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../users/user.entity';
import { Company } from './company.entity';

export type CompanyEmployeeStatus = 'pending' | 'invited' | 'active' | 'inactive';

@Entity('acaf_company_employees')
@Index(['companyId', 'userId'], { unique: true })
export class CompanyEmployee {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'company_id', type: 'uuid' })
  companyId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 16, default: 'invited' })
  status: CompanyEmployeeStatus;

  @Column({ name: 'invited_at', type: 'datetime', nullable: true })
  invitedAt: Date | null;

  @Column({ name: 'activated_at', type: 'datetime', nullable: true })
  activatedAt: Date | null;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
