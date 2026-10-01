import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { workflowTemplates } from './models.js';
import { users } from './users.js';

// Propose -> approve/reject queue for workflow_templates changes. MODERATOR/ADMIN
// can only reach workflow_templates through this table; SUPER_ADMIN can still write
// workflow_templates directly (see apps/api/src/modules/admin/workflows.routes.ts),
// bypassing this queue entirely.
export const workflowChangeRequests = pgTable(
  'workflow_change_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    changeType: text('change_type').notNull(), // 'create' | 'update'
    // For 'update': the existing workflow being changed. For 'create': the existing
    // ACTIVE workflow this new one is meant to replace — mandatory at the API layer
    // even though nullable here, to tolerate a target row being deleted later.
    targetWorkflowId: uuid('target_workflow_id').references(() => workflowTemplates.id, {
      onDelete: 'set null',
    }),
    proposedBy: uuid('proposed_by')
      .notNull()
      .references(() => users.id),
    proposedByRole: text('proposed_by_role').notNull(), // snapshot of the proposer's role at submit time
    reason: text('reason').notNull(), // what's updated/improved in this workflow
    previousLimitations: text('previous_limitations'), // what the current/past workflow lacks
    proposedFields: jsonb('proposed_fields').notNull().$type<Record<string, unknown>>(),
    status: text('status').notNull().default('pending'), // 'pending' | 'approved' | 'rejected'
    reviewedBy: uuid('reviewed_by').references(() => users.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewNote: text('review_note'), // optional on approve, required on reject
    resultingWorkflowId: uuid('resulting_workflow_id').references(() => workflowTemplates.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byStatusCreated: index('workflow_change_requests_status_created_idx').on(t.status, t.createdAt),
    byTarget: index('workflow_change_requests_target_idx').on(t.targetWorkflowId),
    byProposedBy: index('workflow_change_requests_proposed_by_idx').on(t.proposedBy),
  }),
);

// Full applied-change history for workflow_templates, independent of the
// draining/archive mechanism on workflow_templates.version (which exists only to
// let in-flight jobs finish against the graph they were dispatched with).
// Version numbering: normally continues THIS row's own history (MAX+1). When a
// 'create' proposal is approved, numbering instead continues the REPLACED row's
// lineage (its MAX+1, or an implicit 1 if it was never itself versioned) — see
// recordWorkflowVersion in apps/api/src/modules/admin/workflow-versions.ts.
export const workflowVersions = pgTable(
  'workflow_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workflowTemplateId: uuid('workflow_template_id')
      .notNull()
      .references(() => workflowTemplates.id, { onDelete: 'cascade' }),
    versionNumber: integer('version_number').notNull(),
    snapshot: jsonb('snapshot').notNull().$type<Record<string, unknown>>(),
    // null = a direct SUPER_ADMIN edit with no queue involved
    changeRequestId: uuid('change_request_id').references(() => workflowChangeRequests.id, {
      onDelete: 'set null',
    }),
    appliedBy: uuid('applied_by')
      .notNull()
      .references(() => users.id),
    appliedAt: timestamp('applied_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byTemplateVersion: index('workflow_versions_template_version_idx').on(
      t.workflowTemplateId,
      t.versionNumber,
    ),
  }),
);
