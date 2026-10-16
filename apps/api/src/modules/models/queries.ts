import { schema } from '@aivastra/db';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { poseGarmentRoles } from './garment-roles.js';

export async function listGarmentTypes(app: FastifyInstance, gender: string, bodyTypeId?: string) {
  let items = await app.db
    .select({
      id: schema.garmentSubcategories.id,
      slug: schema.garmentSubcategories.slug,
      label: schema.garmentSubcategories.label,
      sortOrder: schema.garmentSubcategories.sortOrder,
      thumbnailKey: schema.garmentSubcategories.thumbnailKey,
      instructionImageKey: schema.garmentSubcategories.instructionImageKey,
      tutorialVideoUrl: schema.garmentSubcategories.tutorialVideoUrl,
      requiresLowerUpload: schema.garmentSubcategories.requiresLowerUpload,
      upperUploadLabel: schema.garmentSubcategories.upperUploadLabel,
      lowerUploadLabel: schema.garmentSubcategories.lowerUploadLabel,
      requiresThirdUpload: schema.garmentSubcategories.requiresThirdUpload,
      thirdUploadLabel: schema.garmentSubcategories.thirdUploadLabel,
      allowsFourthUpload: schema.garmentSubcategories.allowsFourthUpload,
      fourthUploadLabel: schema.garmentSubcategories.fourthUploadLabel,
      defaultLowerCatalogId: schema.garmentSubcategories.defaultLowerCatalogId,
      defaultShoeCatalogId: schema.garmentSubcategories.defaultShoeCatalogId,
      requiresMannequinStep: schema.garmentSubcategories.requiresMannequinStep,
      mannequinTwoInputWorkflowTemplateId:
        schema.garmentSubcategories.mannequinTwoInputWorkflowTemplateId,
    })
    .from(schema.garmentSubcategories)
    .where(
      and(
        eq(schema.garmentSubcategories.genderSlug, gender),
        eq(schema.garmentSubcategories.isActive, true),
      ),
    )
    .orderBy(asc(schema.garmentSubcategories.sortOrder), asc(schema.garmentSubcategories.label));

  // No mapping row for this body type at all = opt-out (every active garment type of
  // this gender stays visible). Once any explicit mapping exists for the body type,
  // only mapped garment types are shown. See modelFaceSubcategories's opt-out
  // convention — same pattern, independent join.
  if (bodyTypeId && items.length > 0) {
    const mapped = await app.db
      .select({ subcategoryId: schema.bodyTypeSubcategories.subcategoryId })
      .from(schema.bodyTypeSubcategories)
      .where(eq(schema.bodyTypeSubcategories.bodyTypeId, bodyTypeId));
    if (mapped.length > 0) {
      const mappedIds = new Set(mapped.map((m) => m.subcategoryId));
      items = items.filter((i) => mappedIds.has(i.id));
    }
  }

  return {
    items: await Promise.all(
      items.map(async (i) => ({
        ...i,
        thumbnailUrl: i.thumbnailKey
          ? (await app.storage.presignGet(i.thumbnailKey, 3600)).url
          : null,
        instructionImageUrl: i.instructionImageKey
          ? (await app.storage.presignGet(i.instructionImageKey, 3600)).url
          : null,
      })),
    ),
  };
}

