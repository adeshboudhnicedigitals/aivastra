import { hostname } from 'node:os';
import type { Redis } from 'ioredis';
import type { Logger } from '@aivastra/logger';
import type { ProcessorConfig } from '../job/processor.js';
import { processJob } from '../job/processor.js';

const GROUP = 'dispatcher-cg';
const CONSUMER = hostname();

async function ensureGroups(redis: Redis, log: Logger): Promise<void> {
  for (const stream of ['jobs:priority', 'jobs:normal']) {
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

async function readOne(
  redis: Redis,
): Promise<{ stream: string; messageId: string; jobId: string; userId: string } | null> {
  // Try priority queue first (non-blocking)
  for (const [stream, blockMs] of [['jobs:priority', '0'], ['jobs:normal', '2000']] as const) {
    const result = (await redis.xreadgroup(
      'GROUP', GROUP, CONSUMER, 'COUNT', '1', 'BLOCK', blockMs, 'STREAMS', stream, '>',
    )) as XReadGroupResult;
    if (!result || !result[0] || !result[0][1].length) continue;
    const [messageId, fields] = result[0][1][0]!;
    const fieldMap: Record<string, string> = {};
    for (let i = 0; i < fields.length; i += 2) fieldMap[fields[i]!] = fields[i + 1]!;
    if (!fieldMap['jobId'] || !fieldMap['userId']) continue;
    return { stream, messageId, jobId: fieldMap['jobId'], userId: fieldMap['userId'] };
  }
  return null;
}

export async function runConsumer(
  redis: Redis,
  cfg: ProcessorConfig,
  log: Logger,
): Promise<() => void> {
  await ensureGroups(redis, log);
  let running = true;

  async function loop(): Promise<void> {
    while (running) {
      try {
        const msg = await readOne(redis);
        if (!msg) continue;
        const { stream, messageId, jobId, userId } = msg;
        log.info({ jobId, userId, stream }, 'consumed job from stream');
        await processJob(cfg, jobId, userId, stream, messageId);
      } catch (err) {
        log.error({ err }, 'consumer loop error — resuming');
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  loop().catch((err) => log.error({ err }, 'consumer loop crashed'));

  return () => { running = false; };
}
