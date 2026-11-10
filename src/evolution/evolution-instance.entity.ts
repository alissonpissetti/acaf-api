import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('acaf_evolution_instances')
export class EvolutionInstance {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Nome exibido no admin (ex.: «Comercial WhatsApp»). */
  @Column({ length: 120 })
  name: string;

  /** Nome da instância na Evolution API. */
  @Column({ name: 'instance_key', length: 120 })
  instanceKey: string;

  @Column({ name: 'base_url', type: 'varchar', length: 512 })
  baseUrl: string;

  @Column({ name: 'api_key', type: 'varchar', length: 512, select: false })
  apiKey: string;

  @Column({ name: 'is_default', default: false })
  isDefault: boolean;

  @Column({ name: 'usage_mode', type: 'varchar', length: 32, default: 'corporate' })
  usageMode: 'corporate' | 'operational';

  @Column({ name: 'department_id', type: 'uuid', nullable: true })
  departmentId: string | null;

  @Column({ name: 'default_owner_user_id', type: 'uuid', nullable: true })
  defaultOwnerUserId: string | null;

  @Column({ name: 'connected_phone', type: 'varchar', length: 24, nullable: true })
  connectedPhone: string | null;

  @Column({ name: 'connection_state', type: 'varchar', length: 32, default: 'unknown' })
  connectionState: string;

  @Column({ name: 'auto_create_leads', default: true })
  autoCreateLeads: boolean;

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
