import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('acaf_partner_onboarding_cnpj_challenges')
@Index(['cnpj', 'createdAt'])
export class PartnerOnboardingCnpjChallenge {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'cnpj', type: 'char', length: 14 })
  cnpj: string;

  @Column({ name: 'network_id', type: 'varchar', length: 128 })
  networkId: string;

  @Column({ name: 'code_hash', type: 'varchar', length: 255 })
  codeHash: string;

  @Column({ default: 0 })
  attempts: number;

  @Column({ name: 'expires_at', type: 'datetime' })
  expiresAt: Date;

  @Column({ name: 'consumed_at', type: 'datetime', nullable: true })
  consumedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;
}
