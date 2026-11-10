# Inbox WhatsApp — réplica local e sincronização incremental

## Objetivo

O histórico de conversas vive em **`acaf_evolution_messages`** (e perfis/leituras/arquivo nas tabelas auxiliares). A Evolution API é usada só para **preencher lacunas** que o webhook não cobriu ou para **primeira carga** de uma instância.

Isso reduz chamadas à Evolution, melhora performance do ADM e garante que o histórico fique **no nosso banco** (backup, auditoria, independência do WhatsApp conectado).

## Fluxos

### 1. Tempo real (caminho principal)

`POST /public/evolution/webhook` → `EvolutionInboundService.handleWebhook` → `ingestFromInstance` (dedupe por `instance_id` + `external_id`).

Cada entrega de mensagem atualiza `acaf_evolution_inbox_sync_state.last_webhook_at`.

### 2. Leitura no ADM

- **Lista de conversas:** só consulta MySQL (paginada, modo `light`).
- **Mensagens:** `GET .../messages` lê do MySQL. Parâmetro `remote`:
  - omitido ou não = **`auto`**: só chama Evolution se não há mensagem local na thread **ou** o webhook não foi visto há ~25 min;
  - `remote=0` = nunca puxa;
  - `remote=1` = força delta na Evolution (reparo manual).

### 3. Pull incremental por conversa

`pullRemoteMessagesForThreadIfDue`:

- Usa `MAX(message_at)` local como watermark.
- `findMessages` com filtro temporal (+ overlap de 2 min) e limite menor quando já há histórico.
- Ingere apenas mensagens novas; atualiza `last_incremental_pull_at`.

Throttle maior quando o webhook está saudável (~12 min vs ~90 s).

### 4. Sync manual da instância (`POST .../sync-inbox`)

- Reconfigura webhook.
- Busca mensagens na Evolution com **no máximo 6 páginas** se já existe watermark global (`MAX(message_at)` da instância); caso contrário mantém carga inicial mais ampla.
- Filtra no servidor só o que é mais recente que o watermark.

## Tabela de estado

`acaf_evolution_inbox_sync_state` (por instância):

| Campo | Uso |
|--------|-----|
| `last_webhook_at` | Saúde do webhook |
| `last_local_message_at` | Watermark derivado do ingest |
| `last_incremental_pull_at` | Último pull reparador |

Criada automaticamente se `DB_SYNC=true`.

## Jobs automáticos (`EvolutionInboxJobsScheduler`)

Roda na própria API (tick a cada **15 min**). Liga/desliga com `EVOLUTION_INBOX_JOBS_ENABLED` (padrão `true`).

| Job | Quando | O que faz |
|-----|--------|-----------|
| **Catch-up mídia** | A cada tick (se houver pendente) | Até `EVOLUTION_MEDIA_CATCHUP_MAX` mensagens por instância (padrão **24**) |
| **Mídia noturna** | Uma vez por dia, `EVOLUTION_NIGHTLY_HOUR_START`–`END` (padrão **2h–6h** America/Sao_Paulo) | Até `EVOLUTION_NIGHTLY_MEDIA_MAX` por instância (padrão **500**) |
| **Inbox noturno** | Mesma janela, 1×/dia | `repairInboxIncremental` em instâncias **conectadas** (delta vs watermark local) |

Variáveis úteis:

- `EVOLUTION_INBOX_JOBS_ENABLED=0` — desliga todos os jobs.
- `EVOLUTION_MEDIA_CATCHUP_ENABLED=0` — só noturno.
- `EVOLUTION_NIGHTLY_MEDIA_ENABLED=0` / `EVOLUTION_NIGHTLY_INBOX_ENABLED=0` — desliga job específico.

## Próximos passos (roadmap)

- Tratar `MESSAGES_DELETE` / edição no webhook para manter paridade legal/histórico.
- Materializar threads ou cache de listagem se o volume crescer muito.
- Bootstrap pós-conexão mais enxuto quando webhook está OK.
- Lock distribuído se houver mais de um processo da API.

## Operacional

- Manter `EVOLUTION_WEBHOOK_SECRET` e URL pública estáveis.
- **Sync-inbox** após migração ou falha prolongada de webhook.
- Mídia: `sync-media` / persistência Nextcloud continua separada do texto das mensagens.
