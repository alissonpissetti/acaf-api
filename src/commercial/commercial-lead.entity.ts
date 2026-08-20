import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type CommercialLeadType = 'partner' | 'corporate';
export type CommercialLeadTemperature = 'cold' | 'warm' | 'hot';

@Entity('acaf_commercial_leads')
export class CommercialLead {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'funnel_id', type: 'uuid' })
  funnelId: string;

  @Column({ name: 'stage_id', type: 'uuid' })
  stageId: string;

  @Column({ type: 'varchar', length: 180 })
  title: string;

  @Column({ type: 'varchar', length: 16, nullable: true })
  type: CommercialLeadType | null;

  @Column({ type: 'varchar', length: 16, default: 'cold' })
  temperature: CommercialLeadTemperature;

  @Column({ name: 'legal_name', type: 'varchar', length: 180, nullable: true })
  legalName: string | null;

  @Column({ type: 'char', length: 14, nullable: true })
  cnpj: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email: string | null;

  @Column({ type: 'char', length: 11, nullable: true })
  phone: string | null;

  @Column({ name: 'contact_name', type: 'varchar', length: 120, nullable: true })
  contactName: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'owner_user_id', type: 'uuid' })
  ownerUserId: string;

  @Column({ name: 'created_by_user_id', type: 'uuid' })
  createdByUserId: string;

  @Column({ name: 'converted_network_id', type: 'varchar', length: 64, nullable: true })
  convertedNetworkId: string | null;

  @Column({ name: 'converted_company_id', type: 'uuid', nullable: true })
  convertedCompanyId: string | null;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @Column({ name: 'last_interaction_at', type: 'datetime', nullable: true })
  lastInteractionAt: Date | null;

  @Column({ name: 'stage_entered_at', type: 'datetime', nullable: true })
  stageEnteredAt: Date | null;

  @Column({ name: 'stage_expired_at', type: 'datetime', nullable: true })
  stageExpiredAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
