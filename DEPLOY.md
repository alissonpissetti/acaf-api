# Deploy da `acaf-api`

A API roda em **Docker (Coolify)**. O `Dockerfile` na raiz faz `npm ci`, `npm run build` e inicia com `node dist/main.js` na porta **8787**.

## Atualizar produção (hoje)

1. Confirme que `main` no repositório da API contém o commit com exclusão definitiva de landing pages (`removed: true` no DELETE).
2. No **Coolify** (ou painel que builda este Dockerfile), abra o serviço da API e dispare **Redeploy** / **Rebuild** a partir de `main` (não basta só `git push` se o host não faz auto-deploy).
3. Aguarde o healthcheck em `/test` ficar verde.
4. Valide: `DELETE /api/admin/marketing/landing-pages/:id?force=1` deve retornar `{ "ok": true, "removed": true }`.

## Desenvolvimento local (admin apontando para API local)

```bash
cd acaf-api
cp .env.example .env   # DATABASE_URL etc.
npm install
npm run start:dev      # porta padrão 8787
```

No `acaf-adm`, crie `.env.local`:

```env
VITE_API_URL=http://localhost:8787
```

Suba o adm com `npm run dev`. O admin usará a API local com o código mais recente.

## Emergência: exclusão definitiva sem redeploy

Enquanto produção ainda estiver na API antiga, use o script (com cuidado — aponta para o banco configurado em `DATABASE_URL`):

```bash
cd acaf-api
DATABASE_URL='mysql://...' npm run force-delete-landing-page -- <uuid-ou-slug>
```

O script remove envios, eventos e o registro da landing page (mesma lógica SQL do fallback do serviço).
