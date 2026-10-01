import type { Logger } from '@aivastra/logger';
import { queueDepth, workersHealthy } from '@aivastra/observability';
import { comfyVersionKey } from '@aivastra/types';
import type { Redis } from 'ioredis';
import { detectCapabilityDrift } from './capabilities.js';
import { sampleWorkerQueues } from './queue-sampler.js';
import { getWorkers, healthKey } from './registry.js';

const PROBE_INTERVAL_MS = 15_000;
const HEALTH_TTL_SEC = 30;
const JOB_STREAMS = ['jobs:priority', 'jobs:normal', 'jobs:low', 'jobs:video'] as const;

async function probeWorker(
  redis: Redis,
  workerId: string,
  workerUrl: string,
  apiKey: string,
): Promise<boolean> {
  try {
    const res = await fetch(`${workerUrl.replace(/\/$/, '')}/system_stats`, {
      headers: { 'X-Api-Key': apiKey },
      signal: AbortSignal.timeout(5_000),
    });
    if (res.ok) {
      try {
        const stats = (await res.json()) as { system?: { comfyui_version?: unknown } };
        if (
          typeof stats?.system?.comfyui_version === 'string' &&
          stats.system.comfyui_version.length > 0
        ) {
          await redis.setex(comfyVersionKey(workerId), 60, stats.system.comfyui_version);
        }
      } catch {
        // Version authorization fails closed when the body is unreadable, while
        // routing health keeps its existing HTTP-status semantics.
      }
    }
    return res.ok;
  } catch {
    return false;
  }
}

export function startHealthMonitor(redis: Redis, log: Logger): () => void {
  let running = true;
  let ticking = false;

  async function tick() {
    const workers = await getWorkers(redis);
    let healthyCount = 0;
    const healthyIds = new Set<string>();
    // Each worker renews health independently: slow/draining workers must not
    // delay healthy workers later in registry order, or drift checks delay routing.
    await Promise.allSettled(
      [...workers].map(async ([id, entry]) => {
        try {
          const healthy = await probeWorker(redis, id, entry.url, entry.apiKey);
          if (entry.status !== 'DRAINING') {
            if (healthy) {
              await redis.setex(healthKey(id), HEALTH_TTL_SEC, '1');
              healthyCount++;
              healthyIds.add(id);
              log.info({ workerId: id }, 'worker healthy');
            } else {
              log.warn({ workerId: id }, 'worker unhealthy — health key not renewed');
            }
          }
          // Draining workers retain version authorization without renewing health.
          await detectCapabilityDrift(redis, id, log);
        } catch (err) {
          log.error({ workerId: id, err }, 'worker monitor failed');
        }
      }),
    );
    workersHealthy.set(healthyCount);

    // Display-only /queue snapshot for the admin Workers view; routing never reads it.
    // Runs after health keys are renewed so a slow queue probe can't delay them.
    try {
      await sampleWorkerQueues(redis, healthyIds, log);
    } catch (err) {
      log.warn({ err }, 'worker queue sampling failed');
    }

    // Sample queue depth for each job stream
    for (const stream of JOB_STREAMS) {
      try {
        queueDepth.set({ stream }, await redis.xlen(stream));
      } catch (err) {
        log.warn({ err, stream }, 'failed to sample queue depth');
      }
    }
  }

  async function runTick() {
    // A delayed Redis read or queue snapshot must not stack overlapping monitor cycles.
    if (!running || ticking) return;
    ticking = true;
    try {
      await tick();
    } catch (err) {
      log.error({ err }, 'health monitor tick error');
    } finally {
      ticking = false;
    }
  }
  const interval = setInterval(runTick, PROBE_INTERVAL_MS);
  void runTick();

  return () => {
    running = false;
    clearInterval(interval);
  };
}