export async function listFaces(
  app: FastifyInstance,
  {
    gender,
    garmentTypeId,
    bodyTypeId,
  }: { gender: string; garmentTypeId?: string; bodyTypeId?: string },
) {
  let items = await app.db
    .select({
      id: schema.modelFaces.id,
      gender: schema.modelFaces.gender,
      label: schema.modelFaces.label,
      continent: schema.modelFaces.continent,
      thumbnailUrl: schema.modelFaces.thumbnailKey,
      tags: schema.modelFaces.tags,
    })
    .from(schema.modelFaces)
    .where(
      and(
        eq(schema.modelFaces.gender, gender),
        eq(schema.modelFaces.isActive, true),
        isNull(schema.modelFaces.deletedAt),
      ),
    )
    .orderBy(asc(schema.modelFaces.sortOrder), asc(schema.modelFaces.label));

  // No mapping row for this garment type at all = opt-out (every active face of
  // this gender stays visible). Once any explicit mapping exists for the type,
  // only mapped faces are shown — same opt-in-once-explicit pattern as lower/shoe
  // catalog items (see hasExplicitLowerMappings in admin/subcategories.routes.ts).
  if (garmentTypeId && items.length > 0) {
    const mapped = await app.db
      .select({ faceId: schema.modelFaceSubcategories.faceId })
      .from(schema.modelFaceSubcategories)
      .where(eq(schema.modelFaceSubcategories.subcategoryId, garmentTypeId));
    if (mapped.length > 0) {
      const mappedIds = new Set(mapped.map((m) => m.faceId));
      items = items.filter((i) => mappedIds.has(i.id));
    }
  }

  // Independent opt-out join for body type — see bodyTypeSubcategories above.
  if (bodyTypeId && items.length > 0) {
    const mapped = await app.db
      .select({ faceId: schema.bodyTypeFaces.faceId })
      .from(schema.bodyTypeFaces)
      .where(eq(schema.bodyTypeFaces.bodyTypeId, bodyTypeId));
    if (mapped.length > 0) {
      const mappedIds = new Set(mapped.map((m) => m.faceId));
      items = items.filter((i) => mappedIds.has(i.id));
    }
  }

  return {
    items: await Promise.all(
      items.map(async (i) => ({
        ...i,
        thumbnailUrl: (await app.storage.presignGet(i.thumbnailUrl, 3600)).url,
      })),
    ),
  };
}

