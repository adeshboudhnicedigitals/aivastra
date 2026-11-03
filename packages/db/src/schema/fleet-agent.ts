import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { fleetHosts } from './fleet-inventory.js';
import { users } from './users.js';
import { workers } from './workers.js';

// Fleet agent: the per-GPU-box process that pushes telemetry (docs/fleet-agent-design.md).

/**
 * One row per ingest key. A key is bound to a single box (fleet_hosts) and stored only as sha256, so
 * a database dump never yields a usable key; the plaintext exists only in the create response.
 * Enrolment revokes the box's previous keys when it issues a new one.
 *
 * `worker_id` here, and in every telemetry table below, holds the BOX id (e.g. "w6"), not an admin
 * `workers` row: the agent reports what the machine is doing whether or not the dispatcher uses it.
 * The column name predates that change and was kept to avoid a rename across the fleet module.
 */
export const fleetAgents = pgTable(
  'fleet_agents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // A key without its box is meaningless, so deleting the box removes its keys.
    workerId: text('worker_id')
      .notNull()
      .references(() => fleetHosts.id, { onDelete: 'cascade' }),
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
 * Enrolment tokens: held by the operator's vps-sync checkout, they let fleet-converge.sh register a
 * box and receive that box's agent key in one call (POST /v1/fleet/enroll). A token can do nothing
 * else: no reads, no commands. Stored only as sha256; the plaintext exists only in the create
 * response. Grants made with it are audited under the admin who created it.
 */
export const fleetEnrollTokens = pgTable('fleet_enroll_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  label: text('label').notNull().default(''),
  tokenHash: text('token_hash').notNull().unique(),
  tokenPrefix: text('token_prefix').notNull(),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revokedBy: uuid('revoked_by').references(() => users.id),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
});

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
    // Cumulative driver slowdown counters in microseconds (see agentGpuSchema).
    hwThermalSlowdownUs: bigint('hw_thermal_slowdown_us', { mode: 'number' }),
    swThermalSlowdownUs: bigint('sw_thermal_slowdown_us', { mode: 'number' }),
    swPowerCapUs: bigint('sw_power_cap_us', { mode: 'number' }),
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

// ---- Alerting --------------------------------------------------------------------------------

/**
 * Editable thresholds for each alert rule. The catalog of rules and their defaults lives in
 * packages/types/src/fleet-incidents.ts; this table holds the live values and is seeded by the
 * migration. No CHECK on `key` or `severity`, the same deliberate choice as jobs.source: adding
 * a rule must not need a table rewrite.
 */
