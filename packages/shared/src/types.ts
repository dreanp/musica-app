/** Um segmento HLS de uma faixa, guardado no storage. */
export interface Segment {
  key: string;
  duration: number;
}

/** Manifesto de uma faixa: tracks/<id>/manifest.json no storage. */
export interface TrackManifest {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  duration: number;
  bitrateKbps: number;
  segments: Segment[];
  fullKey: string | null;
  coverKey: string | null;
  createdAt: string;
}

/** Item do catálogo (catalog.json). Na Fase 1 isso vai para o Supabase. */
export interface CatalogTrack {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  duration: number;
  hasCover: boolean;
}

export interface Catalog {
  updatedAt: string;
  tracks: CatalogTrack[];
}

/** Onde cada faixa começa dentro do stream contínuo da fila. */
export interface QueueEntry {
  index: number;
  trackId: string;
  title: string;
  artist: string;
  album: string | null;
  hasCover: boolean;
  /** segundo do stream em que a faixa começa */
  start: number;
  /** duração da faixa dentro do stream */
  duration: number;
  /** segundos da faixa que ficaram de fora (quando a fila começa no meio dela) */
  skipped: number;
}

export interface QueueMap {
  totalDuration: number;
  entries: QueueEntry[];
}
