import { z } from 'zod';

// Response contract for GET /admin/fleet (the GPU ops dashboard, apps/gpu-ops).
//
// This is also an allowlist: the route runs its payload through fleetSnapshotSchema.parse,
// and zod strips unknown keys, so a field added to the underlying worker view (the worker
// URL, an API key) cannot leave the API unless it is named here.
//
// `null` means "not observed" — never "observed as empty". Anything this endpoint has no
// source for yet (GPU utilisation/temperature, host disk/inodes/swap, ownership) is absent or
// 'UNKNOWN' rather than guessed.

export const fleetDispatcherStates = ['IDLE', 'BUSY', 'DRAINING', 'UNKNOWN'] as const;
export const fleetHealthStates = ['HEALTHY', 'UNREACHABLE', 'UNKNOWN'] as const;
export const fleetRoutingStates = ['unavailable', 'ungated', 'externally_busy', 'ok'] as const;
// Deliberately no FOREIGN/DEVELOPER: a prompt we did not dispatch is only known to be
// *unattributed* — nothing here can say whose it is, and naming an owner would be a guess.
export const fleetOwnershipStates = ['PRODUCTION', 'UNATTRIBUTED', 'NONE', 'UNKNOWN'] as const;

// What the dispatcher's health monitor keeps from a worker's ComfyUI GET /system_stats, under
// workerSystemKey(id) with a short TTL (so absence means "not observed", never "zero").
// Whitelisted numbers only: the same response carries launch arguments and paths that must
// never be stored or forwarded. Raw bytes — unit conversion happens once, in the fleet route.
export const workerSystemKey = (id: string) => `worker:system:${id}`;
export const workerSystemSampleSchema = z.object({
  observedAt: z.number().int().nonnegative(), // unix ms, taken by the dispatcher
  gpuName: z.string().nullable(),
  vramTotalBytes: z.number().nonnegative().nullable(),
  vramFreeBytes: z.number().nonnegative().nullable(),
  ramTotalBytes: z.number().nonnegative().nullable(),
  ramFreeBytes: z.number().nonnegative().nullable(),
});
export type WorkerSystemSample = z.infer<typeof workerSystemSampleSchema>;

export const fleetWorkerSchema = z.object({
  workerId: z.string(),
  label: z.string(),
  dispatcherState: z.enum(fleetDispatcherStates),
  health: z.enum(fleetHealthStates),
  routing: z.enum(fleetRoutingStates),
  active: z.boolean(),
  // False when the worker row exists in Postgres but the dispatcher hasn't put it in the
  // Redis registry (dispatcher not restarted since it was added, or it was removed).
  inRegistry: z.boolean(),
  jobTypes: z.array(z.string()),
  comfy: z.object({
    reachable: z.boolean().nullable(),
    running: z.number().int().nullable(),
    pending: z.number().int().nullable(),
    observedAt: z.string().nullable(),
    // True when the dispatcher's queue sample is older than FLEET_QUEUE_STALE_MS.
    stale: z.boolean(),
  }),
  // From ComfyUI /system_stats — the first device only. Utilisation, temperature and exporter
  // state are not available from this source and are deliberately absent, not zero.
  gpu: z.object({
    name: z.string().nullable(),
    vramUsedMb: z.number().int().nullable(),
    vramTotalMb: z.number().int().nullable(),
    observedAt: z.string().nullable(),
    stale: z.boolean(),
  }),
  // Host RAM as ComfyUI sees it. Disk, inodes and swap need node_exporter and are not here.
  hostMemory: z.object({
    totalGb: z.number().nullable(),
    availableGb: z.number().nullable(),
    observedAt: z.string().nullable(),
    stale: z.boolean(),
  }),
  // Whose work is on this ComfyUI, from matching its queued prompt ids to COMFY_DISPATCH job
  // events. NONE = queue empty, PRODUCTION = every prompt matched a dispatched job,
  // UNATTRIBUTED = at least one prompt matched none (someone else's, or ours before its
  // dispatch event was written), UNKNOWN = queue not observed or ids incomplete.
  ownership: z.enum(fleetOwnershipStates),
  // The prompt currently running, if any, and the job it belongs to when it matched.
  prompt: z
    .object({ id: z.string(), jobId: z.string().nullable(), observedAt: z.string() })
    .nullable(),
  lastSeenAt: z.string().nullable(),
  warning: z.string().nullable(),
});
export type FleetWorker = z.infer<typeof fleetWorkerSchema>;

// Dispatch backlog per Redis stream. These are shared lanes, not per-worker queues.
export const fleetStreamSchema = z.object({
  stream: z.string(),
  // Entries no consumer has been given yet. null = could not be read.
  waiting: z.number().int().nullable(),
  // Delivered to a consumer but not acknowledged: jobs being worked on right now.
  inFlight: z.number().int().nullable(),
  // True when `waiting` hit the read cap and the real figure may be higher.
  capped: z.boolean(),
});
export type FleetStream = z.infer<typeof fleetStreamSchema>;

export const fleetSnapshotSchema = z.object({
  source: z.literal('LIVE'),
  generatedAt: z.string(),
  workers: z.array(fleetWorkerSchema),
  queues: z.array(fleetStreamSchema),
});
export type FleetSnapshot = z.infer<typeof fleetSnapshotSchema>;

// The dispatcher samples each worker's queue every 15s (health monitor); three missed
// samples is the point where a figure should stop being shown as current.
// Rolling per-worker history behind the dashboard's sparklines. The dispatcher appends one
// point per health probe to a sorted set scored by observation time; the api reads it back.
export const workerHistoryKey = (id: string) => `worker:history:${id}`;
export const FLEET_HISTORY_WINDOW_MS = 60 * 60 * 1000;
// Hard ceiling independent of the time window: a one-hour window at the 15 s probe interval is
// 240 points, so this only bites if probes ever run far more often than designed.
export const FLEET_HISTORY_MAX_POINTS = 360;
export const fleetHistoryPointSchema = z.object({
  t: z.number().int().nonnegative(), // unix ms the dispatcher observed the worker
  vramUsedMb: z.number().int().nullable(),
  vramTotalMb: z.number().int().nullable(),
  ramUsedGb: z.number().nullable(),
  ramTotalGb: z.number().nullable(),
});
export type FleetHistoryPoint = z.infer<typeof fleetHistoryPointSchema>;

export const fleetWorkerHistorySchema = z.object({
  workerId: z.string(),
  generatedAt: z.string(),
  windowMinutes: z.number().int().positive(),
  // Oldest first. Points are only the probes that returned usable numbers, so a gap in `t`
  // means the worker was unreachable or unreadable then; clients must not interpolate across it.
  points: z.array(fleetHistoryPointSchema),
});
export type FleetWorkerHistory = z.infer<typeof fleetWorkerHistorySchema>;

export const FLEET_QUEUE_STALE_MS = 45_000;
// Same cadence for the /system_stats sample (written by the same monitor tick).
export const FLEET_SYSTEM_STALE_MS = 45_000;
