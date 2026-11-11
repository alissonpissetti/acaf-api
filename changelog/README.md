# Changelog do projeto (ACAF / Movly)

**Fonte de verdade em produção:** tabela `acaf_changelog_entries` no banco (compartilhada entre réplicas/containers).

O arquivo versionado `changelog.json` continua útil para hooks locais e **seed** na primeira subida da API (tabela vazia).

A página **Sistema → Atualizações** (admin) consulta `GET /api/admin/changelog`.

## Registro automático por commit

1. Instale os hooks (uma vez por clone):

```bash
chmod +x scripts/install-git-hooks.sh scripts/changelog-record-commit.mjs .githooks/post-commit
./scripts/install-git-hooks.sh
```

**Vários repositórios** (`acaf-adm`, `acaf-api`, `acaf-partner`, … na mesma pasta pai):

```bash
./scripts/install-changelog-hooks-all.sh
```

Cada commit em qualquer repo grava no **mesmo** `acaf-api/changelog/changelog.json` e marca o ambiente pelo nome da pasta (`acaf-adm` → `adm`).

2. A cada `git commit`, o hook acrescenta uma entrada (exceto se a mensagem contiver `[skip changelog]`). Commit o `changelog.json` atualizado no repositório.

## Produção (Docker / Coolify)

- **Listagem:** sempre do banco — não depende mais de arquivo gravável no container.
- **Bootstrap:** na primeira subida, se a tabela estiver vazia, a API importa `changelog/changelog.json` da imagem (`CHANGELOG_FILE` opcional).
- **Após deploy:** use **Importar do Git** no admin (`POST /api/admin/changelog/sync`) ou confie no bootstrap + sync. O sync faz *upsert* no banco a partir do JSON versionado **e** de commits Git quando disponível.
- **Histórico perdido / tabela parcial:** `POST /api/admin/changelog/seed-from-file` (permissão `sistema.changelog`) ou `node scripts/seed-changelog.mjs` no host com `DATABASE_URL` — reimporta só o `changelog.json` sem duplicar (id ou `repository`+`commit_sha`).
- A pasta `changelog/` na imagem Docker serve só para seed e documentação (ver `Dockerfile`).

`DB_SYNC=true` (padrão) cria a tabela automaticamente. Com `DB_SYNC=false`, rode `scripts/sql/changelog-entries.sql`.

## Importação Git (API)

`POST /api/admin/changelog/sync`:

1. Mescla entradas do `changelog.json` (se existir no servidor) no banco.
2. Acrescenta commits recentes dos repositórios Git configurados.

- Descobre clones em `../acaf-*` (mesmo nível da API), se houver `.git`.
- Ou configure `CHANGELOG_GIT_REPOS=adm=/srv/acaf-adm,api=/srv/acaf-api`.
- Desative leitura Git com `CHANGELOG_GIT_READ=0`.

Duplicatas são evitadas por *upsert* em `(repository, commit_sha)` quando houver SHA.

### Mensagem de commit recomendada

```
feat(whatsapp): citações no inbox no estilo WhatsApp

Changelog:
- Respostas com mensagem citada aparecem com faixa lateral na bolha
- Sincronização em tempo real melhorada em grupos
```

- A **primeira linha** vira o título (sem o prefixo `feat:` / `fix:` etc.).
- Linhas sob **`Changelog:`** viram bullets amigáveis para o time.
- Pastas alteradas definem os **ambientes** (cada pasta do monorepo).
- O escopo do commit conta: `feat(adm): …`, `fix(api|partner): …`.
- Opcional no corpo: `Ambientes: adm, api, site`.

### Ambientes (pastas)

| ID | Pasta | Uso |
|----|--------|-----|
| `adm` | `acaf-adm/` | Painel admin |
| `api` | `acaf-api/` | Backend |
| `partner` | `acaf-partner/` | Portal parceiro |
| `app` | `acaf-app/` | App mobile/web |
| `corporate` | `acaf-corporate/` | Portal corporativo |
| `site` | `acaf-site/` | Site institucional |
| `associacao` | `acaf-association/` | Portal associação (extra) |

Lista canônica: `changelog/environments.json` (usada pelo hook e pela API).

## Público (futuro)

Cada entrada pode usar `audience`: `internal` | `partner` | `client` e `published: true` para filtrar o que for compartilhável fora do time.

## Variáveis de ambiente (API)

- `CHANGELOG_FILE` — caminho absoluto alternativo para `changelog.json` (seed/sync).
- `CHANGELOG_GIT_REPOS` / `CHANGELOG_GIT_READ` — ver acima.
