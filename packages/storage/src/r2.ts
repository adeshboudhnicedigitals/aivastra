import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { PresignResult, StorageProvider } from './index.js';

export interface R2Config {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicUrl: string;
  forcePathStyle: boolean;
  region?: string;
  /** Public-facing base URL for presigned PUT/GET URLs sent to the browser.
   *  e.g. "https://rankplex.cloud/minio"
   *  When set, the internal endpoint origin in the generated URL is replaced
   *  with this value so browsers can reach it. */
  presignBaseUrl?: string;
}

export function createR2Provider(cfg: R2Config): StorageProvider {
  const s3 = new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region ?? 'auto',
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    forcePathStyle: cfg.forcePathStyle,
    // Disable automatic checksum so presigned PUTs work from browser/curl without extra headers
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  const sign = async (
    cmd: PutObjectCommand | GetObjectCommand,
    expiresIn: number,
  ): Promise<PresignResult> => {
    let url = await getSignedUrl(s3, cmd, { expiresIn });
    // Rewrite internal endpoint to public URL so browsers can reach it over HTTPS
    if (cfg.presignBaseUrl) {
      const internalOrigin = new URL(cfg.endpoint).origin; // e.g. "http://minio:9000"
      const publicBase = cfg.presignBaseUrl.replace(/\/$/, ''); // e.g. "https://rankplex.cloud/minio"
      url = url.replace(internalOrigin, publicBase);
    }
    return { url, expiresIn };
  };
  return {
    // ContentLength omitted from PutObjectCommand: including it forces content-length into
    // X-Amz-SignedHeaders, causing SignatureDoesNotMatch when the real file size differs.
    presignPut: (key, contentType, _contentLength, expiresIn = 300) =>
      sign(
        new PutObjectCommand({
          Bucket: cfg.bucket,
          Key: key,
          ContentType: contentType,
        }),
        expiresIn,
      ),
    presignGet: (key, expiresIn = 300) =>
      sign(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }), expiresIn),
    deleteObject: async (key) => {
      await s3.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }));
    },
    putObject: async (key, body, contentType) => {
      await s3.send(
        new PutObjectCommand({
          Bucket: cfg.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      );
    },
    getObject: async (key) => {
      const res = await s3.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
      const chunks: Uint8Array[] = [];
      for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    },
    headObject: async (key) => {
      const res = await s3.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }));
      return { contentLength: res.ContentLength ?? 0, contentType: res.ContentType ?? null };
    },
    publicUrl: (key) => `${cfg.publicUrl.replace(/\/$/, '')}/${key}`,
  };
}
