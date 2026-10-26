import { schema } from '@aivastra/db';
import { JOB_SOURCE } from '@aivastra/types';
import { sql } from 'drizzle-orm';
import { COMPARISON_SYSTEM_USER_ID } from './system-user.js';

/**
 * Keeps internal workflow-comparison replay jobs out of customer-facing reads and
 * business totals. `jobs.source` is nullable (legacy rows), so this must be
 * `IS DISTINCT FROM`: a bare `<>` evaluates to NULL for those rows and would silently
 * drop them from the count — the trap queue-capacity-config.ts also documents.
 *
 * Do NOT apply it to operational safety checks (template archive draining, stuck-job
 * sweeping, worker capacity): replay jobs are real jobs there and must be counted.
 */
export const notComparisonJob = sql`${schema.jobs.source} is distinct from ${JOB_SOURCE.COMPARISON}`;

/** The reserved account that owns replay jobs is not a customer. */
export const notComparisonSystemUser = sql`${schema.users.id} <> ${COMPARISON_SYSTEM_USER_ID}`;
