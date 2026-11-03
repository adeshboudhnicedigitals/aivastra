import { hostname } from 'node:os';
import type { Redis } from 'ioredis';
import { parseMessage, type StreamMessage, type XReadGroupResult } from '../../src/stream/loop.js';

export const FAIR_STREAMS = ['jobs:priority', 'jobs:normal', 'jobs:low'] as const;

/**
 * The GPU consumer's read, minus the registry-derived cap and the blocking XREAD: one claim per
 * call from the three job streams in order, as the dispatcher consumer under test would make it.
 * The slot accounting, parking and resume it feeds are the production `runStreamLoop`.
 */
export function makeReader(redis: Redis) {
  return async (isRunning: () => boolean): Promise<StreamMessage | null> => {
    for (const stream of FAIR_STREAMS) {
      if (!isRunning()) return null;
      const result = (await redis.xreadgroup(
        'GROUP',
        'dispatcher-cg',
        hostname(),
        'COUNT',
        '1',
        'STREAMS',
        stream,
        '>',
      )) as XReadGroupResult;
      const msg = parseMessage(stream, result);
      if (msg) return msg;
    }
    await new Promise((r) => setTimeout(r, 25));
    return null;
  };
}

/** ioredis does not prefix XGROUP's key, so spell the prefix out. */
export async function ensureGroups(redis: Redis, prefix: string): Promise<void> {
  for (const stream of FAIR_STREAMS)
    await redis
      .call('XGROUP', 'CREATE', `${prefix}${stream}`, 'dispatcher-cg', '$', 'MKSTREAM')
      .catch(() => undefined);
}
