import { hostname } from 'node:os';
import type { Logger } from '@aivastra/logger';
import type { Redis } from 'ioredis';
import type { ProcessorConfig } from '../job/processor.js';
import { getWorkers, servesSharedPools } from '../worker/registry.js';
import {
  DISPATCHER_GROUP,
  parseMessage,
  runStreamLoop,
  type StreamMessage,
  type XReadGroupResult,
} from './loop.js';

const GROUP = DISPATCHER_GROUP;
const CONSUMER = hostname();
const STREAMS = ['jobs:priority', 'jobs:normal', 'jobs:low'] as const;

// How often the consumer re-reads the worker registry to recompute its in-flight
// cap (inhouse-only workers excluded — they have their own lane). Short enough that adding/removing a worker via the admin panel takes effect
// within seconds (no dispatcher restart), long enough to avoid hammering Redis.
const CONCURRENCY_REFRESH_MS = 5_000;

async function ensureGroups(redis: Redis, log: Logger): Promise<void> {
  for (const stream of STREAMS) {
    try {
      await redis.xgroup('CREATE', stream, GROUP, '$', 'MKSTREAM');
      log.info({ stream }, 'consumer group created');
    } catch (err: unknown) {
      // BUSYGROUP = group already exists, safe to ignore
      if (!(err instanceof Error) || !err.message.includes('BUSYGROUP')) throw err;
    }
  }
}

async function readOne(redis: Redis, isRunning: () => boolean): Promise<StreamMessage | null> {
  // Snapshot BEFORE checking the groups: an arrival between its empty check and
  // XREAD must still wake us. Fresh IDs each cycle also avoid spinning on entries
  // another consumer already claimed; '$' would miss arrivals in that gap.
  const tails = await Promise.all(
    STREAMS.map(async (stream) => {
      const entries = await redis.xrevrange(stream, '+', '-', 'COUNT', 1);
      return entries[0]?.[0] ?? '0-0';
    }),
  );

  // Preserve the existing ordered checks and claim only one job per free slot.
  for (const stream of STREAMS) {
    if (!isRunning()) return null;
    const result = (await redis.xreadgroup(
      'GROUP',
      GROUP,
      CONSUMER,
      'COUNT',
      '1',
      'STREAMS',
      stream,
      '>',
    )) as XReadGroupResult;
    const msg = parseMessage(stream, result);
    if (msg) return msg;
  }

  if (!isRunning()) return null;
  // Plain XREAD is only a wake-up signal. Unlike a multi-stream XREADGROUP, it
  // creates no pending entries or prefetched jobs outside our admission cap.
  // Any stream can wake us; the next cycle chooses a job via the ordered claims.
  await redis.xread('COUNT', 1, 'BLOCK', 2000, 'STREAMS', ...STREAMS, ...tails);
  return null;
}

/**
 * GPU lane consumer: reads jobs:priority → jobs:normal → jobs:low and caps in-flight
 * jobs to the number of registered ComfyUI workers. Catalog-video jobs do NOT ride
 * this lane — see runVideoConsumer in ./video-consumer.ts.
 */
export async function runConsumer(
  redis: Redis,
  cfg: ProcessorConfig,
  log: Logger,
): Promise<() => void> {
  // XREAD BLOCK parks its Redis connection. Keep it away from worker claims,
  // acknowledgements and registry reads used by active jobs.
  const readConn = redis.duplicate();
  await ensureGroups(readConn, log);

  // In-flight cap = number of registered workers, read live from the registry so
  // scaling GPUs up/down via the admin panel takes effect without a restart.
  // Cached for CONCURRENCY_REFRESH_MS to avoid an HGETALL on every slot check.
  let concurrency = 0;
  let lastConcurrencyRefresh = 0;

  async function getConcurrency(): Promise<number> {
    const now = Date.now();
    if (now - lastConcurrencyRefresh >= CONCURRENCY_REFRESH_MS) {
      lastConcurrencyRefresh = now;
      try {
        const next = [...(await getWorkers(redis)).values()].filter(servesSharedPools).length;
        if (next !== concurrency) {
          log.info({ from: concurrency, to: next }, 'consumer concurrency updated from registry');
          concurrency = next;
        }
      } catch (err) {
        log.warn({ err }, 'failed to refresh concurrency from registry — keeping current');
      }
    }
    return concurrency;
  }

  const stop = runStreamLoop(cfg, log, {
    name: 'gpu',
    read: (isRunning) => readOne(readConn, isRunning),
    getConcurrency,
  });
  return () => {
    stop();
    void readConn.quit().catch(() => {});
  };
}
