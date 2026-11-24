import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type {
  SocialPostAprovacao,
  SocialPostEnvio,
  SocialPostEtapa,
  SocialPostTipo,
  SocialRede,
} from './social-post.constants';
import { SocialPostArte } from './social-post-arte.entity';
import { SocialPostBuffer } from './social-post-buffer.entity';

@Entity('acaf_social_posts')
@Index('idx_social_posts_agendado', ['agendadoPara'])
export class SocialPost {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 32, unique: true })
  codigo: string;

  @Column({ name: 'numero_exibicao', type: 'varchar', length: 64 })
  numeroExibicao: string;

  @Column({ type: 'enum', enum: ['feed', 'stories'] })
  tipo: SocialPostTipo;

  @Column({ type: 'varchar', length: 200, nullable: true })
  formato: string | null;

  @Column({ type: 'enum', enum: ['feed', 'stories', 'reels'] })
  envio: SocialPostEnvio;

  @Column({ type: 'varchar', length: 120, nullable: true })
  pilar: string | null;

  @Column({ type: 'varchar', length: 500 })
  titulo: string;

  @Column({ type: 'text', nullable: true })
  visual: string | null;

  @Column({ type: 'text', nullable: true })
  legenda: string | null;

  @Column({ type: 'text', nullable: true })
  hashtags: string | null;

  @Column({ type: 'json', nullable: true })
  telas: string[] | null;

  @Column({ type: 'varchar', length: 2000, nullable: true })
  link: string | null;

  @Column({ type: 'text', nullable: true })
  aviso: string | null;

  @Column({ name: 'agendado_para', type: 'datetime', precision: 0, nullable: true })
  agendadoPara: Date | null;

  @Column({ type: 'enum', enum: ['pendente', 'aprovado', 'ajustar'], default: 'pendente' })
  aprovacao: SocialPostAprovacao;

  @Column({ type: 'enum', enum: ['rascunho', 'programado', 'publicado'], default: 'rascunho' })
  etapa: SocialPostEtapa;

  @Column({ type: 'text', nullable: true })
  nota: string | null;

  @Column({ type: 'json' })
  redes: SocialRede[];

  @Column({ name: 'aprovado_por', type: 'uuid', nullable: true })
  aprovadoPor: string | null;

  @Column({ name: 'aprovado_em', type: 'datetime', precision: 6, nullable: true })
  aprovadoEm: Date | null;

  @Column({ name: 'responsavel_user_id', type: 'uuid', nullable: true })
  responsavelUserId: string | null;

  @Column({ name: 'manual_reminder_sent_at', type: 'datetime', precision: 6, nullable: true })
  manualReminderSentAt: Date | null;

  @OneToMany(() => SocialPostArte, (arte) => arte.post, { cascade: true })
  artes?: SocialPostArte[];

  @OneToMany(() => SocialPostBuffer, (row) => row.post, { cascade: true })
  bufferLinks?: SocialPostBuffer[];

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 6 })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 6 })
  updatedAt: Date;
}