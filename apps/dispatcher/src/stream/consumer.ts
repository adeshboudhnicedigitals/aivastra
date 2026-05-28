import { hostname } from 'node:os';
import type { Logger } from '@aivastra/logger';
import type { Redis } from 'ioredis';
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

function parseMessage(
  stream: string,
  result: XReadGroupResult,
): { stream: string; messageId: string; jobId: string; userId: string } | null {
  if (!result || !result[0] || !result[0][1].length) return null;
  const [messageId, fields] = result[0][1][0]!;
  const fieldMap: Record<string, string> = {};
  for (let i = 0; i < fields.length; i += 2) fieldMap[fields[i]!] = fields[i + 1]!;
  if (!fieldMap['jobId'] || !fieldMap['userId']) return null;
  return { stream, messageId, jobId: fieldMap['jobId'], userId: fieldMap['userId'] };
}

async function readOne(
  redis: Redis,
): Promise<{ stream: string; messageId: string; jobId: string; userId: string } | null> {
  // Check priority queue first — no BLOCK (truly non-blocking instant check)
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

  // Block up to 2s on normal queue
  const normal = (await redis.xreadgroup(
    'GROUP',
    GROUP,
    CONSUMER,
    'COUNT',
    '1',
    'BLOCK',
    '2000',
    'STREAMS',
    'jobs:normal',
    '>',
  )) as XReadGroupResult;
  return parseMessage('jobs:normal', normal);
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

  return () => {
    running = false;
  };
}
