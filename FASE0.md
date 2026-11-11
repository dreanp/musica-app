# Fase 0 — Protótipo de validação no iPhone

Objetivo: descobrir se o iPhone **passa de faixa com a tela travada** num PWA da tela inicial,
comparando o **modo simples** (troca o `src` a cada música) com o **HLS contínuo** (a fila inteira
vira um stream só). Também observar a **tela de bloqueio** (título/capa e botões).

## O que tem no repositório

| Caminho | O que faz |
|---|---|
| `packages/shared/src/hls.ts` | Monta o `.m3u8` da fila (com `#EXT-X-DISCONTINUITY`) e o mapa da fila |
| `apps/api/src/importer.ts` | Importação: AAC 256 kbps, segmentos HLS de ~6 s, tags, capa → storage (roda no servidor) |
| `apps/api/src/server.ts` | API Fastify: `/tracks`, `/queue`, `/queue.m3u8`, `/tracks/:id/full`, `/tracks/:id/cover`, `/import` |
| `apps/api/src/storage*.ts` | `StorageProvider`: R2 (S3) ou pasta local para desenvolvimento |
| `apps/web/` | Página de teste (Vite + React): importar músicas, fila, dois modos de reprodução, log persistente |

No storage fica assim: `catalog.json`, `tracks/<id>/manifest.json` e `tracks/<id>/<versão>/seg_00000.ts…`,
`full.m4a`, `cover.jpg`. (Na Fase 1 o catálogo vai para o Supabase.)

---

**Nada precisa ser instalado no Windows.** O Railway e a Vercel instalam as dependências no deploy,
e a conversão das músicas (ffmpeg) roda no servidor do Railway.

## 1. GitHub

O código vai para `github.com/dreanp/musica-app` (pelo GitHub Desktop ou pelo Claude, se a conta estiver vinculada).

## 2. Cloudflare R2

1. Painel Cloudflare → **R2** → *Create bucket* → nome `musica`. **Não** deixe o bucket público.
2. R2 → **Manage R2 API Tokens** → *Create API token* → permissão **Object Read & Write**,
   restrito ao bucket `musica`. Guarde o *Access Key ID*, o *Secret* e o endpoint
   `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`.

## 3. Deploy da API no Railway

1. Railway → *New Project* → *Deploy from GitHub repo* → `musica-app`.
   O `railway.json` da raiz já manda usar `apps/api/Dockerfile` (com ffmpeg).
2. Em **Variables** (modelo em `apps/api/.env.example`):
   - `STORAGE_DRIVER` = `s3`
   - `S3_ENDPOINT`, `S3_BUCKET` = `musica`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (do passo 2)
   - `PROTO_TOKEN` = uma senha qualquer (protege o protótipo até termos login)
   - `CORS_ORIGIN` = `*` por enquanto (depois, a URL da Vercel)
3. *Settings* → *Networking* → **Generate Domain**. Teste `https://<domínio>/health` → `{"ok":true,"storage":"s3"}`.

## 4. Deploy da página na Vercel

1. Vercel → *Add New Project* → `musica-app` → **Root Directory: `apps/web`** (framework Vite).
2. Variável de ambiente: `VITE_API_URL` = URL do Railway (sem barra no final).
3. Deploy. Depois volte ao Railway e troque `CORS_ORIGIN` pela URL da Vercel.

## 5. Importar 3 músicas

Abra a URL da Vercel no navegador do PC, digite o `PROTO_TOKEN` → **Salvar**, e em
**Importar músicas** escolha 3 arquivos (MP3, FLAC, M4A, WAV…) → **Enviar e converter**.
Cada arquivo aparece com ✔ quando terminar, e a fila é atualizada. Escolha pelo menos uma faixa
curta (2–3 min) para o teste não demorar.

## 6. Teste no iPhone

1. Abra a URL da Vercel no **Safari** → Compartilhar → **Adicionar à Tela de Início**.
2. Abra pelo ícone, digite o `PROTO_TOKEN` e toque em **Salvar**. A fila aparece.
3. O topo deve mostrar `HLS nativo: maybe` (ou `probably`). O log mostra `standalone=true`.

Para cada modo, faça o roteiro abaixo (dica: coloque uma faixa curta em 1º lugar):

1. Toque em **Tocar fila** (HLS ou simples) e **trave a tela** ainda na 1ª faixa.
2. Espere a faixa acabar com a tela travada. **A próxima começou sozinha?**
3. Sem destravar, olhe a tela de bloqueio: **título/capa mudaram para a 2ª faixa?**
4. Na tela de bloqueio, use **próxima** e **anterior**. Funcionaram?
5. Destrave, abra o app e leia o **Log** (ele fica salvo): veja o "atraso" da detecção da faixa,
   eventos `ended`, `pause`, `stalled`, `error`.
6. Repita com o app em segundo plano (outro app aberto) em vez da tela travada.
7. Deixe tocar uns 15–20 min travado para ver se não para do nada.

### Anote os resultados

| Teste | Modo simples | HLS contínuo |
|---|---|---|
| Passa de faixa com a tela travada | | |
| Título/capa atualizam na tela de bloqueio | | |
| Próxima/anterior na tela de bloqueio | | |
| Passa de faixa com o app em 2º plano | | |
| Toca 20 min sem parar | | |
| Versão do iOS | | |

Com essa tabela preenchida a gente decide: seguir com HLS, ajustar (ex.: Media Session),
ou partir para um plano B (Capacitor ou Subsonic + Amperfy).

## Observações

- URLs assinadas valem 6 h (`SIGNED_URL_TTL`). Fila tocando mais que isso → gerar de novo (resolvido nas fases seguintes).
- Mudou a fila? Toque em "Tocar fila" de novo — por enquanto o stream começa do início da fila.
  O parâmetro `offset` já existe na API (`/queue.m3u8?ids=…&offset=42`) para retomar do ponto atual.
- Reimportar a mesma música gera uma nova "versão" de pasta no R2; as antigas podem ser apagadas à mão.
- Desenvolvimento local continua possível (`pnpm install`, `pnpm dev:api`, `pnpm dev:web`, com Node 22 e ffmpeg),
  mas não é necessário para a Fase 0.
- As importações em andamento ficam na memória do servidor: se o Railway reiniciar no meio, é só enviar de novo.
