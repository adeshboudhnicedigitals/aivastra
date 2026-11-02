import type { DB } from '@aivastra/db';
import type { Logger } from '@aivastra/logger';
import { keys, type StorageProvider } from '@aivastra/storage';
import type { Redis } from 'ioredis';
import { assertStorageWriteLease, type OwnerToken } from '../job/ownership.js';
import { settleAndPublish } from '../job/settlement.js';
import { encodeCompressedImage } from './finalize.js';

type Stage = <T>(name: string, fn: () => Promise<T>) => Promise<T>;
const unmeasured: Stage = (_name, fn) => fn();

export interface FinalizeWidgetOpts {
  owner: OwnerToken;
  attemptId: string;
  imageBytes: Uint8Array;
  jobId: string;
  compression: Parameters<typeof encodeCompressedImage>[1];
  db: DB;
  pub: Redis;
  storage: StorageProvider;
  jobLog: Logger;
  /** Per-stage timing wrapper of the original handler; adoption runs unmeasured. */
  stage?: Stage;
}

/**
 * Encode, store and settle a merchant-widget result. One body for the handler and for adoption,
 * so a recovered widget job finishes exactly as an uninterrupted one does. The storage write is
 * lease-checked: a replacement owner may already be running.
 */
export async function finalizeWidgetOutput(
  opts: FinalizeWidgetOpts,
): Promise<{ completed: boolean; resultKey: string }> {
  const stage = opts.stage ?? unmeasured;
  const {
    buffer: encodedBuffer,
    format: outputFormat,
    contentType,
  } = await stage('output_encode', () => encodeCompressedImage(opts.imageBytes, opts.compression));
  const resultKey = keys.widgetOutput(opts.jobId, outputFormat);
  await stage('output_storage_put', async () => {
    await assertStorageWriteLease(opts.db, opts.owner, 'widget:output', {
      attemptId: opts.attemptId,
    });
    await opts.storage.putObject(resultKey, encodedBuffer, contentType);
  });
  const completed = await stage('completed_status_transition', () =>
    settleAndPublish(
      { db: opts.db, pub: opts.pub, log: opts.jobLog },
      { owner: opts.owner },
      { kind: 'completed', output: { resultKey } },
      { userId: '' },
    ).then((r) => r.kind === 'settled'),
  );
  return { completed, resultKey };
}

/** The widget channel and the merchant webhook outbox; the caller ACKs. */
export async function announceWidgetCompleted(
  pub: Redis,
  redis: Redis,
  args: { jobId: string; merchantId: string; resultKey: string },
): Promise<void> {
  const { jobId, merchantId, resultKey } = args;
  await pub.publish(
    `sse:events:widget:${merchantId}`,
    JSON.stringify({ jobId, type: 'STATUS', status: 'COMPLETED', resultKey }),
  );
  await redis.xadd(
    'webhooks:outbound',
    'MAXLEN',
    '~',
    10000,
    '*',
    'jobId',
    jobId,
    'merchantId',
    merchantId,
    'status',
    'COMPLETED',
    'resultKey',
    resultKey,
  );
}
