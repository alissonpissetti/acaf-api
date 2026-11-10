import { Column, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/** Marca de leitura vinda do WhatsApp (celular / Evolution), compartilhada na instância. */
@Entity('acaf_evolution_inbox_device_reads')
@Index('UQ_evolution_device_read', ['instanceId', 'contactKey'], { unique: true })
export class EvolutionInboxDeviceRead {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'instance_id', type: 'uuid' })
  instanceId: string;

  @Column({ name: 'contact_key', type: 'varchar', length: 64 })
  contactKey: string;

  @Column({ name: 'read_at', type: 'datetime' })
  readAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
