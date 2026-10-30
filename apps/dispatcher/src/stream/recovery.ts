import { hostname } from 'node:os';
import { schema } from '@aivastra/db';
import type { Logger } from '@aivastra/logger';
import { eq, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import type { ProcessorConfig } from '../job/processor.js';
import { processJob } from '../job/processor.js';
import { pruneLaneOccupancy, takeTicket } from './lane-tickets.js';

const GROUP = 'dispatcher-cg';
const CONSUMER = hostname();
// jobs:video comes last deliberately: this loop awaits each processJob serially, and a
// recovered video job runs for minutes (PixVerse poll + mp4 download), so putting it
// first would stall recovery of the GPU streams behind it.
const DEFAULT_STREAMS = [
  'jobs:priority',
  'jobs:normal',
  'jobs:low',
  'jobs:video',
  'jobs:inhouse',
] as const;

type PendingEntry = [string, string, number, number]; // [id, consumer, idleMs, deliveries]

/** A consumer that drained at shutdown: everything it left pending is recoverable at once. */
const retiredKey = (consumer: string) => `dispatcher:retired-consumer:${consumer}`;

export async function markConsumerRetired(redis: Redis): Promise<void> {
  // An hour is far longer than any recovery lag; the marker is only a hint, the database
  // decides who may take the job.
  await redis.set(retiredKey(CONSUMER), '1', 'EX', 3600);
}

/**
 * Whether a pending entry may be claimed now, without waiting for the idle threshold. Only a hint
 * to claim: processJob's acquisition is decisive, so a wrong "yes" costs one ignored delivery.
 */
async function eligibleNow(
  redis: Redis,
  cfg: ProcessorConfig,
  stream: string,
  messageId: string,
  consumer: string,
): Promise<boolean> {
  if (await redis.exists(retiredKey(consumer))) return true;
  const [entry] = (await redis.xrange(stream, messageId, messageId)) as Array<[string, string[]]>;
  const fields = entry?.[1] ?? [];
  const jobId = fields[fields.indexOf('jobId') + 1];
  if (!jobId || fields.indexOf('jobId') < 0) return false;
  const [row] = await cfg.db
    .select({
      free: sql<boolean>`(${schema.dispatcherJobControl.ownerRetired}
        or ${schema.dispatcherJobControl.leaseUntil} is null
        or ${schema.dispatcherJobControl.leaseUntil} <= clock_timestamp())`,
    })
    .from(schema.dispatcherJobControl)
    .where(eq(schema.dispatcherJobControl.jobId, jobId));
  return row?.free === true;
}

/**
 * Whether a live, unretired lease covers the entry's job. A job parked for a worker (or running
 * for longer than the idle threshold) keeps its message pending under this consumer; claiming it
 * would move the message to another consumer name, break the handoff's "pending under this
 * consumer" test, raise its delivery count and repeat every threshold for as long as it waits.
 * Checked before any claim, whatever else made the entry eligible.
 */
async function leaseIsLive(
  redis: Redis,
  cfg: ProcessorConfig,
  stream: string,
  messageId: string,
): Promise<boolean> {
  const [entry] = (await redis.xrange(stream, messageId, messageId)) as Array<[string, string[]]>;
  const fields = entry?.[1] ?? [];
  const at = fields.indexOf('jobId');
  const jobId = at < 0 ? undefined : fields[at + 1];
  if (!jobId) return false;
  const [row] = await cfg.db
    .select({
      live: sql<boolean>`(not ${schema.dispatcherJobControl.ownerRetired}
        and ${schema.dispatcherJobControl.leaseUntil} > clock_timestamp())`,
    })
    .from(schema.dispatcherJobControl)
    .where(eq(schema.dispatcherJobControl.jobId, jobId));
  return row?.live === true;
}

const BACKGROUND_CAP = 2;
const background = new Set<Promise<void>>();
let scanning = false;

/**
 * The recovery tick: never overlaps itself, never blocks on a job (an adoption can wait minutes),
 * and runs at most a couple of recovered jobs at a time. Everything it runs is tracked as an
 * owned job, so the shutdown drain sees it.
 */
export function startRecoveryScheduler(
  redis: Redis,
  cfg: ProcessorConfig,
  thresholdMs: number,
  log: Logger,
  intervalMs = 5_000,
): () => void {
  const tick = async () => {
    if (scanning) return;
    scanning = true;
    try {
      await pruneLaneOccupancy(redis, log);
      await recoverPendingJobs(redis, cfg, thresholdMs, log, DEFAULT_STREAMS, { background: true });
    } catch (err) {
      log.error({ err }, 'recovery scan failed');
    } finally {
      scanning = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  return () => clearInterval(timer);
}

export async function recoverPendingJobs(
  redis: Redis,
  cfg: ProcessorConfig,
  thresholdMs: number,
  log: Logger,
  streams: readonly string[] = DEFAULT_STREAMS,
  opts: { background?: boolean } = {},
): Promise<void> {
  for (const stream of streams) {
    let startId = '-';
    while (true) {
      let pending: PendingEntry[];
      try {
        pending = (await redis.xpending(stream, GROUP, startId, '+', 10)) as PendingEntry[];
      } catch (err: unknown) {
        if (err instanceof Error && err.message.includes('NOGROUP')) break;
        throw err;
      }
      if (!pending.length) break;

      for (const [messageId, consumer, idleMs] of pending) {
        if (opts.background && background.size >= BACKGROUND_CAP) return;
        // The idle threshold is the fallback for an entry nothing else explains; a retired
        // consumer or a retired/expired control row makes it claimable at once.
        const early =
          idleMs < thresholdMs && (await eligibleNow(redis, cfg, stream, messageId, consumer));
        if (idleMs < thresholdMs && !early) continue;
        if (await leaseIsLive(redis, cfg, stream, messageId)) continue;
        log.warn({ stream, messageId, idleMs, early }, 'claiming pending entry');
        const claimed = (await redis.xclaim(
          stream,
          GROUP,
          CONSUMER,
          early ? 0 : thresholdMs,
          messageId,
        )) as Array<[string, string[]]>;
        if (!claimed.length) continue;

        const claimedEntry = claimed[0];
        if (!claimedEntry) continue;
        const [, fields] = claimedEntry;
        const fieldMap: Record<string, string> = {};
        for (let i = 0; i < fields.length; i += 2) {
          const k = fields[i];
          const v = fields[i + 1];
          if (k !== undefined && v !== undefined) fieldMap[k] = v;
        }
        // jobId alone is required. Store-billed Shopify jobs and merchant
        // widget jobs are enqueued with no userId field at all — they bill
        // shopify_store_credits / the merchant's owning user, both resolved
        // from the job row, not the stream message. Requiring one here ACKed
        // their message away and stranded the job in QUEUED forever: the
        // sweeper only reaps PREPROCESSING/GENERATING/UPLOADING, so nothing
        // else would ever fail or refund it. Mirrors the live consumer path
        // in stream/loop.ts, which defaults a missing userId to ''.
        if (!fieldMap.jobId) {
          await redis.xack(stream, GROUP, messageId);
          continue;
        }
        log.info({ jobId: fieldMap.jobId }, 'reprocessing claimed pending job');
        const retryCount = Number.parseInt(fieldMap.retryCount ?? '0', 10);
        // Taken before the first await on the job, so the lane counts it from here on and
        // whatever the cap is: this is observation of work that already occupies a worker.
        const release = takeTicket(stream, messageId);
        const run = processJob(
          cfg,
          fieldMap.jobId,
          fieldMap.userId ?? '',
          stream,
          messageId,
          Number.isFinite(retryCount) ? retryCount : 0,
        ).finally(release);
        if (!opts.background) {
          await run;
          continue;
        }
        const tracked: Promise<void> = run
          .catch((err) => log.error({ err, jobId: fieldMap.jobId }, 'recovered job failed'))
          .finally(() => {
            background.delete(tracked);
          });
        background.add(tracked);
      }

      const lastId = pending[pending.length - 1]?.[0];
      if (!lastId) break;
      startId = lastId.replace(/^(\d+)-(\d+)$/, (_, ms, seq) => `${ms}-${Number(seq) + 1}`);
      if (pending.length < 10) break;
    }
  }
}
