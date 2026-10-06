import { schema } from '@aivastra/db';
import { JOB_SOURCE } from '@aivastra/types';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../../lib/errors.js';
import { getTryonCreditCost } from '../../lib/resolution-config.js';
import { createDevJobCore } from '../dev/create-job.js';
import { resolveQueueRouting } from '../jobs/create.js';

/**
 * Creates a Chrome-extension try-on job from a raw person image + raw garment
 * image + category slug, on behalf of an authenticated platform user (JWT via
 * requireUser) — the shopper's own Ai Vastra account, not a merchant's key.
 *
 * Sibling to createDevTryonJob (apps/api/src/modules/dev/create-job.ts), not a
 * reuse of it: that function requires a merchantId/apiKeyId pair the extension
 * doesn't have. Resolves the workflow off the same dev_tryon_categories table
 * (decoupled from the internal Studio catalog — same reasoning
 * createDevTryonJob documents) and reuses createDevJobCore for the actual
 * insert/deduct/enqueue/refund-on-fail transaction, same as every other
 * dev-API-shaped job.
 */
export async function createExtensionTryonJob(
  app: FastifyInstance,
  params: {
    userId: string;
    categorySlug: string;
    personKey: string;
    garmentKey: string;
  },
): Promise<{ jobId: string }> {
  const cost = await getTryonCreditCost(app);

  // Resolve off the dedicated dev table, not tryon_categories — same
  // kill-switch parity as createDevTryonJob: an inactive category, or one
  // whose workflow template is inactive, must not resolve. Runs before any
  // credit movement, so a rejected request is free.
  const [category] = await app.db
    .select({
      workflowTemplateId: schema.devTryonCategories.workflowTemplateId,
      templateVersion: schema.workflowTemplates.version,
      templateIsActive: schema.workflowTemplates.isActive,
    })
    .from(schema.devTryonCategories)
    .leftJoin(
      schema.workflowTemplates,
      eq(schema.workflowTemplates.id, schema.devTryonCategories.workflowTemplateId),
    )
    .where(
      and(
        eq(schema.devTryonCategories.slug, params.categorySlug),
        eq(schema.devTryonCategories.isActive, true),
      ),
    )
    .limit(1);

  if (!category) throw new AppError('BAD_CATEGORY', 400, 'unknown or inactive category');
  if (!category.workflowTemplateId || !category.templateIsActive) {
    throw new AppError('BAD_CATEGORY', 400, 'category has no active workflow configured');
  }

  const [user] = await app.db
    .select({ isBanned: schema.users.isBanned })
    .from(schema.users)
    .where(eq(schema.users.id, params.userId));
  if (!user || user.isBanned) throw new AppError('FORBIDDEN', 403, 'account suspended');

  // This draws from the user's own regular credits/plan (unlike the dev API's
  // external, always-unwatermarked callers), so honour their actual
  // watermark entitlement rather than hardcoding false.
  const { watermark } = await resolveQueueRouting(app, params.userId);

  return createDevJobCore(app, {
    merchantUserId: params.userId,
    apiKeyId: null,
    cost,
    watermark,
    source: JOB_SOURCE.EXTENSION_TRYON,
    buildJobInputs: () => ({
      upperGarmentKey: params.garmentKey,
      params: {
        personKey: params.personKey,
        workflowTemplateId: category.workflowTemplateId,
        dispatchTemplateVersion: category.templateVersion ?? null,
      },
    }),
  });
}
