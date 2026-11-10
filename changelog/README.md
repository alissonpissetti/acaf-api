# Changelog do projeto (ACAF / Movly)

Arquivo versionado: `changelog.json`. A API do admin lê este arquivo e a página **Sistema → Atualizações** exibe o histórico para o time.

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

O repositório da API guarda `changelog/` na raiz deste projeto (caminho usado em deploy).

2. A cada `git commit`, o hook acrescenta uma entrada (exceto se a mensagem contiver `[skip changelog]`). Lembre de commitar o `changelog.json` atualizado em seguida (ou use **Importar do Git** no admin).

## Leitura direta do Git (API)

Se faltar entrada no JSON, a API pode **mesclar commits do Git** ao listar:

- Descobre clones em `../acaf-*` (mesmo nível da API).
- Ou configure `CHANGELOG_GIT_REPOS=adm=/srv/acaf-adm,api=/srv/acaf-api`.
- Desative com `CHANGELOG_GIT_READ=0`.

No admin: **Importar do Git** (`POST /api/admin/changelog/sync`) grava as entradas faltantes no `changelog.json`.

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

No JSON, cada entrada pode usar `audience`: `internal` | `partner` | `client` e `published: true` para filtrar o que for compartilhável fora do time.

## Variável de ambiente (API)

`CHANGELOG_FILE` — caminho absoluto alternativo para `changelog.json` (opcional).
