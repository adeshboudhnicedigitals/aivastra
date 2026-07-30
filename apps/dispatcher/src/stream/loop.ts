import type { Logger } from '@aivastra/logger';
import type { ProcessorConfig } from '../job/processor.js';
import { processJob } from '../job/processor.js';

export const DISPATCHER_GROUP = 'dispatcher-cg';

export type XReadGroupResult = Array<[string, Array<[string, string[]]>]> | null;

export interface StreamMessage {
  stream: string;
  messageId: string;
  jobId: string;
  userId: string;
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
  return { stream, messageId, jobId: fieldMap.jobId, userId: fieldMap.userId ?? '' };
}

export interface StreamLoopOptions {
  /** Lane name, bound to every log line so the two loops are distinguishable. */
  name: string;
  /** Reads at most one message; may block internally; null when nothing was read. */
  read: () => Promise<StreamMessage | null>;
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

  // Caps in-flight jobs so reads don't race ahead of capacity. Blocks indefinitely
  // while concurrency is 0, resuming automatically once capacity appears.
  async function waitForSlot(): Promise<void> {
    while (running) {
      const concurrency = await opts.getConcurrency();
      if (inFlight < concurrency) return;
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  async function loop(): Promise<void> {
    while (running) {
      try {
        await waitForSlot();
        const msg = await opts.read();
        if (!msg) continue;
        const { stream, messageId, jobId, userId } = msg;
        laneLog.info({ jobId, userId, stream }, 'consumed job from stream');
        inFlight++;
        processJob(cfg, jobId, userId, stream, messageId)
          .catch((err) => laneLog.error({ err, jobId }, 'job processing failed'))
          .finally(() => {
            inFlight--;
          });
      } catch (err) {
        laneLog.error({ err }, 'consumer loop error — resuming');
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  loop().catch((err) => laneLog.error({ err }, 'consumer loop crashed'));

  return () => {
    running = false;
  };
}
