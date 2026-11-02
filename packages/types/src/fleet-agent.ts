import { z } from 'zod';

// Contract between the per-box fleet agent and POST /v1/fleet/agent/ingest
// (docs/fleet-agent-design.md). The agent sends names and numbers only: never command lines,
// environment, paths, UUIDs or serials. Unknown is `null`, never 0. Every object is strict, so a
// field this version does not know is rejected rather than stored.

export const FLEET_AGENT_PROTOCOL_VERSION = 1;
export const FLEET_AGENT_KEY_PREFIX = 'fa_';
// 32 random bytes, base64url. Not sticky (no /g): a sticky regex carries lastIndex between tests.
export const FLEET_AGENT_KEY_RE = /^fa_[A-Za-z0-9_-]{43}$/;
export const FLEET_AGENT_MAX_BODY_BYTES = 32 * 1024;
export const FLEET_AGENT_MAX_ACTIVE_KEYS_PER_WORKER = 3;
// A sample older than this, or further in the future, is refused rather than stored under a
// wrong time. The agent spools at most five minutes, so this leaves room for a flush.
export const FLEET_AGENT_MAX_PAST_MS = 10 * 60 * 1000;
export const FLEET_AGENT_MAX_FUTURE_MS = 2 * 60 * 1000;
// How long raw per-sample rows are kept. Longer history comes from the 1-minute rollups, which
// do not exist yet: until they do, anything older than this is simply gone.
export const FLEET_RAW_RETENTION_MS = 48 * 60 * 60 * 1000;
// 1-minute rollups outlive the raw rows by this much (docs/fleet-agent-design.md section 5).
export const FLEET_ROLLUP_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
// Heartbeat TTL in Redis: six missed 15 s intervals.
export const FLEET_AGENT_HEARTBEAT_TTL_SEC = 90;
export const FLEET_AGENT_LATEST_TTL_SEC = 60;

export const fleetAgentHeartbeatKey = (workerId: string) => `fleet:agent:${workerId}`;
export const fleetAgentLatestKey = (workerId: string) => `fleet:latest:${workerId}`;
export const fleetAgentRejectsKey = (workerId: string) => `fleet:rejects:${workerId}`;

// Display text, not an identifier: no control characters, bounded length.
const hasNoControlChars = (s: string) =>
  ![...s].some((c) => (c.codePointAt(0) ?? 0) < 0x20 || c === '\x7f');
const text = (max: number) =>
  z.string().min(1).max(max).refine(hasNoControlChars, 'must not contain control characters');
const logicalName = z.string().regex(/^[a-z0-9._-]{1,32}$/);

const num = (min: number, max: number) => z.number().finite().min(min).max(max).nullable();
const int = (min: number, max: number) => z.number().int().min(min).max(max).nullable();
const pct = num(0, 100);

export const agentGpuSchema = z
  .object({
    index: z.number().int().min(0).max(31),
    name: text(120).nullable(),
    tempC: num(-50, 200),
    memTempC: num(-50, 200),
    fanPct: pct,
    pstate: z
      .string()
      .regex(/^P([0-9]|1[0-5])$/)
      .nullable(),
    smClockMhz: int(0, 10_000),
    smClockMaxMhz: int(0, 10_000),
    memClockMhz: int(0, 100_000),
    powerW: num(0, 5_000),
    powerLimitW: num(0, 5_000),
    utilGpuPct: pct,
    utilMemPct: pct,
    vramUsedMib: int(0, 8_388_608),
    vramTotalMib: int(0, 8_388_608),
    // The raw bitmask as reported (e.g. "0x0000000000000000"), or null when nvidia-smi says N/A.
    throttleReasons: z
      .string()
      .regex(/^0x[0-9a-fA-F]{1,16}$/)
      .nullable(),
    eccUncorrected: int(0, 2_147_483_647),
  })
  .strict();
export type AgentGpu = z.infer<typeof agentGpuSchema>;

export const agentComputeAppSchema = z
  .object({
    gpuIndex: z.number().int().min(0).max(31),
    name: text(80),
    vramMib: int(0, 8_388_608),
  })
  .strict();

