import { useSyncExternalStore } from 'react';

// Log persistente: depois de destravar o iPhone dá para ver o que aconteceu com a tela travada.
const KEY = 'proto-log';
let lines: string[] = JSON.parse(localStorage.getItem(KEY) ?? '[]');
const listeners = new Set<() => void>();

export function log(msg: string) {
  const d = new Date();
  const ts = d.toLocaleTimeString('pt-BR', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
  lines = [...lines, `${ts}  ${msg}`].slice(-400);
  try {
    localStorage.setItem(KEY, JSON.stringify(lines));
  } catch {
    /* sem espaço */
  }
  listeners.forEach((l) => l());
}

export function clearLog() {
  lines = [];
  localStorage.removeItem(KEY);
  listeners.forEach((l) => l());
}

export const useLog = () =>
  useSyncExternalStore(
    (cb) => (listeners.add(cb), () => listeners.delete(cb)),
    () => lines,
  );
