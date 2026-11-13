import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('acaf_partner_legal_documents')
@Index(['slug', 'version'], { unique: true })
@Index(['slug', 'active'])
export class PartnerLegalDocument {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 64 })
  slug: string;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ name: 'content_html', type: 'longtext' })
  contentHtml: string;

  @Column({ type: 'int' })
  version: number;

  @Column({ name: 'published_at', type: 'datetime', nullable: true })
  publishedAt: Date | null;

  /** Versão vigente exibida ao parceiro (apenas uma `true` por slug). */
  @Column({ type: 'boolean', default: false })
  active: boolean;

  @Column({ name: 'effective_at', type: 'datetime', nullable: true })
  effectiveAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
