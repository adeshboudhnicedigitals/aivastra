import { schema } from '@aivastra/db';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../../lib/errors.js';

export interface ResolvedSingleTryonGarment {
  kind: 'single';
  r2Key: string;
  workflowTemplateId: string;
  workflowTemplateVersion?: number | null;
  isDemo: boolean;
}

/**
 * A catalog item with a pallu (second) image. No single-pass 3-input (customer +
 * body + pallu) ComfyUI template exists in this system today — see
 * docs/superpowers/plans/2026-08-20-merchant-catalog-two-input-direct-tryon.md and
 * the handoff that followed it. This shape instead carries what's needed to run
 * the same two-step pipeline merchant-catalog product generation already uses:
 * a 0-credit mannequin-drape job (body+pallu -> one draped image) whose output
 * then becomes the single garment input to an ordinary tryon job against the
 * real customer's photo. Always merchant-owned (never a demo item).
 */
export interface ResolvedTwoInputTryonGarment {
  kind: 'two-input';
  bodyKey: string;
  palluKey: string;
  garmentSubcategoryId: string;
  mannequinWorkflowTemplateId: string;
  mannequinWorkflowTemplateVersion?: number | null;
  tryonWorkflowTemplateId: string;
  tryonWorkflowTemplateVersion?: number | null;
}