export const agentDiskSchema = z
  .object({
    mount: text(128),
    totalGb: num(0, 10_000_000),
    usedGb: num(0, 10_000_000),
    inodeUsedPct: pct,
  })
  .strict();

export const agentServiceSchema = z
  .object({
    name: logicalName,
    active: z.enum(['active', 'inactive', 'failed', 'activating', 'deactivating', 'unknown']),
    sub: text(32).nullable(),
    restarts: int(0, 1_000_000),
  })
  .strict();

export const agentComfySchema = z
  .object({
    instance: logicalName,
    reachable: z.boolean().nullable(),
    running: int(0, 100_000),
    pending: int(0, 100_000),
  })
  .strict();

export const agentHostSchema = z
  .object({
    cpuCount: int(1, 4096),
    load1: num(0, 100_000),
    load5: num(0, 100_000),
    load15: num(0, 100_000),
    ramTotalMib: int(0, 67_108_864),
    ramAvailMib: int(0, 67_108_864),
    swapTotalMib: int(0, 67_108_864),
    swapUsedMib: int(0, 67_108_864),
    memPsiSome10: pct,
    uptimeSec: int(0, 2_147_483_647),
    ntpSynced: z.boolean().nullable(),
    disks: z.array(agentDiskSchema).max(16),
  })
  .strict();

export const agentTelemetrySchema = z
  .object({
    v: z.literal(FLEET_AGENT_PROTOCOL_VERSION),
    workerId: z.string().min(1).max(100),
    agentVersion: z.string().regex(/^[0-9A-Za-z.+-]{1,32}$/),
    // Changes every time the agent starts; with `seq` it makes a sample idempotent.
    bootId: z.string().regex(/^[0-9a-fA-F-]{8,64}$/),
    seq: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    observedAt: z.number().int().positive(),
    gpus: z.array(agentGpuSchema).max(16),
    // Empty can mean "none" or "not visible from a shared pod/VM"; consumers must not read it as idle.
    computeApps: z.array(agentComputeAppSchema).max(64),
    host: agentHostSchema,
    services: z.array(agentServiceSchema).max(16),
    comfy: z.array(agentComfySchema).max(8),
  })
  .strict()
  .refine((p) => new Set(p.gpus.map((g) => g.index)).size === p.gpus.length, {
    message: 'gpu indexes must be unique',
    path: ['gpus'],
  });
export type AgentTelemetry = z.infer<typeof agentTelemetrySchema>;

export const agentIngestResponseSchema = z.object({
  ok: z.literal(true),
  duplicate: z.boolean(),
  serverTime: z.number().int(),
  // Commands arrive in a later phase; until then there is never anything to poll for.
  commandsPending: z.number().int().min(0),
});
export type AgentIngestResponse = z.infer<typeof agentIngestResponseSchema>;

// ---- Admin read/write views (what apps/gpu-ops consumes) -------------------------------------

export const fleetAgentKeyViewSchema = z.object({
  id: z.string(),
  label: z.string(),
  keyPrefix: z.string(),
  createdAt: z.string(),
  revokedAt: z.string().nullable(),
  lastSeenAt: z.string().nullable(),
  agentVersion: z.string().nullable(),
});
export type FleetAgentKeyView = z.infer<typeof fleetAgentKeyViewSchema>;

export const fleetAgentStatusSchema = z.object({
  workerId: z.string(),
  generatedAt: z.string(),
  keys: z.array(fleetAgentKeyViewSchema),
  // null = no agent has reported within the heartbeat TTL (never connected, or silent).
  heartbeat: z
    .object({
      receivedAt: z.string(),
      observedAt: z.string(),
      agentVersion: z.string(),
      bootId: z.string(),
    })
    .nullable(),
  // Samples refused in the last hour (invalid payload, wrong worker, bad clock): a non-zero value
  // with no heartbeat means the agent is trying and failing, which is different from silent.
  rejectsLastHour: z.number().int().min(0),
});
export type FleetAgentStatus = z.infer<typeof fleetAgentStatusSchema>;

