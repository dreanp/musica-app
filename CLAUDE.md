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
| Código | **GitHub** | Monorepo (pnpm workspaces) |

### Regras de arquitetura

1. **O áudio nunca passa pelo Railway.** O backend só gera o `.m3u8` (texto) com URLs assinadas;
   o player baixa os segmentos direto do R2/CDN da Cloudflare (sem custo de egress, menor latência).
2. **O frontend só fala com a API**, nunca direto com o storage. A API decide a URL de cada arquivo
   (facilita a migração para o servidor caseiro).
3. **Storage atrás de uma interface** (`StorageProvider`) usando a **API S3**. No servidor caseiro:
   Garage ou SeaweedFS (compatíveis com S3), trocando só variáveis de ambiente.
4. **O player só LÊ do banco.** Playlists, curtidas e biblioteca no Supabase são a fonte da verdade;
   o stream HLS é temporário e descartável. Nenhum bug de reprodução pode alterar playlists.

## Reprodução no iPhone (ponto crítico)

- Problema conhecido: em PWA da tela inicial, o iOS costuma **não passar para a próxima faixa
  com a tela travada** quando o JS troca o `src` do `<audio>` (JS fica suspenso). iOS 26 tem
  regressões adicionais de áudio em PWA.
- **Abordagem escolhida: fila tocada como um stream HLS contínuo.** O backend gera um `.m3u8`
  com os segmentos de todas as faixas da fila (com `#EXT-X-DISCONTINUITY` entre faixas). A troca
  de faixa acontece dentro do player nativo do iOS, sem depender de JS.
- Junto com o stream, o backend devolve um **mapa da fila** (tempo de início de cada faixa no stream)
  para o app saber qual música está tocando (curtir a faixa certa, mostrar título/capa).
- Editar a fila com o app aberto → gera novo stream a partir da faixa/segundo atual.
- Possível defeito cosmético: título/capa na tela de bloqueio (Media Session API) podem ficar
  desatualizados com a tela travada até o app voltar ao foco. **Validar no protótipo.**
- Planos B, se o iOS não colaborar: (a) empacotar com Capacitor e instalar só no próprio iPhone
  (sem loja); (b) implementar a API Subsonic no backend e usar apps nativos como o Amperfy.

## Formato de áudio

- Distribuição: **AAC 256 kbps** (melhor compatibilidade com iPhone), segmentado para HLS.
- Original (opcional): FLAC/MP3 guardado à parte; o servidor converte.
- Referência: ~60–80 MB por álbum em AAC 256. R2 free = 10 GB; acima disso US$ 0,015/GB/mês.
- Não guardar áudio no armazenamento do celular (sem download offline, sem áudio no Cache Storage).
  O PWA faz cache só do app (HTML/JS/CSS) e das capas.

## Funcionalidades planejadas

- Cadastro, login, senha (Supabase Auth) + Cloudflare Turnstile no cadastro/login
- Curtir músicas ("Músicas Curtidas" automática)
- Playlists: criar, renomear, excluir, adicionar/remover faixas, reordenar arrastando
- Biblioteca (artistas, álbuns), busca, tocadas recentemente
- Fila, shuffle, repeat, progresso, volume, controles na tela de bloqueio
- Tela de admin para upload: original → R2 → job no Railway converte/segmenta/lê tags → cadastra no Supabase

### Tabelas (rascunho)

`artists`, `albums`, `tracks`, `track_segments` (ou metadados do HLS), `likes`, `playlists`,
`playlist_tracks` (com `position`), `play_history`. Usuários via `auth.users` do Supabase.

## Estrutura do repositório

```
musica-app/
├── apps/
│   ├── web/        → Vercel (Vite + React PWA)
│   └── api/        → Railway (Fastify + ffmpeg, Dockerfile)
├── packages/
│   └── shared/     → tipos e utilitários comuns (Track, Playlist, QueueMap...)
├── supabase/       → migrations e políticas RLS
└── CLAUDE.md       → este arquivo
```

## Fases

0. **[PRÓXIMO] Protótipo de validação no iPhone**: monorepo, endpoint que gera HLS, script que
   segmenta 3 músicas e sobe para o R2, página mínima com play/próxima. Teste com tela travada
   (troca de faixa + tela de bloqueio). Comparar abordagem simples vs. HLS.
1. Importador (upload + ffmpeg + tags) + API + player básico
2. Interface completa: navegação, álbuns, artistas, fila, busca
3. Auth, curtidas e playlists
4. PWA instalável, Media Session, pré-carregamento, polimento visual

## Diário de decisões

- 2026-11-11 — Projeto iniciado. Stack: Vercel + Railway + Supabase + Cloudflare R2, monorepo no GitHub.
- 2026-11-11 — Reprodução via HLS contínuo por causa das limitações do iOS em PWA.
- 2026-11-11 — Áudio em AAC 256 kbps; áudio nunca trafega pelo Railway.

## Status atual

- [ ] Fase 0 — protótipo de validação no iPhone
