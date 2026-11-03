import { createDb, schema } from '@aivastra/db';
import { createLogger } from '@aivastra/logger';
import { Redis } from 'ioredis';
import { RESERVATIONS_KEY } from '../../src/worker/registry.js';
import {
  rebuildWorkerRegistry,
  reconcileWorkerReservations,
} from '../../src/worker/reservation-reconciler.js';

// The startup path of a replacement dispatcher as its own process: rebuild the registry and
// holds from Postgres, run the immediate reconcile, report what is held, exit. It shares the
// parent's Postgres, Redis (under the same test prefix) and fake worker, so a hold or deadline
// that survives it survived a real process restart.
const need = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`missing child fixture config: ${name}`);
  return value;
};
const { db, close } = createDb(need('RES_TEST_DATABASE_URL'));
const redis = new Redis(need('RES_TEST_REDIS_URL'), { keyPrefix: need('RES_TEST_REDIS_PREFIX') });
const log = createLogger('reservation-boot-child');
const bootStartedAt = performance.now();
const workers = await db.select().from(schema.workers);
await rebuildWorkerRegistry({ db, redis, log, workers });
// Admission is open from here: the rebuild came from Postgres alone, no worker was contacted.
const admissionOpenMs = performance.now() - bootStartedAt;
if (process.env.RES_TEST_RECONCILE !== '0')
  await reconcileWorkerReservations({
    db,
    redis,
    log,
    uncertainCheckMs: Number(need('RES_TEST_UNCERTAIN_MS')),
  });
process.send?.({
  holds: await redis.hgetall(RESERVATIONS_KEY),
  admissionOpenMs,
  bootMs: performance.now() - bootStartedAt,
});
await close();
redis.disconnect();
process.exit(0);
