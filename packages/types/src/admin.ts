import { z } from 'zod';
export const AdminRole = z.enum(['SUPER_ADMIN', 'MODERATOR', 'SUPPORT']);
export const GrantCreditsBody = z.object({
  userId: z.string().uuid(),
  amount: z.number().int().positive().max(10_000),
  reason: z.string().min(1).max(200),
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
  sortOrder: z.number().int().default(0),
});
const CoercedPositiveInt = z.union([z.number().int().positive(), z.string().regex(/^\d+$/).transform(Number)]);

export const PresignCatalogItemBody = z.object({
  categoryId: CoercedPositiveInt,
  label: z.string().min(1).max(120),
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
});
export const ConfirmCatalogItemBody = z.object({
  categoryId: CoercedPositiveInt,
  label: z.string().min(1).max(120),
  r2Key: z.string().min(1),
  thumbnailKey: z.string().min(1),
  sortOrder: z.number().int().default(0),
});
export const SystemConfigBody = z.object({
  creditCostPerJob: z.number().int().positive().max(100).optional(),
  maxJobsPerDay: z.number().int().positive().max(10_000).optional(),
});

// ── Model asset upload schemas ────────────────────────────────────────────

const AssetContentType = z.enum(['image/jpeg', 'image/png', 'image/webp']);
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
});
export const ConfirmModelBackgroundBody = z.object({
  label: z.string().min(1).max(120),
  r2Key: z.string().min(1),
  thumbnailKey: z.string().min(1),
  sortOrder: z.number().int().default(0),
});
export const PatchModelBackgroundBody = z.object({
  label: z.string().min(1).max(120).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

// Poses are per (subcategory × face × background) combo, e.g. m1bg1p1
export const PresignModelPoseBody = z.object({
  subcategoryId: z.string().uuid(),
  faceId: z.string().uuid(),
  backgroundId: z.string().uuid(),
  contentType: AssetContentType,
});
export const ConfirmModelPoseBody = z.object({
  subcategoryId: z.string().uuid(),
  faceId: z.string().uuid(),
  backgroundId: z.string().uuid(),
  label: z.string().min(1).max(120),
  r2Key: z.string().min(1),
  thumbnailKey: z.string().min(1),
  showsLower: z.boolean().default(false),
  showsShoes: z.boolean().default(false),
  isTemplate: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
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
});

// Garment subcategories
export const CreateGarmentSubcategoryBody = z.object({
  genderSlug: GenderEnum,
  slug: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/, 'slug must be lowercase alphanumeric with hyphens'),
  label: z.string().min(1).max(120),
  sortOrder: z.number().int().default(0),
});
export const PatchGarmentSubcategoryBody = z.object({
  label: z.string().min(1).max(120).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

