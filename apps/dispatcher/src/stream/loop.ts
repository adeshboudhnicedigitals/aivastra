import type { Logger } from '@aivastra/logger';
import type { ProcessorConfig } from '../job/processor.js';
import { processJob } from '../job/processor.js';
import { type Lane, laneOccupancy } from './lane-tickets.js';
import {
  kick,
  maxParkedJobs,
  type ParkedJob,
  parkedCount,
  registerLane,
  resumeEnded,
  unregisterLane,
} from './parked.js';

export const DISPATCHER_GROUP = 'dispatcher-cg';

export type XReadGroupResult = Array<[string, Array<[string, string[]]>]> | null;

export interface StreamMessage {
  stream: string;
  messageId: string;
  jobId: string;
  userId: string;
  /** Times this job has been re-XADDed after finding no free worker. 0 for a fresh message. */
  retryCount: number;
}

export function parseMessage(stream: string, result: XReadGroupResult): StreamMessage | null {
  if (!result?.[0]?.[1].length) return null;
  const entry = result[0][1][0];
  if (!entry) return null;
  const [messageId, fields] = entry;
  const fieldMap: Record<string, string> = {};
  for (let i = 0; i < fields.length; i += 2) {
    const k = fields[i];
    const v = fields[i + 1];
    if (k !== undefined && v !== undefined) fieldMap[k] = v;
  }
  // userId is absent for widget jobs (which use merchantId from the DB row instead)
  if (!fieldMap.jobId) return null;
  const retryCount = Number.parseInt(fieldMap.retryCount ?? '0', 10);
  return {
    stream,
    messageId,
    jobId: fieldMap.jobId,
    userId: fieldMap.userId ?? '',
    retryCount: Number.isFinite(retryCount) ? retryCount : 0,
  };
}

export interface StreamLoopOptions {
  /** Lane name, bound to every log line so the two loops are distinguishable. */
  name: Lane;
  /** Reads at most one message; checks isRunning before any further claims after an await. */
  read: (isRunning: () => boolean) => Promise<StreamMessage | null>;
  /** Current in-flight cap. Called on every slot check — implementations cache. */
  getConcurrency: () => Promise<number>;
}

/**
 * Shared read → dispatch loop, used by both the GPU consumer (concurrency from the
 * worker registry) and the video consumer (fixed concurrency from env). Only the
 * read strategy and the concurrency source differ between lanes; the in-flight
 * accounting and crash-resume behaviour are identical and live here.
 */
export function runStreamLoop(
  cfg: ProcessorConfig,
  log: Logger,
  opts: StreamLoopOptions,
): () => void {
  const laneLog = log.child({ lane: opts.name });
  let running = true;
  let inFlight = 0;
  // The last cap read, for the synchronous slot test a parked job's resume makes.
  let knownConcurrency = 0;

  // Caps in-flight jobs so reads don't race ahead of capacity. Blocks indefinitely
  // while concurrency is 0, resuming automatically once capacity appears.
  async function waitForSlot(): Promise<void> {
    while (running) {
      const concurrency = await opts.getConcurrency();
      knownConcurrency = concurrency;
      // Parked jobs hold no slot, but each costs a lease renewal and memory, so past MAX_PARKED
      // nothing new is read and the messages stay in the stream.
      // In-flight jobs count too: each may be about to park, and reads made while it does so
      // would overshoot the bound.
      if (parkedCount() + inFlight >= maxParkedJobs()) {
        await new Promise((r) => setTimeout(r, 50));
        continue;
      }
      // Recovery tickets occupy slots too: work a previous dispatcher left on a worker counts
      // against the cap, so a fresh read cannot start new execution on top of it.
      if (inFlight + laneOccupancy(opts.name) < concurrency) return;
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  // A parked job whose worker is free resumes through its lane, so it is counted against the
  // cap like any other running job; it is started only while a slot is free.
  registerLane(opts.name, {
    tryStart(job: ParkedJob) {
      if (!running) return false;
      if (inFlight + laneOccupancy(opts.name) >= knownConcurrency) {
        void opts.getConcurrency().then((c) => {
          knownConcurrency = c;
        });
        return false;
      }
      inFlight++;
      processJob(
        { ...job.cfg, resumeOwner: job.owner },
        job.jobId,
        job.userId,
        job.stream,
        job.messageId,
        job.retryCount,
      )
        .catch((err) => laneLog.error({ err, jobId: job.jobId }, 'resumed job failed'))
        .finally(() => {
          inFlight--;
          resumeEnded(job.jobId);
          kick();
        });
      return true;
    },
  });

  async function loop(): Promise<void> {
    while (running) {
      try {
        await waitForSlot();
        if (!running) break;
        const msg = await opts.read(() => running);
        // A claim already in flight may return after stop. Leave it pending for
        // recovery: Change 2 (graceful shutdown and safe redelivery) will add
        // coordinated draining/handback; re-enqueueing here could duplicate work.
        if (!running) break;
        if (!msg) continue;
        const { stream, messageId, jobId, userId, retryCount } = msg;
        laneLog.info({ jobId, userId, stream, retryCount }, 'consumed job from stream');
        inFlight++;
        processJob(cfg, jobId, userId, stream, messageId, retryCount)
          .catch((err) => laneLog.error({ err, jobId }, 'job processing failed'))
          .finally(() => {
            inFlight--;
            // A slot is free: a parked job that is ready to resume may be waiting for one.
            kick();
          });
      } catch (err) {
        if (!running) break;
        laneLog.error({ err }, 'consumer loop error — resuming');
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  loop().catch((err) => laneLog.error({ err }, 'consumer loop crashed'));

  return () => {
    running = false;
    unregisterLane(opts.name);
  };
}
