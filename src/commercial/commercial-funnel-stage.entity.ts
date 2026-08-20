import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { CommercialFunnel } from './commercial-funnel.entity';

export type FunnelStageOutcome = 'pipeline' | 'won' | 'lost';

@Entity('acaf_commercial_funnel_stages')
export class CommercialFunnelStage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'funnel_id', type: 'uuid' })
  funnelId: string;

  @ManyToOne(() => CommercialFunnel, (funnel) => funnel.stages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'funnel_id' })
  funnel: CommercialFunnel;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'varchar', length: 64 })
  slug: string;

  @Column({ type: 'varchar', length: 16, default: 'pipeline' })
  outcome: FunnelStageOutcome;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @Column({ name: 'max_days_in_stage', type: 'int', nullable: true })
  maxDaysInStage: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
