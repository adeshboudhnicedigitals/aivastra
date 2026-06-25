import { hostname } from 'node:os';
import type { Logger } from '@aivastra/logger';
import type { Redis } from 'ioredis';
import type { ProcessorConfig } from '../job/processor.js';
import { processJob } from '../job/processor.js';

const GROUP = 'dispatcher-cg';
const CONSUMER = hostname();
const DEFAULT_STREAMS = ['jobs:priority', 'jobs:normal', 'jobs:low'] as const;

type PendingEntry = [string, string, number, number]; // [id, consumer, idleMs, deliveries]

export async function recoverPendingJobs(
  redis: Redis,
  cfg: ProcessorConfig,
  thresholdMs: number,
  log: Logger,
  streams: readonly string[] = DEFAULT_STREAMS,
): Promise<void> {
  for (const stream of streams) {
    let startId = '-';
    while (true) {
      let pending: PendingEntry[];
      try {
        pending = (await redis.xpending(stream, GROUP, startId, '+', 10)) as PendingEntry[];
      } catch (err: unknown) {
        if (err instanceof Error && err.message.includes('NOGROUP')) break;
        throw err;
      }
      if (!pending.length) break;

      for (const [messageId, , idleMs] of pending) {
        if (idleMs < thresholdMs) continue;
        log.warn({ stream, messageId, idleMs }, 'claiming stale pending entry');
        const claimed = (await redis.xclaim(
          stream,
          GROUP,
          CONSUMER,
          thresholdMs,
          messageId,
        )) as Array<[string, string[]]>;
        if (!claimed.length) continue;

        const claimedEntry = claimed[0];
        if (!claimedEntry) continue;
        const [, fields] = claimedEntry;
        const fieldMap: Record<string, string> = {};
        for (let i = 0; i < fields.length; i += 2) {
          const k = fields[i];
          const v = fields[i + 1];
          if (k !== undefined && v !== undefined) fieldMap[k] = v;
        }
        if (!fieldMap.jobId || !fieldMap.userId) {
          await redis.xack(stream, GROUP, messageId);
          continue;
        }
        log.info({ jobId: fieldMap.jobId }, 'reprocessing claimed pending job');
        await processJob(cfg, fieldMap.jobId, fieldMap.userId, stream, messageId);
      }

      const lastId = pending[pending.length - 1]?.[0];
      if (!lastId) break;
      startId = lastId.replace(/^(\d+)-(\d+)$/, (_, ms, seq) => `${ms}-${Number(seq) + 1}`);
      if (pending.length < 10) break;
    }
  }
}
