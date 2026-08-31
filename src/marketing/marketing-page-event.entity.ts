import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type MarketingPageEventType = 'view' | 'click';

@Entity('acaf_marketing_page_events')
@Index(['landingPageId', 'createdAt'])
export class MarketingPageEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'landing_page_id', type: 'uuid' })
  landingPageId: string;

  @Column({ name: 'creative_id', type: 'uuid', nullable: true })
  creativeId: string | null;

  @Column({ name: 'event_type', type: 'varchar', length: 8 })
  eventType: MarketingPageEventType;

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

  @Column({ type: 'varchar', length: 500, nullable: true })
  referrer: string | null;

  @Column({ name: 'user_agent', type: 'varchar', length: 500, nullable: true })
  userAgent: string | null;

  @Column({ name: 'ip_address', type: 'varchar', length: 64, nullable: true })
  ipAddress: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
