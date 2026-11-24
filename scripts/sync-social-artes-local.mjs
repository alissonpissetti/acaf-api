#!/usr/bin/env node
/**
 * @deprecated Use `npm run sync:social-artes` ou `sync:social-artes:force` (Nextcloud).
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const force = process.argv.includes('--force');
const args = ['run', force ? 'sync:social-artes:force' : 'sync:social-artes'];

const result = spawnSync('npm', args, { cwd: root, stdio: 'inherit', shell: true });
process.exit(result.status ?? 1);