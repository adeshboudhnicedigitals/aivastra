import { schema } from '@aivastra/db';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../../lib/errors.js';

export interface ResolvedTryonGarment {
  r2Key: string;
  workflowTemplateId: string;
  isDemo: boolean;
}

/**
 * One garment lookup for both try-on entry points (the merchant-token route and
 * the kiosk-device route, which had byte-identical copies of this query). Tries
 * the merchant's own catalogue first, then falls back to admin demo items the
 * merchant has been assigned. `merchantCatalogItemId` is a shared id namespace
 * across two tables; UUIDs make collisions impossible.
 */
export async function resolveTryonGarment(
  app: FastifyInstance,
  merchantId: string,
  itemId: string,
): Promise<ResolvedTryonGarment> {
  const [own] = await app.db
    .select({
      merchantId: schema.merchantCatalogItems.merchantId,
      r2Key: schema.merchantCatalogItems.r2Key,
      isActive: schema.merchantCatalogItems.isActive,
      moderationStatus: schema.merchantCatalogItems.moderationStatus,
      workflowTemplateId: schema.tryonCategories.workflowTemplateId,
      tryonCategoryIsActive: schema.tryonCategories.isActive,
      workflowTemplateIsActive: schema.workflowTemplates.isActive,
    })
    .from(schema.merchantCatalogItems)
    .innerJoin(
      schema.merchantCatalogSubcategories,
      eq(schema.merchantCatalogSubcategories.id, schema.merchantCatalogItems.subcategoryId),
    )
    .leftJoin(
      schema.garmentSubcategories,
      eq(schema.garmentSubcategories.id, schema.merchantCatalogSubcategories.garmentSubcategoryId),
    )
    .leftJoin(
      schema.tryonCategories,
      eq(schema.tryonCategories.id, schema.garmentSubcategories.tryonCategoryId),
    )
    .leftJoin(
      schema.workflowTemplates,
      eq(schema.workflowTemplates.id, schema.tryonCategories.workflowTemplateId),
    )
    .where(eq(schema.merchantCatalogItems.id, itemId))
    .limit(1);

  if (own) {
    if (own.merchantId !== merchantId) {
      throw new AppError('NOT_FOUND', 404, 'catalog item not found');
    }
    if (!own.isActive || own.moderationStatus !== 'approved') {
      throw new AppError('FORBIDDEN', 403, 'catalog item is not available');
    }
    assertWorkflow(own);
    return { r2Key: own.r2Key, workflowTemplateId: own.workflowTemplateId, isDemo: false };
  }

  const [demo] = await app.db
    .select({
      r2Key: schema.demoCatalogItems.r2Key,
      isActive: schema.demoCatalogItems.isActive,
      setIsActive: schema.demoCatalogSets.isActive,
      workflowTemplateId: schema.tryonCategories.workflowTemplateId,
      tryonCategoryIsActive: schema.tryonCategories.isActive,
      workflowTemplateIsActive: schema.workflowTemplates.isActive,
    })
    .from(schema.demoCatalogItems)
    .innerJoin(
      schema.demoCatalogSubcategories,
      eq(schema.demoCatalogSubcategories.id, schema.demoCatalogItems.subcategoryId),
    )
    .innerJoin(
      schema.demoCatalogSets,
      eq(schema.demoCatalogSets.id, schema.demoCatalogSubcategories.setId),
    )
    // The inner join IS the authorization check: no assignment row, no result.
    .innerJoin(
      schema.demoCatalogAssignments,
      and(
        eq(schema.demoCatalogAssignments.setId, schema.demoCatalogSets.id),
        eq(schema.demoCatalogAssignments.merchantId, merchantId),
      ),
    )
    .leftJoin(
      schema.garmentSubcategories,
      eq(schema.garmentSubcategories.id, schema.demoCatalogSubcategories.garmentSubcategoryId),
    )
    .leftJoin(
      schema.tryonCategories,
      eq(schema.tryonCategories.id, schema.garmentSubcategories.tryonCategoryId),
    )
    .leftJoin(
      schema.workflowTemplates,
      eq(schema.workflowTemplates.id, schema.tryonCategories.workflowTemplateId),
    )
    .where(eq(schema.demoCatalogItems.id, itemId))
    .limit(1);

  if (!demo) throw new AppError('NOT_FOUND', 404, 'catalog item not found');
  if (!demo.isActive || !demo.setIsActive) {
    throw new AppError('FORBIDDEN', 403, 'catalog item is not available');
  }
  assertWorkflow(demo);
  return { r2Key: demo.r2Key, workflowTemplateId: demo.workflowTemplateId, isDemo: true };
}

function assertWorkflow(row: {
  workflowTemplateId: string | null;
  tryonCategoryIsActive: boolean | null;
  workflowTemplateIsActive: boolean | null;
}): asserts row is {
  workflowTemplateId: string;
  tryonCategoryIsActive: boolean;
  workflowTemplateIsActive: boolean;
} {
  if (!row.workflowTemplateId || !row.tryonCategoryIsActive || !row.workflowTemplateIsActive) {
    throw new AppError('VALIDATION', 400, 'garment type has no tryon category configured');
  }
}
