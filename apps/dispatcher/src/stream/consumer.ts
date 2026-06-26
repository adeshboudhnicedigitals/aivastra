import { hostname } from 'node:os';
import type { Logger } from '@aivastra/logger';
import type { Redis } from 'ioredis';
import type { ProcessorConfig } from '../job/processor.js';
import { processJob } from '../job/processor.js';
import { getWorkers } from '../worker/registry.js';

const GROUP = 'dispatcher-cg';
const CONSUMER = hostname();

// How often the consumer re-reads the worker registry to recompute its in-flight
// cap. Short enough that adding/removing a worker via the admin panel takes effect
// within seconds (no dispatcher restart), long enough to avoid hammering Redis.
const CONCURRENCY_REFRESH_MS = 5_000;

async function ensureGroups(redis: Redis, log: Logger): Promise<void> {
  for (const stream of ['jobs:priority', 'jobs:normal', 'jobs:low']) {
    try {
      await redis.xgroup('CREATE', stream, GROUP, '$', 'MKSTREAM');
      log.info({ stream }, 'consumer group created');
    } catch (err: unknown) {
      // BUSYGROUP = group already exists, safe to ignore
      if (!(err instanceof Error) || !err.message.includes('BUSYGROUP')) throw err;
    }
  }
}

type XReadGroupResult = Array<[string, Array<[string, string[]]>]> | null;

function parseMessage(
  stream: string,
  result: XReadGroupResult,
): { stream: string; messageId: string; jobId: string; userId: string } | null {
  if (!result?.[0]?.[1].length) return null;
  const entry = result[0][1][0];
  if (!entry) return null;
  const [messageId, fields] = entry;
  const fieldMap: Record<string, string> = {};
  for (let i = 0; i < fields.length; i += 2) {
    const k = fields[i];
    const v = fields[i + 1];
    if (k !== undefined && v !== undefined) fieldMap[k] = v;
  }
  // userId is absent for widget jobs (which use widgetClientId from the DB row instead)
  if (!fieldMap.jobId) return null;
  return { stream, messageId, jobId: fieldMap.jobId, userId: fieldMap.userId ?? '' };
}

async function readOne(
  redis: Redis,
): Promise<{ stream: string; messageId: string; jobId: string; userId: string } | null> {
  // 1. Check priority queue — instant, no block
  const priority = (await redis.xreadgroup(
    'GROUP',
    GROUP,
    CONSUMER,
    'COUNT',
    '1',
    'STREAMS',
    'jobs:priority',
    '>',
  )) as XReadGroupResult;
  const pMsg = parseMessage('jobs:priority', priority);
  if (pMsg) return pMsg;

  // 2. Check normal queue — instant, no block
  const normal = (await redis.xreadgroup(
    'GROUP',
    GROUP,
    CONSUMER,
    'COUNT',
    '1',
    'STREAMS',
    'jobs:normal',
    '>',
  )) as XReadGroupResult;
  const nMsg = parseMessage('jobs:normal', normal);
  if (nMsg) return nMsg;

  // 3. Block up to 2s on low queue
  const low = (await redis.xreadgroup(
    'GROUP',
    GROUP,
    CONSUMER,
    'COUNT',
    '1',
    'BLOCK',
    '2000',
    'STREAMS',
    'jobs:low',
    '>',
  )) as XReadGroupResult;
  return parseMessage('jobs:low', low);
}

export async function runConsumer(
  redis: Redis,
  cfg: ProcessorConfig,
  log: Logger,
): Promise<() => void> {
  await ensureGroups(redis, log);
  let running = true;
  let inFlight = 0;

  // In-flight cap = number of registered workers, read live from the registry so
  // scaling GPUs up/down via the admin panel takes effect without a restart.
  // Cached for CONCURRENCY_REFRESH_MS to avoid an HGETALL on every slot check.
  let concurrency = 0;
  let lastConcurrencyRefresh = 0;

  async function refreshConcurrency(): Promise<void> {
    const now = Date.now();
    if (now - lastConcurrencyRefresh < CONCURRENCY_REFRESH_MS) return;
    lastConcurrencyRefresh = now;
    try {
      const next = (await getWorkers(redis)).size;
      if (next !== concurrency) {
        log.info({ from: concurrency, to: next }, 'consumer concurrency updated from registry');
        concurrency = next;
      }
    } catch (err) {
      log.warn({ err }, 'failed to refresh concurrency from registry — keeping current');
    }
  }

  // Caps in-flight jobs to the number of GPU workers so reads don't race ahead of
  // capacity — processJob already requeues gracefully if no worker is free anyway.
  // Blocks indefinitely while concurrency is 0 (no workers), resuming automatically
  // once a worker is added to the registry.
  async function waitForSlot(): Promise<void> {
    while (running) {
      await refreshConcurrency();
      if (inFlight < concurrency) return;
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  async function loop(): Promise<void> {
    while (running) {
      try {
        await waitForSlot();
        const msg = await readOne(redis);
        if (!msg) continue;
        const { stream, messageId, jobId, userId } = msg;
        log.info({ jobId, userId, stream }, 'consumed job from stream');
        inFlight++;
        processJob(cfg, jobId, userId, stream, messageId)
          .catch((err) => log.error({ err, jobId }, 'job processing failed'))
          .finally(() => {
            inFlight--;
          });
      } catch (err) {
        log.error({ err }, 'consumer loop error — resuming');
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  loop().catch((err) => log.error({ err }, 'consumer loop crashed'));

  return () => {
    running = false;
  };
}
