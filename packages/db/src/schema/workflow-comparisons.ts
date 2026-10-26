import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { jobs } from './jobs.js';
import { workflowTemplates } from './models.js';

export const workflowComparisons = pgTable(
  'workflow_comparisons',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceJobId: uuid('source_job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    generalJobId: uuid('general_job_id').references(() => jobs.id, { onDelete: 'set null' }),
    templateId: uuid('template_id')
      .notNull()
      .references(() => workflowTemplates.id),
    templateVersion: integer('template_version').notNull(),
    status: text('status').notNull(),
    unsupportedReason: text('unsupported_reason'),
    sourceSource: text('source_source'),
    sourceTemplateId: uuid('source_template_id'),
    // Freeze the supported person/garment mapping at collection time, before
    // live catalog or input metadata can change. Unsupported rows have no mapping.
    personKey: text('person_key'),
    garmentKey: text('garment_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('workflow_comparisons_source_template_version_idx').on(
      t.sourceJobId,
      t.templateId,
      t.templateVersion,
    ),
    index('workflow_comparisons_status_created_idx').on(t.status, t.createdAt),
    check('workflow_comparisons_version_positive', sql`${t.templateVersion} > 0`),
    check(
      'workflow_comparisons_status_valid',
      sql`${t.status} IN ('COLLECTED', 'QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'UNSUPPORTED', 'EXPIRED', 'CANCELLED')`,
    ),
  ],
);
