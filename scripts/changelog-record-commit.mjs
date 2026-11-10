#!/usr/bin/env node
/**
 * Acrescenta a última revisão git ao changelog/changelog.json.
 * Chamado pelo hook post-commit.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { loadEnvironmentsManifest, mergeAreaIds } from './changelog-environments.mjs';

const ROOT = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
const CHANGELOG_PATH = path.join(ROOT, 'changelog/changelog.json');
const ENV_MANIFEST = loadEnvironmentsManifest(ROOT);

function git(format, extra = '') {
  return execSync(`git log -1 --format=${format} ${extra}`.trim(), {
    cwd: ROOT,
    encoding: 'utf8',
  }).trim();
}

function gitNames() {
  const out = execSync('git diff-tree --no-commit-id --name-only -r HEAD', {
    cwd: ROOT,
    encoding: 'utf8',
  }).trim();
  return out ? out.split('\n').map((line) => line.trim()).filter(Boolean) : [];
}

function parseCategory(subject) {
  const match = /^(feat|fix|perf|refactor|docs|style|test|chore|ci|build)(\([^)]*\))?!?:\s*/i.exec(subject);
  if (!match) return 'maintenance';
  const key = match[1].toLowerCase();
  if (key === 'feat') return 'feature';
  if (key === 'fix') return 'fix';
  if (key === 'docs') return 'docs';
  if (key === 'perf' || key === 'refactor') return 'improvement';
  return 'maintenance';
}

function humanizeSubject(subject) {
  const stripped = subject
    .replace(/^\[[^\]]+\]\s*/g, '')
    .replace(/^(feat|fix|perf|refactor|docs|style|test|chore|ci|build)(\([^)]*\))?!?:\s*/i, '')
    .trim();
  const text = stripped || subject.trim();
  if (!text) return 'Atualização do projeto';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function extractHighlights(body) {
  const lines = String(body ?? '').split('\n');
  const highlights = [];
  let inSection = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (/^changelog\s*:/i.test(line)) {
      inSection = true;
      continue;
    }
    if (inSection) {
      if (!line) {
        if (highlights.length) break;
        continue;
      }
      if (/^[a-z]+(\([^)]*\))?!?:\s+/i.test(line) && !line.startsWith('-')) break;
      const bullet = line.replace(/^[-*•]\s*/, '').trim();
      if (bullet) highlights.push(bullet);
    }
  }
  return highlights;
}

function readStore() {
  if (!fs.existsSync(CHANGELOG_PATH)) {
    return { version: 1, entries: [] };
  }
  try {
    const data = JSON.parse(fs.readFileSync(CHANGELOG_PATH, 'utf8'));
    if (!Array.isArray(data.entries)) return { version: 1, entries: [] };
    return data;
  } catch {
    return { version: 1, entries: [] };
  }
}

function main() {
  const sha = execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
  const subject = git('%s');
  const body = git('%b');
  const author = git('%an');
  const committedAt = git('%cI');

  if (/\[skip changelog\]/i.test(`${subject}\n${body}`)) {
    process.exit(0);
  }

  const store = readStore();
  if (store.entries.some((row) => row.commitSha === sha)) {
    process.exit(0);
  }

  const files = gitNames();
  const category = parseCategory(subject);
  const title = humanizeSubject(subject);
  const highlights = extractHighlights(body);
  const areas = mergeAreaIds({ files, subject, body }, ENV_MANIFEST);

  const entry = {
    id: randomUUID(),
    commitSha: sha,
    committedAt,
    title,
    summary: highlights.length ? null : body.split('\n').find((l) => l.trim() && !/^changelog\s*:/i.test(l))?.trim() || null,
    category,
    areas,
    highlights,
    author,
    audience: 'internal',
    published: true,
  };

  store.entries.unshift(entry);
  fs.mkdirSync(path.dirname(CHANGELOG_PATH), { recursive: true });
  fs.writeFileSync(CHANGELOG_PATH, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  console.log(`[changelog] registrado: ${title}`);
}

main();
