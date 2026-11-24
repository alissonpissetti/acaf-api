# Artes locais do calendário de redes

Coloque os PNG/JPG/WebP aqui para o admin e o Buffer usarem — **sem Google Drive**.

## Estrutura

```text
storage/social-posts/assets/
  g01/
    G1.png
  p01/
    P01.png
  s01/
    S1-1.png
    S1-2.png
```

- A pasta é o **`id` do post no seed** (`g01`, `p01`, `s01`, …), em minúsculas.
- O arquivo pode usar o **`nome` da arte** no JSON (`G1`, `P01`, …) ou o `drive_id` como nome do arquivo.

Depois de copiar as imagens, sincronize:

```bash
# a partir de uma pasta plana (ex. ~/Documents/movly-artes)
node scripts/organize-social-post-assets.mjs /caminho/para/movly-artes
node scripts/sync-social-artes-local.mjs
```

Ou via API (com a API no ar):

```http
POST /api/admin/social-posts/artes/sync-local
```

As cópias servidas ficam em `storage/social-posts/files/` (pode ignorar no git).

A URL pública é `{API_PUBLIC_URL}/api/social-posts/media/{arteId}` — em produção defina `API_PUBLIC_URL` para o Buffer conseguir baixar a imagem.