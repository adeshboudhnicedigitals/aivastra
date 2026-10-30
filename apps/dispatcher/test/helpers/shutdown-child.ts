import { createDb } from '@aivastra/db';
import { createLogger } from '@aivastra/logger';
import { Redis } from 'ioredis';
import { trackOwnedJob } from '../../src/job/ownership.js';
import { submitRecordedPhase } from '../../src/job/submission.js';
import { drainAndRetire } from '../../src/shutdown.js';
import { reserveWorker } from '../../src/worker/reserve.js';
import { selectWorker } from '../../src/worker/selector.js';
import { acquireAndStart } from './acquire.js';

// A dispatcher-shaped process: owns one paid job (tracked as in flight, as processJob does),
// has its prompt accepted by the parent's fake worker, then handles SIGTERM with the same
// drainAndRetire that index.ts calls. It is the process under test for the 0-5 s drain.
const need = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`missing child fixture config: ${name}`);
  return value;
};
const { db } = createDb(need('RES_TEST_DATABASE_URL'));
const redis = new Redis(need('RES_TEST_REDIS_URL'), { keyPrefix: need('RES_TEST_REDIS_PREFIX') });
const log = createLogger('shutdown-child');
const jobId = need('RES_TEST_JOB_ID');
const session = need('RES_TEST_SESSION');

const acquired = await acquireAndStart(db, redis, jobId, session, log);
if (acquired.kind !== 'Acquired') throw new Error(`could not acquire: ${acquired.kind}`);
trackOwnedJob(acquired.owner);

process.on('SIGTERM', () => {
  void drainAndRetire({
    db,
    redis,
    log,
    session,
    drainMs: Number(process.env.RES_TEST_DRAIN_MS ?? '5000'),
  }).then(() => process.exit(0));
});

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
await submitRecordedPhase({
  db,
  owner: acquired.owner,
  jobId,
  phase: 'main',
  attemptId: reservation.attemptId,
  worker: reservation.worker,
  prompt: { '1': { class_type: 'Fixture', inputs: {} } },
  contract: {
    kind: 'regular',
    outputNodeId: '4',
    finalizer: 'standard',
    watermark: false,
    timeoutMs: 300_000,
  },
  log,
});
process.send?.({ receipt: true });
await new Promise(() => {});
