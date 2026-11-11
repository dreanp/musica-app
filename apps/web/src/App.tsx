import { useEffect, useRef, useState } from 'react';
import { entryAt, type Catalog, type CatalogTrack, type QueueMap } from '@musica/shared';
import { API, apiUrl, getJson, getToken, setToken } from './api.ts';
import { clearLog, log, useLog } from './log.ts';
import Importer from './Importer.tsx';

type Mode = 'hls' | 'simple';

const fmt = (s: number) => {
  if (!Number.isFinite(s) || s < 0) s = 0;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

export default function App() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [token, setTokenState] = useState(getToken());
  const [catalog, setCatalog] = useState<CatalogTrack[]>([]);
  const [queue, setQueue] = useState<string[]>([]);
  const [mode, setMode] = useState<Mode>('hls');
  const [map, setMap] = useState<QueueMap | null>(null);
  const [current, setCurrent] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [error, setError] = useState('');
  const logLines = useLog();

  // estado mais recente para os handlers de eventos (registrados uma vez só)
  const s = useRef({ mode, map, current, queue, catalog });
  s.current = { mode, map, current, queue, catalog };

  const trackById = (id: string) => s.current.catalog.find((t) => t.id === id);
  const hlsSupport = typeof document !== 'undefined' ? document.createElement('audio').canPlayType('application/vnd.apple.mpegurl') : '';

  async function loadCatalog() {
    setError('');
    try {
      const c = await getJson<Catalog>('/tracks');
      setCatalog(c.tracks);
      setQueue((q) => (q.length ? q.filter((id) => c.tracks.some((t) => t.id === id)) : c.tracks.map((t) => t.id)));
      log(`catálogo: ${c.tracks.length} faixa(s)`);
    } catch (e) {
      setError(`Falha ao carregar ${API}/tracks: ${(e as Error).message}`);
    }
  }
  useEffect(() => {
    loadCatalog();
  }, []);

  // ---------- Media Session (tela de bloqueio) ----------
  function updateMediaSession(id: string, duration?: number, position?: number) {
    const t = trackById(id);
    if (!t || !('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title,
      artist: t.artist,
      album: t.album ?? '',
      artwork: t.hasCover ? [{ src: apiUrl(`/tracks/${t.id}/cover`), sizes: '600x600', type: 'image/jpeg' }] : [],
    });
    if (duration && navigator.mediaSession.setPositionState) {
      try {
        navigator.mediaSession.setPositionState({
          duration,
          position: Math.min(Math.max(position ?? 0, 0), duration),
          playbackRate: 1,
        });
      } catch {
        /* ignore */
      }
    }
  }

  // ---------- modo HLS: a fila inteira é um stream só ----------
  async function playHls(fromIndex = 0) {
    const audio = audioRef.current!;
    const ids = s.current.queue;
    if (!ids.length) return;
    setMode('hls');
    setError('');
    try {
      const qs = `ids=${ids.join(',')}`;
      const m = await getJson<QueueMap>(`/queue?${qs}`);
      setMap(m);
      s.current.map = m;
      s.current.mode = 'hls';
      setCurrent(-1);
      s.current.current = -1;
      audio.src = apiUrl(`/queue.m3u8?${qs}`);
      log(`HLS: fila com ${m.entries.length} faixa(s), ${fmt(m.totalDuration)} no total`);
      const start = m.entries[fromIndex]?.start ?? 0;
      if (start > 0) {
        audio.addEventListener('loadedmetadata', () => (audio.currentTime = start), { once: true });
      }
      await audio.play();
    } catch (e) {
      setError(`HLS: ${(e as Error).message}`);
      log(`ERRO HLS: ${(e as Error).message}`);
    }
  }

  // ---------- modo simples: troca o src a cada faixa (o que costuma falhar no iOS) ----------
  async function playSimple(index: number) {
    const audio = audioRef.current!;
    const id = s.current.queue[index];
    if (!id) return;
    setMode('simple');
    s.current.mode = 'simple';
    setMap(null);
    s.current.map = null;
    setCurrent(index);
    s.current.current = index;
    audio.src = apiUrl(`/tracks/${id}/full`);
    log(`SIMPLES: tocando #${index + 1} ${trackById(id)?.title ?? id} (visível=${document.visibilityState})`);
    updateMediaSession(id);
    try {
      await audio.play();
    } catch (e) {
      log(`ERRO play() simples: ${(e as Error).message}`);
    }
  }

  function next() {
    const { mode, map, current, queue } = s.current;
    const audio = audioRef.current!;
    if (mode === 'simple') {
      if (current + 1 < queue.length) playSimple(current + 1);
    } else if (map) {
      const e = map.entries[current + 1];
      if (e) audio.currentTime = e.start;
    }
  }

  function prev() {
    const { mode, map, current } = s.current;
    const audio = audioRef.current!;
    if (mode === 'simple') {
      if (audio.currentTime > 3 || current <= 0) audio.currentTime = 0;
      else playSimple(current - 1);
    } else if (map && current >= 0) {
      const e = map.entries[current];
      const target = audio.currentTime - e.start > 3 || current === 0 ? e : map.entries[current - 1];
      audio.currentTime = target.start;
    }
  }

  function toggle() {
    const audio = audioRef.current!;
    if (!audio.src) return void (s.current.mode === 'simple' ? playSimple(0) : playHls(0));
    if (audio.paused) audio.play();
    else audio.pause();
  }

  // ---------- eventos do <audio> e do sistema ----------
  useEffect(() => {
    const audio = audioRef.current!;
    const vis = () => document.visibilityState;

    const onTime = () => {
      setTime(audio.currentTime);
      const { mode, map, current } = s.current;
      if (mode !== 'hls' || !map) return;
      const e = entryAt(map, audio.currentTime);
      if (e && e.index !== current) {
        s.current.current = e.index;
        setCurrent(e.index);
        log(`HLS: faixa #${e.index + 1} "${e.title}" detectada em ${fmt(audio.currentTime)} do stream (início real ${fmt(e.start)}, atraso ${(audio.currentTime - e.start).toFixed(1)} s, visível=${vis()})`);
        updateMediaSession(e.trackId, e.duration, audio.currentTime - e.start);
      }
    };
    const onEnded = () => {
      log(`evento ended (modo ${s.current.mode}, visível=${vis()})`);
      if (s.current.mode === 'simple') next();
    };
    const simple = (name: string) => () => log(`evento ${name} @ ${fmt(audio.currentTime)} (visível=${vis()})`);
    const onPlay = () => (setPlaying(true), log(`evento play @ ${fmt(audio.currentTime)}`));
    const onPause = () => (setPlaying(false), log(`evento pause @ ${fmt(audio.currentTime)} (visível=${vis()})`));
    const onError = () => log(`evento error: código ${audio.error?.code} ${audio.error?.message ?? ''}`);
    const onVisibility = () => {
      const { map } = s.current;
      const e = map ? entryAt(map, audio.currentTime) : null;
      log(`app ${vis() === 'visible' ? 'VOLTOU' : 'saiu de foco'} @ ${fmt(audio.currentTime)}${e ? ` (tocando #${e.index + 1} "${e.title}")` : ''}`);
      onTime();
    };

    const handlers: [string, EventListener][] = [
      ['timeupdate', onTime],
      ['ended', onEnded],
      ['play', onPlay],
      ['pause', onPause],
      ['error', onError],
      ['waiting', simple('waiting')],
      ['stalled', simple('stalled')],
      ['seeked', simple('seeked')],
    ];
    handlers.forEach(([n, h]) => audio.addEventListener(n, h));
    document.addEventListener('visibilitychange', onVisibility);

    if ('mediaSession' in navigator) {
      const ms = navigator.mediaSession;
      ms.setActionHandler('play', () => (log('tela de bloqueio: play'), audio.play()));
      ms.setActionHandler('pause', () => (log('tela de bloqueio: pause'), audio.pause()));
      ms.setActionHandler('nexttrack', () => (log('tela de bloqueio: próxima'), next()));
      ms.setActionHandler('previoustrack', () => (log('tela de bloqueio: anterior'), prev()));
    }
    log(`app aberto · standalone=${(navigator as any).standalone === true || matchMedia('(display-mode: standalone)').matches} · HLS nativo="${hlsSupport}"`);

    return () => {
      handlers.forEach(([n, h]) => audio.removeEventListener(n, h));
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // ---------- fila ----------
  const move = (i: number, d: number) =>
    setQueue((q) => {
      const j = i + d;
      if (j < 0 || j >= q.length) return q;
      const c = [...q];
      [c[i], c[j]] = [c[j], c[i]];
      return c;
    });
  const remove = (i: number) => setQueue((q) => q.filter((_, k) => k !== i));
  const add = (id: string) => setQueue((q) => [...q, id]);

  const currentId = mode === 'hls' ? map?.entries[current]?.trackId : queue[current];
  const currentTrack = currentId ? trackById(currentId) : undefined;
  const entry = mode === 'hls' ? map?.entries[current] : undefined;
  const pos = entry ? time - entry.start + entry.skipped : time;
  const dur = entry ? entry.duration + entry.skipped : currentTrack?.duration ?? 0;

  return (
    <div className="app">
      <header>
        <h1>Música <span>protótipo · fase 0</span></h1>
        <div className="token">
          <input
            type="password"
            placeholder="token do protótipo"
            value={token}
            onChange={(e) => setTokenState(e.target.value)}
          />
          <button onClick={() => (setToken(token), loadCatalog())}>Salvar</button>
        </div>
        <small>API: {API} · HLS nativo: {hlsSupport || 'não'}</small>
        {error && <p className="error">{error}</p>}
      </header>

      <section className="modes">
        <button className={mode === 'hls' ? 'primary' : ''} onClick={() => playHls(0)} disabled={!queue.length}>
          ▶ Tocar fila — HLS contínuo
        </button>
        <button className={mode === 'simple' ? 'primary' : ''} onClick={() => playSimple(0)} disabled={!queue.length}>
          ▶ Tocar fila — modo simples
        </button>
      </section>

      <section>
        <h2>Fila ({queue.length})</h2>
        <ol className="queue">
          {queue.map((id, i) => {
            const t = trackById(id);
            const active = i === current;
            return (
              <li key={`${id}-${i}`} className={active ? 'active' : ''}>
                <button className="track" onClick={() => (mode === 'simple' ? playSimple(i) : playHls(i))}>
                  {t?.hasCover ? <img src={apiUrl(`/tracks/${id}/cover`)} alt="" /> : <div className="nocover" />}
                  <span>
                    <b>{t?.title ?? id}</b>
                    <small>{t?.artist} · {fmt(t?.duration ?? 0)}</small>
                  </span>
                </button>
                <span className="ops">
                  <button onClick={() => move(i, -1)}>↑</button>
                  <button onClick={() => move(i, 1)}>↓</button>
                  <button onClick={() => remove(i)}>✕</button>
                </span>
              </li>
            );
          })}
        </ol>
        {catalog.some((t) => !queue.includes(t.id)) && (
          <div className="add">
            Adicionar:{' '}
            {catalog
              .filter((t) => !queue.includes(t.id))
              .map((t) => (
                <button key={t.id} onClick={() => add(t.id)}>+ {t.title}</button>
              ))}
          </div>
        )}
        <p className="hint">Mudou a fila? Toque de novo em "Tocar fila" para gerar o stream novo.</p>
      </section>

      <Importer onDone={loadCatalog} />

      <section>
        <h2>
          Log <button onClick={clearLog}>limpar</button>
        </h2>
        <pre className="log">{[...logLines].reverse().join('\n')}</pre>
      </section>

      <footer className="player">
        <div className="now">
          <b>{currentTrack?.title ?? '—'}</b>
          <small>
            {currentTrack?.artist ?? ''} · {fmt(pos)} / {fmt(dur)} · {mode === 'hls' ? 'HLS' : 'simples'}
          </small>
        </div>
        <div className="controls">
          <button onClick={prev}>⏮</button>
          <button className="play" onClick={toggle}>{playing ? '⏸' : '▶'}</button>
          <button onClick={next}>⏭</button>
        </div>
        <audio ref={audioRef} preload="auto" playsInline />
      </footer>
    </div>
  );
}
