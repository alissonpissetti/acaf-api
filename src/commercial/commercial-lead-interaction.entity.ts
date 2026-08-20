import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type CommercialLeadInteractionSource = 'manual' | 'system' | 'whatsapp';

@Entity('acaf_commercial_lead_interactions')
export class CommercialLeadInteraction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'lead_id', type: 'uuid' })
  leadId: string;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ type: 'varchar', length: 500 })
  content: string;

  @Column({ type: 'varchar', length: 16, default: 'manual' })
  source: CommercialLeadInteractionSource;

  @Column({ name: 'external_id', type: 'varchar', length: 128, nullable: true })
  externalId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
