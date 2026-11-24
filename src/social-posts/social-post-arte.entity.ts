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
import type { SocialArteInteracao } from './social-post.constants';
import { SocialPost } from './social-post.entity';

@Entity('acaf_social_post_artes')
@Index('idx_social_post_artes_post_ordem', ['postId', 'ordem'])
export class SocialPostArte {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'post_id', type: 'uuid' })
  postId: string;

  @ManyToOne(() => SocialPost, (post) => post.artes, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'post_id' })
  post: SocialPost;

  @Column({ type: 'int', unsigned: true, default: 0 })
  ordem: number;

  @Column({ type: 'varchar', length: 120, nullable: true })
  nome: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  arquivo: string | null;

  @Column({ name: 'url_publica', type: 'varchar', length: 2000, nullable: true })
  urlPublica: string | null;

  @Column({ name: 'drive_id', type: 'varchar', length: 120, nullable: true })
  driveId: string | null;

  @Column({ type: 'int', unsigned: true, nullable: true })
  largura: number | null;

  @Column({ type: 'int', unsigned: true, nullable: true })
  altura: number | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  interacao: SocialArteInteracao;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 6 })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 6 })
  updatedAt: Date;
}