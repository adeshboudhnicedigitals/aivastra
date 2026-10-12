import { createLogger, type Logger } from '@aivastra/logger';
import {
  perfProbeBackoff,
  perfSelectionMode,
  workerExternalBusyRejectionsTotal,
  workerReleaseFailuresTotal,
} from '@aivastra/observability';
import type { WorkerPool } from '@aivastra/types';
import type { Redis } from 'ioredis';
import type { SelectionMode } from '../perf/config.js';
import { NODE_COUNT_RULE_RELIABLE } from '../perf/performance-key.js';
import { healthKey, isQueueGateEnabled, REGISTRY_KEY, releaseWorkerIfBusy } from './registry.js';

const log = createLogger('worker-selector');

const RR_CURSOR_KEY = 'worker:rr_cursor';

// Lua script: atomically round-robin to the next IDLE+healthy worker that accepts
// the given job type, mark BUSY, return {id, url, apiKey}.
// ARGV[1] = Date.now() timestamp, ARGV[2] = jobType ('catalogue' | 'tryon').
// ARGV[3] = performance key (empty preserves round-robin).
// ARGV[4] = reliable executable-node rule available.
// ARGV[5..] = worker ids to skip this selection cycle (found externally busy).
// Workers with an empty allowedJobTypes array accept any job type.
export const CLAIM_LUA = `
local fields = redis.call('HGETALL', KEYS[1])
local n = #fields / 2
if n == 0 then return false end
local cursor = redis.call('INCR', KEYS[3])
local start = cursor % n
local jobType = ARGV[2]
local excluded = {}
for a = 5, #ARGV do excluded[ARGV[a]] = true end
local candidates = {}
local rankingReadable = true
local function candidateAt(i, id)
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
      if eligible then return {id=id, val=val} end
    end
  end
  return nil
end
for offset = 0, n - 1 do
  local i = ((start + offset) % n) * 2 + 1
  local id = fields[i]
  local candidate
  if #candidates == 0 then candidate = candidateAt(i, id)
  else
    -- Once round-robin has a winner, optional ranking must not make that claim fail.
    local ok
    ok, candidate = pcall(candidateAt, i, id)
    if not ok then rankingReadable = false break end
  end
  if candidate then table.insert(candidates, candidate) end
end
if #candidates == 0 then return false end
local actual = candidates[1]
local preferred = actual
local mode = 'off'
local backoffMs = 20000
local scores = {}
local baseline = nil
local usable = false
local function read(command, key, field)
  local reply
  if field then reply = redis.pcall(command, key, field)
  else reply = redis.pcall(command, key) end
  if type(reply) == 'table' and reply.err then return nil end
  return reply
end
local function positive(value)
  local number = tonumber(value)
  if number and number > 0 and number < math.huge then return number end
  return nil
end
if ARGV[3] ~= '' then
  local raw = read('GET', 'config:perf-routing')
  local ok, config = pcall(cjson.decode, raw or '')
  if ok and type(config) == 'table' then
    local configured = config.mode
    local valid = config.mode == 'off' or config.mode == 'observe' or config.mode == 'active'
    if config.alpha ~= nil and (type(config.alpha) ~= 'number' or config.alpha <= 0 or config.alpha > 1) then valid = false end
    if config.cacheExcludeThreshold ~= nil and (type(config.cacheExcludeThreshold) ~= 'number' or config.cacheExcludeThreshold < 0 or config.cacheExcludeThreshold % 1 ~= 0) then valid = false end
    if config.cachePolicyFrozen ~= nil and type(config.cachePolicyFrozen) ~= 'boolean' then valid = false end
    if config.poolBaselines ~= nil then
      if type(config.poolBaselines) ~= 'table' then valid = false
      else for _, value in pairs(config.poolBaselines) do if not positive(value) then valid = false end end end
    end
    if not valid then configured = 'off' end
    if config.pools ~= nil then
      if type(config.pools) ~= 'table' then configured = 'off'
      else
        for _, value in pairs(config.pools) do
          if value ~= 'off' and value ~= 'observe' and value ~= 'active' then valid = false end
        end
        if valid then configured = config.pools[jobType] or configured else configured = 'off' end
      end
    end
    if configured == 'observe' or configured == 'active' then
      mode = configured
      -- ACTIVE is pool-specific; provisional cache data cannot authorize a rollout.
      if mode == 'active' and (type(config.pools) ~= 'table' or config.pools[jobType] ~= 'active'
        or config.cachePolicyFrozen ~= true or config.cacheExcludeThreshold == nil or ARGV[4] ~= '1') then mode = 'observe' end
      if config.probeBackoffMs ~= nil then
        local duration = tonumber(config.probeBackoffMs)
        if type(config.probeBackoffMs) == 'number' and duration and duration >= 15000 and duration <= 30000 then backoffMs = duration
        else mode = 'off' end
      end
      if config.baselineMs ~= nil and (type(config.baselineMs) ~= 'number' or not positive(config.baselineMs)) then mode = 'off' end
      baseline = positive(read('GET', 'perf:baseline:' .. ARGV[3]))
      local hash = read('HGETALL', 'perf:score:' .. ARGV[3])
      usable = rankingReadable and mode ~= 'off' and baseline ~= nil and type(hash) == 'table' and #hash > 0
      if usable then
        for i = 1, #hash, 2 do
          local score = positive(hash[i+1])
          if not score then usable = false break end
          scores[hash[i]] = score
        end
      end
    end
  end
end
if usable then
  local ranked = candidates
  if mode == 'active' then
    local available = {}
    local soonest = nil
    local soonestTtl = math.huge
    for _, candidate in ipairs(candidates) do
      local ttl = read('PTTL', 'worker:probe-backoff:' .. candidate.id)
      if type(ttl) ~= 'number' then usable = false break end
      if ttl == -1 then usable = false break end
      if ttl <= 0 then table.insert(available, candidate)
      elseif ttl < soonestTtl then soonest = candidate soonestTtl = ttl end
    end
    if #available > 0 then ranked = available
    elseif soonest then ranked = {soonest} end
  end
  if usable then
    local minimum = math.huge
    for _, candidate in ipairs(ranked) do
      minimum = math.min(minimum, scores[candidate.id] or baseline)
    end
    for _, candidate in ipairs(ranked) do
      if (scores[candidate.id] or baseline) <= minimum * 1.10 then preferred = candidate break end
    end
    if mode == 'active' then actual = preferred end
  end
end
if not usable then
  preferred = actual
  if mode == 'active' then mode = 'observe' end
end
actual.val.status = 'BUSY'
actual.val.lastSeen = tonumber(ARGV[1])
redis.call('HSET', KEYS[1], actual.id, cjson.encode(actual.val))
return {actual.id, actual.val.url, actual.val.apiKey, preferred.id,
  usable and tostring(scores[actual.id] or baseline) or '',
  usable and tostring(scores[preferred.id] or baseline) or '', mode, tostring(backoffMs)}
`;

