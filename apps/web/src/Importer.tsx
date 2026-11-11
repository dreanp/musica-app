import { useState } from 'react';
import { apiUrl, getJson } from './api.ts';

interface ImportItem {
  name: string;
  status: 'aguardando' | 'convertendo' | 'ok' | 'erro';
  message?: string;
}
interface ImportJob {
  id: string;
  done: boolean;
  items: ImportItem[];
}

const ICON: Record<ImportItem['status'], string> = { aguardando: '⏳', convertendo: '⚙️', ok: '✔', erro: '✘' };

/** Envia as músicas para a API; o servidor converte com ffmpeg e sobe para o R2. */
export default function Importer({ onDone }: { onDone: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const [job, setJob] = useState<ImportJob | null>(null);
  const [error, setError] = useState('');

  function send() {
    if (!files.length) return;
    setError('');
    setJob(null);
    const form = new FormData();
    files.forEach((f) => form.append('files', f, f.name));

    const xhr = new XMLHttpRequest();
    xhr.open('POST', apiUrl('/import'));
    xhr.upload.onprogress = (e) => e.lengthComputable && setProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onerror = () => (setProgress(null), setError('Falha de rede no envio'));
    xhr.onload = () => {
      setProgress(null);
      if (xhr.status !== 202) return setError(`Erro ${xhr.status}: ${xhr.responseText}`);
      const j = JSON.parse(xhr.responseText) as ImportJob;
      setJob(j);
      setFiles([]);
      poll(j.id);
    };
    xhr.send(form);
  }

  async function poll(id: string) {
    try {
      const j = await getJson<ImportJob>(`/import/${id}`);
      setJob(j);
      if (!j.done) return void setTimeout(() => poll(id), 1500);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <section className="importer">
      <h2>Importar músicas</h2>
      <label className="picker">
        <input
          type="file"
          multiple
          accept="audio/*,.mp3,.flac,.m4a,.wav,.ogg,.aac"
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
        />
        {files.length ? `${files.length} arquivo(s) selecionado(s)` : 'Escolher arquivos de áudio…'}
      </label>
      <button className="primary" onClick={send} disabled={!files.length || progress !== null}>
        {progress !== null ? `Enviando… ${progress}%` : 'Enviar e converter'}
      </button>
      {error && <p className="error">{error}</p>}
      {job && (
        <ul className="jobs">
          {job.items.map((it, i) => (
            <li key={i} className={it.status}>
              {ICON[it.status]} {it.name}
              {it.message && <small> — {it.message}</small>}
            </li>
          ))}
          {job.done && <li><small>Importação concluída. Catálogo atualizado.</small></li>}
        </ul>
      )}
    </section>
  );
}
