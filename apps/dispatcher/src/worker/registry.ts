import { randomUUID } from 'node:crypto';
import type { Logger } from '@aivastra/logger';
import { workerReleaseFailuresTotal } from '@aivastra/observability';
import type { WorkerPool } from '@aivastra/types';
import type { Redis } from 'ioredis';
import { boundedRead } from './bounded-read.js';

export type WorkerStatus = 'IDLE' | 'BUSY' | 'DRAINING';

export interface WorkerEntry {
  gpuGroup?: string;
  url: string;
  apiKey: string;
  status: WorkerStatus;
  lastSeen: number; // unix ms
  allowedJobTypes: WorkerPool[]; // empty = accept all
}

export const REGISTRY_KEY = 'worker:registry';

// Reservation tokens live in their own hash, NOT in the registry JSON: every admin status edit
// reads, rewrites and writes back a whole registry entry, so a token stored there would be
// erased by an ordinary reactivation. One token per worker, value = reservationToken().
export const RESERVATIONS_KEY = 'worker:reservations';

// Present only once this registry was built by a dispatcher (registerWorkers). A Redis reset
// removes it together with the registry, so claims fail closed until the rebuild runs again
// instead of racing an admin-recreated, token-less entry.
export const ADMISSION_KEY = 'worker:admission';

/** Identity of one worker hold: the attempt it is for plus the owner generation and session. */
export function reservationToken(args: {
  session: string;
  generation: bigint | number | string;
  attemptId: string;
}): string {
  return `${args.session}:${args.generation}:${args.attemptId}`;
}

/** Classify has no durable reservation (plan §9), only a token so its release is checked too. */
export function transientReservationToken(): string {
  return `transient:${randomUUID()}`;
}

export function isTransientToken(token: string): boolean {
  return token.startsWith('transient:');
}

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

// Token-checked release: frees the worker only while the hash still holds the caller's own
// token, so a late release from a dead or replaced owner cannot free a newer owner's hold.
// BUSY becomes IDLE; DRAINING stays DRAINING (an admin drain must survive the release) and a
// worker the admin removed is never resurrected.
const RELEASE_IF_TOKEN_LUA = `
local held = redis.call('HGET', KEYS[2], ARGV[1])
if held ~= ARGV[2] then return 0 end
redis.call('HDEL', KEYS[2], ARGV[1])
local raw = redis.call('HGET', KEYS[1], ARGV[1])
if not raw then return 1 end
local ok, val = pcall(cjson.decode, raw)
if ok and val.status == 'BUSY' then
  val.status = 'IDLE'
  val.lastSeen = tonumber(ARGV[3])
  redis.call('HSET', KEYS[1], ARGV[1], cjson.encode(val))
end
return 1
`;

/** True when the caller's token was the one held and is now released. */
export async function releaseWorkerIfToken(
  redis: Redis,
  workerId: string,
  token: string,
): Promise<boolean> {
  const released = await redis.eval(
    RELEASE_IF_TOKEN_LUA,
    2,
    REGISTRY_KEY,
    RESERVATIONS_KEY,
    workerId,
    token,
    String(Date.now()),
  );
  return released === 1;
}

// Hands a hold to the adopting owner. The hold is named by the attempt, so the dead owner's
// session and generation need not be known: the same attempt re-keys, an absent hold is
// re-established (and the worker marked BUSY so it cannot be claimed), and a hold that
// belongs to a different attempt is never touched.
const ADOPT_RESERVATION_LUA = `
local held = redis.call('HGET', KEYS[2], ARGV[1])
if held == ARGV[3] then return 'same' end
if not held then
  redis.call('HSET', KEYS[2], ARGV[1], ARGV[3])
  local raw = redis.call('HGET', KEYS[1], ARGV[1])
  if raw then
    local ok, val = pcall(cjson.decode, raw)
    if ok and val.status == 'IDLE' then
      val.status = 'BUSY'
      redis.call('HSET', KEYS[1], ARGV[1], cjson.encode(val))
    end
  end
  return 'set'
end
local suffix = ':' .. ARGV[2]
if string.sub(held, -string.len(suffix)) == suffix then
  redis.call('HSET', KEYS[2], ARGV[1], ARGV[3])
  return 'rekeyed'
end
return 'conflict'
`;

export type AdoptReservationResult = 'same' | 'set' | 'rekeyed' | 'conflict';

export async function adoptWorkerReservation(
  redis: Redis,
  workerId: string,
  attemptId: string,
  newToken: string,
): Promise<AdoptReservationResult> {
  return (await redis.eval(
    ADOPT_RESERVATION_LUA,
    2,
    REGISTRY_KEY,
    RESERVATIONS_KEY,
    workerId,
    attemptId,
    newToken,
  )) as AdoptReservationResult;
}

