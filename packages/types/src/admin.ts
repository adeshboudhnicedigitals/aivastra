import { z } from 'zod';
export const AdminRole = z.enum(['SUPER_ADMIN', 'MODERATOR', 'SUPPORT']);
export const GrantCreditsBody = z.object({
  userId: z.string().uuid(),
  amount: z.number().int().positive().max(10_000),
  reason: z.string().max(200).optional(),
});
export const BulkGrantBody = z.object({
  tier: z.enum(['FREE', 'PRO']),
  amount: z.number().int().positive().max(10_000),
  reason: z.string().min(1).max(200),
});
export const DeductCreditsBody = GrantCreditsBody;
export const UpdateUserBody = z.object({
  tier: z.enum(['FREE', 'PRO']).optional(),
  isBanned: z.boolean().optional(),
  banReason: z.string().max(500).nullable().optional(),
  forceLogout: z.boolean().optional(),
});
export const CreateCategoryBody = z.object({
  typeId: z.number().int().positive(),
  parentId: z.number().int().positive().nullable(),
  slug: z.string().min(1).max(80),
  label: z.string().min(1).max(120),
  genderSlug: z.enum(['men', 'women', 'boys', 'girls']).optional(),
  sortOrder: z.number().int().default(0),
});
const CoercedPositiveInt = z.union([
  z.number().int().positive(),
  z.string().regex(/^\d+$/).transform(Number),
]);
const CatalogTypeSlug = z.enum(['lower', 'shoe']);

export const PresignCatalogItemBody = z.object({
  typeSlug: CatalogTypeSlug,
  label: z.string().min(1).max(120),
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  // Legacy — still accepted but ignored if typeSlug provided
  categoryId: CoercedPositiveInt.optional(),
});
export const ConfirmCatalogItemBody = z.object({
  typeSlug: CatalogTypeSlug,
  genderSlug: z.enum(['men', 'women', 'boys', 'girls']).nullable().optional(),
  label: z.string().min(1).max(120),
  r2Key: z.string().min(1),
  thumbnailKey: z.string().min(1),
  sortOrder: z.number().int().default(0),
  subcategoryIds: z.array(z.string().uuid()).optional(),
  // Legacy — still accepted but ignored
  categoryId: CoercedPositiveInt.optional(),
});
export const SystemConfigBody = z.object({
  creditCostPerJob: z.number().int().positive().max(100).optional(),
  maxJobsPerDay: z.number().int().positive().max(10_000).optional(),
});

// ── Model asset upload schemas ────────────────────────────────────────────

export const AssetContentType = z.enum(['image/jpeg', 'image/png', 'image/webp']);
const GenderEnum = z.enum(['men', 'women', 'boys', 'girls']);

export const PresignModelFaceBody = z.object({
  contentType: AssetContentType,
});
export const ConfirmModelFaceBody = z.object({
  label: z.string().min(1).max(120),
  gender: GenderEnum,
  r2Key: z.string().min(1),
  thumbnailKey: z.string().min(1),
  sortOrder: z.number().int().default(0),
});
export const PatchModelFaceBody = z.object({
  label: z.string().min(1).max(120).optional(),
  gender: GenderEnum.optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

// Backgrounds are now global — no faceId
export const PresignModelBackgroundBody = z.object({
  contentType: AssetContentType,
  thumbnailContentType: AssetContentType.optional(),
});
export const ConfirmModelBackgroundBody = z.object({
  label: z.string().min(1).max(120),
  r2Key: z.string().min(1),
  thumbnailKey: z.string().min(1),
  sortOrder: z.number().int().default(0),
  genderSlug: GenderEnum.optional(),
});
export const PatchModelBackgroundBody = z.object({
  label: z.string().min(1).max(120).optional(),
  genderSlug: GenderEnum.nullable().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

// ── Workflow template schemas ─────────────────────────────────────────────

export const CreateWorkflowBody = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9_]+$/, 'Slug must be snake_case (lowercase letters, digits, underscores only)'),
  label: z.string().min(1).max(120),
  jsonContent: z.record(z.any()),
  faceNodeId: z.string().min(1),
  poseNodeId: z.string().min(1),
  bgNodeId: z.string().min(1),
  upperNodeIds: z.array(z.string().min(1)).min(1).max(8),
  lowerNodeId: z.string().min(1).optional(),
  shoeNodeId: z.string().min(1).optional(),
  sizeNodeId: z.string().min(1).optional(),
  facePhasePromptNode: z.string().min(1),
  garmentPhasePromptNode: z.string().min(1),
});

export const ParseWorkflowBody = z.object({
  jsonContent: z.record(z.any()),
});

