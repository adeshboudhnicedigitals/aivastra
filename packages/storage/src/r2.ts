import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { StorageProvider, PresignResult } from './index';

export interface R2Config {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicUrl: string;
  forcePathStyle: boolean;
  region?: string;
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
  const sign = async (cmd: PutObjectCommand | GetObjectCommand, expiresIn: number): Promise<PresignResult> => ({
    url: await getSignedUrl(s3, cmd, { expiresIn }),
    expiresIn,
  });
  return {
    // ContentLength omitted from PutObjectCommand: including it forces content-length into
    // X-Amz-SignedHeaders, causing SignatureDoesNotMatch when the real file size differs.
    presignPut: (key, contentType, _contentLength, expiresIn = 300) =>
      sign(new PutObjectCommand({
        Bucket: cfg.bucket, Key: key, ContentType: contentType,
      }), expiresIn),
    presignGet: (key, expiresIn = 300) =>
      sign(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }), expiresIn),
    deleteObject: async (key) => {
      await s3.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }));
    },
    publicUrl: (key) => `${cfg.publicUrl.replace(/\/$/, '')}/${key}`,
  };
}
