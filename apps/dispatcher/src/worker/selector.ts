import { createLogger } from '@aivastra/logger';
import {
  workerExternalBusyRejectionsTotal,
  workerReleaseFailuresTotal,
} from '@aivastra/observability';
import type { WorkerPool } from '@aivastra/types';
import type { Redis } from 'ioredis';
import { healthKey, isQueueGateEnabled, REGISTRY_KEY, releaseWorkerIfBusy } from './registry.js';

const log = createLogger('worker-selector');

const RR_CURSOR_KEY = 'worker:rr_cursor';

// Lua script: atomically round-robin to the next IDLE+healthy worker that accepts
// the given job type, mark BUSY, return {id, url, apiKey}.
// ARGV[1] = Date.now() timestamp, ARGV[2] = jobType ('catalogue' | 'tryon').
// ARGV[3..] = worker ids to skip this selection cycle (found externally busy).
// Workers with an empty allowedJobTypes array accept any job type.
const CLAIM_LUA = `
local fields = redis.call('HGETALL', KEYS[1])
local n = #fields / 2
if n == 0 then return false end
local cursor = redis.call('INCR', KEYS[3])
local start = cursor % n
local jobType = ARGV[2]
local excluded = {}
for a = 3, #ARGV do excluded[ARGV[a]] = true end
for offset = 0, n - 1 do
  local i = ((start + offset) % n) * 2 + 1
  local id = fields[i]
  local ok, val = pcall(cjson.decode, fields[i+1])
  if ok and val.status == 'IDLE' and not excluded[id] then
    if redis.call('EXISTS', KEYS[2] .. id) == 1 then
      local eligible = true
      local allowed = val.allowedJobTypes
      if allowed and #allowed > 0 then
        eligible = false
        for _, t in ipairs(allowed) do
          if t == jobType then eligible = true break end
        end
      end
      if eligible then
        val.status = 'BUSY'
        val.lastSeen = tonumber(ARGV[1])
        redis.call('HSET', KEYS[1], id, cjson.encode(val))
        return {id, val.url, val.apiKey}
      end
    end
  end
end
return false
`;

export interface ClaimedWorker {
  id: string;
  url: string;
  apiKey: string;
}

// A dev can be running a workflow straight in a worker's ComfyUI, invisible to our Redis
// bookkeeping. Bounded so a network problem can't hold a consumer slot for
// timeout × workerCount; the round-robin cursor advances on every claim, so a capped
// selection still reaches the workers beyond the window on the next call.
const MAX_QUEUE_PROBES = 4;
const QUEUE_PROBE_TIMEOUT_MS = 2_000;

/** Fail closed: anything other than a numeric `queue_remaining === 0` is "not available". */
async function isComfyQueueEmpty(url: string, apiKey: string): Promise<boolean> {
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/prompt`, {
      headers: { 'X-Api-Key': apiKey },
      signal: AbortSignal.timeout(QUEUE_PROBE_TIMEOUT_MS),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { exec_info?: { queue_remaining?: unknown } };
    return body?.exec_info?.queue_remaining === 0;
  } catch {
    return false;
  }
}

// A worker stuck BUSY is lost capacity until a dispatcher restart, so retry once and
// make a persistent failure loud.
async function releaseUnused(redis: Redis, workerId: string): Promise<void> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await releaseWorkerIfBusy(redis, workerId);
      return;
    } catch (err) {
      if (attempt === 2) {
        workerReleaseFailuresTotal.inc();
        log.error({ err, workerId }, 'failed to release unused worker — stuck BUSY until restart');
      }
    }
  }
}

export async function selectWorker(
  redis: Redis,
  jobType: WorkerPool,
): Promise<ClaimedWorker | null> {
  const healthPrefix = healthKey(''); // "worker:health:"
  const excluded: string[] = [];
  // Per-worker probe gate: the live probe runs AFTER the atomic claim, never off a cached
  // value, so two dispatcher jobs still can't take one worker and the queue read isn't stale.
  for (let probes = 0; probes < MAX_QUEUE_PROBES; probes++) {
    const result = (await redis.eval(
      CLAIM_LUA,
      3,
      REGISTRY_KEY,
      healthPrefix,
      RR_CURSOR_KEY,
      String(Date.now()),
      jobType,
      ...excluded,
    )) as [string, string, string] | false | null;

    if (!result) return null;
    const [id, url, apiKey] = result;

    try {
      if (!(await isQueueGateEnabled(redis, id))) return { id, url, apiKey };
      if (await isComfyQueueEmpty(url, apiKey)) return { id, url, apiKey };
    } catch (err) {
      await releaseUnused(redis, id);
      throw err;
    }

    workerExternalBusyRejectionsTotal.inc({ reason: 'queue_not_empty_or_unreadable' });
    log.info({ workerId: id }, 'worker busy or unreadable in ComfyUI — skipping');
    excluded.push(id);
    await releaseUnused(redis, id);
  }
  return null;
}
