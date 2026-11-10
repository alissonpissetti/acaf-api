# Changelog do projeto (ACAF / Movly)

Arquivo versionado: `changelog.json`. A API do admin lê este arquivo e a página **Sistema → Atualizações** exibe o histórico para o time.

## Registro automático por commit

1. Instale os hooks (uma vez por clone):

```bash
chmod +x scripts/install-git-hooks.sh scripts/changelog-record-commit.mjs .githooks/post-commit
./scripts/install-git-hooks.sh
```

O repositório da API guarda `changelog/` na raiz deste projeto (caminho usado em deploy).

2. A cada `git commit`, o hook acrescenta uma entrada (exceto se a mensagem contiver `[skip changelog]`).

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
