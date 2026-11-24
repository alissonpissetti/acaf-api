import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { SocialRede } from './social-post.constants';

@Entity('acaf_social_canais')
export class SocialChannel {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: ['instagram', 'facebook', 'linkedin'] })
  rede: SocialRede;

  @Column({ name: 'buffer_channel_id', type: 'varchar', length: 64, unique: true })
  bufferChannelId: string;

  @Column({ name: 'nome_exibicao', type: 'varchar', length: 120 })
  nomeExibicao: string;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 6 })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 6 })
  updatedAt: Date;
}