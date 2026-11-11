import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from './config.ts';
import type { StorageProvider } from './storage.ts';

export class S3Storage implements StorageProvider {
  kind = 's3' as const;
  private client: S3Client;
  private bucket = env.s3.bucket;

  constructor() {
    const { endpoint, accessKeyId, secretAccessKey, region, forcePathStyle } = env.s3;
    if (!endpoint || !this.bucket || !accessKeyId || !secretAccessKey) {
      throw new Error('Configure S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID e S3_SECRET_ACCESS_KEY');
    }
    this.client = new S3Client({
      endpoint,
      region,
      forcePathStyle,
      credentials: { accessKeyId, secretAccessKey },
      // R2 não aceita os checksums automáticos das versões novas do SDK
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  async getText(key: string) {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return (await res.Body?.transformToString('utf-8')) ?? null;
    } catch (err: any) {
      if (err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404) return null;
      throw err;
    }
  }

  async put(key: string, body: Buffer | string, contentType: string, cacheControl?: string) {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType, CacheControl: cacheControl }),
    );
  }

  async urlFor(key: string) {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: env.signedUrlTtl,
    });
  }
}
