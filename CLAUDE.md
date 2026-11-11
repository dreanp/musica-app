# Projeto: App de Música Pessoal (estilo Spotify)

> Documento de contexto do projeto. Mantenha atualizado a cada decisão importante.
> Serve para o Claude (chat, Projeto ou Claude Code) retomar o trabalho sem perder nada.

## Objetivo

App web de música **pessoal** (uso só do André), com interface no estilo dos players modernos
(barra lateral, biblioteca, player fixo embaixo, tema escuro), **identidade visual própria**
(não copiar nome, logo, cores ou telas do Spotify).

- Uso principal: **iPhone**, como PWA fixado na tela inicial (sem App Store).
- Conteúdo: **músicas próprias** do usuário, a princípio.
- Requisito crítico: **continuar tocando e passar de faixa com a tela travada**.
- Futuro: migrar o storage (e talvez o backend) para um **servidor caseiro**.

## Stack decidida

| Camada | Serviço | Papel |
|---|---|---|
| Frontend | **Vercel** | PWA em Vite + React (SPA; o player não pode recarregar entre telas) |
| Backend | **Railway** (plano pago) | API Node (Fastify) em **Docker** + **ffmpeg** (conversão, segmentação HLS, geração do `.m3u8`) |
| Banco + Auth | **Supabase** | Postgres + **Supabase Auth** (cadastro, login, confirmação de e-mail, recuperar senha, JWT) + RLS |
| Arquivos | **Cloudflare R2** | Áudios (segmentos HLS) e capas; acesso via URLs assinadas |
| Código | **GitHub** | Monorepo (pnpm workspaces) — `github.com/dreanp/musica-app`, branch `main` |

### Regras de arquitetura

1. **O áudio nunca passa pelo Railway na reprodução.** O backend só gera o `.m3u8` (texto) com URLs
   assinadas; o player baixa os segmentos direto do R2/CDN da Cloudflare (sem custo de egress, menor
   latência). Exceção aceita: na **importação** o arquivo original sobe uma vez para o Railway, que converte.
2. **O frontend só fala com a API**, nunca direto com o storage. A API decide a URL de cada arquivo
   (facilita a migração para o servidor caseiro).
3. **Storage atrás de uma interface** (`StorageProvider`) usando a **API S3**. No servidor caseiro:
   Garage ou SeaweedFS (compatíveis com S3), trocando só variáveis de ambiente.
4. **O player só LÊ do banco.** Playlists, curtidas e biblioteca no Supabase são a fonte da verdade;
   o stream HLS é temporário e descartável. Nenhum bug de reprodução pode alterar playlists.
5. **Nada precisa ser instalado no PC do André.** Build e conversão rodam no Railway/Vercel;
   o código é enviado pelo Claude direto para o GitHub.

## Reprodução no iPhone (ponto crítico)

- Problema conhecido: em PWA da tela inicial, o iOS costuma **não passar para a próxima faixa
  com a tela travada** quando o JS troca o `src` do `<audio>` (JS fica suspenso). iOS 26 tem
  regressões adicionais de áudio em PWA.
- **Abordagem escolhida: fila tocada como um stream HLS contínuo.** O backend gera um `.m3u8`
  com os segmentos de todas as faixas da fila (com `#EXT-X-DISCONTINUITY` entre faixas). A troca
  de faixa acontece dentro do player nativo do iOS, sem depender de JS.
- Junto com o stream, o backend devolve um **mapa da fila** (tempo de início de cada faixa no stream)
  para o app saber qual música está tocando (curtir a faixa certa, mostrar título/capa).
- Editar a fila com o app aberto → gera novo stream a partir da faixa/segundo atual
  (a API já aceita `offset`; a página da Fase 0 ainda reinicia do começo da fila).
- **O app precisa ser aberto pelo ícone da tela inicial, fora do modo anônimo.** Em aba anônima
  do Safari o iOS pausa o áudio ao travar a tela (confirmado no teste de 11/11).
- Possível defeito cosmético: título/capa na tela de bloqueio podem ficar desatualizados com a tela
  travada até o app voltar ao foco. **Ainda validar.**
- Planos B, se o iOS não colaborar: (a) empacotar com Capacitor e instalar só no próprio iPhone
  (sem loja); (b) implementar a API Subsonic no backend e usar apps nativos como o Amperfy.
- HLS nativo só existe no Safari. Para usar no Chrome/PC no futuro: adicionar **hls.js**.

## Formato de áudio