export interface ClaimedWorker {
  id: string;
  url: string;
  apiKey: string;
  performance?: {
    preferredWorker: string;
    actualWorkerScore?: number;
    preferredWorkerScore?: number;
    selectionMode: SelectionMode;
  };
}

// A dev can be running a workflow straight in a worker's ComfyUI, invisible to our Redis
// bookkeeping. Bounded so a network problem can't hold a consumer slot for
// timeout × workerCount; the round-robin cursor advances on every claim, so a capped
// selection still reaches the workers beyond the window on the next call.
const MAX_QUEUE_PROBES = 4;
const QUEUE_PROBE_TIMEOUT_MS = 2_000;

type SkipReason = 'queue_not_empty' | 'unreadable';
type QueueProbeResult =
  | { available: true }
  | { available: false; reason: SkipReason; queueRemaining?: number };

/** Fail closed: anything other than a numeric `queue_remaining === 0` is "not available". */
async function isComfyQueueEmpty(url: string, apiKey: string): Promise<QueueProbeResult> {
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/prompt`, {
      headers: { 'X-Api-Key': apiKey },
      signal: AbortSignal.timeout(QUEUE_PROBE_TIMEOUT_MS),
    });
    if (!res.ok) return { available: false, reason: 'unreadable' };
    const body = (await res.json()) as { exec_info?: { queue_remaining?: unknown } };
    const remaining = body?.exec_info?.queue_remaining;
    if (remaining === 0) return { available: true };
    return typeof remaining === 'number'
      ? { available: false, reason: 'queue_not_empty', queueRemaining: remaining }
      : { available: false, reason: 'unreadable' };
  } catch {
    return { available: false, reason: 'unreadable' };
  }
}

// A worker stuck BUSY is lost capacity until a dispatcher restart, so retry once and
// make a persistent failure loud.
async function releaseUnused(redis: Redis, workerId: string, selectorLog: Logger): Promise<void> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await releaseWorkerIfBusy(redis, workerId);
      return;
    } catch (err) {
      if (attempt === 2) {
        workerReleaseFailuresTotal.inc();
        selectorLog.error(
          { err, workerId },
          'failed to release unused worker — stuck BUSY until restart',
        );
      }
    }
  }
}

// Atomically claims ONE specific worker id if it's IDLE, healthy, and eligible
// for the job type — sibling to CLAIM_LUA above rather than a modification of
// it, since a worker-pinning claim has nothing to do with round-robin cursors
// or performance ranking and should carry none of that blast radius.
// ARGV[1] = worker id, ARGV[2] = Date.now() timestamp, ARGV[3] = jobType.
export const CLAIM_SPECIFIC_LUA = `
local raw = redis.call('HGET', KEYS[1], ARGV[1])
if not raw then return false end
local ok, val = pcall(cjson.decode, raw)
if not ok or val.status ~= 'IDLE' then return false end
if redis.call('EXISTS', KEYS[2] .. ARGV[1]) ~= 1 then return false end
local jobType = ARGV[3]
local allowed = val.allowedJobTypes
if allowed and #allowed > 0 then
  local eligible = false
  for _, t in ipairs(allowed) do
    if t == jobType then eligible = true break end
  end
  if not eligible then return false end
end
val.status = 'BUSY'
val.lastSeen = tonumber(ARGV[2])
redis.call('HSET', KEYS[1], ARGV[1], cjson.encode(val))
return {val.url, val.apiKey}
`;

/**
 * Tries to claim a job to one of a caller-pinned set of workers — primary ids
 * in order, then fallback ids in order — instead of the normal round-robin
 * pool. Returns null the moment every id in both lists has been tried and
 * none was claimable; callers must treat that as a hard failure, not a cue to
 * fall back to selectWorker(), per the no-silent-fallback requirement this
 * exists for.
 */
export async function selectPreferredWorker(
  redis: Redis,
  jobType: WorkerPool,
  primaryIds: string[],
  fallbackIds: string[],
  ctx?: { jobId?: string; log?: Logger },
): Promise<ClaimedWorker | null> {
  const healthPrefix = healthKey(''); // "worker:health:"
  const selectorLog = ctx?.log ?? log;
  const tried: string[] = [];

  for (const id of [...primaryIds, ...fallbackIds]) {
    const result = (await redis.eval(
      CLAIM_SPECIFIC_LUA,
      2,
      REGISTRY_KEY,
      healthPrefix,
      id,
      String(Date.now()),
      jobType,
    )) as [string, string] | false | null;

    if (!result) {
      tried.push(id);
      continue;
    }
    const [url, apiKey] = result;
    const claimed: ClaimedWorker = { id, url, apiKey };

    try {
      if (!(await isQueueGateEnabled(redis, id))) return claimed;
      const probe = await isComfyQueueEmpty(url, apiKey);
      if (probe.available) return claimed;
    } catch (err) {
      await releaseUnused(redis, id, selectorLog);
      throw err;
    }

    workerExternalBusyRejectionsTotal.inc({ reason: 'queue_not_empty_or_unreadable' });
    selectorLog.info(
      { workerId: id, jobId: ctx?.jobId, pool: jobType },
      'pinned worker busy or unreadable in ComfyUI — trying next pinned worker',
    );
    tried.push(id);
    await releaseUnused(redis, id, selectorLog);
  }

  selectorLog.info(
    { pool: jobType, jobId: ctx?.jobId, tried, primaryIds, fallbackIds },
    'no pinned worker (primary or fallback) was claimable',
  );
  return null;
}

export async function selectWorker(
  redis: Redis,
  jobType: WorkerPool,
  performanceKey?: string,
  ctx?: { jobId?: string; log?: Logger },
): Promise<ClaimedWorker | null> {
  const healthPrefix = healthKey(''); // "worker:health:"
  const selectorLog = ctx?.log ?? log;
  const excluded: string[] = [];
  const reasons: SkipReason[] = [];
  const noWorker = () => {
    selectorLog.info(
      { pool: jobType, jobId: ctx?.jobId, skippedWorkers: excluded, reasons },
      'no eligible worker after probes',
    );
    return null;
  };
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
      performanceKey ?? '',
      NODE_COUNT_RULE_RELIABLE ? '1' : '0',
      ...excluded,
    )) as [string, string, string, string, string, string, SelectionMode, string] | false | null;

    if (!result) return noWorker();
    const [
      id,
      url,
      apiKey,
      preferredWorker,
      actualScore,
      preferredScore,
      selectionMode,
      backoffMs,
    ] = result;
    perfSelectionMode.inc({ mode: selectionMode, pool: jobType });
    const claimed: ClaimedWorker = {
      id,
      url,
      apiKey,
      ...(performanceKey
        ? {
            performance: {
              preferredWorker,
              actualWorkerScore: actualScore ? Number(actualScore) : undefined,
              preferredWorkerScore: preferredScore ? Number(preferredScore) : undefined,
              selectionMode,
            },
          }
        : {}),
    };

    let probe: QueueProbeResult;
    let probeMs: number;
    try {
      if (!(await isQueueGateEnabled(redis, id))) return claimed;
      const probeStartedAt = Date.now();
      probe = await isComfyQueueEmpty(url, apiKey);
      probeMs = Date.now() - probeStartedAt;
      if (probe.available) return claimed;
    } catch (err) {
      await releaseUnused(redis, id, selectorLog);
      throw err;
    }

    workerExternalBusyRejectionsTotal.inc({ reason: 'queue_not_empty_or_unreadable' });
    selectorLog.info(
      {
        workerId: id,
        jobId: ctx?.jobId,
        pool: jobType,
        attempt: probes + 1,
        reason: probe.reason,
        ...(probe.queueRemaining !== undefined ? { queueRemaining: probe.queueRemaining } : {}),
        probeMs,
        selectionMode,
      },
      'worker busy or unreadable in ComfyUI — skipping',
    );
    reasons.push(probe.reason);
    excluded.push(id);
    await releaseUnused(redis, id, selectorLog);
    if (selectionMode === 'active') {
      try {
        await redis.set(`worker:probe-backoff:${id}`, '1', 'PX', Number(backoffMs));
        perfProbeBackoff.inc({ pool: jobType });
      } catch (err) {
        selectorLog.warn({ err, workerId: id }, 'performance probe backoff dropped');
      }
    }
  }
  return noWorker();
}
