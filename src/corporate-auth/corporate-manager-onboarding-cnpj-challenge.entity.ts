import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('acaf_corporate_manager_onboarding_cnpj_challenges')
@Index(['cnpj', 'createdAt'])
export class CorporateManagerOnboardingCnpjChallenge {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'cnpj', type: 'char', length: 14 })
  cnpj: string;

  @Column({ name: 'company_id', type: 'uuid' })
  companyId: string;

  @Column({ name: 'code_hash', type: 'varchar', length: 255 })
  codeHash: string;

  @Column({ default: 0 })
  attempts: number;

  @Column({ name: 'expires_at', type: 'datetime' })
  expiresAt: Date;

  @Column({ name: 'consumed_at', type: 'datetime', nullable: true })
  consumedAt: Date | null;

  @Column({ name: 'delivery_channel', type: 'varchar', length: 8, nullable: true })
  deliveryChannel: string | null;

  @Column({ name: 'override_email', type: 'varchar', length: 255, nullable: true })
  overrideEmail: string | null;

  @Column({ name: 'override_phone', type: 'char', length: 11, nullable: true })
  overridePhone: string | null;

  @Column({ name: 'override_name', type: 'varchar', length: 255, nullable: true })
  overrideName: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;
}