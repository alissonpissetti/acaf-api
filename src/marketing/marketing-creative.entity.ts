import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { MarketingCreativeFormat, MarketingPlatform } from './marketing.types';

@Entity('acaf_marketing_creatives')
export class MarketingCreative {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'campaign_id', type: 'uuid' })
  campaignId: string;

  @Column({ type: 'varchar', length: 160 })
  name: string;

  @Column({ type: 'varchar', length: 120 })
  slug: string;

  @Column({ type: 'varchar', length: 24, default: 'other' })
  platform: MarketingPlatform;

  @Column({ type: 'varchar', length: 24, default: 'image' })
  format: MarketingCreativeFormat;

  @Column({ name: 'external_url', type: 'varchar', length: 500, nullable: true })
  externalUrl: string | null;

  @Column({ name: 'landing_page_id', type: 'uuid', nullable: true })
  landingPageId: string | null;

  @Column({ name: 'utm_source', type: 'varchar', length: 120, nullable: true })
  utmSource: string | null;

  @Column({ name: 'utm_medium', type: 'varchar', length: 120, nullable: true })
  utmMedium: string | null;

  @Column({ name: 'utm_campaign', type: 'varchar', length: 120, nullable: true })
  utmCampaign: string | null;

  @Column({ name: 'utm_content', type: 'varchar', length: 120, nullable: true })
  utmContent: string | null;

  @Column({ name: 'utm_term', type: 'varchar', length: 120, nullable: true })
  utmTerm: string | null;

  @Column({ type: 'int', default: 0 })
  impressions: number;

  @Column({ type: 'int', default: 0 })
  clicks: number;

  @Column({ name: 'spend_cents', type: 'int', default: 0 })
  spendCents: number;

  @Column({ type: 'int', default: 0 })
  conversions: number;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
