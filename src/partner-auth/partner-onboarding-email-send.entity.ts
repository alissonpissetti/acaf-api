import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** Limite de 1 convite por e-mail/dia por academia (unidade) ou por rede (e-mail responsável da rede). */
@Entity('acaf_partner_onboarding_email_sends')
@Index(['scopeType', 'scopeId', 'sentOn'], { unique: true })
export class PartnerOnboardingEmailSend {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'scope_type', type: 'varchar', length: 16 })
  scopeType: 'unit' | 'network';

  @Column({ name: 'scope_id', type: 'varchar', length: 128 })
  scopeId: string;

  /** Data civil America/Sao_Paulo (YYYY-MM-DD). */
  @Column({ name: 'sent_on', type: 'date' })
  sentOn: string;

  @Column({ name: 'network_id', type: 'varchar', length: 128 })
  networkId: string;

  @Column({ name: 'recipient_email', type: 'varchar', length: 320 })
  recipientEmail: string;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;
}
