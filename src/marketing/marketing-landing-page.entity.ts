import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { CommercialLeadType } from '../commercial/commercial-lead.entity';
import type { MarketingLandingField } from './marketing.types';

@Entity('acaf_marketing_landing_pages')
export class MarketingLandingPage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 160 })
  name: string;

  @Column({ type: 'varchar', length: 120, unique: true })
  slug: string;

  @Column({ type: 'varchar', length: 180 })
  headline: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'thank_you_message', type: 'text', nullable: true })
  thankYouMessage: string | null;

  @Column({ name: 'primary_color', type: 'varchar', length: 7, default: '#0f766e' })
  primaryColor: string;

  @Column({ name: 'logo_url', type: 'varchar', length: 512, nullable: true })
  logoUrl: string | null;

  @Column({ name: 'cover_image_url', type: 'varchar', length: 512, nullable: true })
  coverImageUrl: string | null;

  @Column({ type: 'json', nullable: true })
  theme: Record<string, unknown> | null;

  @Column({ name: 'campaign_id', type: 'uuid', nullable: true })
  campaignId: string | null;

  @Column({ name: 'creative_id', type: 'uuid', nullable: true })
  creativeId: string | null;

  @Column({ name: 'funnel_id', type: 'uuid', nullable: true })
  funnelId: string | null;

  @Column({ name: 'lead_type', type: 'varchar', length: 16, nullable: true })
  leadType: CommercialLeadType | null;

  @Column({ name: 'owner_user_id', type: 'uuid', nullable: true })
  ownerUserId: string | null;

  @Column({ type: 'json' })
  fields: MarketingLandingField[];

  @Column({ name: 'view_count', type: 'int', default: 0 })
  viewCount: number;

  @Column({ name: 'submission_count', type: 'int', default: 0 })
  submissionCount: number;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
