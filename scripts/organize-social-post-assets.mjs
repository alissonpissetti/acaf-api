#!/usr/bin/env node
/**
 * Copia PNG de uma pasta plana (ex. ~/Documents/movly-artes)
 * para storage/social-posts/assets/{postId}/{nome}.png conforme o seed.
 *
 * Uso:
 *   node scripts/organize-social-post-assets.mjs /Users/alisson/Documents/movly-artes
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';

const SOURCE = process.argv[2]?.trim();
if (!SOURCE || !existsSync(SOURCE)) {
  console.error('Uso: node scripts/organize-social-post-assets.mjs <pasta-origem>');
  process.exit(1);
}

const ROOT = process.cwd();
const SEED_PATH = join(ROOT, 'scripts/seeds/movly-posts-seed.json');
const ASSETS_ROOT = join(ROOT, 'storage/social-posts/assets');

/** nome da arte no seed → nome do arquivo na origem quando diverge */
const SOURCE_ALIASES = {
  'E1-Story': 'E1',
};

const seed = JSON.parse(readFileSync(SEED_PATH, 'utf-8'));
const nomeToPost = new Map();

for (const post of seed.posts ?? []) {
  const postId = String(post.id ?? '').trim().toLowerCase();
  if (!postId) continue;
  for (const arte of post.artes ?? []) {
    const nome = String(arte.nome ?? '').trim();
    if (!nome) continue;
    nomeToPost.set(nome, postId);
  }
}

const sourceFiles = new Set(
  readdirSync(SOURCE).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)),
);

let copied = 0;
let skipped = 0;
const unmatched = [];

for (const [nome, postId] of nomeToPost) {
  const base = SOURCE_ALIASES[nome] ?? nome;
  const candidates = [`${base}.png`, `${base}.PNG`, `${nome}.png`];
  let src = null;
  for (const c of candidates) {
    const full = join(SOURCE, c);
    if (existsSync(full)) {
      src = full;
      break;
    }
  }
  if (!src) {
    skipped++;
    console.warn(`⚠ Sem arquivo para arte "${nome}" (post ${postId})`);
    continue;
  }

  const destDir = join(ASSETS_ROOT, postId);
  mkdirSync(destDir, { recursive: true });
  const dest = join(destDir, `${nome}.png`);
  copyFileSync(src, dest);
  copied++;
  sourceFiles.delete(basename(src));
}

// Extras: arquivo P03.png → p03/P03.png mesmo sem entrada no seed
const EXTRA_POST_BY_FILE = {
  P03: 'p03',
  P05: 'p05',
  P08: 'p08',
  P11: 'p11',
};

for (const [fileBase, postId] of Object.entries(EXTRA_POST_BY_FILE)) {
  const src = join(SOURCE, `${fileBase}.png`);
  if (!existsSync(src)) continue;
  const destDir = join(ASSETS_ROOT, postId);
  mkdirSync(destDir, { recursive: true });
  copyFileSync(src, join(destDir, `${fileBase}.png`));
  sourceFiles.delete(`${fileBase}.png`);
  copied++;
  console.log(`ℹ Extra (reels): ${fileBase}.png → ${postId}/`);
}

for (const f of sourceFiles) {
  unmatched.push(f);
}

console.log(`\n✓ ${copied} arquivo(s) copiado(s) para ${ASSETS_ROOT}`);
if (skipped) console.log(`⚠ ${skipped} arte(s) no seed sem PNG na origem`);
if (unmatched.length) {
  console.log(`? ${unmatched.length} PNG na origem não usado(s): ${unmatched.join(', ')}`);
}