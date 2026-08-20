import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { NavModule } from './nav-module.entity';

@Entity('acaf_module_items')
export class ModuleItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'module_id', type: 'uuid' })
  moduleId: string;

  @ManyToOne(() => NavModule, (module) => module.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'module_id' })
  module: NavModule;

  @Column({ length: 60 })
  slug: string;

  @Column({ length: 120 })
  label: string;

  @Column({ length: 255 })
  route: string;

  @Column({ name: 'sort_order', default: 0 })
  sortOrder: number;

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
