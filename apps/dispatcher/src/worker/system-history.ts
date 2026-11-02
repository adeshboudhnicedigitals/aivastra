import {
  FLEET_HISTORY_MAX_POINTS,
  FLEET_HISTORY_WINDOW_MS,
  type FleetHistoryPoint,
  type WorkerSystemSample,
  workerHistoryKey,
} from '@aivastra/types';
import type { Redis } from 'ioredis';

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;
// Twice the window: a retired worker's history disappears on its own, while one that is merely
// unreachable for a while keeps the points it already has.
const HISTORY_TTL_SEC = (FLEET_HISTORY_WINDOW_MS * 2) / 1000;

/**
 * The graphable numbers from one sample, computed the same way the api's /admin/fleet reports
 * them: used = total - free, and a free figure larger than the total is unknown rather than a
 * negative "used". Null stays null so a gap is never drawn as zero.
 */
export function toHistoryPoint(sample: WorkerSystemSample): FleetHistoryPoint {
  const { vramTotalBytes: vt, vramFreeBytes: vf, ramTotalBytes: rt, ramFreeBytes: rf } = sample;
  const gb = (b: number) => Math.round((b / GIB) * 10) / 10;
  return {
    t: sample.observedAt,
    vramUsedMb: vt !== null && vf !== null && vf <= vt ? Math.round((vt - vf) / MIB) : null,
    vramTotalMb: vt === null ? null : Math.round(vt / MIB),
    ramUsedGb: rt !== null && rf !== null && rf <= rt ? gb(rt - rf) : null,
    ramTotalGb: rt === null ? null : gb(rt),
  };
}

/**
 * Appends a point and trims by age and by count in one round trip. Advisory like the sample it
 * comes from: the caller swallows errors, because losing a graph point must never affect routing.
 */
export async function recordHistory(
  redis: Redis,
  workerId: string,
  sample: WorkerSystemSample,
): Promise<void> {
  const key = workerHistoryKey(workerId);
  const point = toHistoryPoint(sample);
  await redis
    .multi()
    .zadd(key, point.t, JSON.stringify(point))
    .zremrangebyscore(key, '-inf', point.t - FLEET_HISTORY_WINDOW_MS)
    // Keeps the newest N: rank 0 is the oldest, so drop everything but the last N ranks.
    .zremrangebyrank(key, 0, -(FLEET_HISTORY_MAX_POINTS + 1))
    .expire(key, HISTORY_TTL_SEC)
    .exec();
}
