import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { ProjectTaskPhase, ProjectTaskPriority, ProjectTaskStatus } from './project-task.constants';

@Entity('acaf_project_tasks')
@Index('idx_project_tasks_phase_start', ['phase', 'startDate', 'sortOrder'])
export class ProjectTask {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 32, unique: true, nullable: true })
  code: string | null;

  @Column({ type: 'varchar', length: 80 })
  phase: ProjectTaskPhase;

  @Column({ type: 'varchar', length: 500 })
  name: string;

  @Column({ name: 'start_date', type: 'date' })
  startDate: string;

  @Column({ name: 'end_date', type: 'date' })
  endDate: string;

  @Column({
    type: 'enum',
    enum: ['todo', 'in_progress', 'blocked', 'postponed', 'cancelled', 'done'],
  })
  status: ProjectTaskStatus;

  @Column({
    type: 'enum',
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium',
  })
  priority: ProjectTaskPriority;

  @Column({ type: 'json', nullable: true })
  tags: string[] | null;

  @Column({ name: 'estimated_hours', type: 'decimal', precision: 8, scale: 2, default: 0 })
  estimatedHours: string;

  @Column({ name: 'time_tracked_seconds', type: 'int', unsigned: true, default: 0 })
  timeTrackedSeconds: number;

  @Column({ name: 'requester_user_id', type: 'char', length: 36, nullable: true })
  requesterUserId: string | null;

  @Column({ name: 'created_by', type: 'char', length: 36, nullable: true })
  createdBy: string | null;

  @Column({ type: 'tinyint', unsigned: true, default: 0 })
  progress: number;

  @Column({ type: 'varchar', length: 200, nullable: true })
  owner: string | null;

  @Column({ name: 'owner_user_ids', type: 'json', nullable: true })
  ownerUserIds: string[] | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'is_milestone', type: 'boolean', default: false })
  isMilestone: boolean;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}