export async function getReservations(redis: Redis): Promise<Map<string, string>> {
  return new Map(Object.entries(await redis.hgetall(RESERVATIONS_KEY)));
}

// Lane capacity. The shared GPU lanes and the dedicated inhouse lane each cap
// in-flight jobs at the number of workers that can actually serve them, so a worker
// dedicated to inhouse never inflates the shared lanes' cap (their consumers would
// hold slots no eligible worker can fill) and vice versa.
export function servesSharedPools(w: WorkerEntry): boolean {
  return (
    w.status !== 'DRAINING' &&
    (w.allowedJobTypes.length === 0 || w.allowedJobTypes.some((t) => t !== 'inhouse'))
  );
}

export function servesInhouse(w: WorkerEntry): boolean {
  return w.status !== 'DRAINING' && w.allowedJobTypes.includes('inhouse');
}

export async function getWorkers(redis: Redis): Promise<Map<string, WorkerEntry>> {
  const raw = await redis.hgetall(REGISTRY_KEY);
  const map = new Map<string, WorkerEntry>();
  for (const [id, json] of Object.entries(raw)) {
    try {
      const entry = JSON.parse(json) as WorkerEntry;
      // The Lua scripts round-trip the entry through cjson, which re-encodes an
      // empty array as `{}` — normalise so `.some`/`.includes` stay callable.
      if (!Array.isArray(entry.allowedJobTypes)) entry.allowedJobTypes = [];
      map.set(id, entry);
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

export interface RegistrableWorker {
  id: string;
  url: string;
  apiKey: string;
  allowedJobTypes?: WorkerPool[];
  /** Inactive workers stay registered as DRAINING so a plain admin reactivation finds them. */
  isActive?: boolean;
  /** A rebuilt hold for unresolved remote work; the worker starts BUSY (or DRAINING) with it. */
  reservation?: string;
}

export async function registerWorkers(redis: Redis, workers: RegistrableWorker[]): Promise<void> {
  // Remove stale entries: any worker in Redis but not in the DB list is deleted.
  // This prevents old env-var workers from lingering after being removed from the DB.
  const existing = await redis.hkeys(REGISTRY_KEY);
  const incoming = new Set(workers.map((w) => w.id));
  for (const id of existing) {
    if (!incoming.has(id)) {
      await redis.hdel(REGISTRY_KEY, id);
      await redis.hdel(RESERVATIONS_KEY, id);
      await redis.del(healthKey(id));
    }
  }
  // A token for a worker this call no longer registers (or registers without a hold) is dead.
  const keptTokens = new Set(workers.filter((w) => w.reservation).map((w) => w.id));
  for (const id of await redis.hkeys(RESERVATIONS_KEY)) {
    if (!keptTokens.has(id)) await redis.hdel(RESERVATIONS_KEY, id);
  }

  for (const w of workers) {
    const previous = await redis.hget(REGISTRY_KEY, w.id);
    let gpuGroup: string | undefined;
    try {
      gpuGroup = previous ? (JSON.parse(previous) as WorkerEntry).gpuGroup : undefined;
    } catch {
      /* Optional measurement metadata. */
    }
    const active = w.isActive !== false;
    const entry: WorkerEntry = {
      ...(gpuGroup ? { gpuGroup } : {}),
      url: w.url,
      apiKey: w.apiKey,
      // Admission is closed to inactive workers whatever else holds them.
      status: !active ? 'DRAINING' : w.reservation ? 'BUSY' : 'IDLE',
      lastSeen: Date.now(),
      allowedJobTypes: w.allowedJobTypes ?? [],
    };
    // Token first: a crash between the two leaves an IDLE entry guarded by the token, never
    // a claimable worker with remote work still running on it.
    if (w.reservation) await redis.hset(RESERVATIONS_KEY, w.id, w.reservation);
    await redis.hset(REGISTRY_KEY, w.id, JSON.stringify(entry));
  }
  // Last, so a claim can never see a half-built registry.
  await redis.set(ADMISSION_KEY, '1');
}

export async function deregisterWorker(redis: Redis, workerId: string): Promise<void> {
  await redis.hdel(REGISTRY_KEY, workerId);
  await redis.hdel(RESERVATIONS_KEY, workerId);
  await redis.del(healthKey(workerId));
}

/** Release has its own finite retry, independent of an exhausted cancel deadline. */
export async function releaseWorker(
  redis: Redis,
  workerId: string,
  token: string,
  log: Logger,
): Promise<boolean> {
  // Bounding the wait does not cancel Redis's command, so a late attempt can still land after
  // a newer claim. That is safe now: it carries this hold's token and frees nothing else.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await boundedRead(() => releaseWorkerIfToken(redis, workerId, token), 5_000);
    } catch (err) {
      if (attempt === 1) {
        workerReleaseFailuresTotal.inc();
        log.error({ workerId, err }, 'worker release failed after bounded retry');
      }
    }
  }
  return false;
}
