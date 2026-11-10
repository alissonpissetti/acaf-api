import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** Watermarks por instância: webhook + histórico local (fonte para sync incremental). */
@Entity('acaf_evolution_inbox_sync_state')
export class EvolutionInboxSyncState {
  @PrimaryColumn({ name: 'instance_id', type: 'uuid' })
  instanceId: string;

  @Column({ name: 'last_webhook_at', type: 'datetime', nullable: true })
  lastWebhookAt: Date | null;

  @Column({ name: 'last_local_message_at', type: 'datetime', nullable: true })
  lastLocalMessageAt: Date | null;

  @Column({ name: 'last_incremental_pull_at', type: 'datetime', nullable: true })
  lastIncrementalPullAt: Date | null;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
