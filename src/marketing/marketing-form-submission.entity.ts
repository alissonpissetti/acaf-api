import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('acaf_marketing_form_submissions')
export class MarketingFormSubmission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'landing_page_id', type: 'uuid' })
  landingPageId: string;

  @Column({ name: 'campaign_id', type: 'uuid', nullable: true })
  campaignId: string | null;

  @Column({ name: 'creative_id', type: 'uuid', nullable: true })
  creativeId: string | null;

  @Column({ name: 'lead_id', type: 'uuid', nullable: true })
  leadId: string | null;

  @Column({ type: 'json' })
  data: Record<string, string>;

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
