import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('acaf_project_task_attachments')
@Index('idx_project_task_attachments_task', ['taskId', 'createdAt'])
export class ProjectTaskAttachment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'task_id', type: 'char', length: 36 })
  taskId: string;

  @Column({ name: 'user_id', type: 'char', length: 36, nullable: true })
  userId: string | null;

  @Column({ name: 'original_name', type: 'varchar', length: 255 })
  originalName: string;

  @Column({ name: 'mime_type', type: 'varchar', length: 128 })
  mimeType: string;

  @Column({ type: 'int', unsigned: true })
  size: number;

  @Column({ name: 'storage_path', type: 'varchar', length: 500 })
  storagePath: string;

  @Column({ name: 'public_url', type: 'varchar', length: 1000 })
  publicUrl: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}