- Distribuição: **AAC 256 kbps**, 44,1 kHz estéreo, segmentado para HLS em **MPEG-TS de ~6 s**.
- Também gera `full.m4a` (arquivo inteiro) para o "modo simples" de comparação.
- Capa: extraída da tag embutida, 600×600 JPEG.
- Original não é guardado na Fase 0.
- Referência: ~60–80 MB por álbum em AAC 256. R2 free = 10 GB; acima disso US$ 0,015/GB/mês.
- Não guardar áudio no armazenamento do celular (sem download offline, sem áudio no Cache Storage).
  O PWA faz cache só do app (HTML/JS/CSS) e das capas.

### Layout no storage (R2, bucket `musica`)

```
catalog.json                          → lista de faixas (Fase 0; vai para o Supabase na Fase 1)
tracks/<id>/manifest.json             → título, artista, álbum, duração, segmentos, chaves
tracks/<id>/<versão>/seg_00000.ts…    → segmentos HLS
tracks/<id>/<versão>/full.m4a         → arquivo inteiro (modo simples)
tracks/<id>/<versão>/cover.jpg        → capa
```
`<id>` = slug de "artista título"; `<versão>` muda a cada reimportação (evita cache velho).

## Funcionalidades planejadas

- Cadastro, login, senha (Supabase Auth) + Cloudflare Turnstile no cadastro/login
- Curtir músicas ("Músicas Curtidas" automática)
- Playlists: criar, renomear, excluir, adicionar/remover faixas, reordenar arrastando
- Biblioteca (artistas, álbuns), busca, tocadas recentemente
- Fila, shuffle, repeat, progresso, volume, controles na tela de bloqueio
- Tela de admin para upload: original → Railway converte/segmenta/lê tags → R2 → cadastra no Supabase
  (versão inicial já existe na Fase 0: seção "Importar músicas")

### Tabelas (rascunho)

`artists`, `albums`, `tracks`, `track_segments` (ou metadados do HLS), `likes`, `playlists`,
`playlist_tracks` (com `position`), `play_history`. Usuários via `auth.users` do Supabase.

## Estrutura do repositório

```
musica-app/
├── apps/
│   ├── web/        → Vercel (Vite + React PWA) — App.tsx, Importer.tsx, log.ts, api.ts
│   └── api/        → Railway (Fastify + ffmpeg, Dockerfile) — server.ts, importer.ts, storage*.ts
├── packages/
│   └── shared/     → tipos e utilitários comuns (TrackManifest, QueueMap, buildQueuePlaylist...)
├── supabase/       → migrations e políticas RLS (vazio ainda)
├── FASE0.md        → passo a passo e checklist do teste no iPhone
└── CLAUDE.md       → este arquivo
```

### API (Fase 0)

| Rota | O que faz |
|---|---|
| `GET /health` | `{"ok":true,"storage":"s3"}` |
| `GET /tracks` | catálogo |
| `GET /queue?ids=a,b,c&offset=0` | mapa da fila (JSON) |
| `GET /queue.m3u8?ids=a,b,c&offset=0` | a fila como um stream HLS contínuo |
| `GET /tracks/:id/full` · `/cover` | redirect para URL assinada no R2 |
| `POST /import` (multipart) · `GET /import/:id` | importação em segundo plano + status |

Todas (menos `/health`) exigem `?k=<PROTO_TOKEN>` ou header `x-proto-token`.

## Infraestrutura no ar

| Parte | Onde | Endereço / detalhe |
|---|---|---|
| Página | Vercel, projeto `musica-app` | https://musica-app-dun.vercel.app |
| API | Railway, projeto `stunning-adaptation`, serviço `@musica/api`, região US East | https://musicaapi-production.up.railway.app |
| Arquivos | Cloudflare R2 | bucket `musica` (privado), token "musica-app" com Object Read & Write só nesse bucket |
| Código | GitHub | `dreanp/musica-app`, deploy automático da `main` no Railway e na Vercel |

**Railway** (configurado na tela, não depender do `railway.json`): sem Root Directory; Builder
**Dockerfile**, path `apps/api/Dockerfile`; Watch Paths vazio; Healthcheck `/health`; porta definida
pelo Railway (8080). Variáveis: `STORAGE_DRIVER=s3`, `S3_ENDPOINT`, `S3_BUCKET=musica`,
`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION=auto`, `S3_FORCE_PATH_STYLE=true`,
`PROTO_TOKEN`, `CORS_ORIGIN=https://musica-app-dun.vercel.app`, `SIGNED_URL_TTL=21600`.
(Os valores secretos ficam só no Railway — nunca no repositório nem no chat.)

