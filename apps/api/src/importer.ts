/**
 * Importação de faixas: converte para AAC 256 kbps, segmenta em HLS (MPEG-TS, ~6 s),
 * extrai tags e capa e sobe tudo para o storage. Roda no servidor (Railway tem ffmpeg).
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { promisify } from 'node:util';
import { parseMediaPlaylist, type Catalog, type CatalogTrack, type TrackManifest } from '@musica/shared';
import type { StorageProvider } from './storage.ts';

const run = promisify(execFile);
const BITRATE_KBPS = 256;
const SEGMENT_SECONDS = 6;
const IMMUTABLE = 'public, max-age=31536000, immutable';

const slugify = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'faixa';

function tag(tags: Record<string, string>, name: string): string | undefined {
  const k = Object.keys(tags).find((t) => t.toLowerCase() === name);
  return k ? tags[k].trim() || undefined : undefined;
}

const ffmpeg = (args: string[]) =>
  run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { maxBuffer: 16 * 1024 * 1024 });

async function inParallel<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

export async function ingestFile(file: string, storage: StorageProvider, originalName?: string): Promise<CatalogTrack> {
  const { stdout } = await run('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', file]);
  const info = JSON.parse(stdout);
  const audio = info.streams?.find((s: any) => s.codec_type === 'audio');
  if (!audio) throw new Error('arquivo sem áudio');
  const tags = { ...(audio.tags ?? {}), ...(info.format?.tags ?? {}) };

  const title = tag(tags, 'title') ?? basename(originalName ?? file, extname(originalName ?? file));
  const artist = tag(tags, 'artist') ?? tag(tags, 'album_artist') ?? 'Artista desconhecido';
  const album = tag(tags, 'album') ?? null;
  const id = slugify(`${artist} ${title}`);
  // versão no caminho: reimportar não briga com cache de CDN
  const prefix = `tracks/${id}/${Date.now().toString(36)}`;

  const dir = await mkdtemp(join(tmpdir(), 'musica-'));
  try {
    const audioArgs = ['-map', '0:a:0', '-vn', '-c:a', 'aac', '-b:a', `${BITRATE_KBPS}k`, '-ar', '44100', '-ac', '2'];

    await ffmpeg([
      '-i', file, ...audioArgs,
      '-f', 'hls', '-hls_time', String(SEGMENT_SECONDS), '-hls_playlist_type', 'vod',
      '-hls_segment_type', 'mpegts', '-hls_segment_filename', join(dir, 'seg_%05d.ts'),
      join(dir, 'index.m3u8'),
    ]);
    await ffmpeg(['-i', file, ...audioArgs, '-movflags', '+faststart', join(dir, 'full.m4a')]);

    let coverKey: string | null = null;
    if (info.streams?.some((s: any) => s.codec_type === 'video')) {
      try {
        await ffmpeg([
          '-i', file, '-map', '0:v:0', '-an', '-frames:v', '1',
          '-vf', 'scale=600:600:force_original_aspect_ratio=decrease', join(dir, 'cover.jpg'),
        ]);
        coverKey = `${prefix}/cover.jpg`;
      } catch (err) {
        console.warn(`   capa não extraída: ${(err as Error).message}`);
      }
    }

    const parsed = parseMediaPlaylist(await readFile(join(dir, 'index.m3u8'), 'utf8'));
    await inParallel(parsed, 6, async (s) => {
      await storage.put(`${prefix}/${s.uri}`, await readFile(join(dir, s.uri)), 'video/mp2t', IMMUTABLE);
    });
    await storage.put(`${prefix}/full.m4a`, await readFile(join(dir, 'full.m4a')), 'audio/mp4', IMMUTABLE);
    if (coverKey) await storage.put(coverKey, await readFile(join(dir, 'cover.jpg')), 'image/jpeg', IMMUTABLE);

    const duration = Math.round(parsed.reduce((a, s) => a + s.duration, 0) * 1000) / 1000;
    const manifest: TrackManifest = {
      id, title, artist, album, duration,
      bitrateKbps: BITRATE_KBPS,
      segments: parsed.map((s) => ({ key: `${prefix}/${s.uri}`, duration: s.duration })),
      fullKey: `${prefix}/full.m4a`,
      coverKey,
      createdAt: new Date().toISOString(),
    };
    await storage.put(`tracks/${id}/manifest.json`, JSON.stringify(manifest, null, 2), 'application/json', 'no-cache');

    console.log(`✔ ${artist} — ${title}  (${id}, ${parsed.length} segmentos, ${duration.toFixed(1)} s${coverKey ? ', com capa' : ''})`);
    return { id, title, artist, album, duration, hasCover: Boolean(coverKey) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// Atualizações do catálogo em fila, uma de cada vez (evita duas importações sobrescreverem uma à outra).
let catalogLock: Promise<unknown> = Promise.resolve();
export function addToCatalog(storage: StorageProvider, tracks: CatalogTrack[]) {
  const job = catalogLock.then(async () => {
    const catalog: Catalog = JSON.parse((await storage.getText('catalog.json')) ?? '{"updatedAt":"","tracks":[]}');
    for (const t of tracks) catalog.tracks = [...catalog.tracks.filter((x) => x.id !== t.id), t];
    catalog.updatedAt = new Date().toISOString();
    await storage.put('catalog.json', JSON.stringify(catalog, null, 2), 'application/json', 'no-cache');
    return catalog;
  });
  catalogLock = job.catch(() => undefined);
  return job;
}
