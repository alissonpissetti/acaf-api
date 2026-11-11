import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';
import type { ChangelogAudience, ChangelogCategory, ChangelogEntrySource } from './changelog.types';

@Entity('acaf_changelog_entries')
@Index('uq_changelog_repo_sha', ['repository', 'commitSha'], { unique: true })
export class ChangelogEntry {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id: string;

  @Column({ type: 'varchar', length: 40, nullable: true, name: 'commit_sha' })
  commitSha: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  repository: string | null;

  @Column({ type: 'varchar', length: 32 })
  source: ChangelogEntrySource;

  @Column({ type: 'datetime', name: 'committed_at' })
  committedAt: Date;

  @Column({ type: 'varchar', length: 300 })
  title: string;

  @Column({ type: 'text', nullable: true })
  summary: string | null;

  @Column({ type: 'varchar', length: 32 })
  category: ChangelogCategory;

  @Column({ type: 'json' })
  areas: string[];

  @Column({ type: 'json', nullable: true })
  highlights: string[] | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  author: string | null;

  @Column({ type: 'varchar', length: 16, default: 'internal' })
  audience: ChangelogAudience;

  @Column({ type: 'boolean', default: true })
  published: boolean;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
