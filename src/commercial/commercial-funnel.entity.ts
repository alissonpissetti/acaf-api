import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { CommercialFunnelStage } from './commercial-funnel-stage.entity';

export type FunnelOutcomeAction = 'none' | 'transfer_funnel' | 'convert';

@Entity('acaf_commercial_funnels')
export class CommercialFunnel {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'varchar', length: 64, unique: true })
  slug: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @Column({ name: 'is_default', type: 'boolean', default: false })
  isDefault: boolean;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @Column({ name: 'win_action', type: 'varchar', length: 24, default: 'none' })
  winAction: FunnelOutcomeAction;

  @Column({ name: 'win_target_funnel_id', type: 'uuid', nullable: true })
  winTargetFunnelId: string | null;

  @Column({ name: 'win_target_stage_id', type: 'uuid', nullable: true })
  winTargetStageId: string | null;

  @Column({ name: 'loss_action', type: 'varchar', length: 24, default: 'none' })
  lossAction: FunnelOutcomeAction;

  @Column({ name: 'loss_target_funnel_id', type: 'uuid', nullable: true })
  lossTargetFunnelId: string | null;

  @Column({ name: 'loss_target_stage_id', type: 'uuid', nullable: true })
  lossTargetStageId: string | null;

  @OneToMany(() => CommercialFunnelStage, (stage) => stage.funnel)
  stages: CommercialFunnelStage[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
