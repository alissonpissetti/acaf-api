import * as fs from 'node:fs';
import * as path from 'node:path';

export type ChangelogEnvironmentRow = {
  id: string;
  label: string;
  folder?: string;
  aliases?: string[];
  folders?: string[];
};

export type ChangelogEnvironmentsManifest = {
  version: number;
  environments: ChangelogEnvironmentRow[];
  infra?: ChangelogEnvironmentRow[];
  legacyAreaIds?: Record<string, string>;
};

let cached: ChangelogEnvironmentsManifest | null = null;
let cachedPath: string | null = null;

const FALLBACK: ChangelogEnvironmentsManifest = {
  version: 1,
  environments: [
    { id: 'adm', label: 'Admin', folder: 'acaf-adm' },
    { id: 'api', label: 'API', folder: 'acaf-api' },
    { id: 'partner', label: 'Parceiro', folder: 'acaf-partner' },
    { id: 'app', label: 'App', folder: 'acaf-app' },
    { id: 'corporate', label: 'Corporativo', folder: 'acaf-corporate' },
    { id: 'site', label: 'Site', folder: 'acaf-site' },
    { id: 'associacao', label: 'Associação', folder: 'acaf-association' },
  ],
  infra: [{ id: 'plataforma', label: 'Plataforma', folders: ['changelog/', 'scripts/'] }],
  legacyAreaIds: {
    parceiro: 'partner',
    corporativo: 'corporate',
  },
};

export function resolveEnvironmentsFilePath(cwd = process.cwd()): string | null {
  const candidates = [
    path.resolve(cwd, '../changelog/environments.json'),
    path.resolve(cwd, 'changelog/environments.json'),
    path.resolve(cwd, '../../changelog/environments.json'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[0] ?? null;
}

export function loadChangelogEnvironments(cwd = process.cwd()): ChangelogEnvironmentsManifest {
  const filePath = resolveEnvironmentsFilePath(cwd);
  if (!filePath || !fs.existsSync(filePath)) return FALLBACK;
  if (cached && cachedPath === filePath) return cached;

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as ChangelogEnvironmentsManifest;
    cached = {
      version: parsed.version ?? 1,
      environments: Array.isArray(parsed.environments) ? parsed.environments : FALLBACK.environments,
      infra: Array.isArray(parsed.infra) ? parsed.infra : FALLBACK.infra,
      legacyAreaIds: parsed.legacyAreaIds ?? FALLBACK.legacyAreaIds,
    };
    cachedPath = filePath;
    return cached;
  } catch {
    return FALLBACK;
  }
}

export function normalizeChangelogAreaId(
  rawId: string,
  manifest: ChangelogEnvironmentsManifest = loadChangelogEnvironments(),
): string {
  const id = String(rawId ?? '').trim().toLowerCase();
  if (!id) return id;
  const legacy = manifest.legacyAreaIds?.[id];
  if (legacy) return legacy;
  const all = [...manifest.environments, ...(manifest.infra ?? [])];
  for (const row of all) {
    if (row.id === id) return row.id;
    if (row.aliases?.some((alias) => alias.toLowerCase() === id)) return row.id;
  }
  return id;
}

export function changelogAreaLabel(
  id: string,
  manifest: ChangelogEnvironmentsManifest = loadChangelogEnvironments(),
): string {
  const canonical = normalizeChangelogAreaId(id, manifest);
  const all = [...manifest.environments, ...(manifest.infra ?? [])];
  const row = all.find((item) => item.id === canonical);
  return row?.label ?? canonical;
}

export function changelogEnvironmentsCatalog(
  manifest: ChangelogEnvironmentsManifest = loadChangelogEnvironments(),
): Array<{ id: string; label: string }> {
  return manifest.environments.map((row) => ({
    id: row.id,
    label: row.label,
  }));
}

export function normalizeChangelogAreaIds(
  ids: string[] | undefined,
  manifest: ChangelogEnvironmentsManifest = loadChangelogEnvironments(),
): string[] {
  const unique = new Set<string>();
  for (const raw of ids ?? []) {
    const normalized = normalizeChangelogAreaId(raw, manifest);
    if (normalized) unique.add(normalized);
  }
  return [...unique];
}
