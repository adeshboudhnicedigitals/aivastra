import type { Logger } from '@aivastra/logger';
import {
  comfyWorkerExternalBusy,
  comfyWorkerQueueProbeDuration,
  comfyWorkerQueueProbesTotal,
  comfyWorkerQueueRemaining,
} from '@aivastra/observability';
import type { Redis } from 'ioredis';
import { getWorkers, queueSnapshotKey } from './registry.js';

const QUEUE_PROBE_TIMEOUT_MS = 3_000;
// Longer than the 15s monitor interval so one slow tick doesn't blank the admin view,
// short enough that a dead monitor stops looking current.
const SNAPSHOT_TTL_SEC = 60;

export interface QueueSnapshot {
  queueRemaining: number | null;
  running: number | null;
  pending: number | null;
  probedAt: number;
  error?: string;
}

/** GET /queue → running + pending counts. Never throws; failure is recorded in `error`. */
export async function sampleQueue(url: string, apiKey: string): Promise<QueueSnapshot> {
  const probedAt = Date.now();
  const stop = comfyWorkerQueueProbeDuration.startTimer();
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/queue`, {
      headers: { 'X-Api-Key': apiKey },
      signal: AbortSignal.timeout(QUEUE_PROBE_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { queue_running?: unknown; queue_pending?: unknown };
    if (!Array.isArray(body.queue_running) || !Array.isArray(body.queue_pending)) {
      throw new Error('unexpected /queue shape');
    }
    const running = body.queue_running.length;
    const pending = body.queue_pending.length;
    comfyWorkerQueueProbesTotal.inc({ result: 'ok' });
    return { queueRemaining: running + pending, running, pending, probedAt };
  } catch (err) {
    comfyWorkerQueueProbesTotal.inc({ result: 'error' });
    return {
      queueRemaining: null,
      running: null,
      pending: null,
      probedAt,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    stop();
  }
}

/**
 * Samples every non-draining, healthy worker in parallel and writes the display snapshot.
 * "External" = registry says IDLE yet ComfyUI has work — a BUSY worker's queue is our own job.
 */
export async function sampleWorkerQueues(
  redis: Redis,
  healthyIds: ReadonlySet<string>,
  log: Logger,
): Promise<void> {
  const workers = await getWorkers(redis);
  await Promise.all(
    [...workers]
      .filter(([id, entry]) => entry.status !== 'DRAINING' && healthyIds.has(id))
      .map(async ([id, entry]) => {
        const snap = await sampleQueue(entry.url, entry.apiKey);
        try {
          await redis.setex(queueSnapshotKey(id), SNAPSHOT_TTL_SEC, JSON.stringify(snap));
        } catch (err) {
          log.warn({ err, workerId: id }, 'failed to write worker queue snapshot');
        }
        if (snap.queueRemaining === null) {
          comfyWorkerQueueRemaining.remove({ worker_id: id });
          comfyWorkerExternalBusy.remove({ worker_id: id });
          log.warn({ workerId: id, error: snap.error }, 'worker queue probe failed');
          return;
        }
        comfyWorkerQueueRemaining.set({ worker_id: id }, snap.queueRemaining);
        comfyWorkerExternalBusy.set(
          { worker_id: id },
          entry.status === 'IDLE' && snap.queueRemaining > 0 ? 1 : 0,
        );
      }),
  );
}
