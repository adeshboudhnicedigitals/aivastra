import { createDb } from '@aivastra/db';
import { createLogger } from '@aivastra/logger';
import { createR2Provider } from '@aivastra/storage';
import { Redis } from 'ioredis';
import { processJob } from '../../src/job/processor.js';

// A real dispatcher-side process: it owns a job through processJob, against the
// parent's fake worker, until the test kills it. Test-only endpoints and credentials,
// passed through env by the test; it never reads a production env file.
const need = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`missing child fixture config: ${name}`);
  return value;
};
const { db } = createDb(need('OWN_TEST_DATABASE_URL'));
const redis = new Redis(need('OWN_TEST_REDIS_URL'), { keyPrefix: need('OWN_TEST_REDIS_PREFIX') });
const storage = createR2Provider({
  endpoint: 'http://127.0.0.1:9000',
  accessKeyId: 'minioadmin',
  secretAccessKey: 'minioadmin_dev_pw',
  bucket: need('OWN_TEST_BUCKET'),
  publicUrl: `http://127.0.0.1:9000/${need('OWN_TEST_BUCKET')}`,
  forcePathStyle: true,
});
process.send?.({ ready: true });
await processJob(
  {
    db,
    redis,
    comfyRedis: redis,
    pub: redis,
    storage,
    log: createLogger('ownership-child'),
    ownerSession: need('OWN_TEST_SESSION'),
  },
  need('OWN_TEST_JOB_ID'),
  need('OWN_TEST_USER_ID'),
  'jobs:normal',
  need('OWN_TEST_MESSAGE_ID'),
);
process.send?.({ done: true });
