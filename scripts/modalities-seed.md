# Seed do catálogo de modalidades

O admin **Operação → Modalidades** (`/m/operacao/modalidades`) lê a tabela `acaf_modalities` via `GET /api/admin/modalities`.

O JSON versionado `shared/modality_catalog_seed.json` lista modalidades típicas de academias e studios (PT-BR). O script insere só nomes que **ainda não existem** (comparação case-insensitive); não altera nem remove registros já cadastrados.

## Rodar local

Na pasta `acaf-api`, com `DATABASE_URL` no `.env` (e API parada ou compartilhando o mesmo banco):

```bash
cd acaf-api
node scripts/seed-modalities.mjs
```

Ou via npm:

```bash
npm run seed:modalities
```

Outro arquivo JSON:

```bash
MODALITY_CATALOG_FILE=/caminho/para/lista.json node scripts/seed-modalities.mjs
```

A tabela é criada com `CREATE TABLE IF NOT EXISTS` quando ainda não existir (`DB_SYNC=true` na API também sincroniza o schema TypeORM).

## API (manual)

Sem seed dedicado: use `POST /api/admin/modalities` com `{ "name": "…" }` (JWT admin) para cada modalidade.

O campo `modalityCatalog` em `shared/connect_domain.json` é legado/documentação; em runtime o domínio usa os nomes ativos do banco.
