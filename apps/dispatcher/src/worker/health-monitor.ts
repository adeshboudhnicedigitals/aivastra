import type { Redis } from 'ioredis';
import type { Logger } from '@aivastra/logger';
import { getWorkers, healthKey } from './registry.js';

const PROBE_INTERVAL_MS = 15_000;
const HEALTH_TTL_SEC = 30;

async function probeWorker(
  workerId: string,
  workerUrl: string,
  apiKey: string,
): Promise<boolean> {
  try {
    const res = await fetch(`${workerUrl}/system_stats`, {
      headers: { 'X-Api-Key': apiKey },
      signal: AbortSignal.timeout(5_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function startHealthMonitor(
  redis: Redis,
  apiKey: string,
  log: Logger,
): () => void {
  let running = true;

  async function tick() {
    const workers = await getWorkers(redis);
    for (const [id, entry] of workers) {
      if (entry.status === 'DRAINING') continue;
      const healthy = await probeWorker(id, entry.url, apiKey);
      if (healthy) {
        await redis.setex(healthKey(id), HEALTH_TTL_SEC, '1');
        log.info({ workerId: id }, 'worker healthy');
      } else {
        log.warn({ workerId: id }, 'worker unhealthy — health key not renewed');
      }
    }
  }

  const interval = setInterval(async () => {
    if (!running) return;
    try { await tick(); } catch (err) { log.error({ err }, 'health monitor tick error'); }
  }, PROBE_INTERVAL_MS);

  // Run immediately on start
  tick().catch((err) => log.error({ err }, 'health monitor initial tick error'));

  return () => {
    running = false;
    clearInterval(interval);
  };
}