export type ResolvedTryonGarment = ResolvedSingleTryonGarment | ResolvedTwoInputTryonGarment;

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
      secondR2Key: schema.merchantCatalogItems.secondR2Key,
      mannequinResultKey: schema.merchantCatalogItems.mannequinResultKey,
      isActive: schema.merchantCatalogItems.isActive,
      moderationStatus: schema.merchantCatalogItems.moderationStatus,
      garmentSubcategoryId: schema.merchantCatalogSubcategories.garmentSubcategoryId,
      mannequinWorkflowTemplateId: schema.garmentSubcategories.mannequinTwoInputWorkflowTemplateId,
      workflowTemplateId: schema.tryonCategories.workflowTemplateId,
      workflowTemplateVersion: schema.workflowTemplates.version,
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
    // A staff soft-deleted item is gone for try-on: it falls through to the demo lookup,
    // which cannot match a merchant row's id, so the caller gets the same 404.
    .where(
      and(
        eq(schema.merchantCatalogItems.id, itemId),
        isNull(schema.merchantCatalogItems.deletedAt),
      ),
    )
    .limit(1);

  if (own) {
    if (own.merchantId !== merchantId) {
      throw new AppError('NOT_FOUND', 404, 'catalog item not found');
    }
    if (!own.isActive || own.moderationStatus !== 'approved') {
      throw new AppError('FORBIDDEN', 403, 'catalog item is not available');
    }

    // A catalog item with a second (pallu) image needs the two-step pipeline: no
    // single-pass 3-input (customer + body + pallu) template exists in this system
    // (see ResolvedTwoInputTryonGarment's doc comment). Falling back to the
    // single-image template here would silently ignore the pallu image rather than
    // fail loud, so both the drape template and the tryon-category template are
    // hard config requirements, not a soft fallback.
    if (own.secondR2Key) {
      // Already drape once for this exact catalog item on an earlier customer's
      // try-on (saree-step2-promoter.ts caches the mannequin job's output here on
      // promotion) — every later try-on can skip straight to the single-garment
      // step, using the cached drape as the garment input, same as any ordinary
      // single-image product from this point on.
      if (own.mannequinResultKey) {
        assertWorkflow(own);
        return {
          kind: 'single',
          r2Key: own.mannequinResultKey,
          workflowTemplateId: own.workflowTemplateId,
          workflowTemplateVersion: own.workflowTemplateVersion,
          isDemo: false,
        };
      }
      if (!own.garmentSubcategoryId || !own.mannequinWorkflowTemplateId) {
        throw new AppError(
          'VALIDATION',
          400,
          'garment type has no two-input mannequin workflow configured',
        );
      }
      const [mannequinTemplate] = await app.db
        .select({
          isActive: schema.workflowTemplates.isActive,
          version: schema.workflowTemplates.version,
        })
        .from(schema.workflowTemplates)
        .where(eq(schema.workflowTemplates.id, own.mannequinWorkflowTemplateId))
        .limit(1);
      if (!mannequinTemplate?.isActive) {
        throw new AppError('VALIDATION', 400, 'two-input mannequin workflow is inactive');
      }
      // Step 2 reuses the same tryon-category template an ordinary single-image
      // try-on for this garment type already uses — assertWorkflow gives the same
      // fail-loud check that path already relies on.
      assertWorkflow(own);
      return {
        kind: 'two-input',
        bodyKey: own.r2Key,
        palluKey: own.secondR2Key,
        garmentSubcategoryId: own.garmentSubcategoryId,
        mannequinWorkflowTemplateId: own.mannequinWorkflowTemplateId,
        mannequinWorkflowTemplateVersion: mannequinTemplate.version,
        tryonWorkflowTemplateId: own.workflowTemplateId,
        tryonWorkflowTemplateVersion: own.workflowTemplateVersion,
      };
    }

    assertWorkflow(own);
    return {
      kind: 'single',
      r2Key: own.r2Key,
      workflowTemplateId: own.workflowTemplateId,
      workflowTemplateVersion: own.workflowTemplateVersion,
      isDemo: false,
    };
  }

  const [demo] = await app.db
    .select({
      r2Key: schema.demoCatalogItems.r2Key,
      isActive: schema.demoCatalogItems.isActive,
      setIsActive: schema.demoCatalogSets.isActive,
      workflowTemplateId: schema.tryonCategories.workflowTemplateId,
      workflowTemplateVersion: schema.workflowTemplates.version,
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
    .innerJoin(
      schema.merchants,
      and(eq(schema.merchants.id, merchantId), eq(schema.merchants.demoData, true)),
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
  return {
    kind: 'single',
    r2Key: demo.r2Key,
    workflowTemplateId: demo.workflowTemplateId,
    workflowTemplateVersion: demo.workflowTemplateVersion,
    isDemo: true,
  };
}

/**
 * Ownership-only form of resolveTryonGarment's lookup, for callers that record a catalog
 * item without running a try-on (in-store wishlist / sale). Same rule: the merchant's own
 * row, or an admin demo item in a set assigned to a demo-data merchant. Deliberately
 * ignores active/moderation/workflow state: those gate generating a try-on, not
 * remembering what a customer liked or bought.
 */
export async function merchantCanReferenceCatalogItem(
  app: FastifyInstance,
  merchantId: string,
  itemId: string,
): Promise<boolean> {
  const [own] = await app.db
    .select({ id: schema.merchantCatalogItems.id })
    .from(schema.merchantCatalogItems)
    .where(
      and(
        eq(schema.merchantCatalogItems.id, itemId),
        eq(schema.merchantCatalogItems.merchantId, merchantId),
        // Soft-deleted items cannot be newly wishlisted or sold; past session items keep
        // their id (no FK), so reports of earlier activity are unaffected.
        isNull(schema.merchantCatalogItems.deletedAt),
      ),
    )
    .limit(1);
  if (own) return true;
  const [demo] = await app.db
    .select({ id: schema.demoCatalogItems.id })
    .from(schema.demoCatalogItems)
    .innerJoin(
      schema.demoCatalogSubcategories,
      eq(schema.demoCatalogSubcategories.id, schema.demoCatalogItems.subcategoryId),
    )
    .innerJoin(
      schema.demoCatalogAssignments,
      and(
        eq(schema.demoCatalogAssignments.setId, schema.demoCatalogSubcategories.setId),
        eq(schema.demoCatalogAssignments.merchantId, merchantId),
      ),
    )
    .innerJoin(
      schema.merchants,
      and(eq(schema.merchants.id, merchantId), eq(schema.merchants.demoData, true)),
    )
    .where(eq(schema.demoCatalogItems.id, itemId))
    .limit(1);
  return Boolean(demo);
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
