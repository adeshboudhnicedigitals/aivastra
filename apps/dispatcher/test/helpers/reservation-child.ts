import { createDb } from '@aivastra/db';
import { createLogger } from '@aivastra/logger';
import { Redis } from 'ioredis';
import { acquireComfyJob } from '../../src/job/ownership.js';
import { submitRecordedPhase } from '../../src/job/submission.js';
import { reserveWorker } from '../../src/worker/reserve.js';
import { selectWorker } from '../../src/worker/selector.js';

// A real dispatcher-side process that owns a job, reserves a worker and sends the one POST
// against the parent's fake worker. The fake is told to accept the prompt and never answer,
// so this process dies (by the test's signal) exactly where the receipt would be recorded.
// Test-only endpoints and credentials arrive through env; no production env file is read.
const need = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`missing child fixture config: ${name}`);
  return value;
};
const { db } = createDb(need('RES_TEST_DATABASE_URL'));
const redis = new Redis(need('RES_TEST_REDIS_URL'), { keyPrefix: need('RES_TEST_REDIS_PREFIX') });
const log = createLogger('reservation-child');
const jobId = need('RES_TEST_JOB_ID');

const acquired = await acquireComfyJob(db, jobId, need('RES_TEST_SESSION'), log);
if (acquired.kind !== 'Acquired') throw new Error(`could not acquire: ${acquired.kind}`);
const reservation = await reserveWorker({
  db,
  redis,
  owner: acquired.owner,
  jobId,
  phase: 'main',
  log,
  select: (token) => selectWorker(redis, 'tryon', undefined, { jobId, log, token }),
});
if (!reservation) throw new Error('no worker could be reserved');
process.send?.({
  reserved: {
    attemptId: reservation.attemptId,
    clientId: reservation.clientId,
    token: reservation.token,
  },
});
if (process.env.RES_TEST_STOP_BEFORE_POST === '1') await new Promise(() => {});
await submitRecordedPhase({
  db,
  owner: acquired.owner,
  jobId,
  phase: 'main',
  attemptId: reservation.attemptId,
  worker: reservation.worker,
  prompt: { '1': { class_type: 'Fixture', inputs: {} } },
  contract: { kind: 'reservation-fixture' },
  log,
});
process.send?.({ receipt: true });
await new Promise(() => {});
