import { and, count, eq, inArray, notInArray, or, sql } from 'drizzle-orm';
import type { DB, DbTransaction } from './index.js';
import * as schema from './schema/index.js';

/** Undispatched comparisons pin the same frozen graph as an in-flight job. */
export async function hasWorkflowVersionConsumers(
  tx: DB | DbTransaction,
  workflowTemplateId: string,
  version: number,
): Promise<boolean> {
  const [comparison] = await tx
    .select({ id: schema.workflowComparisons.id })
    .from(schema.workflowComparisons)
    .where(
      and(
        eq(schema.workflowComparisons.templateId, workflowTemplateId),
        eq(schema.workflowComparisons.templateVersion, version),
        inArray(schema.workflowComparisons.status, ['COLLECTED', 'QUEUED', 'RUNNING']),
      ),
    )
    .limit(1);
  if (comparison) return true;
  const [row] = await tx
    .select({ cnt: count() })
    .from(schema.jobs)
    .innerJoin(schema.jobInputs, eq(schema.jobInputs.jobId, schema.jobs.id))
    .leftJoin(schema.modelPoseAssets, eq(schema.modelPoseAssets.id, schema.jobInputs.poseId))
    .leftJoin(
      schema.garmentSubcategories,
      eq(schema.garmentSubcategories.id, schema.jobInputs.garmentTypeId),
    )
    .where(
      and(
        sql`${schema.jobInputs.params} ->> 'dispatchTemplateVersion' = ${String(version)}`,
        or(
          sql`${schema.jobInputs.params} ->> 'workflowTemplateId' = ${workflowTemplateId}`,
          eq(schema.modelPoseAssets.workflowTemplateId, workflowTemplateId),
          eq(schema.garmentSubcategories.sareeStep2WorkflowTemplateId, workflowTemplateId),
          eq(schema.garmentSubcategories.mannequinWorkflowTemplateId, workflowTemplateId),
          eq(schema.garmentSubcategories.mannequinTwoInputWorkflowTemplateId, workflowTemplateId),
          eq(schema.garmentSubcategories.twoInputTryonWorkflowTemplateId, workflowTemplateId),
        ),
        notInArray(schema.jobs.status, ['COMPLETED', 'FAILED', 'CANCELLED']),
      ),
    );
  return Number(row?.cnt ?? 0) > 0;
}

/** Serialize with collection and replacement before dropping the exact graph. */
export async function cleanupUnusedWorkflowArchive(
  db: DB,
  templateId: string,
  version: number,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .select({ id: schema.workflowTemplates.id })
      .from(schema.workflowTemplates)
      .where(eq(schema.workflowTemplates.id, templateId))
      .for('update');
    if (await hasWorkflowVersionConsumers(tx, templateId, version)) return;
    await tx
      .delete(schema.workflowTemplateArchives)
      .where(
        and(
          eq(schema.workflowTemplateArchives.workflowTemplateId, templateId),
          eq(schema.workflowTemplateArchives.version, version),
        ),
      );
  });
}