export const UpdateWorkflowBody = z.object({
  label: z.string().min(1).max(120).optional(),
  isActive: z.boolean().optional(),
  // Allow updating node mappings (not the JSON itself)
  faceNodeId: z.string().min(1).optional(),
  poseNodeId: z.string().min(1).optional(),
  bgNodeId: z.string().min(1).optional(),
  upperNodeIds: z.array(z.string().min(1)).min(1).max(8).optional(),
  lowerNodeId: z.string().min(1).nullable().optional(),
  shoeNodeId: z.string().min(1).nullable().optional(),
  sizeNodeId: z.string().min(1).nullable().optional(),
  facePhasePromptNode: z.string().min(1).optional(),
  garmentPhasePromptNode: z.string().min(1).optional(),
});

export const ReassignWorkflowBody = z.object({
  targetWorkflowId: z.string().uuid(),
});

// ── Pose schemas ──────────────────────────────────────────────────────────

// Poses are per (garment type × face × background) combo, e.g. m1bg1p1
export const PresignModelPoseBody = z
  .object({
    garmentTypeId: z.string().uuid(),
    // Exactly one of faceId (existing) or newFaceContentType (upload new)
    faceId: z.string().uuid().optional(),
    newFaceContentType: AssetContentType.optional(),
    // Exactly one of backgroundId (existing) or newBgContentType (upload new)
    backgroundId: z.string().uuid().optional(),
    newBgContentType: AssetContentType.optional(),
    // Pose body image
    contentType: AssetContentType,
    // Side/tilt face for ComfyUI (optional — batch uploads omit this and the processor falls back to the display face)
    faceSideContentType: AssetContentType.optional(),
    // Per-pose background image for ComfyUI (optional — batch uploads omit this and the processor falls back to the display background)
    bgComfyContentType: AssetContentType.optional(),
  })
  .refine((d) => Boolean(d.faceId) !== Boolean(d.newFaceContentType), {
    message: 'Provide either faceId or newFaceContentType, not both',
    path: ['faceId'],
  })
  .refine((d) => Boolean(d.backgroundId) !== Boolean(d.newBgContentType), {
    message: 'Provide either backgroundId or newBgContentType, not both',
    path: ['backgroundId'],
  });

export const ConfirmModelPoseBody = z
  .object({
    garmentTypeId: z.string().uuid(),
    // Exactly one of faceId (existing) or newFace (inline upload)
    faceId: z.string().uuid().optional(),
    newFace: z
      .object({
        r2Key: z.string().min(1),
        thumbnailKey: z.string().min(1),
        filename: z.string().min(1),
      })
      .optional(),
    // Exactly one of backgroundId (existing) or newBackground (inline upload)
    backgroundId: z.string().uuid().optional(),
    newBackground: z
      .object({
        r2Key: z.string().min(1),
        thumbnailKey: z.string().min(1),
        filename: z.string().min(1),
      })
      .optional(),
    // Pose body image
    label: z.string().min(1).max(120),
    r2Key: z.string().min(1),
    thumbnailKey: z.string().min(1),
    // Side/tilt face (optional — if absent the processor falls back to the display face r2Key)
    faceSideR2Key: z.string().min(1).optional(),
    // Per-pose background for ComfyUI (optional — if absent the processor falls back to the display background)
    bgComfyR2Key: z.string().min(1).optional(),
    // Workflow — now a UUID FK instead of an enum string
    workflowTemplateId: z.string().uuid(),
    // Optional — if absent or empty the workflow template's own prompt text is used
    promptFacePhase: z.string().optional(),
    promptGarmentPhase: z.string().optional(),
    isTemplate: z.boolean().default(false),
    sortOrder: z.number().int().default(0),
  })
  .refine((d) => Boolean(d.faceId) !== Boolean(d.newFace), {
    message: 'Provide either faceId or newFace, not both',
    path: ['faceId'],
  })
  .refine((d) => Boolean(d.backgroundId) !== Boolean(d.newBackground), {
    message: 'Provide either backgroundId or newBackground, not both',
    path: ['backgroundId'],
  });

export const PatchModelPoseBody = z.object({
  label: z.string().min(1).max(120).optional(),
  faceId: z.string().uuid().optional(),
  backgroundId: z.string().uuid().optional(),
  isActive: z.boolean().optional(),
  isTemplate: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  showsLower: z.boolean().optional(),
  showsShoes: z.boolean().optional(),
  workflowTemplateId: z.string().uuid().optional(),
  promptFacePhase: z.string().optional(),
  promptGarmentPhase: z.string().optional(),
  /** Updated after re-uploading the side/tilt face via presign-faceside */
  faceSideR2Key: z.string().min(1).optional(),
});

// Garment types (formerly subcategories)
export const CreateGarmentTypeBody = z.object({
  genderSlug: GenderEnum,
  slug: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9-]+$/, 'slug must be lowercase alphanumeric with hyphens'),
  label: z.string().min(1).max(120),
  sortOrder: z.number().int().default(0),
  thumbnailKey: z.string().optional(),
});
export const PatchGarmentTypeBody = z.object({
  label: z.string().min(1).max(120).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  thumbnailKey: z.string().nullable().optional(),
});
export const PresignGarmentTypeBody = z.object({
  contentType: AssetContentType,
});
