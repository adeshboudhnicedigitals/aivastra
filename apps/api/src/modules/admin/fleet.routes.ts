import { schema } from '@aivastra/db';
import {
  FLEET_HISTORY_WINDOW_MS,
  FLEET_QUEUE_STALE_MS,
  FLEET_SYSTEM_STALE_MS,
  type FleetSnapshot,
  type FleetStream,
  fleetHistoryPointSchema,
  fleetSnapshotSchema,
  fleetWorkerHistorySchema,
  type WorkerSystemSample,
  workerHistoryKey,
  workerSystemKey,
  workerSystemSampleSchema,
} from '@aivastra/types';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { requirePermission } from './guard.js';
import { listAdminWorkers } from './workers.routes.js';

type WorkerView = Awaited<ReturnType<typeof listAdminWorkers>>[number];
type FleetWorker = FleetSnapshot['workers'][number];

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

// Shared dispatcher lanes and their consumer group (apps/dispatcher/src/stream/loop.ts).
const JOB_STREAMS = [
  'jobs:priority',
  'jobs:normal',
  'jobs:low',
  'jobs:video',
  'jobs:inhouse',
] as const;
const DISPATCHER_GROUP = 'dispatcher-cg';
// XRANGE COUNT: enough to show "hundreds waiting" without letting one request scan a flood.
const BACKLOG_READ_CAP = 1000;
// A prompt can sit in a worker's queue for a long time; this bounds the job_events lookup, not
// how long a job may run.
const OWNERSHIP_LOOKBACK_MS = 24 * 60 * 60 * 1000;

function toDispatcherState(w: WorkerView): FleetWorker['dispatcherState'] {
  // Without a registry entry `status` is a fallback guess, not an observation.
  if (!w.inRegistry) return 'UNKNOWN';
  return w.status === 'IDLE' || w.status === 'BUSY' || w.status === 'DRAINING'
    ? w.status
    : 'UNKNOWN';
}

