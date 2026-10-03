import type { Logger } from '@aivastra/logger';
import type { WorkerPool } from '@aivastra/types';
import type { Redis } from 'ioredis';
import { JobCancelledError, type WaitForCompletionResult } from '../comfyui/progress.js';
import { getWorkers, REGISTRY_KEY, type WorkerEntry } from '../worker/registry.js';
import type { ClaimedWorker } from '../worker/selector.js';
import { promptNodeCount } from './performance-key.js';
import { recordSample, type Sample, type SampleOutcome } from './record-sample.js';

// Pending success samples on early-return paths can be lost; statistics are best-effort.
const pendingSamples = new WeakMap<ClaimedWorker, { redis: Redis; sample: Sample }>();

export function settlePerformanceSample(worker: ClaimedWorker, outcome: SampleOutcome): void {
  const pending = pendingSamples.get(worker);
  if (!pending) return;
  pendingSamples.delete(worker);
  void recordSample(pending.redis, { ...pending.sample, outcome });
}

export async function observeCompletion(
  redis: Redis,
  worker: ClaimedWorker,
  pool: WorkerPool,
  performanceKey: string,
  graph: Record<string, unknown>,
  log: Logger,
  wait: (totalNodeCount: number) => Promise<WaitForCompletionResult>,
): Promise<WaitForCompletionResult> {
  const count = promptNodeCount(graph);
  const observing = worker.performance?.selectionMode !== 'off' && worker.performance !== undefined;
  const samples: { at: number; busy: boolean }[] = [];
  let probing = false;
  let stopped = false;
  let siblings: string[] = [];
  let timer: ReturnType<typeof setInterval> | undefined;
  const probe = async () => {
    if (probing || stopped || !observing) return;
    probing = true;
    try {
      const entries = siblings.length ? await redis.hmget(REGISTRY_KEY, ...siblings) : [];
      samples.push({
        at: Date.now(),
        busy: entries.some((raw) => {
          try {
            return raw !== null && (JSON.parse(raw) as WorkerEntry).status === 'BUSY';
          } catch {
            return false;
          }
        }),
      });
    } catch (err) {
      log.debug({ err }, 'shared GPU measurement unavailable');
    } finally {
      probing = false;
    }
  };
  if (observing)
    void (async () => {
      try {
        const raw = await redis.hget(REGISTRY_KEY, worker.id);
        const group = raw ? (JSON.parse(raw) as WorkerEntry).gpuGroup : undefined;
        if (!group || stopped) return;
        const workers = await getWorkers(redis);
        siblings = [...workers]
          .filter(([id, entry]) => id !== worker.id && entry.gpuGroup === group)
          .map(([id]) => id);
        if (stopped) return;
        await probe();
        if (stopped) return;
        timer = setInterval(() => {
          void probe();
        }, 1_000);
        timer.unref();
      } catch (err) {
        log.debug({ err }, 'shared GPU measurement unavailable');
      }
    })();
  const record = (outcome: SampleOutcome, result?: WaitForCompletionResult) => {
    if (!observing) return;
    const timing = result?.status === 'completed' ? result.executionTiming : undefined;
    const end = Date.now();
    const duration = timing ? timing.executionSuccessMs - timing.executionStartMs : undefined;
    const start = duration !== undefined ? end - duration : end;
    const prior = samples.filter((sample) => sample.at <= start).at(-1);
    let overlap = 0;
    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i];
      if (sample?.busy)
        overlap += Math.max(
          0,
          Math.min(end, samples[i + 1]?.at ?? end) - Math.max(start, sample.at),
        );
    }
    log.info(
      {
        jobType: pool,
        performanceKey,
        actualWorker: worker.id,
        actualExecutionMs: duration,
        cachedNodeCount: timing?.cachedNodeCount,
        totalNodeCount: count.totalNodeCount,
        totalNodeCountReliable: count.reliable,
        siblingGpuBusyAtStart: prior?.busy,
        siblingGpuOverlapMs: samples.length ? overlap : undefined,
      },
      'worker performance completion',
    );
    const sample: Sample = {
      workerId: worker.id,
      performanceKey,
      pool,
      outcome,
      executionTiming: timing,
      totalNodeCountReliable: count.reliable,
    };
    // A successful GPU run is not yet a successful job: output finalization can lose to cancel.
    if (outcome === 'success') pendingSamples.set(worker, { redis, sample });
    else void recordSample(redis, sample);
  };
  try {
    const result = await wait(count.totalNodeCount);
    record(result.status === 'completed' ? 'success' : 'cleanup_failure', result);
    return result;
  } catch (err) {
    const outcome =
      err instanceof JobCancelledError
        ? 'cancelled'
        : err instanceof Error && err.message.startsWith('ComfyUI history polling timeout')
          ? 'execution_timeout'
          : 'workflow_failure';
    record(outcome);
    throw err;
  } finally {
    stopped = true;
    if (timer) clearInterval(timer);
  }
}

export function logSelection(
  redis: Redis,
  worker: ClaimedWorker,
  pool: WorkerPool,
  performanceKey: string,
  log: Logger,
): void {
  if (!worker.performance || worker.performance.selectionMode === 'off') return;
  void redis
    .hget(`worker:perfstats:${worker.id}:${performanceKey}`, 'sampleCount')
    .then((count) => {
      log.info(
        {
          jobType: pool,
          performanceKey,
          actualWorker: worker.id,
          preferredWorker: worker.performance?.preferredWorker,
          actualWorkerScore: worker.performance?.actualWorkerScore,
          preferredWorkerScore: worker.performance?.preferredWorkerScore,
          scoreSampleCount: Number(count ?? 0),
          selectionMode: worker.performance?.selectionMode,
        },
        'worker performance selection',
      );
    })
    .catch((err) => log.debug({ err }, 'worker performance selection metadata unavailable'));
}
