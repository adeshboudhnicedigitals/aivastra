import { type DbTransaction, schema } from '@aivastra/db';
import { and, eq, inArray, isNotNull, isNull, or } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { recordAudit } from './audit.js';

export interface ReassignWorkflowMappingsSummary {
  poses: number;
  poseGarmentConfigsDirect: number;
  poseGarmentConfigsInherited: number;
  garmentSubcategoryColumns: number;
  sareeMannequinStyleColumns: number;
  tryonCategories: number;
  sareeSettings: number;
  shopifyFunnelTemplates: number;
  catalogueTemplatePoseWorkflows: number;
  garmentShotTypeWorkflows: number;
  devTryonCategories: number;
  devSareeMannequinConfig: number;
}

/**
 * Moves every mapping that pointed at `fromWorkflowId` onto `toWorkflowId` —
 * every table in the schema that can route a job to a specific workflow row,
 * not just model_pose_assets (which is all the older, manual
 * POST /admin/workflows/:id/reassign endpoint ever covered).
 *
 * Called when a 'create' change request is approved: the approval already
 * inserted a brand-new workflow_templates row (a new id) and deactivated the
 * one it replaces, so without this step every pose/garment-type/category/
 * funnel that used the old workflow would keep pointing at a now-inactive
 * row — and isActive is enforced at job-creation time (apps/api/src/modules/
 * jobs/create.ts, createSaree.ts, regenerate.ts), so those would start
 * failing job creation until someone noticed and reassigned manually.
 *
 * Prompt overrides pinned to the OLD graph (model_pose_assets,
 * pose_garment_configs, catalogue_template_pose_workflows) are cleared for
 * every row this moves — same "old text can't be trusted against a
 * different graph shape" rule already applied by /replace and the older
 * /reassign endpoint (see docs/superpowers/specs/
 * 2026-09-11-workflow-replace-prompt-override-invalidation-design.md).
 *
 * Invariant: must run inside the same transaction as the mutation that
 * triggered it (the 'create' approval), so a failure here rolls back the
 * whole approval instead of leaving a new workflow half-adopted.
 */