export async function listCatalogueTemplates(
  app: FastifyInstance,
  { gender, garmentTypeId }: { gender: string; garmentTypeId?: string },
) {
  // A template with no mapping row for this garment type is not offered for it at
  // all (strict opt-in — see catalogue_template_subcategories). Without a
  // garmentTypeId there's no way to know which templates apply, so fail closed.
  if (!garmentTypeId) return { items: [] };

  const templates = await app.db
    .select({
      id: schema.catalogueTemplates.id,
      label: schema.catalogueTemplates.label,
      thumbnailKey: schema.catalogueTemplates.thumbnailKey,
      mappingId: schema.catalogueTemplateSubcategories.id,
    })
    .from(schema.catalogueTemplates)
    .innerJoin(
      schema.catalogueTemplateSubcategories,
      and(
        eq(schema.catalogueTemplateSubcategories.templateId, schema.catalogueTemplates.id),
        eq(schema.catalogueTemplateSubcategories.subcategoryId, garmentTypeId),
      ),
    )
    .where(
      and(
        eq(schema.catalogueTemplates.genderSlug, gender),
        eq(schema.catalogueTemplates.isActive, true),
        isNull(schema.catalogueTemplates.deletedAt),
      ),
    )
    .orderBy(asc(schema.catalogueTemplates.sortOrder));

  if (templates.length === 0) return { items: [] };
  const templateIds = templates.map((t) => t.id);

  const lookRows = await app.db
    .select({
      lookId: schema.catalogueTemplateLooks.id,
      templateId: schema.catalogueTemplateLooks.templateId,
      poseId: schema.modelPoseAssets.id,
      poseLabel: schema.modelPoseAssets.label,
      poseDisplayName: schema.modelPoseAssets.displayName,
      poseThumbnailKey: schema.modelPoseAssets.thumbnailKey,
      upperNodeIds: schema.workflowTemplates.upperNodeIds,
      lowerNodeId: schema.workflowTemplates.lowerNodeId,
      shoeNodeId: schema.workflowTemplates.shoeNodeId,
      accessoryNodeId: schema.workflowTemplates.accessoryNodeId,
      backgroundId: schema.modelBackgrounds.id,
      backgroundLabel: schema.modelBackgrounds.label,
      backgroundThumbnailKey: schema.modelBackgrounds.thumbnailKey,
    })
    .from(schema.catalogueTemplateLooks)
    .innerJoin(
      schema.modelPoseAssets,
      and(
        eq(schema.catalogueTemplateLooks.poseAssetId, schema.modelPoseAssets.id),
        eq(schema.modelPoseAssets.isActive, true),
        isNull(schema.modelPoseAssets.deletedAt),
      ),
    )
    .innerJoin(
      schema.modelBackgrounds,
      and(
        eq(schema.catalogueTemplateLooks.backgroundId, schema.modelBackgrounds.id),
        eq(schema.modelBackgrounds.isActive, true),
        isNull(schema.modelBackgrounds.deletedAt),
      ),
    )
    .innerJoin(
      schema.catalogueTemplateSubcategories,
      and(
        eq(
          schema.catalogueTemplateSubcategories.templateId,
          schema.catalogueTemplateLooks.templateId,
        ),
        eq(schema.catalogueTemplateSubcategories.subcategoryId, garmentTypeId),
      ),
    )
    .leftJoin(
      schema.catalogueTemplateLookExclusions,
      and(
        eq(
          schema.catalogueTemplateLookExclusions.mappingId,
          schema.catalogueTemplateSubcategories.id,
        ),
        eq(schema.catalogueTemplateLookExclusions.lookId, schema.catalogueTemplateLooks.id),
      ),
    )
    .innerJoin(
      schema.catalogueTemplatePoseWorkflows,
      and(
        eq(
          schema.catalogueTemplatePoseWorkflows.mappingId,
          schema.catalogueTemplateSubcategories.id,
        ),
        eq(
          schema.catalogueTemplatePoseWorkflows.poseAssetId,
          schema.catalogueTemplateLooks.poseAssetId,
        ),
      ),
    )
    .innerJoin(
      schema.workflowTemplates,
      and(
        eq(schema.catalogueTemplatePoseWorkflows.workflowTemplateId, schema.workflowTemplates.id),
        eq(schema.workflowTemplates.isActive, true),
      ),
    )
    .where(
      and(
        inArray(schema.catalogueTemplateLooks.templateId, templateIds),
        isNull(schema.catalogueTemplateLookExclusions.id),
      ),
    )
    .orderBy(asc(schema.catalogueTemplateLooks.sortOrder));

  const looksByTemplate = new Map<string, typeof lookRows>();
  for (const row of lookRows) {
    if (!looksByTemplate.has(row.templateId)) looksByTemplate.set(row.templateId, []);
    looksByTemplate.get(row.templateId)?.push(row);
  }

  const items = (
    await Promise.all(
      templates.map(async (t) => {
        const rows = looksByTemplate.get(t.id) ?? [];
        const looks = await Promise.all(
          rows.map(async (r) => ({
            id: r.lookId,
            poseId: r.poseId,
            poseLabel: r.poseDisplayName ?? r.poseLabel,
            poseThumbnailUrl: (await app.storage.presignGet(r.poseThumbnailKey, 3600)).url,
            backgroundId: r.backgroundId,
            backgroundLabel: r.backgroundLabel,
            backgroundThumbnailUrl: (await app.storage.presignGet(r.backgroundThumbnailKey, 3600))
              .url,
            ...poseGarmentRoles(r),
          })),
        );
        return {
          id: t.id,
          mappingId: t.mappingId,
          label: t.label,
          thumbnailUrl: t.thumbnailKey
            ? (await app.storage.presignGet(t.thumbnailKey, 3600)).url
            : (looks[0]?.poseThumbnailUrl ?? null),
          looks,
        };
      }),
    )
  ).filter((t) => t.looks.length > 0);

  return { items };
}
