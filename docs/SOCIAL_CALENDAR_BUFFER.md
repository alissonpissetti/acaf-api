# Calendário de redes sociais + Buffer

## Variáveis de ambiente (acaf-api)

| Variável | Obrigatória | Descrição |
|---|---|---|
| `BUFFER_API_KEY` | sim, para enviar | Token em [Buffer → Settings → API](https://publish.buffer.com/settings/api). **Nunca** exponha no front. |
| `BUFFER_SYNC_ENABLED` | não | `1` (padrão) agenda sync a cada ~12 min; `0` desliga o job. |
| `NEXTCLOUD_*` | sim (prod) | Artes e uploads vão para `{NEXTCLOUD_ROOT_FOLDER}/marketing/social-posts/{postId}/` com link público (mesmo padrão dos anexos financeiros/cronograma). |
| `API_PUBLIC_URL` | não* | *Opcional. Só necessário se ainda houver artes legadas sem URL remota (`GET /api/social-posts/media/:id` redireciona após sync). |
| `SOCIAL_POST_STORAGE_DIR` | não | Pasta local apenas para **seed** (`assets/{codigo}/`). Em produção o conteúdo é enviado ao Nextcloud na subida ou via `POST .../artes/sync-local`. |
| `SOCIAL_MANUAL_REMINDER_ENABLED` | não | `1` (padrão): job a cada 1 min envia SMS/e-mail **15 min antes** do horário agendado para posts com figurinha de link ou interação manual, quando há responsável admin. `0` desliga. |
| `ADMIN_PUBLIC_URL` | não | URL base do acaf-adm (link no lembrete). Se vazio, usa `APP_PUBLIC_URL` ou `http://localhost:5173`. |

## Seed do cronograma

Arquivo: `scripts/seeds/movly-posts-seed.json` (26 posts).

Importação (admin autenticado):

```http
POST /api/admin/social-posts/seed/import
POST /api/admin/social-posts/seed/import?force=1
```

Na primeira subida da API, se não houver posts, o seed roda automaticamente (`seedIfEmpty`).

## Artes (storage remoto)

1. Coloque os arquivos de seed em `storage/social-posts/assets/{codigo}/{nome}.png` (ex.: `g01/G1.png`).
2. Ao subir a API, ou `POST /api/admin/social-posts/artes/sync-local`, ou seed com `force=1` — as artes são **enviadas ao Nextcloud** e `url_publica` no banco aponta para o link público.
3. Novos uploads pelo admin vão direto ao Nextcloud (acessíveis pelo Buffer e de qualquer lugar).

O preview do admin usa `urlPublica` do storage; `GET /api/social-posts/media/:arteId` só redireciona (compatibilidade).

## Permissões (acaf-adm)

| Chave | Uso |
|---|---|
| `marketing.redes-sociais` | Ver calendário |
| `marketing.redes-sociais.manage` | Editar post, artes, importar seed |
| `marketing.redes-sociais.aprovar` | Aprovar / pedir ajuste |
| `marketing.redes-sociais.publicar` | Buffer, publicação manual por canal, etapa do post |

## Publicação manual (Meta Business Suite / app)

Posts com arte marcada como **link** ou **interação manual** (pergunta, poll, figurinha, etc.) exigem publicação no app (Meta Business Suite). A API **não permite enviar esses posts pelo Buffer** — o admin oculta as ações de Buffer e a API rejeita rascunho/programação/envio.

Para cada post manual agendado, defina um **responsável** (usuário do console admin) no campo do calendário. Com data/hora e post aprovado, a API envia **SMS e/ou e-mail 15 minutos antes** ao responsável (se tiver celular/e-mail cadastrados).

Sem usar o Buffer, marque por canal (Instagram, Facebook, LinkedIn):

`PATCH /api/admin/social-posts/:id/canais/:rede/manual` com corpo `{ "status": "draft" | "scheduled" | "sent" | "clear", "externalLink"?, "dueAt"? }`.

Etapa do post (rascunho / programado / publicado) para quem tem `manage` ou `publicar`:

`PATCH /api/admin/social-posts/:id/fluxo-publicacao` com `{ "etapa"?, "agendadoPara"? }`.

Atribua `aprovar` e `publicar` aos grupos de marketing em **Sistema → Grupos** após o deploy (criadas na migration do módulo).

## Reels (perfil e alcance)

Posts com `envio: reels` usam **só Instagram** no Buffer. Anexe **vídeo MP4 ou MOV** (até 100 MB) na seção Artes; a URL pública da API é enviada ao Buffer como asset `video` com `metadata.instagram.type = reel`.

No admin: filtro **Reels**, prévia 9:16 com player de vídeo, e programação como os demais (após aprovação e com arte de vídeo).

## Plano Buffer

No plano gratuito, limites de posts agendados por canal e de recursos como primeiro comentário podem bloquear a API — a mensagem de erro do Buffer é repassada à UI.

## Rota no admin

`/m/marketing/redes-sociais`