import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../../lib/errors.js';
import { getTryonCreditCost } from '../../lib/resolution-config.js';
import { createDevJobCore } from './create-job.js';

/**
 * Creates a developer-API saree-mannequin (step-1) job from a raw garment
 * cloth image. Resolves the workflow off whichever garment_subcategories row
 * has requires_mannequin_step = true — today, exactly one (Flat Saree). No
 * category/garmentType param yet; add one if a second such garment type ever
 * exists (see docs/superpowers/specs/2026-07-20-dev-saree-mannequin-api-design.md).
 *
 * faceId is always null here — the workflow's face comes from a fixed URL node
 * baked into the template, not a caller-supplied image.
 */
export async function createDevSareeMannequinJob(
  app: FastifyInstance,
  params: {
    merchantUserId: string;
    apiKeyId: string;
    garmentKey: string;
  },
): Promise<{ jobId: string }> {
  const cost = await getTryonCreditCost(app);

  const [garmentType] = await app.db
    .select({
      id: schema.garmentSubcategories.id,
      workflowTemplateId: schema.garmentSubcategories.mannequinWorkflowTemplateId,
      isActive: schema.garmentSubcategories.isActive,
    })
    .from(schema.garmentSubcategories)
    .where(eq(schema.garmentSubcategories.requiresMannequinStep, true))
    .limit(1);

  if (!garmentType || !garmentType.isActive || !garmentType.workflowTemplateId) {
    throw new AppError('BAD_CATEGORY', 400, 'saree mannequin generation is not configured');
  }

  const [template] = await app.db
    .select({ isActive: schema.workflowTemplates.isActive })
    .from(schema.workflowTemplates)
    .where(eq(schema.workflowTemplates.id, garmentType.workflowTemplateId));
  if (!template?.isActive) {
    throw new AppError('BAD_CATEGORY', 400, 'saree mannequin generation is not configured');
  }

  const [user] = await app.db
    .select({ isBanned: schema.users.isBanned })
    .from(schema.users)
    .where(eq(schema.users.id, params.merchantUserId));
  if (!user || user.isBanned) throw new AppError('FORBIDDEN', 403, 'account suspended');

  return createDevJobCore(app, {
    merchantUserId: params.merchantUserId,
    apiKeyId: params.apiKeyId,
    cost,
    watermark: false,
    metricKind: 'saree_mannequin',
    buildJobInputs: () => ({
      upperGarmentKey: params.garmentKey,
      garmentTypeId: garmentType.id,
      faceId: null,
      params: { kind: 'saree_mannequin' },
    }),
  });
}
