import { hostname } from 'node:os';
import type { Logger } from '@aivastra/logger';
import type { Redis } from 'ioredis';
import type { ProcessorConfig } from '../job/processor.js';
import { getWorkers, servesInhouse } from '../worker/registry.js';
import { DISPATCHER_GROUP, parseMessage, runStreamLoop, type XReadGroupResult } from './loop.js';

export const INHOUSE_STREAM = 'jobs:inhouse';

// Distinct from the GPU consumer's plain hostname so the lanes are separable in
// `XINFO CONSUMERS jobs:inhouse dispatcher-cg`.
const CONSUMER = `${hostname()}-inhouse`;
const BLOCK_MS = 5_000;
// Same cadence as the GPU consumer's registry-derived cap (see consumer.ts).
const CONCURRENCY_REFRESH_MS = 5_000;

async function ensureInhouseGroup(redis: Redis, stream: string, log: Logger): Promise<void> {
  try {
    // '0' not '$', for the same reason as jobs:video: a job the API enqueued between
    // its own deploy and this dispatcher's boot must still be delivered.
    await redis.xgroup('CREATE', stream, DISPATCHER_GROUP, '0', 'MKSTREAM');
    log.info({ stream }, 'inhouse consumer group created');
  } catch (err: unknown) {
    // BUSYGROUP = group already exists, safe to ignore
    if (!(err instanceof Error) || !err.message.includes('BUSYGROUP')) throw err;
  }
}

/**
 * Inhouse lane consumer: reads jobs:inhouse (bulk try-on test runs from the team's own
 * accounts) and caps in-flight jobs at the number of workers that list 'inhouse'.
 *
 * Its own lane, not the shared GPU streams, so a burst of test jobs can never occupy the
 * shared consumer's slots or delay production — and the shared consumer's cap, which
 * excludes inhouse-only workers, can never hold slots that no eligible worker can fill.
 */
export async function runInhouseConsumer(
  redis: Redis,
  cfg: ProcessorConfig,
  log: Logger,
): Promise<() => void> {
  // Dedicated connection: XREADGROUP ... BLOCK parks it server-side (see video-consumer.ts).
  const readConn = redis.duplicate();
  await ensureInhouseGroup(readConn, INHOUSE_STREAM, log);

  let concurrency = 0;
  let lastRefresh = 0;
  async function getConcurrency(): Promise<number> {
    const now = Date.now();
    if (now - lastRefresh >= CONCURRENCY_REFRESH_MS) {
      lastRefresh = now;
      try {
        const next = [...(await getWorkers(redis)).values()].filter(servesInhouse).length;
        if (next !== concurrency) {
          log.info({ from: concurrency, to: next }, 'inhouse concurrency updated from registry');
          concurrency = next;
        }
      } catch (err) {
        log.warn({ err }, 'failed to refresh inhouse concurrency — keeping current');
      }
    }
    return concurrency;
  }

  const stop = runStreamLoop(cfg, log, {
    name: 'inhouse',
    read: async () =>
      parseMessage(
        INHOUSE_STREAM,
        (await readConn.xreadgroup(
          'GROUP',
          DISPATCHER_GROUP,
          CONSUMER,
          'COUNT',
          '1',
          'BLOCK',
          String(BLOCK_MS),
          'STREAMS',
          INHOUSE_STREAM,
          '>',
        )) as XReadGroupResult,
      ),
    getConcurrency,
  });

  log.info({ stream: INHOUSE_STREAM }, 'inhouse consumer started');

  return () => {
    stop();
    void readConn.quit().catch(() => {});
  };
}
