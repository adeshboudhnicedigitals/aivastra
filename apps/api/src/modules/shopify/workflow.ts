import { schema } from '@aivastra/db';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { getShopifyWorkflowTemplateId } from '../../lib/resolution-config.js';

export interface ResolvedShopifyWorkflow {
  workflowTemplateId: string;
  workflowTemplateVersion: number | null;
  source: 'config' | 'sole_basket_workflow';
}

async function activeWorkflow(app: FastifyInstance, id: string) {
  const [row] = await app.db
    .select({ id: schema.workflowTemplates.id, version: schema.workflowTemplates.version })
    .from(schema.workflowTemplates)
    .where(and(eq(schema.workflowTemplates.id, id), eq(schema.workflowTemplates.isActive, true)))
    .limit(1);
  return row ?? null;
}

/**
 * The one workflow every Shopify try-on runs. Resolved by the API at job
 * creation and pinned into job_inputs.params, so a change made after a job was
 * charged never alters what that job runs.
 *
 * Null means "refuse before the credit deduct": enqueueing would burn a credit
 * on a job that can only fail NO_WORKFLOW_CONFIGURED, which no merchant can fix.
 *
 * RELEASE-1 SHIM: until the admin has chosen a workflow, use the one workflow
 * all active funnel templates share, so deploying this does not refuse every
 * Shopify try-on in the gap before the admin acts. Deleted in release 2 along
 * with the funnel tables.
 */
export async function resolveShopifyWorkflow(
  app: FastifyInstance,
): Promise<ResolvedShopifyWorkflow | null> {
  const configuredId = await getShopifyWorkflowTemplateId(app);
  if (configuredId) {
    // A configured-but-unusable workflow refuses; it must not silently fall
    // back to a different one than the admin chose.
    const wf = await activeWorkflow(app, configuredId);
    return wf
      ? { workflowTemplateId: wf.id, workflowTemplateVersion: wf.version ?? null, source: 'config' }
      : null;
  }

  // Shim: one distinct workflow across all active baskets is unambiguous. More
  // than one means the old routing picked per product, so there is no single
  // answer to infer; refuse until the admin chooses.
  const distinct = await app.db
    .selectDistinct({ workflowTemplateId: schema.shopifyFunnelTemplates.workflowTemplateId })
    .from(schema.shopifyFunnelTemplates)
    .where(eq(schema.shopifyFunnelTemplates.isActive, true));
  if (distinct.length !== 1) return null;
  const wf = await activeWorkflow(app, distinct[0].workflowTemplateId);
  return wf
    ? {
        workflowTemplateId: wf.id,
        workflowTemplateVersion: wf.version ?? null,
        source: 'sole_basket_workflow',
      }
    : null;
}
