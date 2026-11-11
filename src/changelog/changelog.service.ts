import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Repository } from 'typeorm';
import type {
  ChangelogAreaDto,
  ChangelogCategory,
  ChangelogEntryDto,
  ChangelogEntryRaw,
  ChangelogFile,
} from './changelog.types';
import {
  changelogAreaLabel,
  changelogEnvironmentsCatalog,
  loadChangelogEnvironments,
  normalizeChangelogAreaId,
  normalizeChangelogAreaIds,
} from './changelog-environments';
import { ChangelogGitService } from './changelog-git.service';
import { ChangelogEntry } from './changelog-entry.entity';
import {
  applyRawToChangelogEntity,
  changelogEntryToRaw,
  rawToChangelogEntity,
} from './changelog-persistence';

const CATEGORY_LABELS: Record<ChangelogCategory, string> = {
  feature: 'Novidade',
  fix: 'Correção',
  improvement: 'Melhoria',
  docs: 'Documentação',
  maintenance: 'Manutenção',
};

export type ChangelogListQuery = {
  limit?: number;
  offset?: number;
  area?: string;
  category?: ChangelogCategory;
  audience?: 'internal' | 'partner' | 'client';
  q?: string;
};

@Injectable()
export class ChangelogService implements OnModuleInit {
  private readonly logger = new Logger(ChangelogService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly gitChangelog: ChangelogGitService,
    @InjectRepository(ChangelogEntry)
    private readonly entries: Repository<ChangelogEntry>,
  ) {}

  async onModuleInit() {
    await this.seedFromJsonFileIfEmpty();
  }

  async list(query: ChangelogListQuery = {}): Promise<{
    entries: ChangelogEntryDto[];
    total: number;
    areas: ChangelogAreaDto[];
    environments: ChangelogAreaDto[];
    categories: Array<{ id: ChangelogCategory; label: string }>;
  }> {
    const manifest = loadChangelogEnvironments();
    const audience = query.audience ?? 'internal';

    let rows = (await this.loadAllRaw()).filter((row) => row.published !== false);

    if (audience === 'partner') {
      rows = rows.filter((row) => (row.audience ?? 'internal') !== 'internal');
    } else if (audience === 'client') {
      rows = rows.filter((row) => row.audience === 'client');
    }

    const areasCatalog = this.buildAreasCatalog();

    if (query.area?.trim()) {
      const areaId = normalizeChangelogAreaId(query.area.trim(), manifest);
      rows = rows.filter((row) => normalizeChangelogAreaIds(row.areas, manifest).includes(areaId));
    }
    if (query.category) {
      rows = rows.filter((row) => row.category === query.category);
    }
    if (query.q?.trim()) {
      const needle = query.q.trim().toLowerCase();
      rows = rows.filter((row) => {
        const hay = [
          row.title,
          row.summary ?? '',
          ...(row.highlights ?? []),
          row.author ?? '',
        ]
          .join(' ')
          .toLowerCase();
        return hay.includes(needle);
      });
    }

    rows = [...rows].sort(
      (a, b) => new Date(b.committedAt).getTime() - new Date(a.committedAt).getTime(),
    );

    const total = rows.length;
    const offset = Math.max(0, Number(query.offset ?? 0) || 0);
    const limit = Math.min(200, Math.max(1, Number(query.limit ?? 40) || 40));
    const slice = rows.slice(offset, offset + limit).map((row) => this.mapEntry(row, manifest));

    return {
      entries: slice,
      total,
      areas: areasCatalog,
      environments: areasCatalog,
      categories: Object.entries(CATEGORY_LABELS).map(([id, label]) => ({
        id: id as ChangelogCategory,
        label,
      })),
    };
  }

  /** Reimporta todas as entradas do changelog.json (upsert por id ou repository+commit). */
  async seedFromJsonFile(): Promise<{ fromFile: number; added: number; total: number }> {
    const fromFile = this.readJsonFileEntries();
    const added = fromFile.length ? await this.upsertMany(fromFile) : 0;
    const total = await this.entries.count();
    return { fromFile: fromFile.length, added, total };
  }

  async syncFromGit(): Promise<{ added: number; total: number }> {
    let added = 0;

    const fileSeed = await this.seedFromJsonFile();
    added += fileSeed.added;

    const persisted = await this.loadAllRaw();
    const fromGit = this.gitChangelog.collectMissingFromGit(persisted);
    if (fromGit.length) {
      added += await this.upsertMany(fromGit);
    }

    const total = await this.entries.count();
    return { added, total };
  }

