import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ModuleItem } from './module-item.entity';

@Entity('acaf_permissions')
export class Permission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true, length: 120 })
  key: string;

  @Column({ length: 160 })
  label: string;

  @Column({ name: 'module_item_id', type: 'uuid', nullable: true })
  moduleItemId: string | null;

  @ManyToOne(() => ModuleItem, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'module_item_id' })
  moduleItem: ModuleItem | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
