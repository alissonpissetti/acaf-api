import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('acaf_project_task_comments')
@Index('idx_project_task_comments_task', ['taskId', 'createdAt'])
export class ProjectTaskComment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'task_id', type: 'char', length: 36 })
  taskId: string;

  @Column({ name: 'user_id', type: 'char', length: 36, nullable: true })
  userId: string | null;

  @Column({ type: 'text' })
  body: string;

  @Column({ name: 'mentioned_user_ids', type: 'json', nullable: true })
  mentionedUserIds: string[] | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}