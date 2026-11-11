import type { QueueEntry, QueueMap, TrackManifest } from './types.ts';

export interface BuildQueueOptions {
  /** segundos a pular na primeira faixa (retomar do ponto atual ao editar a fila) */
  startOffset?: number;
}

/**
 * Monta um único .m3u8 VOD com todas as faixas da fila em sequência,
 * separadas por #EXT-X-DISCONTINUITY. Assim o player nativo do iOS troca
 * de faixa sozinho, sem depender de JavaScript (que fica suspenso com a tela travada).
 */
export async function buildQueuePlaylist(
  tracks: TrackManifest[],
  signUrl: (key: string) => Promise<string>,
  opts: BuildQueueOptions = {},
): Promise<{ m3u8: string; map: QueueMap }> {
  const body: string[] = [];
  const entries: QueueEntry[] = [];
  let t = 0;
  let maxSeg = 1;

  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i];
    let segments = track.segments;
    let skipped = 0;

    if (i === 0 && opts.startOffset && opts.startOffset > 0) {
      let k = 0;
      while (k < segments.length && skipped + segments[k].duration <= opts.startOffset) {
        skipped += segments[k].duration;
        k++;
      }
      segments = segments.slice(k);
    }
    if (segments.length === 0) continue;

    if (body.length > 0) body.push('#EXT-X-DISCONTINUITY');
    const start = t;
    const urls = await Promise.all(segments.map((s) => signUrl(s.key)));
    segments.forEach((seg, k) => {
      body.push(`#EXTINF:${seg.duration.toFixed(6)},`);
      body.push(urls[k]);
      t += seg.duration;
      maxSeg = Math.max(maxSeg, seg.duration);
    });

    entries.push({
      index: entries.length,
      trackId: track.id,
      title: track.title,
      artist: track.artist,
      album: track.album,
      hasCover: Boolean(track.coverKey),
      start: round(start),
      duration: round(t - start),
      skipped: round(skipped),
    });
  }

  const m3u8 = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-PLAYLIST-TYPE:VOD',
    `#EXT-X-TARGETDURATION:${Math.ceil(maxSeg)}`,
    '#EXT-X-MEDIA-SEQUENCE:0',
    ...body,
    '#EXT-X-ENDLIST',
    '',
  ].join('\n');

  return { m3u8, map: { totalDuration: round(t), entries } };
}

/** Qual faixa está tocando no segundo `time` do stream. */
export function entryAt(map: QueueMap, time: number): QueueEntry | null {
  let found: QueueEntry | null = null;
  for (const e of map.entries) {
    if (e.start <= time + 0.05) found = e;
    else break;
  }
  return found;
}

/** Lê um media playlist (.m3u8) gerado pelo ffmpeg: duração + nome de cada segmento. */
export function parseMediaPlaylist(text: string): { duration: number; uri: string }[] {
  const out: { duration: number; uri: string }[] = [];
  let pending: number | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('#EXTINF:')) {
      pending = parseFloat(line.slice(8));
    } else if (line && !line.startsWith('#') && pending !== null) {
      out.push({ duration: pending, uri: line });
      pending = null;
    }
  }
  return out;
}

const round = (n: number) => Math.round(n * 1000) / 1000;
