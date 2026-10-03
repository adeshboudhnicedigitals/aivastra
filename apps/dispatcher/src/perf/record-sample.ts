import { createLogger } from '@aivastra/logger';
import { perfCachedSkips, perfSamples } from '@aivastra/observability';
import type { WorkerPool } from '@aivastra/types';
import type { Redis } from 'ioredis';
import type { ExecutionTiming } from '../comfyui/execution-timing.js';
import { AGE_DECAY_MS, MIN_SAMPLES, PERF_TTL_SECONDS, readPerfConfig } from './config.js';

const log = createLogger('performance-samples');
const CACHE_DIST_LIMIT = 256;
// Bound distinct counts atomically, including when multiple dispatchers collect the same key.
const CACHE_DIST_LUA = `
if redis.call('HEXISTS', KEYS[1], ARGV[1]) == 1 or redis.call('HLEN', KEYS[1]) < tonumber(ARGV[2]) then
  redis.call('HINCRBY', KEYS[1], ARGV[1], 1)
end
redis.call('EXPIRE', KEYS[1], ARGV[3])
`;
function counter(value: string | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
async function readStats(redis: Redis, key: string): Promise<Record<string, string>> {
  try {
    return await redis.hgetall(key);
  } catch (err) {
    log.warn({ err, key }, 'performance aggregate unreadable');
    return {};
  }
}
export type SampleOutcome =
  | 'success'
  | 'cancelled'
  | 'execution_timeout'
  | 'workflow_failure'
  | 'queue_timeout'
  | 'cleanup_failure';
export interface Sample {
  workerId: string;
  performanceKey: string;
  pool: WorkerPool;
  outcome: SampleOutcome;
  executionTiming?: ExecutionTiming;
  totalNodeCountReliable: boolean;
}
export interface PerfStats {
  ewmaExecutionMs: number;
  sampleCount: number;
  updatedAt: number;
}

export function effectiveScore(stats: PerfStats, baseline: number, now = Date.now()): number {
  const ageConfidence = Math.max(0, 1 - Math.max(0, now - stats.updatedAt) / AGE_DECAY_MS);
  const confidence = Math.min(1, stats.sampleCount / MIN_SAMPLES) * ageConfidence;
  return confidence * stats.ewmaExecutionMs + (1 - confidence) * baseline;
}
export function median(values: number[]): number {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  const upper = ordered[middle];
  const lower = ordered[middle - 1];
  if (upper === undefined) throw new Error('Median requires samples');
  return ordered.length % 2 ? upper : ((lower ?? upper) + upper) / 2;
}

// Serialize writes/refreshes within this single dispatcher without blocking dispatch or losing EWMA updates.
const pending = new WeakMap<Redis, Promise<void>>();
function enqueue(redis: Redis, task: () => Promise<void>): Promise<void> {
  const next = (pending.get(redis) ?? Promise.resolve()).then(task).catch((err) => {
    log.warn({ err }, 'performance statistics write dropped');
  });
  pending.set(redis, next);
  return next;
}

async function refreshScores(
  redis: Redis,
  performanceKey: string,
  pool: WorkerPool,
  now = Date.now(),
): Promise<void> {
  const config = await readPerfConfig(redis);
  const mode = config.pools?.[pool] ?? config.mode;
  if (mode === 'off') return;
  const registry = await redis.hkeys('worker:registry');
  const stats = await Promise.all(
    registry.map(async (workerId) => {
      const raw = await readStats(redis, `worker:perfstats:${workerId}:${performanceKey}`);
      return {
        workerId,
        ewmaExecutionMs: Number(raw.ewmaExecutionMs),
        sampleCount: Number(raw.sampleCount),
        updatedAt: Number(raw.updatedAt),
      };
    }),
  );
  const usable = stats.filter(
    (s) =>
      Number.isFinite(s.ewmaExecutionMs) &&
      s.ewmaExecutionMs > 0 &&
      Number.isFinite(s.sampleCount) &&
      s.sampleCount > 0 &&
      Number.isFinite(s.updatedAt),
  );
  const mature = usable.filter((s) => s.sampleCount >= MIN_SAMPLES);
  const override = Number(await redis.get(`perf:baseline:${performanceKey}:configured`));
  const configured =
    Number.isFinite(override) && override > 0
      ? override
      : (config.poolBaselines?.[pool] ?? config.baselineMs);
  const baseline = mature.length >= 3 ? median(mature.map((s) => s.ewmaExecutionMs)) : configured;
  const transaction = redis.multi();
  transaction.set(`perf:baseline:${performanceKey}`, String(baseline), 'EX', PERF_TTL_SECONDS);
  const scores: Record<string, number> = {};
  for (const workerId of registry) {
    const workerStats = usable.find((s) => s.workerId === workerId);
    scores[workerId] = workerStats ? effectiveScore(workerStats, baseline, now) : baseline;
  }
  if (registry.length) transaction.hset(`perf:score:${performanceKey}`, scores);
  transaction.expire(`perf:score:${performanceKey}`, PERF_TTL_SECONDS);
  transaction.set(`perf:score:${performanceKey}:ts`, String(now), 'EX', PERF_TTL_SECONDS);
  const result = await transaction.exec();
  const error = result?.find(([err]) => err)?.[0];
  if (error) throw error;
}

export function recordSample(redis: Redis, sample: Sample): Promise<void> {
  return enqueue(redis, async () => {
    const config = await readPerfConfig(redis);
    if ((config.pools?.[sample.pool] ?? config.mode) === 'off') return;
    const key = `worker:perfstats:${sample.workerId}:${sample.performanceKey}`;
    const raw = await redis.hgetall(key);
    const fields: Record<string, string | number> = {
      pool: sample.pool,
      performanceKey: sample.performanceKey,
    };
    const counters: Record<SampleOutcome, string> = {
      success: 'successCount',
      cancelled: 'cancelledCount',
      execution_timeout: 'timeoutCount',
      workflow_failure: 'failedCount',
      queue_timeout: 'queueTimeoutCount',
      cleanup_failure: 'cleanupFailureCount',
    };
    let reason: string = sample.outcome;
    let accepted = false;
    const timing = sample.executionTiming;
    if (sample.outcome === 'success') {
      fields.lastTotalNodeCountReliable = String(sample.totalNodeCountReliable);
      if (timing) {
        if (Number.isSafeInteger(timing.cachedNodeCount) && timing.cachedNodeCount >= 0)
          await redis.eval(
            CACHE_DIST_LUA,
            1,
            `perf:cachedist:${sample.performanceKey}`,
            String(timing.cachedNodeCount),
            String(CACHE_DIST_LIMIT),
            String(PERF_TTL_SECONDS),
          );
        fields.lastCachedNodeCount = timing.cachedNodeCount;
        fields.lastTotalNodeCount = timing.totalNodeCount;
        fields.lastExecutionMs = timing.executionSuccessMs - timing.executionStartMs;
      }
      if (!timing) reason = 'missing_timing';
      else if (
        !Number.isFinite(timing.executionSuccessMs - timing.executionStartMs) ||
        timing.executionSuccessMs <= timing.executionStartMs
      )
        reason = 'invalid_timing';
      else if (
        config.cachePolicyFrozen === true && config.cacheExcludeThreshold !== undefined
          ? timing.cachedNodeCount > config.cacheExcludeThreshold
          : sample.totalNodeCountReliable &&
            timing.totalNodeCount > 0 &&
            timing.cachedNodeCount >= timing.totalNodeCount
      ) {
        reason =
          config.cachePolicyFrozen === true && config.cacheExcludeThreshold !== undefined
            ? 'cached'
            : 'fully_cached';
        fields.cachedSkipCount = counter(raw.cachedSkipCount) + 1;
        perfCachedSkips.inc();
      } else {
        accepted = true;
        reason = 'usable';
        const count =
          Number.isFinite(Number(raw.ewmaExecutionMs)) && Number(raw.ewmaExecutionMs) > 0
            ? counter(raw.sampleCount)
            : 0;
        const executionMs = timing.executionSuccessMs - timing.executionStartMs;
        fields.ewmaExecutionMs =
          count > 0
            ? config.alpha * executionMs + (1 - config.alpha) * Number(raw.ewmaExecutionMs)
            : executionMs;
        fields.sampleCount = count + 1;
        fields.updatedAt = Date.now();
        // A policy flip cannot certify an EWMA that still contains provisional samples.
        fields.cachePolicy =
          sample.totalNodeCountReliable &&
          config.cachePolicyFrozen === true &&
          config.cacheExcludeThreshold !== undefined &&
          raw.cachePolicy !== 'provisional'
            ? 'frozen'
            : 'provisional';
      }
    }
    fields[counters[sample.outcome]] = counter(raw[counters[sample.outcome]]) + 1;
    fields[`skip_${reason}`] = accepted
      ? counter(raw[`skip_${reason}`])
      : counter(raw[`skip_${reason}`]) + 1;
    await redis.hset(key, fields);
    await redis.expire(key, PERF_TTL_SECONDS);
    perfSamples.inc({ outcome: accepted ? 'accepted' : 'skipped', reason });
    if (!accepted)
      log.info(
        {
          workerId: sample.workerId,
          performanceKey: sample.performanceKey,
          reason,
          cachedNodeCount: timing?.cachedNodeCount,
          totalNodeCount: timing?.totalNodeCount,
          totalNodeCountReliable: sample.totalNodeCountReliable,
        },
        'performance sample skipped',
      );
    if (accepted) await refreshScores(redis, sample.performanceKey, sample.pool);
  });
}

export function refreshPerformanceScores(redis: Redis): Promise<void> {
  return enqueue(redis, async () => {
    let cursor = '0';
    const keys = new Map<string, WorkerPool>();
    do {
      const [next, matches] = await redis.scan(cursor, 'MATCH', 'worker:perfstats:*', 'COUNT', 100);
      cursor = next;
      for (const key of matches) {
        const raw = await readStats(redis, key);
        if (raw.performanceKey && raw.pool) keys.set(raw.performanceKey, raw.pool as WorkerPool);
      }
    } while (cursor !== '0');
    for (const [key, pool] of keys) await refreshScores(redis, key, pool);
  });
}

export function startPerformanceRefresh(redis: Redis): () => void {
  const timer = setInterval(() => {
    void refreshPerformanceScores(redis);
  }, 5 * 60_000);
  timer.unref();
  return () => clearInterval(timer);
}
