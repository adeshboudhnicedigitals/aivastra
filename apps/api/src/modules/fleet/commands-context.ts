import { FLEET_SYSTEM_STALE_MS, fleetAgentLatestKey } from '@aivastra/types';
import type { Redis } from 'ioredis';
import type { CommandContext, QueueCounts } from './commands-core.js';

// The dispatcher's Redis keys (apps/dispatcher/src/worker/registry.ts and queue-sampler.ts). The
// API reads them but never writes them: a command changes nothing here until something on the box
// claims it.
const REGISTRY_KEY = 'worker:registry';
const RESERVATIONS_KEY = 'worker:reservations';
const queueKey = (id: string) => `worker:queue:${id}`;
const DISPATCHER_PROBE_FRESH_MS = 45_000;

const count = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null;

function parseJson(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return typeof v === 'object' && v !== null && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Everything the guard needs, read once. A reading that is missing, stale or failed is null. */
export async function readCommandContext(
  redis: Pick<Redis, 'hget' | 'get'>,
  workerId: string,
  now: number,
): Promise<CommandContext> {
  const [registry, reservation, queueRaw, latestRaw] = await Promise.all([
    redis.hget(REGISTRY_KEY, workerId),
    redis.hget(RESERVATIONS_KEY, workerId),
    redis.get(queueKey(workerId)),
    redis.get(fleetAgentLatestKey(workerId)),
  ]);

  const entry = parseJson(registry);
  const status = entry && typeof entry.status === 'string' ? entry.status : null;

  const snap = parseJson(queueRaw);
  const dispatcherQueue: QueueCounts | null =
    snap &&
    typeof snap.probedAt === 'number' &&
    now - snap.probedAt <= DISPATCHER_PROBE_FRESH_MS &&
    typeof snap.error !== 'string'
      ? { running: count(snap.running), pending: count(snap.pending) }
      : null;

  const latest = parseJson(latestRaw);
  let agentQueue: QueueCounts | null = null;
  if (
    latest &&
    typeof latest.observedAt === 'number' &&
    now - latest.observedAt <= FLEET_SYSTEM_STALE_MS &&
    Array.isArray(latest.comfy) &&
    latest.comfy.length > 0
  ) {
    const rows = latest.comfy as Record<string, unknown>[];
    const sum = (key: 'running' | 'pending') => {
      const parts = rows.map((r) => count(r[key]));
      return parts.every((p): p is number => p !== null) ? parts.reduce((a, b) => a + b, 0) : null;
    };
    agentQueue = { running: sum('running'), pending: sum('pending') };
  }

  return { dispatcherStatus: status, reserved: Boolean(reservation), dispatcherQueue, agentQueue };
}