  private mapEntry(row: ChangelogEntryRaw, manifest = loadChangelogEnvironments()): ChangelogEntryDto {
    const category = this.normalizeCategory(row.category);
    const areaIds = normalizeChangelogAreaIds(row.areas, manifest);
    const areas = areaIds.map((id) => ({
      id,
      label: changelogAreaLabel(id, manifest),
    }));
    return {
      id: row.id,
      commitSha: row.commitSha ?? null,
      committedAt: row.committedAt,
      title: row.title,
      summary: row.summary?.trim() || null,
      category,
      categoryLabel: CATEGORY_LABELS[category],
      areas,
      highlights: (row.highlights ?? []).filter((line) => String(line).trim()),
      author: row.author?.trim() || null,
      audience: row.audience ?? 'internal',
      published: row.published !== false,
      repository: row.repository?.trim() || row.areas?.[0] || null,
      source: row.source === 'git' ? 'git' : 'changelog',
    };
  }

  private normalizeCategory(value: string | undefined): ChangelogCategory {
    const key = String(value ?? '').trim() as ChangelogCategory;
    if (key in CATEGORY_LABELS) return key;
    return 'maintenance';
  }

  private buildAreasCatalog(): ChangelogAreaDto[] {
    return changelogEnvironmentsCatalog();
  }

  private async seedFromJsonFileIfEmpty(): Promise<void> {
    const count = await this.entries.count();
    if (count > 0) return;

    const { fromFile, added } = await this.seedFromJsonFile();
    if (!fromFile) return;

    this.logger.log(
      `Changelog: tabela vazia — importadas ${fromFile} entradas do changelog.json (${added} novas)`,
    );
  }

  private async loadAllRaw(): Promise<ChangelogEntryRaw[]> {
    const rows = await this.entries.find({
      order: { sortOrder: 'DESC', committedAt: 'DESC' },
    });
    return rows.map((row) => changelogEntryToRaw(row));
  }

  private async upsertMany(rows: ChangelogEntryRaw[]): Promise<number> {
    let added = 0;
    for (const raw of rows) {
      const created = await this.upsertOne(raw);
      if (created) added += 1;
    }
    return added;
  }

  private async upsertOne(raw: ChangelogEntryRaw): Promise<boolean> {
    const existing = await this.findExisting(raw);
    if (existing) {
      applyRawToChangelogEntity(existing, raw);
      await this.entries.save(existing);
      return false;
    }

    const entity = rawToChangelogEntity(raw);
    try {
      await this.entries.save(entity);
      return true;
    } catch (err) {
      const dup = await this.findExisting(raw);
      if (dup) {
        applyRawToChangelogEntity(dup, raw);
        await this.entries.save(dup);
        return false;
      }
      this.logger.warn(
        `Falha ao gravar changelog ${raw.id}: ${err instanceof Error ? err.message : 'erro'}`,
      );
      return false;
    }
  }

  private async findExisting(raw: ChangelogEntryRaw): Promise<ChangelogEntry | null> {
    const sha = String(raw.commitSha ?? '').trim();
    const repo = String(raw.repository ?? '').trim();

    if (sha) {
      if (repo) {
        const hit = await this.entries.findOne({ where: { commitSha: sha, repository: repo } });
        if (hit) return hit;
      }
      const bySha = await this.entries.findOne({ where: { commitSha: sha } });
      if (bySha) return bySha;
    }

    const id = String(raw.id ?? '').trim();
    if (id) {
      return this.entries.findOne({ where: { id } });
    }

    return null;
  }

  private readJsonFileEntries(): ChangelogEntryRaw[] {
    const filePath = this.resolveFilePath();
    if (!filePath || !fs.existsSync(filePath)) {
      return [];
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as ChangelogFile;
      return Array.isArray(parsed.entries) ? parsed.entries : [];
    } catch (err) {
      this.logger.error(`Falha ao ler changelog.json: ${err instanceof Error ? err.message : 'erro'}`);
      return [];
    }
  }

  private resolveFilePath(): string | null {
    const envPath = this.config.get<string>('CHANGELOG_FILE')?.trim();
    if (envPath) return path.resolve(envPath);

    const cwd = process.cwd();
    const candidates = [
      path.resolve(cwd, 'changelog/changelog.json'),
      path.resolve(cwd, '../changelog/changelog.json'),
      path.resolve(cwd, '../../changelog/changelog.json'),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }
    return candidates[1] ?? null;
  }
}
