import type { ChangelogEntryRaw } from './changelog.types';
import { ChangelogEntry } from './changelog-entry.entity';

export function changelogSortOrder(committedAt: string | Date): number {
  const ms = committedAt instanceof Date ? committedAt.getTime() : new Date(committedAt).getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
}

export function changelogEntryToRaw(row: ChangelogEntry): ChangelogEntryRaw {
  return {
    id: row.id,
    commitSha: row.commitSha,
    committedAt:
      row.committedAt instanceof Date ? row.committedAt.toISOString() : String(row.committedAt),
    title: row.title,
    summary: row.summary,
    category: row.category,
    areas: Array.isArray(row.areas) ? row.areas : [],
    highlights: row.highlights ?? [],
    author: row.author,
    audience: row.audience,
    published: row.published,
    repository: row.repository,
    source: row.source === 'git' ? 'git' : 'changelog',
  };
}

export function rawToChangelogEntity(raw: ChangelogEntryRaw): ChangelogEntry {
  const entity = new ChangelogEntry();
  applyRawToChangelogEntity(entity, raw);
  if (!entity.id?.trim()) {
    entity.id = raw.commitSha?.trim()
      ? `changelog:${raw.repository ?? 'unknown'}:${raw.commitSha.trim()}`
      : `changelog:${Date.now()}`;
  }
  return entity;
}

export function applyRawToChangelogEntity(entity: ChangelogEntry, raw: ChangelogEntryRaw): void {
  const sha = String(raw.commitSha ?? '').trim() || null;
  const repo =
    String(raw.repository ?? '').trim() ||
    (raw.areas?.length === 1 ? raw.areas[0] : null) ||
    null;

  entity.id = String(raw.id ?? entity.id ?? '').trim() || entity.id;
  entity.commitSha = sha;
  entity.repository = repo;
  entity.source = raw.source === 'git' ? 'git' : 'changelog';
  entity.committedAt = new Date(raw.committedAt);
  entity.title = String(raw.title ?? '').trim() || 'Atualização';
  entity.summary = raw.summary?.trim() || null;
  entity.category = raw.category ?? 'maintenance';
  entity.areas = Array.isArray(raw.areas) ? raw.areas.map((a) => String(a).trim()).filter(Boolean) : [];
  const highlights = (raw.highlights ?? []).map((line) => String(line).trim()).filter(Boolean);
  entity.highlights = highlights.length ? highlights : null;
  entity.author = raw.author?.trim() || null;
  entity.audience = raw.audience ?? 'internal';
  entity.published = raw.published !== false;
  entity.sortOrder = changelogSortOrder(raw.committedAt);
}