**Vercel**: Root Directory `apps/web`, preset Vite, "Include files outside the root directory" ligado;
`apps/web/vercel.json` força **pnpm 9.15.0** (`npx --yes pnpm@9.15.0 ...`) — sem isso a Vercel usa
pnpm antigo e falha com `ERR_INVALID_THIS`. Variável: `VITE_API_URL=https://musicaapi-production.up.railway.app`.

**iPhone**: app adicionado à tela inicial a partir de uma aba **normal** do Safari; token salvo no app.

## Fases

0. **[EM ANDAMENTO] Protótipo de validação no iPhone** — infraestrutura no ar, importação funcionando,
   teste parcial feito (ver "Status atual").
1. Importador definitivo (Supabase no lugar do `catalog.json`) + API + player básico
2. Interface completa: navegação, álbuns, artistas, fila, busca
3. Auth, curtidas e playlists
4. PWA instalável, Media Session, pré-carregamento, polimento visual

## Diário de decisões

- 2026-11-11 — Projeto iniciado. Stack: Vercel + Railway + Supabase + Cloudflare R2, monorepo no GitHub.
- 2026-11-11 — Reprodução via HLS contínuo por causa das limitações do iOS em PWA.
- 2026-11-11 — Áudio em AAC 256 kbps; áudio nunca trafega pelo Railway na reprodução.
- 2026-11-11 — Segmentos HLS em MPEG-TS de ~6 s; também gera `full.m4a` para comparação (modo simples).
- 2026-11-11 — Fase 0 usa `catalog.json` no R2 como catálogo (Supabase só na Fase 1).
- 2026-11-11 — Protótipo protegido por uma senha simples (`PROTO_TOKEN`) até o login da Fase 3.
- 2026-11-11 — Importação pela página (upload → ffmpeg no Railway → R2). Nada instalado no PC.
- 2026-11-11 — GitHub vinculado ao Claude: o Claude faz commit/push direto em `dreanp/musica-app`.
- 2026-11-11 — Railway configurado pela tela (o `railway.json` está obsoleto e para de valer em 01/12/2026).
- 2026-11-11 — Vercel fixada em pnpm 9.15.0 via `apps/web/vercel.json`.
- 2026-11-11 — O app deve ser usado pelo ícone da tela inicial, fora do modo anônimo do Safari.

## Status atual (fim do dia 11/11/2026)

**Feito**
- [x] Monorepo no GitHub; API no Railway (`/health` ok com R2); página na Vercel; CORS ajustado.
- [x] Importação testada: álbum *The Dark Side of the Moon* (10 faixas, comprado pelo André, só para
      teste pessoal) convertido, com tags e capas no R2.
- [x] iPhone (pelo ícone da tela inicial): **continua tocando com a tela travada**, tela de bloqueio
      mostra o nome da música e os controles (avançar/voltar).
- [x] Descoberto: em aba anônima do Safari o áudio pausa ao travar (os dois modos); no PC (Chrome)
      o HLS não toca (só Safari tem HLS nativo) — esperado.

**Falta para fechar a Fase 0** (roteiro em `FASE0.md`, seção 6)
- [ ] Troca de faixa com a tela travada, **nos dois modos** (HLS vs. simples). Sugestão: fila com
      *Speak To Me* (0:58) seguida de *Breathe*, travar antes de acabar a primeira.
- [ ] O título/capa na tela de bloqueio troca sozinho para a faixa seguinte?
- [ ] Próxima/anterior na tela de bloqueio pulam para a faixa certa (no HLS)?
- [ ] Tocar 15–20 min travado sem parar.
- [ ] Anotar a versão do iOS e preencher a tabela de resultados do `FASE0.md`; mandar print do log.
- [ ] Decidir: seguir com HLS, ajustar, ou plano B.

**Pendências técnicas (pequenas)**
- [ ] Remover `railway.json` do repo (antes, limpar o campo "Railway Config File" na tela do Railway).
- [ ] Gerar e commitar `pnpm-lock.yaml` (precisa de um ambiente com acesso ao npm).
- [ ] Opcional: hls.js para tocar no Chrome/PC.
- [ ] URLs assinadas valem 6 h — fila mais longa precisa ser regenerada (tratar na Fase 1).
- [ ] Jobs de importação ficam na memória do servidor (se o Railway reiniciar no meio, reenviar).
