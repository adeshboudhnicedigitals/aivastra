import type { Logger } from '@aivastra/logger';
import type { Redis } from 'ioredis';

const GROUP = 'dispatcher-cg';

/**
 * Lane occupancy held outside a lane's own read loop.
 *
 * A job a previous dispatcher left pending may still be running on a worker. Until recovery has
 * looked at it, the lane must count it against its in-flight cap, or a fresh read could start
 * new execution on top of it. A ticket is that count: a placeholder per pending entry restored
 * at boot (before any fresh read, whether or not the entry is old enough to claim yet), and the
 * same key held while recovery observes or adopts the entry. The cap only limits new execution,
 * so recovery takes its ticket whatever the cap is (zero included, or the worker DRAINING):
 * the prompt already occupies that worker.
 */
export type Lane = 'gpu' | 'video' | 'inhouse';

export const laneOf = (stream: string): Lane =>
  stream === 'jobs:video' ? 'video' : stream === 'jobs:inhouse' ? 'inhouse' : 'gpu';

const LANE_STREAMS = [
  'jobs:priority',
  'jobs:normal',
  'jobs:low',
  'jobs:video',
  'jobs:inhouse',
] as const;

// `running` is set while a recovery task is observing the entry; a placeholder is just a count.
const held = new Map<string, { lane: Lane; running: boolean }>();
const key = (stream: string, messageId: string) => `${stream}\u0000${messageId}`;

export function laneOccupancy(lane: Lane): number {
  let n = 0;
  for (const h of held.values()) if (h.lane === lane) n++;
  return n;
}

/** Holds (or keeps holding) occupancy for one pending entry; the returned function frees it. */
export function takeTicket(stream: string, messageId: string): () => void {
  const k = key(stream, messageId);
  held.set(k, { lane: laneOf(stream), running: true });
  return () => {
    held.delete(k);
  };
}

/**
 * One placeholder per entry still pending in a lane's stream, read once at boot before any lane
 * starts reading. At most `max` entries are read (the I/O bound); a longer pending list is
 * logged, and the rest are picked up by recovery as it reaches them.
 */
export async function restoreLaneOccupancy(redis: Redis, log: Logger, max: number): Promise<void> {
  let restored = 0;
  for (const stream of LANE_STREAMS) {
    if (restored >= max) break;
    try {
      const pending = (await redis.xpending(stream, GROUP, '-', '+', max - restored)) as Array<
        [string]
      >;
      for (const [messageId] of pending)
        held.set(key(stream, messageId), { lane: laneOf(stream), running: false });
      restored += pending.length;
    } catch (err) {
      // No group yet means nothing was ever delivered on this stream.
      if (!(err instanceof Error && err.message.includes('NOGROUP')))
        log.error({ err, stream }, 'could not restore lane occupancy');
    }
  }
  if (restored >= max)
    log.warn({ restored, max }, 'lane occupancy restore hit its bound — recovery covers the rest');
  log.info({ restored }, 'lane occupancy restored');
}

/**
 * Drops placeholders whose entry is no longer pending (ACKed or handed off), so a finished job
 * cannot hold a lane slot. A ticket held by a running recovery task is dropped by that task.
 */
export async function pruneLaneOccupancy(redis: Redis, log: Logger): Promise<void> {
  for (const [k, h] of [...held]) {
    if (h.running) continue;
    const [stream, messageId] = k.split('\u0000') as [string, string];
    try {
      const pending = await redis.xpending(stream, GROUP, messageId, messageId, 1);
      if ((pending as unknown[]).length === 0) held.delete(k);
    } catch (err) {
      if (err instanceof Error && err.message.includes('NOGROUP')) held.delete(k);
      else log.warn({ err, stream, messageId }, 'could not check a lane placeholder');
    }
  }
}

/** Test hook: forget everything held. */
export function resetLaneTickets(): void {
  held.clear();
}
