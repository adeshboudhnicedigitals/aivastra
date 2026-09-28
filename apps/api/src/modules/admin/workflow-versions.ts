import { type DbTransaction, schema } from '@aivastra/db';
import { desc, eq } from 'drizzle-orm';
import { AppError } from '../../lib/errors.js';

export interface RecordWorkflowVersionParams {
  workflowTemplateId: string;
  appliedBy: string;
  changeRequestId?: string | null;
  // Set only when a brand-new row is replacing an existing one (a 'create'
  // change request being approved) — the id of the row being replaced. Version
  // numbering then continues THAT row's lineage instead of starting the new
  // row at v1. See packages/db/src/schema/workflow-governance.ts.
  continuesFromWorkflowId?: string | null;
}

/**
 * Inserts a workflow_versions snapshot within the caller's transaction.
 *
 * Invariant: must be called inside the same transaction as the workflow_templates
 * mutation it records, so a version-write failure rolls back the mutation too.
 *
 * Version numbering: normally MAX(version_number)+1 for this row's own history.
 * When continuesFromWorkflowId is set, numbering instead continues the replaced
 * row's lineage — its MAX+1, or 2 if that row was never itself versioned (it's
 * treated as an implicit, unwritten v1) — so a workflow replaced twice reads
 * v1 -> v2 -> v3 across three distinct workflow_templates rows.
 */
export async function recordWorkflowVersion(
  tx: DbTransaction,
  params: RecordWorkflowVersionParams,
): Promise<void> {
  const isLineageContinuation = !!params.continuesFromWorkflowId;
  const lineageId = params.continuesFromWorkflowId ?? params.workflowTemplateId;

  const [last] = await tx
    .select({ versionNumber: schema.workflowVersions.versionNumber })
    .from(schema.workflowVersions)
    .where(eq(schema.workflowVersions.workflowTemplateId, lineageId))
    .orderBy(desc(schema.workflowVersions.versionNumber))
    .limit(1);

  const baseline = last?.versionNumber ?? (isLineageContinuation ? 1 : 0);
  const nextVersion = baseline + 1;

  const [row] = await tx
    .select()
    .from(schema.workflowTemplates)
    .where(eq(schema.workflowTemplates.id, params.workflowTemplateId));
  if (!row) throw new AppError('NOT_FOUND', 404, 'workflow not found for versioning');

  await tx.insert(schema.workflowVersions).values({
    workflowTemplateId: params.workflowTemplateId,
    versionNumber: nextVersion,
    snapshot: row as Record<string, unknown>,
    changeRequestId: params.changeRequestId ?? null,
    appliedBy: params.appliedBy,
  });
}
