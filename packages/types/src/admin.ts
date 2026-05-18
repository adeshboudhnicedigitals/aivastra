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
export const PresignCatalogItemBody = z.object({
  categoryId: z.number().int().positive(),
  label: z.string().min(1).max(120),
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
});
export const ConfirmCatalogItemBody = z.object({
  categoryId: z.number().int().positive(),
  label: z.string().min(1).max(120),
  r2Key: z.string().min(1),
  thumbnailKey: z.string().min(1),
  sortOrder: z.number().int().default(0),
});
export const SystemConfigBody = z.object({
  creditCostPerJob: z.number().int().positive().max(100).optional(),
  maxJobsPerDay: z.number().int().positive().max(10_000).optional(),
});
