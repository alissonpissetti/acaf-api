import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

export type ProjectTaskWatcherSource = 'mention' | 'assignee' | 'manual';

@Entity('acaf_project_task_watchers')
@Unique('uq_project_task_watchers', ['taskId', 'userId'])
@Index('idx_project_task_watchers_user', ['userId'])
export class ProjectTaskWatcher {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'task_id', type: 'char', length: 36 })
  taskId: string;

  @Column({ name: 'user_id', type: 'char', length: 36 })
  userId: string;

  @Column({ type: 'varchar', length: 32, default: 'manual' })
  source: ProjectTaskWatcherSource;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}