import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { env } from './config.ts';

/**
 * Toda leitura/escrita de arquivos passa por aqui. Trocar R2 pelo servidor caseiro
 * (Garage/SeaweedFS, também S3) = trocar variáveis de ambiente.
 */
export interface StorageProvider {
  kind: 's3' | 'local';
  getText(key: string): Promise<string | null>;
  put(key: string, body: Buffer | string, contentType: string, cacheControl?: string): Promise<void>;
  /** URL que o player usa para baixar o arquivo direto do storage (assinada no S3). */
  urlFor(key: string): Promise<string>;
}

class LocalStorage implements StorageProvider {
  kind = 'local' as const;
  private root: string;
  private baseUrl: string;
  constructor(root: string, baseUrl: string) {
    this.root = root;
    this.baseUrl = baseUrl;
  }
  private path(key: string) {
    const p = resolve(this.root, key);
    if (!p.startsWith(resolve(this.root))) throw new Error('chave inválida');
    return p;
  }
  async getText(key: string) {
    try {
      return await readFile(this.path(key), 'utf8');
    } catch {
      return null;
    }
  }
  async put(key: string, body: Buffer | string) {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, body);
  }
  async urlFor(key: string) {
    return `${this.baseUrl}/local-files/${key}`;
  }
}

export async function createStorage(): Promise<StorageProvider> {
  if (env.storageDriver === 'local') {
    return new LocalStorage(join(process.cwd(), env.localDir), env.publicUrl);
  }
  const { S3Storage } = await import('./storage-s3.ts');
  return new S3Storage();
}
