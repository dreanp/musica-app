import { env } from './config.ts';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { buildQueuePlaylist, type Catalog, type TrackManifest } from '@musica/shared';
import { createStorage } from './storage.ts';
import { addToCatalog, ingestFile } from './importer.ts';

const storage = await createStorage();
const app = Fastify({ logger: true });

await app.register(cors, {
  origin: env.corsOrigin === '*' ? true : env.corsOrigin.split(',').map((s) => s.trim()),
});

await app.register(multipart, { limits: { fileSize: 500 * 1024 * 1024, files: 50 } });

// Só no desenvolvimento: serve a pasta local como se fosse o "R2" (com suporte a Range).
if (storage.kind === 'local') {
  const fastifyStatic = (await import('@fastify/static')).default;
  await app.register(fastifyStatic, { root: resolve(process.cwd(), env.localDir), prefix: '/local-files/' });
}

// Proteção simples do protótipo (até o login da Fase 3).
app.addHook('onRequest', async (req, reply) => {
  if (!env.protoToken || req.method === 'OPTIONS') return;
  const path = req.url.split('?')[0];
  if (path === '/health' || path.startsWith('/local-files/')) return;
  const token = (req.query as Record<string, string> | undefined)?.k ?? req.headers['x-proto-token'];
  if (token !== env.protoToken) return reply.code(401).send({ error: 'token inválido' });
});

// ---------- leitura de catálogo/manifestos (cache curto em memória) ----------
const cache = new Map<string, { at: number; value: unknown }>();
async function cachedJson<T>(key: string, ttlMs: number): Promise<T | null> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  const text = await storage.getText(key);
  if (text === null) return null;
  const value = JSON.parse(text) as T;
  cache.set(key, { at: Date.now(), value });
  return value;
}

const ID_RE = /^[a-z0-9-]{1,100}$/;
const getManifest = (id: string) =>
  ID_RE.test(id) ? cachedJson<TrackManifest>(`tracks/${id}/manifest.json`, 60_000) : Promise.resolve(null);

function parseIds(raw: unknown): string[] {
  return String(raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 200);
}

async function buildQueue(query: Record<string, string>) {
  const ids = parseIds(query.ids);
  if (ids.length === 0) return { error: 'informe ?ids=a,b,c' as const };
  const manifests = await Promise.all(ids.map(getManifest));
  const missing = ids.filter((_, i) => !manifests[i]);
  if (missing.length) return { error: `faixas não encontradas: ${missing.join(', ')}` };
  return buildQueuePlaylist(manifests as TrackManifest[], (key) => storage.urlFor(key), {
    startOffset: Number(query.offset ?? 0) || 0,
  });
}

// ---------- rotas ----------
app.get('/health', async () => ({ ok: true, storage: storage.kind }));

app.get('/tracks', async () => {
  const catalog = await cachedJson<Catalog>('catalog.json', 10_000);
  return catalog ?? { updatedAt: null, tracks: [] };
});

/** Mapa da fila: onde cada faixa começa no stream (o app usa para saber o que está tocando). */
app.get('/queue', async (req, reply) => {
  const result = await buildQueue(req.query as Record<string, string>);
  if ('error' in result) return reply.code(400).send(result);
  return result.map;
});

/** A fila inteira como UM stream HLS contínuo. O áudio em si vem direto do R2. */
app.get('/queue.m3u8', async (req, reply) => {
  const result = await buildQueue(req.query as Record<string, string>);
  if ('error' in result) return reply.code(400).send(result);
  return reply
    .header('content-type', 'application/vnd.apple.mpegurl')
    .header('cache-control', 'no-store')
    .send(result.m3u8);
});

/** Modo "simples" (comparação): arquivo inteiro da faixa, via redirect para o storage. */
app.get('/tracks/:id/full', async (req, reply) => {
  const m = await getManifest((req.params as { id: string }).id);
  if (!m?.fullKey) return reply.code(404).send({ error: 'não encontrada' });
  return reply.header('cache-control', 'no-store').redirect(await storage.urlFor(m.fullKey), 302);
});

app.get('/tracks/:id/cover', async (req, reply) => {
  const m = await getManifest((req.params as { id: string }).id);
  if (!m?.coverKey) return reply.code(404).send({ error: 'sem capa' });
  return reply.header('cache-control', 'private, max-age=3600').redirect(await storage.urlFor(m.coverKey), 302);
});

// ---------- importação (upload pela página; o servidor converte com ffmpeg) ----------
interface ImportItem {
  name: string;
  status: 'aguardando' | 'convertendo' | 'ok' | 'erro';
  message?: string;
  trackId?: string;
}
interface ImportJob {
  id: string;
  createdAt: number;
  done: boolean;
  items: ImportItem[];
}
const jobs = new Map<string, ImportJob>();

app.post('/import', async (req, reply) => {
  const dir = await mkdtemp(join(tmpdir(), 'upload-'));
  const files: { path: string; name: string }[] = [];
  try {
    for await (const part of req.files()) {
      const path = join(dir, `${files.length}${extname(part.filename).toLowerCase()}`);
      await pipeline(part.file, createWriteStream(path));
      if (part.file.truncated) throw new Error(`${part.filename}: arquivo maior que 500 MB`);
      files.push({ path, name: part.filename });
    }
  } catch (err) {
    await rm(dir, { recursive: true, force: true });
    return reply.code(400).send({ error: (err as Error).message });
  }
  if (!files.length) {
    await rm(dir, { recursive: true, force: true });
    return reply.code(400).send({ error: 'nenhum arquivo enviado' });
  }

  const job: ImportJob = {
    id: randomUUID(),
    createdAt: Date.now(),
    done: false,
    items: files.map((f) => ({ name: f.name, status: 'aguardando' })),
  };
  jobs.set(job.id, job);

  // processa em segundo plano, uma faixa por vez (ffmpeg usa bastante CPU)
  (async () => {
    for (let i = 0; i < files.length; i++) {
      const item = job.items[i];
      item.status = 'convertendo';
      try {
        const track = await ingestFile(files[i].path, storage, files[i].name);
        await addToCatalog(storage, [track]);
        cache.delete('catalog.json');
        cache.delete(`tracks/${track.id}/manifest.json`);
        item.status = 'ok';
        item.trackId = track.id;
        item.message = `${track.artist} — ${track.title}`;
      } catch (err) {
        item.status = 'erro';
        item.message = (err as Error).message;
        req.log.error(err, `importação falhou: ${files[i].name}`);
      }
    }
    job.done = true;
    await rm(dir, { recursive: true, force: true });
  })();

  // limpa jobs com mais de 1 dia
  for (const [id, j] of jobs) if (Date.now() - j.createdAt > 86_400_000) jobs.delete(id);
  return reply.code(202).send(job);
});

app.get('/import/:id', async (req, reply) => {
  const job = jobs.get((req.params as { id: string }).id);
  return job ?? reply.code(404).send({ error: 'importação não encontrada' });
});

await app.listen({ port: env.port, host: '0.0.0.0' });
