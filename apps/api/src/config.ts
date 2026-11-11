// Carrega .env se existir (local). No Railway as variáveis vêm do painel.
try {
  process.loadEnvFile('.env');
} catch {
  /* sem .env */
}

const port = Number(process.env.PORT ?? 3000);

export const env = {
  port,
  storageDriver: (process.env.STORAGE_DRIVER ?? 's3') as 's3' | 'local',
  localDir: process.env.LOCAL_STORAGE_DIR ?? './data',
  publicUrl: (process.env.PUBLIC_API_URL ?? `http://localhost:${port}`).replace(/\/$/, ''),
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
  protoToken: process.env.PROTO_TOKEN ?? '',
  signedUrlTtl: Number(process.env.SIGNED_URL_TTL ?? 21600),
  s3: {
    endpoint: process.env.S3_ENDPOINT ?? '',
    bucket: process.env.S3_BUCKET ?? '',
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
    region: process.env.S3_REGION ?? 'auto',
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
  },
};