export const fleetAgentGpuSignalsSchema = z.object({
  index: z.number().int(),
  // smClockMhz / smClockMaxMhz, or null if either is unknown.
  clockRatio: z.number().nullable(),
  // Instantaneous: clockRatio < 0.6 and tempC >= 80. The alert rule additionally requires it to
  // be sustained; this field is only "is it true in this one sample". null = inputs unknown.
  thermalCollapseNow: z.boolean().nullable(),
  // Device VRAM used minus the compute apps visible on this GPU. null whenever per-process data is
  // not visible (shared pods/VMs): unknown, never 0.
  foreignVramMib: z.number().int().nullable(),
});

export const fleetAgentTelemetryViewSchema = z.object({
  workerId: z.string(),
  generatedAt: z.string(),
  telemetry: agentTelemetrySchema.nullable(),
  receivedAt: z.string().nullable(),
  // Older than FLEET_SYSTEM_STALE_MS at generatedAt. Stale values are history, not current state.
  stale: z.boolean(),
  clockSkewMs: z.number().int().nullable(),
  signals: z.array(fleetAgentGpuSignalsSchema),
});
export type FleetAgentTelemetryView = z.infer<typeof fleetAgentTelemetryViewSchema>;

export const fleetAgentKeyCreatedSchema = fleetAgentKeyViewSchema.extend({
  // The plaintext key. Returned exactly once, in this response; only its hash is stored.
  key: z.string(),
});

// Thresholds for the derived thermal signal (docs/fleet-agent-design.md 4.2). Evidence: on the
// passively cooled cards the SM clock fell from ~2400 to ~900 MHz at 85-88 C while nvidia-smi
// reported no throttle reason, so temperature plus the clock ratio is the only usable indicator.
export const THERMAL_COLLAPSE_CLOCK_RATIO = 0.6;
export const THERMAL_COLLAPSE_MIN_TEMP_C = 80;

// ---- Metrics history (served from the 1-minute rollups) --------------------------------------

// Each window has a fixed step so a response is at most a few hundred points per series. A minute
// that has no rollup row is absent from the response: a gap is shown as a gap, never as zero.
export const FLEET_METRICS_WINDOWS = {
  '1h': { ms: 60 * 60 * 1000, stepSeconds: 60 },
  '6h': { ms: 6 * 60 * 60 * 1000, stepSeconds: 60 },
  '24h': { ms: 24 * 60 * 60 * 1000, stepSeconds: 300 },
  '7d': { ms: 7 * 24 * 60 * 60 * 1000, stepSeconds: 1800 },
  '30d': { ms: 30 * 24 * 60 * 60 * 1000, stepSeconds: 7200 },
} as const;
export type FleetMetricsWindow = keyof typeof FLEET_METRICS_WINDOWS;
export const fleetMetricsWindowSchema = z.enum(['1h', '6h', '24h', '7d', '30d']);
export const fleetMetricsQuerySchema = z.object({
  window: fleetMetricsWindowSchema.default('6h'),
});

const nn = z.number().nullable();
export const fleetGpuMetricPointSchema = z.object({
  // Start of the bucket, ISO-8601.
  t: z.string(),
  // Raw samples behind this point; lets the UI mark thin buckets.
  n: z.number().int().min(1),
  tempAvg: nn,
  tempMax: nn,
  smClockAvg: nn,
  smClockMin: nn,
  powerAvg: nn,
  powerMax: nn,
  utilAvg: nn,
  vramUsedMax: nn,
  vramTotalMax: nn,
});
export const fleetHostMetricPointSchema = z.object({
  t: z.string(),
  n: z.number().int().min(1),
  load1Max: nn,
  ramAvailMin: nn,
  swapUsedMax: nn,
  memPsiMax: nn,
});
export const fleetMetricsSchema = z.object({
  workerId: z.string(),
  generatedAt: z.string(),
  window: fleetMetricsWindowSchema,
  stepSeconds: z.number().int(),
  // Oldest rollup we hold for this worker, or null if none. Anything before it is not "zero",
  // it was never recorded (or already aged out).
  earliest: z.string().nullable(),
  gpus: z.array(z.object({ index: z.number().int(), points: z.array(fleetGpuMetricPointSchema) })),
  host: z.array(fleetHostMetricPointSchema),
});
export type FleetMetrics = z.infer<typeof fleetMetricsSchema>;
