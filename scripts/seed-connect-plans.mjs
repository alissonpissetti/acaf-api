import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

function roundPrice(value) {
  return Math.round(Number(value) * 100) / 100;
}

function resolveDomainFile() {
  const envPath = process.env.CONNECT_DOMAIN_FILE?.trim();
  if (envPath && existsSync(envPath)) return resolve(envPath);

  const cwd = process.cwd();
  const candidates = [
    resolve(cwd, 'shared/connect_domain.json'),
    resolve(cwd, '../acaf-api/shared/connect_domain.json'),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

function resolveCatalogFile() {
  const envPath = process.env.CONNECT_PLANS_SEED_FILE?.trim();
  if (envPath && existsSync(envPath)) return resolve(envPath);

  const cwd = process.cwd();
  const candidates = [
    resolve(cwd, 'shared/connect_plans_premium_seed.json'),
    resolve(cwd, '../acaf-api/shared/connect_plans_premium_seed.json'),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

const domainPath = resolveDomainFile();
if (!domainPath) {
  console.error('connect_domain.json não encontrado');
  process.exit(1);
}

const catalogPath = resolveCatalogFile();
if (!catalogPath) {
  console.error('connect_plans_premium_seed.json não encontrado');
  process.exit(1);
}

const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
const renames = Array.isArray(catalog.renames) ? catalog.renames : [];
const seedPlans = Array.isArray(catalog.plans) ? catalog.plans : [];

if (!seedPlans.length) {
  console.error('Catálogo sem planos premium');
  process.exit(1);
}

const domain = JSON.parse(readFileSync(domainPath, 'utf8'));
const plans = Array.isArray(domain.connectPlans) ? [...domain.connectPlans] : [];

let renamed = 0;
for (const rule of renames) {
  const fromId = String(rule.fromId ?? '').trim();
  const toId = String(rule.toId ?? '').trim();
  if (!fromId || !toId) continue;
  const idx = plans.findIndex((p) => p.id === fromId);
  if (idx < 0) continue;
  const current = plans[idx];
  plans[idx] = {
    ...current,
    id: toId,
    name: rule.name?.trim() || current.name,
    pricePerMonth:
      rule.pricePerMonth != null ? roundPrice(rule.pricePerMonth) : current.pricePerMonth,
    description: rule.description?.trim() || current.description,
  };
  renamed += 1;
}

const byId = new Map(plans.map((p) => [p.id, p]));
let added = 0;
let updated = 0;

for (const seed of seedPlans) {
  const id = String(seed.id ?? '').trim();
  if (!id || !/^connect-[a-z0-9-]+$/.test(id)) continue;
  const name = String(seed.name ?? '').trim();
  const pricePerMonth = roundPrice(seed.pricePerMonth);
  if (!name || !Number.isFinite(pricePerMonth)) continue;

  const next = {
    id,
    name,
    pricePerMonth,
    tierIndex: 0,
    ...(seed.description?.trim() ? { description: seed.description.trim() } : {}),
  };

  const existing = byId.get(id);
  if (!existing) {
    plans.push(next);
    byId.set(id, next);
    added += 1;
    continue;
  }

  const changed =
    existing.name !== next.name ||
    roundPrice(existing.pricePerMonth) !== pricePerMonth ||
    (seed.description?.trim() && existing.description !== next.description);

  Object.assign(existing, next, { tierIndex: existing.tierIndex });
  if (changed) updated += 1;
}

plans.sort(
  (a, b) =>
    (Number(a.pricePerMonth) || 0) - (Number(b.pricePerMonth) || 0) ||
    String(a.name).localeCompare(String(b.name), 'pt-BR'),
);
plans.forEach((plan, index) => {
  plan.tierIndex = index;
});

domain.connectPlans = plans;
writeFileSync(domainPath, `${JSON.stringify(domain, null, 2)}\n`, 'utf8');

const syncTargets = process.env.CONNECT_DOMAIN_SYNC?.trim()
  ? process.env.CONNECT_DOMAIN_SYNC.split(',').map((p) => resolve(p.trim())).filter(Boolean)
  : [
      resolve(dirname(domainPath), '../../acaf-partner/shared/connect_domain.json'),
      resolve(dirname(domainPath), '../../acaf-app/assets/shared/connect_domain.json'),
    ].filter((p) => existsSync(p));

let synced = 0;
const payload = readFileSync(domainPath, 'utf8');
for (const target of syncTargets) {
  writeFileSync(target, payload, 'utf8');
  synced += 1;
}

const ids = plans.map((p) => p.id);
console.log(
  JSON.stringify({
    domain: domainPath,
    catalog: catalogPath,
    renamed,
    added,
    updated,
    synced,
    planCount: plans.length,
    ids,
    fingerprint: createHash('sha256').update(ids.join('\n')).digest('hex').slice(0, 12),
  }),
);
