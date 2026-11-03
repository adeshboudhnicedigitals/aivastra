import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { workers } from './workers.js';

// Fleet inventory: which physical box and GPU each worker runs on, plus the rental facts the
// dashboard shows beside them. Operator-maintained and audited; telemetry never overwrites it.

/**
 * A rented or owned machine: the unit the GPU dashboard is organised around. `id` is the box name
 * vps-sync uses (e.g. "w6"); enrolment creates the row, and the fleet agent reports under that id.
 */
export const fleetHosts = pgTable('fleet_hosts', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
  provider: text('provider'),
  // null = not known; false = owned; true = rented.
  rented: boolean('rented'),
  monthlyCostUsd: numeric('monthly_cost_usd', { precision: 10, scale: 2 }),
  // An operator has checked these facts against the provider's records.
  inventoryVerified: boolean('inventory_verified').notNull().default(false),
  // The dispatcher worker this box serves, if any. Set by enrolment (vps-sync boxes/fleet.txt), not
  // by telemetry. It only labels the box ("in rotation", "disabled"); the box's health never comes
  // from the dispatcher. A deleted worker leaves the box monitored, just unlinked.
  workerId: text('worker_id').references(() => workers.id, { onDelete: 'set null' }),
  // Last hardware the agent reported (GPU models and VRAM, driver, RAM, disk size), kept so a box
  // that has gone quiet still says what it is. Written by ingest only when it changes.
  hardware: jsonb('hardware').$type<Record<string, unknown>>(),
  hardwareAt: timestamp('hardware_at', { withTimezone: true }),
  updatedBy: uuid('updated_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** One physical GPU on a host. The model name and VRAM here are what the operator recorded. */
export const fleetGpus = pgTable(
  'fleet_gpus',
  {
    id: text('id').primaryKey(),
    hostId: text('host_id')
      .notNull()
      .references(() => fleetHosts.id),
    model: text('model'),
    vramTotalMb: integer('vram_total_mb'),
    updatedBy: uuid('updated_by').references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ byHost: index('fleet_gpus_host_idx').on(t.hostId) }),
);

/**
 * Which host and GPU a worker runs on. Several workers may share one GPU (two ComfyUI instances);
 * the route checks that the GPU belongs to the host, which a plain foreign key cannot express.
 */
export const fleetWorkerMap = pgTable(
  'fleet_worker_map',
  {
    workerId: text('worker_id')
      .primaryKey()
      .references(() => workers.id, { onDelete: 'cascade' }),
    hostId: text('host_id')
      .notNull()
      .references(() => fleetHosts.id),
    gpuId: text('gpu_id')
      .notNull()
      .references(() => fleetGpus.id),
    updatedBy: uuid('updated_by').references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byHost: index('fleet_worker_map_host_idx').on(t.hostId),
    byGpu: index('fleet_worker_map_gpu_idx').on(t.gpuId),
  }),
);

/**
 * Append-only reconciliation notes: an operator compared a host against what the provider says and
 * wrote down the outcome. Nothing edits or deletes a row; the newest per host is the current review.
 */
export const fleetHostReviews = pgTable(
  'fleet_host_reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    hostId: text('host_id')
      .notNull()
      .references(() => fleetHosts.id),
    note: text('note').notNull(),
    reviewedBy: uuid('reviewed_by').references(() => users.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ byHost: index('fleet_host_reviews_host_idx').on(t.hostId, t.reviewedAt) }),
);
