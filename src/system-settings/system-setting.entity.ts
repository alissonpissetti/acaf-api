import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('acaf_system_settings')
export class SystemSetting {
  @PrimaryColumn({ length: 80 })
  key: string;

  @Column({ type: 'text' })
  value: string;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
