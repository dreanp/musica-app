/**
 * Importação pela linha de comando (opcional — o normal é pela tela "Importar" da página).
 *   pnpm ingest /caminho/faixa1.mp3 /caminho/faixa2.flac
 */
import { env } from './config.ts';
import { resolve } from 'node:path';
import type { CatalogTrack } from '@musica/shared';
import { createStorage } from './storage.ts';
import { addToCatalog, ingestFile } from './importer.ts';

const files = process.argv.slice(2).map((f) => resolve(f));
if (files.length === 0) {
  console.error('Uso: pnpm ingest <arquivo1.mp3> [arquivo2.flac ...]');
  process.exit(1);
}

const storage = await createStorage();
console.log(`Storage: ${storage.kind}${storage.kind === 'local' ? ` (${env.localDir})` : ` (bucket ${env.s3.bucket})`}`);

const done: CatalogTrack[] = [];
let failures = 0;
for (const file of files) {
  try {
    done.push(await ingestFile(file, storage));
  } catch (err) {
    failures++;
    console.error(`✘ ${file}: ${(err as Error).message}`);
  }
}
const catalog = await addToCatalog(storage, done);
console.log(`Catálogo: ${catalog.tracks.length} faixa(s).`);
process.exit(failures ? 1 : 0);