export async function reassignAllWorkflowMappings(
  tx: DbTransaction,
  params: {
    fromWorkflowId: string;
    toWorkflowId: string;
    actor: { userId: string; role: string };
    request?: FastifyRequest;
  },
): Promise<ReassignWorkflowMappingsSummary> {
  const { fromWorkflowId: fromId, toWorkflowId: toId, actor, request } = params;

  // 1. model_pose_assets — the "regular" per-pose mapping. Prompt overrides on
  // moved poses are cleared; their ids are needed below to also clear any
  // pose_garment_configs row that inherits its workflow from the pose.
  const posesOnFrom = await tx
    .select({ id: schema.modelPoseAssets.id })
    .from(schema.modelPoseAssets)
    .where(eq(schema.modelPoseAssets.workflowTemplateId, fromId));
  const movedPoseIds = posesOnFrom.map((p) => p.id);

  const movedPoses =
    movedPoseIds.length > 0
      ? await tx
          .update(schema.modelPoseAssets)
          .set({ workflowTemplateId: toId, promptGarmentPhase: null, promptFacePhase: null })
          .where(eq(schema.modelPoseAssets.workflowTemplateId, fromId))
          .returning({ id: schema.modelPoseAssets.id })
      : [];

  // 2. pose_garment_configs rows that inherit their workflow from a pose just
  // moved above (workflowTemplateId IS NULL) — their effective graph moved
  // with the pose, so any pinned prompt text is just as stale.
  const inheritedConfigsCleared =
    movedPoseIds.length > 0
      ? await tx
          .update(schema.poseGarmentConfigs)
          .set({ promptGarmentPhase: null, promptFacePhase: null, updatedAt: new Date() })
          .where(
            and(
              isNull(schema.poseGarmentConfigs.workflowTemplateId),
              inArray(schema.poseGarmentConfigs.poseAssetId, movedPoseIds),
              or(
                isNotNull(schema.poseGarmentConfigs.promptGarmentPhase),
                isNotNull(schema.poseGarmentConfigs.promptFacePhase),
              ),
            ),
          )
          .returning({ id: schema.poseGarmentConfigs.id })
      : [];

  // 3. pose_garment_configs rows with their OWN direct workflow override.
  const directConfigsMoved = await tx
    .update(schema.poseGarmentConfigs)
    .set({
      workflowTemplateId: toId,
      promptGarmentPhase: null,
      promptFacePhase: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.poseGarmentConfigs.workflowTemplateId, fromId))
    .returning({ id: schema.poseGarmentConfigs.id });

  // 4. garment_subcategories — the four saree/mannequin/two-input workflow slots.
  const mannequinMoved = await tx
    .update(schema.garmentSubcategories)
    .set({ mannequinWorkflowTemplateId: toId, updatedAt: new Date() })
    .where(eq(schema.garmentSubcategories.mannequinWorkflowTemplateId, fromId))
    .returning({ id: schema.garmentSubcategories.id });
  const sareeStep2Moved = await tx
    .update(schema.garmentSubcategories)
    .set({ sareeStep2WorkflowTemplateId: toId, updatedAt: new Date() })
    .where(eq(schema.garmentSubcategories.sareeStep2WorkflowTemplateId, fromId))
    .returning({ id: schema.garmentSubcategories.id });
  const mannequinTwoInputMoved = await tx
    .update(schema.garmentSubcategories)
    .set({ mannequinTwoInputWorkflowTemplateId: toId, updatedAt: new Date() })
    .where(eq(schema.garmentSubcategories.mannequinTwoInputWorkflowTemplateId, fromId))
    .returning({ id: schema.garmentSubcategories.id });
  const twoInputTryonMoved = await tx
    .update(schema.garmentSubcategories)
    .set({ twoInputTryonWorkflowTemplateId: toId, updatedAt: new Date() })
    .where(eq(schema.garmentSubcategories.twoInputTryonWorkflowTemplateId, fromId))
    .returning({ id: schema.garmentSubcategories.id });
  const garmentSubcategoryColumns =
    mannequinMoved.length +
    sareeStep2Moved.length +
    mannequinTwoInputMoved.length +
    twoInputTryonMoved.length;

  // 5. saree_mannequin_styles — the two per-style workflow slots.
  const styleMannequinMoved = await tx
    .update(schema.sareeMannequinStyles)
    .set({ mannequinWorkflowTemplateId: toId, updatedAt: new Date() })
    .where(eq(schema.sareeMannequinStyles.mannequinWorkflowTemplateId, fromId))
    .returning({ id: schema.sareeMannequinStyles.id });
  const styleMannequinTwoInputMoved = await tx
    .update(schema.sareeMannequinStyles)
    .set({ mannequinTwoInputWorkflowTemplateId: toId, updatedAt: new Date() })
    .where(eq(schema.sareeMannequinStyles.mannequinTwoInputWorkflowTemplateId, fromId))
    .returning({ id: schema.sareeMannequinStyles.id });
  const sareeMannequinStyleColumns =
    styleMannequinMoved.length + styleMannequinTwoInputMoved.length;

  // 6. tryon_categories
  const tryonCategoriesMoved = await tx
    .update(schema.tryonCategories)
    .set({ workflowTemplateId: toId, updatedAt: new Date() })
    .where(eq(schema.tryonCategories.workflowTemplateId, fromId))
    .returning({ id: schema.tryonCategories.id });

  // 7. saree_settings — single-row global config.
  const sareeSettingsMoved = await tx
    .update(schema.sareeSettings)
    .set({ workflowTemplateId: toId, updatedAt: new Date() })
    .where(eq(schema.sareeSettings.workflowTemplateId, fromId))
    .returning({ id: schema.sareeSettings.id });

  // 8. shopify_funnel_templates
  const shopifyFunnelTemplatesMoved = await tx
    .update(schema.shopifyFunnelTemplates)
    .set({ workflowTemplateId: toId, updatedAt: new Date() })
    .where(eq(schema.shopifyFunnelTemplates.workflowTemplateId, fromId))
    .returning({ id: schema.shopifyFunnelTemplates.id });

  // 9. catalogue_template_pose_workflows — per-(template mapping x pose) override,
  // with its own graph-specific prompt text to clear too.
  const catalogueTemplatePoseWorkflowsMoved = await tx
    .update(schema.catalogueTemplatePoseWorkflows)
    .set({ workflowTemplateId: toId, promptGarmentPhase: null, updatedAt: new Date() })
    .where(eq(schema.catalogueTemplatePoseWorkflows.workflowTemplateId, fromId))
    .returning({ id: schema.catalogueTemplatePoseWorkflows.id });

  // 10. garment_shot_type_workflows — the 3-shot-type default per garment type.
  const garmentShotTypeWorkflowsMoved = await tx
    .update(schema.garmentShotTypeWorkflows)
    .set({ workflowTemplateId: toId, updatedAt: new Date() })
    .where(eq(schema.garmentShotTypeWorkflows.workflowTemplateId, fromId))
    .returning({ id: schema.garmentShotTypeWorkflows.id });

  // 11. dev_tryon_categories — the public /v1/dev/* surface, deliberately separate
  // from tryon_categories (see schema comment) but just as much a real mapping.
  const devTryonCategoriesMoved = await tx
    .update(schema.devTryonCategories)
    .set({ workflowTemplateId: toId, updatedAt: new Date() })
    .where(eq(schema.devTryonCategories.workflowTemplateId, fromId))
    .returning({ id: schema.devTryonCategories.id });

  // 12. dev_saree_mannequin_config — single-row global config for the dev-API
  // saree-mannequin endpoint.
  const devSareeMannequinConfigMoved = await tx
    .update(schema.devSareeMannequinConfig)
    .set({ workflowTemplateId: toId, updatedAt: new Date() })
    .where(eq(schema.devSareeMannequinConfig.workflowTemplateId, fromId))
    .returning({ id: schema.devSareeMannequinConfig.id });

  const summary: ReassignWorkflowMappingsSummary = {
    poses: movedPoses.length,
    poseGarmentConfigsDirect: directConfigsMoved.length,
    poseGarmentConfigsInherited: inheritedConfigsCleared.length,
    garmentSubcategoryColumns,
    sareeMannequinStyleColumns,
    tryonCategories: tryonCategoriesMoved.length,
    sareeSettings: sareeSettingsMoved.length,
    shopifyFunnelTemplates: shopifyFunnelTemplatesMoved.length,
    catalogueTemplatePoseWorkflows: catalogueTemplatePoseWorkflowsMoved.length,
    garmentShotTypeWorkflows: garmentShotTypeWorkflowsMoved.length,
    devTryonCategories: devTryonCategoriesMoved.length,
    devSareeMannequinConfig: devSareeMannequinConfigMoved.length,
  };

  await recordAudit(tx, {
    actor,
    action: 'workflow.reassign_mappings',
    resourceType: 'workflow',
    resourceId: toId,
    before: { fromWorkflowId: fromId },
    after: { toWorkflowId: toId, ...summary },
    request,
  });

  return summary;
}
