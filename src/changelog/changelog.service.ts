import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
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
export class ChangelogService {
  private readonly logger = new Logger(ChangelogService.name);
  private cacheAt = 0;
  private cachePayload: ChangelogFile | null = null;
  private readonly cacheMs = 4_000;

  constructor(
    private readonly config: ConfigService,
    private readonly gitChangelog: ChangelogGitService,
  ) {}

  list(query: ChangelogListQuery = {}): {
    entries: ChangelogEntryDto[];
    total: number;
    areas: ChangelogAreaDto[];
    environments: ChangelogAreaDto[];
    categories: Array<{ id: ChangelogCategory; label: string }>;
  } {
    const manifest = loadChangelogEnvironments();
    const store = this.loadFile();
    const audience = query.audience ?? 'internal';

    let rows = this.mergeWithGit(store.entries);

    rows = rows.filter((row) => row.published !== false);
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

  syncFromGit(): { added: number; total: number } {
    const filePath = this.resolveFilePath();
    if (!filePath) {
      return { added: 0, total: 0 };
    }
    const store = this.loadFile(true);
    const outcome = this.gitChangelog.syncMissingToFile(filePath, store.entries);
    this.cachePayload = { version: 1, entries: outcome.entries };
    this.cacheAt = Date.now();
    return { added: outcome.added, total: outcome.entries.length };
  }

  private mergeWithGit(entries: ChangelogEntryRaw[]): ChangelogEntryRaw[] {
    const fromGit = this.gitChangelog.collectMissingFromGit(entries);
    if (!fromGit.length) return entries;

    const seen = new Set(
      entries.map((row) => `${String(row.repository ?? '').trim()}:${String(row.commitSha ?? '').trim()}`),
    );

    const merged = [...entries];
    for (const row of fromGit) {
      const key = `${String(row.repository ?? '').trim()}:${String(row.commitSha ?? '').trim()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(row);
    }

    return merged.sort(
      (a, b) => new Date(b.committedAt).getTime() - new Date(a.committedAt).getTime(),
    );
  }

  private normalizeCategory(value: string | undefined): ChangelogCategory {
    const key = String(value ?? '').trim() as ChangelogCategory;
    if (key in CATEGORY_LABELS) return key;
    return 'maintenance';
  }

  private buildAreasCatalog(): ChangelogAreaDto[] {
    return changelogEnvironmentsCatalog();
  }

  private loadFile(force = false): ChangelogFile {
    const now = Date.now();
    if (!force && this.cachePayload && now - this.cacheAt < this.cacheMs) {
      return this.cachePayload;
    }

    const filePath = this.resolveFilePath();
    if (!filePath || !fs.existsSync(filePath)) {
      this.logger.warn(`Changelog não encontrado (${filePath ?? 'sem caminho'})`);
      return { version: 1, entries: [] };
    }

    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw) as ChangelogFile;
      const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
      this.cachePayload = { version: parsed.version ?? 1, entries };
      this.cacheAt = now;
      return this.cachePayload;
    } catch (err) {
      this.logger.error(`Falha ao ler changelog: ${err instanceof Error ? err.message : 'erro'}`);
      return { version: 1, entries: [] };
    }
  }

  private resolveFilePath(): string | null {
    const envPath = this.config.get<string>('CHANGELOG_FILE')?.trim();
    if (envPath) return path.resolve(envPath);

    const cwd = process.cwd();
    const candidates = [
      path.resolve(cwd, '../changelog/changelog.json'),
      path.resolve(cwd, 'changelog/changelog.json'),
      path.resolve(cwd, '../../changelog/changelog.json'),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }
    return candidates[0] ?? null;
  }
}
