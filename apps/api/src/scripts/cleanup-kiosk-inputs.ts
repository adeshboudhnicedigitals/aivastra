import { createLogger } from '@aivastra/logger';
import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';

const PREFIX = 'kiosk-inputs/';
const DEFAULT_RETENTION_DAYS = 30;
const DELETE_BATCH_SIZE = 1000;

function readRetentionDays() {
  const raw = process.env.KIOSK_INPUT_RETENTION_DAYS;
  if (!raw) return DEFAULT_RETENTION_DAYS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`KIOSK_INPUT_RETENTION_DAYS must be a positive integer, got: ${raw}`);
  }
  return parsed;
}

function buildClient() {
  return new S3Client({
    endpoint: process.env.R2_ENDPOINT,
    region: 'auto',
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
    },
    forcePathStyle: `${process.env.R2_FORCE_PATH_STYLE ?? 'true'}` === 'true',
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

async function listExpiredKeys(
  s3: S3Client,
  bucket: string,
  cutoff: Date,
  log: ReturnType<typeof createLogger>,
) {
  const keys: string[] = [];
  let continuationToken: string | undefined;

  do {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: PREFIX,
        ContinuationToken: continuationToken,
      }),
    );

    for (const object of res.Contents ?? []) {
      if (!object.Key || !object.LastModified) {
        log.warn({ key: object.Key }, 'skipping kiosk input without key/lastModified');
        continue;
      }
      if (object.LastModified.getTime() < cutoff.getTime()) {
        keys.push(object.Key);
      }
    }

    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (continuationToken);

  return keys;
}

async function deleteKeys(s3: S3Client, bucket: string, keys: string[]) {
  let deleted = 0;

  for (let index = 0; index < keys.length; index += DELETE_BATCH_SIZE) {
    const batch = keys.slice(index, index + DELETE_BATCH_SIZE);
    const res = await s3.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: batch.map((key) => ({ Key: key })),
          Quiet: true,
        },
      }),
    );

    deleted += res.Deleted?.length ?? 0;
    if ((res.Errors?.length ?? 0) > 0) {
      throw new Error(`Failed deleting ${res.Errors?.length ?? 0} kiosk input objects`);
    }
  }

  return deleted;
}

async function main() {
  const log = createLogger('kiosk-input-cleanup');
  const bucket = process.env.R2_BUCKET;
  if (!bucket) {
    throw new Error('R2_BUCKET is required');
  }

  const retentionDays = readRetentionDays();
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const s3 = buildClient();

  log.info(
    { bucket, prefix: PREFIX, retentionDays, cutoff: cutoff.toISOString() },
    'starting kiosk input cleanup',
  );

  const expiredKeys = await listExpiredKeys(s3, bucket, cutoff, log);
  if (expiredKeys.length === 0) {
    log.info('no expired kiosk input objects found');
    return;
  }

  const deleted = await deleteKeys(s3, bucket, expiredKeys);
  log.info({ deleted, scannedExpired: expiredKeys.length }, 'finished kiosk input cleanup');
}

main().catch((err) => {
  const log = createLogger('kiosk-input-cleanup');
  log.error({ err }, 'kiosk input cleanup failed');
  process.exitCode = 1;
});