export const fleetAlertRules = pgTable('fleet_alert_rules', {
  key: text('key').primaryKey(),
  severity: text('severity').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  forSeconds: integer('for_seconds').notNull(),
  clearSeconds: integer('clear_seconds').notNull(),
  params: jsonb('params').notNull().default({}).$type<Record<string, number>>(),
  updatedBy: uuid('updated_by').references(() => users.id),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One row per episode of a problem on a worker. States: OPEN, ACK, RECOVERED. A recurrence after
 * recovery is a new row, so each episode keeps its own timeline. No FK to workers: an incident
 * about a deleted worker is still a record of what happened.
 */
export const fleetIncidents = pgTable(
  'fleet_incidents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ruleKey: text('rule_key').notNull(),
    workerId: text('worker_id').notNull(),
    state: text('state').notNull().default('OPEN'),
    severity: text('severity').notNull(),
    summary: text('summary').notNull(),
    // Flat scalar snapshot taken when the incident opened.
    evidence: jsonb('evidence').notNull().default({}).$type<Record<string, unknown>>(),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    ackedAt: timestamp('acked_at', { withTimezone: true }),
    ackedBy: uuid('acked_by').references(() => users.id),
    recoveredAt: timestamp('recovered_at', { withTimezone: true }),
  },
  (t) => ({
    // The dedupe: at most one live incident per rule and worker. The evaluator relies on this
    // rather than on its own bookkeeping, so two evaluators cannot open the same incident twice.
    oneLive: uniqueIndex('fleet_incidents_one_live_idx')
      .on(t.ruleKey, t.workerId)
      .where(sql`${t.state} <> 'RECOVERED'`),
    byStateOpened: index('fleet_incidents_state_opened_idx').on(t.state, t.openedAt),
    byWorkerOpened: index('fleet_incidents_worker_opened_idx').on(t.workerId, t.openedAt),
  }),
);

/** Append-only timeline of one incident. A null actor is the system (the evaluator). */
export const fleetIncidentEvents = pgTable(
  'fleet_incident_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    incidentId: uuid('incident_id')
      .notNull()
      .references(() => fleetIncidents.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    text: text('text'),
  },
  (t) => ({
    byIncident: index('fleet_incident_events_incident_idx').on(t.incidentId, t.at),
  }),
);

// ---- Rollups ---------------------------------------------------------------------------------

/**
 * One row per GPU per minute, aggregated from the raw samples before retention removes them
 * (raw: 48 h, rollups: 30 d). `n` is the sample count, so coarser buckets can be re-averaged
 * correctly (sum(avg * n) / sum(n)) instead of averaging averages. Recomputed idempotently over a
 * recent window, so a late spooled sample just updates its minute.
 */
export const fleetGpuRollups = pgTable(
  'fleet_gpu_rollups',
  {
    workerId: text('worker_id').notNull(),
    gpuIndex: smallint('gpu_index').notNull(),
    bucket: timestamp('bucket', { withTimezone: true }).notNull(),
    n: integer('n').notNull(),
    tempAvg: real('temp_avg'),
    tempMax: real('temp_max'),
    smClockAvg: real('sm_clock_avg'),
    smClockMin: integer('sm_clock_min'),
    powerAvg: real('power_avg'),
    powerMax: real('power_max'),
    utilAvg: real('util_avg'),
    vramUsedMax: integer('vram_used_max'),
    vramTotalMax: integer('vram_total_max'),
    // Highest counter value seen in the minute; consecutive buckets difference into time slowed.
    hwThermalSlowdownUsMax: bigint('hw_thermal_slowdown_us_max', { mode: 'number' }),
    swThermalSlowdownUsMax: bigint('sw_thermal_slowdown_us_max', { mode: 'number' }),
    swPowerCapUsMax: bigint('sw_power_cap_us_max', { mode: 'number' }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.workerId, t.gpuIndex, t.bucket] }),
    byTime: index('fleet_gpu_rollups_time_idx').on(t.bucket),
  }),
);

export const fleetHostRollups = pgTable(
  'fleet_host_rollups',
  {
    workerId: text('worker_id').notNull(),
    bucket: timestamp('bucket', { withTimezone: true }).notNull(),
    n: integer('n').notNull(),
    load1Max: real('load1_max'),
    ramAvailMin: integer('ram_avail_min'),
    swapUsedMax: integer('swap_used_max'),
    memPsiMax: real('mem_psi_max'),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.workerId, t.bucket] }),
    byTime: index('fleet_host_rollups_time_idx').on(t.bucket),
  }),
);

/** Small operator-managed settings for the fleet feature (key -> JSON), e.g. alert recipients. */
export const fleetSettings = pgTable('fleet_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedBy: uuid('updated_by').references(() => users.id),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * An operator's request to act on a GPU worker (restart ComfyUI, clear its queue). The API only
 * records and guards the request; whatever runs on the box claims PENDING rows and reports back.
 * At most one non-terminal command per worker, so two clicks cannot queue two restarts.
 */
export const fleetCommands = pgTable(
  'fleet_commands',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workerId: text('worker_id')
      .notNull()
      .references(() => workers.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    reason: text('reason').notNull(),
    state: text('state').notNull().default('PENDING'),
    requestedBy: uuid('requested_by').references(() => users.id),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    result: text('result'),
  },
  (t) => ({
    oneLive: uniqueIndex('fleet_commands_one_live_idx')
      .on(t.workerId)
      .where(sql`${t.state} IN ('PENDING', 'RUNNING')`),
    byWorkerTime: index('fleet_commands_worker_time_idx').on(t.workerId, t.requestedAt),
  }),
);
