import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { SocialBufferStatus, SocialRede } from './social-post.constants';
import { SocialPost } from './social-post.entity';

@Entity('acaf_social_post_buffer')
@Index('idx_social_post_buffer_post', ['postId'])
@Index('idx_social_post_buffer_post_rede_ordem', ['postId', 'rede', 'ordemArte'], { unique: true })
export class SocialPostBuffer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'post_id', type: 'uuid' })
  postId: string;

  @ManyToOne(() => SocialPost, (post) => post.bufferLinks, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'post_id' })
  post: SocialPost;

  @Column({ type: 'enum', enum: ['instagram', 'facebook', 'linkedin'] })
  rede: SocialRede;

  @Column({ name: 'buffer_post_id', type: 'varchar', length: 64, nullable: true })
  bufferPostId: string | null;

  @Column({ name: 'buffer_channel_id', type: 'varchar', length: 64 })
  bufferChannelId: string;

  @Column({ name: 'ordem_arte', type: 'int', unsigned: true, default: 0 })
  ordemArte: number;

  @Column({
    type: 'enum',
    enum: ['draft', 'scheduled', 'sending', 'sent', 'error'],
    default: 'draft',
  })
  status: SocialBufferStatus;

  @Column({ name: 'due_at', type: 'datetime', precision: 0, nullable: true })
  dueAt: Date | null;

  @Column({ name: 'external_link', type: 'varchar', length: 2000, nullable: true })
  externalLink: string | null;

  @Column({ type: 'text', nullable: true })
  erro: string | null;

  @Column({ type: 'boolean', default: false })
  manual: boolean;

  @Column({ name: 'sincronizado_em', type: 'datetime', precision: 6, nullable: true })
  sincronizadoEm: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 6 })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 6 })
  updatedAt: Date;
}