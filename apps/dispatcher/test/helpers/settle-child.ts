import { createDb } from '@aivastra/db';
import { createLogger } from '@aivastra/logger';
import { Redis } from 'ioredis';
import { settleComfyJob } from '../../src/job/settlement.js';
import { acquireAndStart } from './acquire.js';

// A real dispatcher-side process that owns a job and settles it as FAILED. The parent sets
// SETTLE_TEST_GATE_POINT, so the settlement transaction parks on an advisory lock after one
// specific write and the test can kill the process before COMMIT. Test-only endpoints and
// credentials arrive through env; it never reads a production env file.
const need = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`missing child fixture config: ${name}`);
  return value;
};
const { db } = createDb(need('SETTLE_TEST_DATABASE_URL'));
const log = createLogger('settle-child');
const jobId = need('SETTLE_TEST_JOB_ID');
const acquired = await acquireAndStart(
  db,
  new Redis(need('SETTLE_TEST_REDIS_URL')),
  jobId,
  need('SETTLE_TEST_SESSION'),
  log,
);
if (acquired.kind !== 'Acquired') throw new Error(`child did not acquire: ${acquired.kind}`);
process.send?.({ acquired: true });
await settleComfyJob(
  db,
  { owner: acquired.owner },
  { kind: 'failed', errorCode: 'CHILD_FAIL' },
  log,
);
process.send?.({ done: true });
process.exit(0);
