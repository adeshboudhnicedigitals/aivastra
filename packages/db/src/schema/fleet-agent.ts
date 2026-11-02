import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { workers } from './workers.js';

// Fleet agent: the per-GPU-box process that pushes telemetry (docs/fleet-agent-design.md).

/**
 * One row per ingest key. A key is bound to a single worker and stored only as sha256, so a
 * database dump never yields a usable key; the plaintext exists only in the create response.
 * Rotation is create-new, redeploy, revoke-old, so a worker may briefly hold two active keys.
 */
export const fleetAgents = pgTable(
  'fleet_agents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // A key without its worker is meaningless, so deleting the worker removes its keys.
    workerId: text('worker_id')
      .notNull()
      .references(() => workers.id, { onDelete: 'cascade' }),
    label: text('label').notNull().default(''),
    keyHash: text('key_hash').notNull().unique(),
    // e.g. "fa_a1b2c3d4": dashboard display only, never sufficient to authenticate.
    keyPrefix: text('key_prefix').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedBy: uuid('revoked_by').references(() => users.id),
    // Throttled to about once a minute: the live heartbeat is in Redis, this is for the key list.
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    agentVersion: text('agent_version'),
    bootId: text('boot_id'),
    clockSkewMs: integer('clock_skew_ms'),
  },
  (t) => ({
    byWorker: index('fleet_agents_worker_idx').on(t.workerId),
  }),
);

/**
 * One row per accepted sample. `(worker_id, boot_id, seq)` is unique, which is what makes a
 * replayed sample a no-op. No FK to workers on purpose: history is removed by retention, not by
 * deleting a worker (the same reason other high-volume tables here avoid cascades).
 */
export const fleetHostSamples = pgTable(
  'fleet_host_samples',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    workerId: text('worker_id').notNull(),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    bootId: text('boot_id').notNull(),
    seq: bigint('seq', { mode: 'number' }).notNull(),
    agentVersion: text('agent_version').notNull(),
    // receivedAt - observedAt, in ms. Includes network time; a large steady value means a wrong clock.
    clockSkewMs: integer('clock_skew_ms').notNull(),
    cpuCount: smallint('cpu_count'),
    load1: real('load1'),
    load5: real('load5'),
    load15: real('load15'),
    ramTotalMib: integer('ram_total_mib'),
    ramAvailMib: integer('ram_avail_mib'),
    swapTotalMib: integer('swap_total_mib'),
    swapUsedMib: integer('swap_used_mib'),
    memPsiSome10: real('mem_psi_some10'),
    uptimeSec: bigint('uptime_sec', { mode: 'number' }),
    ntpSynced: boolean('ntp_synced'),
    // Small, bounded lists (see the caps in packages/types/src/fleet-agent.ts).
    disks: jsonb('disks').notNull().$type<unknown[]>(),
    services: jsonb('services').notNull().$type<unknown[]>(),
    comfy: jsonb('comfy').notNull().$type<unknown[]>(),
    computeApps: jsonb('compute_apps').notNull().$type<unknown[]>(),
  },
  (t) => ({
    uniqSample: uniqueIndex('fleet_host_samples_sample_uniq').on(t.workerId, t.bootId, t.seq),
    byWorkerTime: index('fleet_host_samples_worker_time_idx').on(t.workerId, t.observedAt),
    // Retention deletes by age across all workers.
    byTime: index('fleet_host_samples_time_idx').on(t.observedAt),
  }),
);

/** One row per GPU per accepted sample. Written in the same transaction as its host row. */
export const fleetGpuSamples = pgTable(
  'fleet_gpu_samples',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    workerId: text('worker_id').notNull(),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    gpuIndex: smallint('gpu_index').notNull(),
    name: text('name'),
    tempC: real('temp_c'),
    memTempC: real('mem_temp_c'),
    fanPct: real('fan_pct'),
    pstate: text('pstate'),
    smClockMhz: integer('sm_clock_mhz'),
    smClockMaxMhz: integer('sm_clock_max_mhz'),
    memClockMhz: integer('mem_clock_mhz'),
    powerW: real('power_w'),
    powerLimitW: real('power_limit_w'),
    utilGpuPct: real('util_gpu_pct'),
    utilMemPct: real('util_mem_pct'),
    vramUsedMib: integer('vram_used_mib'),
    vramTotalMib: integer('vram_total_mib'),
    throttleReasons: text('throttle_reasons'),
    eccUncorrected: integer('ecc_uncorrected'),
  },
  (t) => ({
    byWorkerGpuTime: index('fleet_gpu_samples_worker_gpu_time_idx').on(
      t.workerId,
      t.gpuIndex,
      t.observedAt,
    ),
    byTime: index('fleet_gpu_samples_time_idx').on(t.observedAt),
  }),
);
