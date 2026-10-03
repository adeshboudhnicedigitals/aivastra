import type { Logger } from '@aivastra/logger';
import { workerReleaseFailuresTotal } from '@aivastra/observability';
import type { WorkerPool } from '@aivastra/types';
import type { Redis } from 'ioredis';
import { boundedRead } from './bounded-read.js';

export type WorkerStatus = 'IDLE' | 'BUSY' | 'DRAINING';

export interface WorkerEntry {
  url: string;
  apiKey: string;
  status: WorkerStatus;
  lastSeen: number; // unix ms
  allowedJobTypes: WorkerPool[]; // empty = accept all
}

export const REGISTRY_KEY = 'worker:registry';

export function healthKey(workerId: string) {
  return `worker:health:${workerId}`;
}

// Per-worker routing flags live OUTSIDE worker:registry on purpose: registerWorkers
// rebuilds every registry entry on dispatcher boot and would wipe a flag stored there.
// Missing key = queue gating off, so unmigrated workers keep today's semantics.
export function routingConfigKey(workerId: string) {
  return `worker:routing-config:${workerId}`;
}

// Display-only snapshot of a worker's ComfyUI /queue, written by the health monitor with a
// short TTL. The api can't reach ComfyUI, so this is how the admin Workers view sees it.
// Routing NEVER reads this — it probes live after the claim (see selector.ts).
export function queueSnapshotKey(workerId: string) {
  return `worker:queue:${workerId}`;
}

export async function isQueueGateEnabled(redis: Redis, workerId: string): Promise<boolean> {
  const raw = await redis.get(routingConfigKey(workerId));
  if (!raw) return false;
  try {
    return (JSON.parse(raw) as { queueGateEnabled?: unknown }).queueGateEnabled === true;
  } catch {
    return false;
  }
}

// Atomic BUSY → IDLE. Unlike setWorkerStatus (read-all / write-one, not atomic) this
// never touches a DRAINING entry and never resurrects a worker the admin removed.
const RELEASE_IF_BUSY_LUA = `
local raw = redis.call('HGET', KEYS[1], ARGV[1])
if not raw then return 0 end
local ok, val = pcall(cjson.decode, raw)
if not ok or val.status ~= 'BUSY' then return 0 end
val.status = 'IDLE'
val.lastSeen = tonumber(ARGV[2])
redis.call('HSET', KEYS[1], ARGV[1], cjson.encode(val))
return 1
`;

export async function releaseWorkerIfBusy(redis: Redis, workerId: string): Promise<void> {
  await redis.eval(RELEASE_IF_BUSY_LUA, 1, REGISTRY_KEY, workerId, String(Date.now()));
}

export async function getWorkers(redis: Redis): Promise<Map<string, WorkerEntry>> {
  const raw = await redis.hgetall(REGISTRY_KEY);
  const map = new Map<string, WorkerEntry>();
  for (const [id, json] of Object.entries(raw)) {
    try {
      map.set(id, JSON.parse(json) as WorkerEntry);
    } catch {
      /* skip malformed */
    }
  }
  return map;
}

export async function setWorkerStatus(
  redis: Redis,
  workerId: string,
  status: WorkerStatus,
): Promise<void> {
  const workers = await getWorkers(redis);
  const entry = workers.get(workerId);
  if (!entry) return;
  // A job release (status IDLE) must not resurrect a worker an admin drained
  // mid-job — DRAINING sticks until an explicit undrain or a startup resync.
  // Without this guard, deactivating a BUSY worker gets silently undone the
  // instant its in-flight job finishes.
  if (status === 'IDLE' && entry.status === 'DRAINING') return;
  entry.status = status;
  entry.lastSeen = Date.now();
  await redis.hset(REGISTRY_KEY, workerId, JSON.stringify(entry));
}

export async function registerWorkers(
  redis: Redis,
  workers: Array<{ id: string; url: string; apiKey: string; allowedJobTypes?: WorkerPool[] }>,
): Promise<void> {
  // Remove stale entries: any worker in Redis but not in the DB list is deleted.
  // This prevents old env-var workers from lingering after being removed from the DB.
  const existing = await redis.hkeys(REGISTRY_KEY);
  const incoming = new Set(workers.map((w) => w.id));
  for (const id of existing) {
    if (!incoming.has(id)) {
      await redis.hdel(REGISTRY_KEY, id);
      await redis.del(healthKey(id));
    }
  }

  for (const w of workers) {
    const entry: WorkerEntry = {
      url: w.url,
      apiKey: w.apiKey,
      status: 'IDLE',
      lastSeen: Date.now(),
      allowedJobTypes: w.allowedJobTypes ?? [],
    };
    await redis.hset(REGISTRY_KEY, w.id, JSON.stringify(entry));
  }
}

export async function deregisterWorker(redis: Redis, workerId: string): Promise<void> {
  await redis.hdel(REGISTRY_KEY, workerId);
  await redis.del(healthKey(workerId));
}

/** Release has its own finite retry, independent of an exhausted cancel deadline. */
export async function releaseWorker(redis: Redis, workerId: string, log: Logger): Promise<void> {
  // Bounding the wait does not cancel Redis's command. A late attempt can release
  // a newly claimed BUSY worker; preventing that requires an ownership token.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await boundedRead(() => releaseWorkerIfBusy(redis, workerId), 5_000);
      return;
    } catch (err) {
      if (attempt === 1) {
        workerReleaseFailuresTotal.inc();
        log.error({ workerId, err }, 'worker release failed after bounded retry');
      }
    }
  }
}
