import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { jobs } from './jobs.js';

// Submission evidence is independent of transport delivery and jobs.attempts:
// a mannequin/main pipeline and an admin retry must never reuse a client ID.
export const executionAttempts = pgTable(
  'execution_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'cascade' }),
    requestId: uuid('request_id'),
    attemptNo: integer('attempt_no').notNull(),
    phase: text('phase').notNull(),
    clientId: text('client_id').notNull().unique(),
    state: text('state').notNull(),
    workerId: text('worker_id'),
    workerUrl: text('worker_url'),
    promptId: text('prompt_id'),
    uncertainDeadline: timestamp('uncertain_deadline', { withTimezone: true }),
    contract: jsonb('contract').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    // A business failure alone does not prove remote execution stopped.
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => [
    check('execution_attempts_one_parent', sql`num_nonnulls(${t.jobId}, ${t.requestId}) = 1`),
    check('execution_attempts_positive_number', sql`${t.attemptNo} > 0`),
    check('execution_attempts_phase', sql`${t.phase} IN ('main', 'mannequin', 'classify')`),
    check(
      'execution_attempts_state',
      sql`${t.state} IN ('PREPARING', 'SUBMITTING', 'ACCEPTED', 'OUTPUT_READY', 'SUCCEEDED', 'FAILED', 'UNKNOWN_RETRIED')`,
    ),
    check(
      'execution_attempts_receipt',
      sql`${t.state} NOT IN ('ACCEPTED', 'OUTPUT_READY', 'SUCCEEDED') OR ${t.promptId} IS NOT NULL`,
    ),
    check('execution_attempts_contract_object', sql`jsonb_typeof(${t.contract}) = 'object'`),
    uniqueIndex('execution_attempts_job_sequence_phase').on(t.jobId, t.attemptNo, t.phase),
    uniqueIndex('execution_attempts_request_sequence_phase').on(t.requestId, t.attemptNo, t.phase),
    index('execution_attempts_unresolved_worker')
      .on(t.workerId)
      .where(sql`${t.resolvedAt} IS NULL AND ${t.jobId} IS NOT NULL`),
  ],
);

// Added with submission evidence so later ownership can be additive. Phase A
// neither acquires leases nor changes recovery/admission behavior.
export const dispatcherJobControl = pgTable(
  'dispatcher_job_control',
  {
    jobId: uuid('job_id')
      .primaryKey()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    ownerSession: uuid('owner_session'),
    generation: bigint('generation', { mode: 'bigint' }).notNull().default(sql`0`),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    ownerRetired: boolean('owner_retired').notNull().default(false),
    activeAttemptId: uuid('active_attempt_id').references(() => executionAttempts.id, {
      onDelete: 'set null',
    }),
  },
  (t) => [index('dispatcher_job_control_recovery').on(t.ownerRetired, t.leaseUntil)],
);