// The sample is written by the dispatcher with a TTL, so a missing key means "not observed".
// A value that no longer matches the schema is treated the same way rather than half-trusted.
async function readSystemSample(
  redis: FastifyInstance['redis'],
  id: string,
): Promise<WorkerSystemSample | null> {
  try {
    const raw = await redis.get(workerSystemKey(id));
    if (!raw) return null;
    const parsed = workerSystemSampleSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function toGpu(sample: WorkerSystemSample | null, now: number): FleetWorker['gpu'] {
  if (!sample) {
    return { name: null, vramUsedMb: null, vramTotalMb: null, observedAt: null, stale: true };
  }
  const { vramTotalBytes: total, vramFreeBytes: free } = sample;
  return {
    name: sample.gpuName,
    // free > total would be a nonsense figure; say unknown instead of a negative "used".
    vramUsedMb:
      total !== null && free !== null && free <= total ? Math.round((total - free) / MIB) : null,
    vramTotalMb: total === null ? null : Math.round(total / MIB),
    observedAt: new Date(sample.observedAt).toISOString(),
    stale: now - sample.observedAt > FLEET_SYSTEM_STALE_MS,
  };
}

function toHostMemory(sample: WorkerSystemSample | null, now: number): FleetWorker['hostMemory'] {
  if (!sample) return { totalGb: null, availableGb: null, observedAt: null, stale: true };
  const gb = (b: number | null) => (b === null ? null : Math.round((b / GIB) * 10) / 10);
  return {
    totalGb: gb(sample.ramTotalBytes),
    availableGb: gb(sample.ramFreeBytes),
    observedAt: new Date(sample.observedAt).toISOString(),
    stale: now - sample.observedAt > FLEET_SYSTEM_STALE_MS,
  };
}

/**
 * Points newer than the cutoff, oldest first. A member that fails the schema is skipped rather
 * than failing the whole graph: the data is advisory and one bad entry says nothing about the rest.
 */
async function readHistory(redis: FastifyInstance['redis'], id: string, sinceMs: number) {
  const raw = await redis.zrangebyscore(workerHistoryKey(id), sinceMs, '+inf');
  const points = [];
  for (const member of raw) {
    try {
      const parsed = fleetHistoryPointSchema.safeParse(JSON.parse(member));
      if (parsed.success) points.push(parsed.data);
    } catch {
      // Not JSON: skip it.
    }
  }
  return points;
}

const historyParams = z.object({ id: z.string().min(1).max(100) });
const historyQuery = z.object({
  minutes: z.coerce
    .number()
    .int()
    .min(5)
    .max(FLEET_HISTORY_WINDOW_MS / 60_000)
    .default(FLEET_HISTORY_WINDOW_MS / 60_000),
});

// RESP map replies from XINFO come back as a flat [key, value, key, value, …] array.
function fromFlat(entry: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!Array.isArray(entry)) return out;
  for (let i = 0; i + 1 < entry.length; i += 2) out[String(entry[i])] = entry[i + 1];
  return out;
}

/**
 * Backlog of one stream for the dispatcher's consumer group: entries not yet handed to any
 * consumer (`waiting`) and entries handed out but unacknowledged (`inFlight`). XLEN is not
 * used — entries are never deleted on ack, so it counts history, not work.
 */
async function readStream(redis: FastifyInstance['redis'], stream: string): Promise<FleetStream> {
  const unknown: FleetStream = { stream, waiting: null, inFlight: null, capped: false };
  try {
    const groups = (await redis.xinfo('GROUPS', stream)) as unknown[];
    const group = groups.map(fromFlat).find((g) => g.name === DISPATCHER_GROUP);
    // Stream exists but the dispatcher never created its group: nothing says what is waiting.
    if (!group) return unknown;
    const last = String(group['last-delivered-id'] ?? '0-0');
    const inFlight = Number(group.pending ?? 0);
    // Exclusive start: everything after the last delivered id is still waiting.
    const ahead = await redis.xrange(stream, `(${last}`, '+', 'COUNT', BACKLOG_READ_CAP);
    return {
      stream,
      waiting: ahead.length,
      inFlight: Number.isFinite(inFlight) ? inFlight : null,
      capped: ahead.length >= BACKLOG_READ_CAP,
    };
  } catch (err) {
    // A stream no producer has written to does not exist yet, which is zero work, not a fault.
    if (err instanceof Error && /no such key/i.test(err.message)) {
      return { stream, waiting: 0, inFlight: 0, capped: false };
    }
    return unknown;
  }
}

/**
 * promptId -> jobId for prompts the dispatcher submitted, from COMFY_DISPATCH job events.
 * Scoped to the worker that received them so a prompt id seen on another box never matches.
 */
async function matchDispatchedPrompts(
  app: FastifyInstance,
  promptIds: string[],
  now: number,
): Promise<Map<string, { jobId: string; workerId: string | null }>> {
  const found = new Map<string, { jobId: string; workerId: string | null }>();
  if (promptIds.length === 0) return found;
  const promptId = sql<string>`${schema.jobEvents.payload}->>'promptId'`;
  const workerId = sql<string | null>`${schema.jobEvents.payload}->>'workerId'`;
  const rows = await app.db
    .select({ jobId: schema.jobEvents.jobId, promptId, workerId })
    .from(schema.jobEvents)
    .where(
      and(
        eq(schema.jobEvents.eventType, 'COMFY_DISPATCH'),
        gte(schema.jobEvents.createdAt, new Date(now - OWNERSHIP_LOOKBACK_MS)),
        inArray(promptId, promptIds),
      ),
    );
  for (const r of rows)
    found.set(`${r.workerId}:${r.promptId}`, { jobId: r.jobId, workerId: r.workerId });
  return found;
}

function toOwnership(
  w: WorkerView,
  matched: Map<string, { jobId: string; workerId: string | null }>,
): Pick<FleetWorker, 'ownership' | 'prompt'> {
  const q = w.queue;
  if (!q || q.error !== undefined || q.running === null || q.pending === null) {
    return { ownership: 'UNKNOWN', prompt: null };
  }
  const running = q.runningPromptIds ?? [];
  const pending = q.pendingPromptIds ?? [];
  // Ids are capped/dropped by the sampler; a short list cannot prove who owns the rest.
  if (running.length !== q.running || pending.length !== q.pending) {
    return { ownership: 'UNKNOWN', prompt: null };
  }
  const all = [...running, ...pending];
  const observedAt = new Date(q.probedAt).toISOString();
  const first = running[0];
  const hit = first === undefined ? undefined : matched.get(`${w.id}:${first}`);
  const prompt = first === undefined ? null : { id: first, jobId: hit?.jobId ?? null, observedAt };
  if (all.length === 0) return { ownership: 'NONE', prompt: null };
  const allOurs = all.every((id) => matched.has(`${w.id}:${id}`));
  return { ownership: allOurs ? 'PRODUCTION' : 'UNATTRIBUTED', prompt };
}

function toFleetWorker(
  w: WorkerView,
  sample: WorkerSystemSample | null,
  matched: Map<string, { jobId: string; workerId: string | null }>,
  now: number,
): FleetWorker {
  const queue = w.queue;
  const probed = queue?.probedAt ?? null;
  const queueStale = probed === null || now - probed > FLEET_QUEUE_STALE_MS;
  // A stale queue sample says nothing about who owns the work now.
  const ownership = queueStale
    ? ({ ownership: 'UNKNOWN', prompt: null } as const)
    : toOwnership(w, matched);
  return {
    workerId: w.id,
    label: w.label,
    dispatcherState: toDispatcherState(w),
    // The health key only ever holds '1' with a 30s TTL; expiry means unhealthy, and
    // "no registry entry" means the monitor isn't probing it, so say UNKNOWN there.
    health: !w.inRegistry ? 'UNKNOWN' : w.healthy ? 'HEALTHY' : 'UNREACHABLE',
    routing: w.routing,
    active: w.isActive,
    inRegistry: w.inRegistry,
    jobTypes: w.allowedJobTypes,
    comfy: {
      reachable: queue ? queue.error === undefined && queue.queueRemaining !== null : null,
      running: queue?.running ?? null,
      pending: queue?.pending ?? null,
      observedAt: probed === null ? null : new Date(probed).toISOString(),
      stale: queueStale,
    },
    gpu: toGpu(sample, now),
    hostMemory: toHostMemory(sample, now),
    ownership: ownership.ownership,
    prompt: ownership.prompt,
    lastSeenAt: w.lastSeen === null ? null : new Date(w.lastSeen).toISOString(),
    warning: w.capabilityWarning,
  };
}

/**
 * Read-only fleet snapshot for the GPU ops dashboard. Composes the dispatcher's Redis
 * registry, the `workers` table, the health/queue/system samples, the stream backlog and
 * COMFY_DISPATCH job events — nothing here contacts a GPU box. The payload is parsed through
 * fleetSnapshotSchema, which is what keeps worker URLs and API keys out of the response.
 */
export async function adminFleetRoutes(app: FastifyInstance) {
  app.get('/admin/fleet', { preHandler: requirePermission('fleet.view') }, async () => {
    const now = Date.now();
    const workers = await listAdminWorkers(app);
    const promptIds = [
      ...new Set(
        workers.flatMap((w) => [
          ...(w.queue?.runningPromptIds ?? []),
          ...(w.queue?.pendingPromptIds ?? []),
        ]),
      ),
    ];
    const [samples, matched, queues] = await Promise.all([
      Promise.all(workers.map((w) => readSystemSample(app.redis, w.id))),
      matchDispatchedPrompts(app, promptIds, now),
      Promise.all(JOB_STREAMS.map((s) => readStream(app.redis, s))),
    ]);
    return fleetSnapshotSchema.parse({
      source: 'LIVE',
      generatedAt: new Date(now).toISOString(),
      workers: workers.map((w, i) => toFleetWorker(w, samples[i] ?? null, matched, now)),
      queues,
    });
  });

  // Separate from /admin/fleet on purpose: the dashboard polls that every 15 s, and the history of
  // every worker would multiply its size for data only the open worker's panel draws.
  app.get(
    '/admin/fleet/workers/:id/history',
    {
      preHandler: requirePermission('fleet.view'),
      schema: { params: historyParams, querystring: historyQuery },
    },
    async (req) => {
      const { id } = req.params as z.infer<typeof historyParams>;
      const { minutes } = req.query as z.infer<typeof historyQuery>;
      // Only registered workers: the id is interpolated into a Redis key, and an unknown one
      // should say so instead of returning a plausible empty graph.
      const [worker] = await app.db
        .select({ id: schema.workers.id })
        .from(schema.workers)
        .where(eq(schema.workers.id, id));
      if (!worker) throw new AppError('NOT_FOUND', 404, 'Worker not found');
      const now = Date.now();
      return fleetWorkerHistorySchema.parse({
        workerId: id,
        generatedAt: new Date(now).toISOString(),
        windowMinutes: minutes,
        points: await readHistory(app.redis, id, now - minutes * 60_000),
      });
    },
  );
}
