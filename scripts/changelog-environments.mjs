import fs from 'node:fs';
import path from 'node:path';

const FALLBACK = {
  version: 1,
  environments: [
    { id: 'adm', label: 'Admin', folder: 'acaf-adm', aliases: ['admin', 'painel'] },
    { id: 'api', label: 'API', folder: 'acaf-api', aliases: ['api', 'backend'] },
    { id: 'partner', label: 'Parceiro', folder: 'acaf-partner', aliases: ['partner', 'parceiro'] },
    { id: 'app', label: 'App', folder: 'acaf-app', aliases: ['app'] },
    { id: 'corporate', label: 'Corporativo', folder: 'acaf-corporate', aliases: ['corporate', 'corporativo'] },
    { id: 'site', label: 'Site', folder: 'acaf-site', aliases: ['site'] },
    { id: 'associacao', label: 'Associação', folder: 'acaf-association', aliases: ['associacao', 'association'] },
  ],
  infra: [{ id: 'plataforma', label: 'Plataforma', folders: ['changelog/', 'scripts/', '.githooks/'] }],
  legacyAreaIds: { parceiro: 'partner', corporativo: 'corporate' },
};

export function loadEnvironmentsManifest(root) {
  const filePath = path.join(root, 'changelog/environments.json');
  if (!fs.existsSync(filePath)) return FALLBACK;
  try {
    return { ...FALLBACK, ...JSON.parse(fs.readFileSync(filePath, 'utf8')) };
  } catch {
    return FALLBACK;
  }
}

export function normalizeAreaId(rawId, manifest) {
  const id = String(rawId ?? '').trim().toLowerCase();
  if (!id) return '';
  if (manifest.legacyAreaIds?.[id]) return manifest.legacyAreaIds[id];
  const all = [...(manifest.environments ?? []), ...(manifest.infra ?? [])];
  for (const row of all) {
    if (row.id === id) return row.id;
    for (const alias of row.aliases ?? []) {
      if (alias.toLowerCase() === id) return row.id;
    }
  }
  return id;
}

export function resolveAreaFromToken(token, manifest) {
  return normalizeAreaId(token, manifest);
}

export function detectAreasFromFiles(files, manifest) {
  const found = new Set();
  for (const file of files) {
    for (const env of manifest.environments ?? []) {
      if (env.folder && file.startsWith(`${env.folder}/`)) found.add(env.id);
    }
    for (const infra of manifest.infra ?? []) {
      for (const prefix of infra.folders ?? []) {
        if (file.startsWith(prefix)) found.add(infra.id);
      }
    }
  }
  return [...found];
}

export function parseCommitScopes(subject) {
  const match = /^(?:feat|fix|perf|refactor|docs|style|test|chore|ci|build)\(([^)]+)\)/i.exec(subject);
  if (!match?.[1]) return [];
  return match[1]
    .split(/[,/|]/)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

export function extractAmbientesFromBody(body) {
  const ids = new Set();
  for (const raw of String(body ?? '').split('\n')) {
    const line = raw.trim();
    const match = /^(ambientes?|environments?)\s*:\s*(.+)$/i.exec(line);
    if (!match?.[2]) continue;
    for (const token of match[2].split(/[,;|/]/)) {
      const part = token.trim().toLowerCase();
      if (part) ids.add(part);
    }
  }
  return [...ids];
}

export function mergeAreaIds({ files, subject, body }, manifest) {
  const merged = new Set();
  for (const id of detectAreasFromFiles(files, manifest)) merged.add(id);
  for (const token of parseCommitScopes(subject)) {
    const id = resolveAreaFromToken(token, manifest);
    if (id) merged.add(id);
  }
  for (const token of extractAmbientesFromBody(body)) {
    const id = resolveAreaFromToken(token, manifest);
    if (id) merged.add(id);
  }
  if (!merged.size) merged.add('plataforma');
  return [...merged].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}
