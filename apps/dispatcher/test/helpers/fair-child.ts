import { createDb } from '@aivastra/db';
import { createLogger } from '@aivastra/logger';
import { createR2Provider } from '@aivastra/storage';
import { Redis } from 'ioredis';
import { drainAndRetire } from '../../src/shutdown.js';
import { runStreamLoop } from '../../src/stream/loop.js';
import { startParkedScheduler } from '../../src/stream/parked.js';
import { makeReader } from './fair-lane.js';

// A dispatcher-shaped process for the fair-dispatch restart tests: the production lane loop
// (slots, parking, resume) over the three job streams against the parent's fake worker, with the
// same SIGTERM drain index.ts runs. Test-only endpoints and credentials arrive through env.
const need = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`missing child fixture config: ${name}`);
  return value;
};
const { db } = createDb(need('FAIR_TEST_DATABASE_URL'));
const redis = new Redis(need('FAIR_TEST_REDIS_URL'), { keyPrefix: need('FAIR_TEST_REDIS_PREFIX') });
const log = createLogger('fair-child');
const session = need('FAIR_TEST_SESSION');
const storage = createR2Provider({
  endpoint: 'http://127.0.0.1:9000',
  accessKeyId: 'minioadmin',
  secretAccessKey: 'minioadmin_dev_pw',
  bucket: need('FAIR_TEST_BUCKET'),
  publicUrl: `http://127.0.0.1:9000/${need('FAIR_TEST_BUCKET')}`,
  forcePathStyle: true,
});
const cfg = {
  db,
  redis,
  comfyRedis: redis,
  pub: redis,
  storage,
  log,
  ownerSession: session,
  comfyPollIntervalMs: 50,
};
const stopScheduler = startParkedScheduler({ db, redis, log });
const stopLane = runStreamLoop(cfg, log, {
  name: 'gpu',
  read: makeReader(redis),
  getConcurrency: async () => Number(process.env.FAIR_TEST_CAP ?? '2'),
});
process.on('SIGTERM', () => {
  stopLane();
  stopScheduler();
  void drainAndRetire({ db, redis, log, session, drainMs: 5000 }).then(() => process.exit(0));
});
process.send?.({ ready: true });
