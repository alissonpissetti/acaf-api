# Seed dos planos Connect (premium)

Os planos Connect **não** usam tabela no banco: ficam em `shared/connect_domain.json`, carregados em runtime por `getDomain()` (`acaf-api/src/partner/store.ts`). O admin **Operação → Planos Connect** (`/m/operacao/planos`, `ConnectPlansPage.jsx`) lê e grava via `GET`/`PATCH` do domínio Connect (`connectPlans`).

O arquivo versionado `shared/connect_plans_premium_seed.json` define:

- renomear `connect-total` → **connect-max** (nome **Max**, R$ 299,90), quando existir;
- garantir os tiers premium: **connect-prime**, **connect-elite**, **connect-signature**, **connect-infinite** (IDs no padrão `connect-…`).

O script faz *upsert* por `id`, reordena por `pricePerMonth` e recalcula `tierIndex`. Não remove planos já cadastrados (Start, Plus, etc.).

## Rodar local

Na pasta `acaf-api`:

```bash
cd acaf-api
node scripts/seed-connect-plans.mjs
```

Ou via npm:

```bash
npm run seed:connect-plans
```

Outro JSON de catálogo ou arquivo de domínio:

```bash
CONNECT_PLANS_SEED_FILE=/caminho/premium.json \
CONNECT_DOMAIN_FILE=/caminho/connect_domain.json \
node scripts/seed-connect-plans.mjs
```

Por padrão, se existirem, o script também copia o `connect_domain.json` atualizado para:

- `acaf-partner/shared/connect_domain.json`
- `acaf-app/assets/shared/connect_domain.json`

Para desativar cópias ou apontar destinos:

```bash
CONNECT_DOMAIN_SYNC= npm run seed:connect-plans
# ou
CONNECT_DOMAIN_SYNC=../acaf-partner/shared/connect_domain.json node scripts/seed-connect-plans.mjs
```

No portal parceiro você ainda pode usar `npm run sync:shared` (a partir de `acaf-partner`) após editar o JSON na API.

## API (manual)

Sem seed: use o admin **Operação → Planos Connect** ou `PATCH` admin do domínio Connect com o array `connectPlans` (validação em `normalizeConnectPlans` em `admin.service.ts`).

**Nota:** assinantes já gravados com `connectPlanId: connect-total` no store da API precisam de migração de dados separada; o seed só atualiza o catálogo de domínio.
