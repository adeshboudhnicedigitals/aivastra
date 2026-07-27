import { z } from 'zod';

export const DevJobStatus = z.enum(['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED']);

export const DevTryonResponse = z.object({
  jobId: z.string().uuid(),
  status: DevJobStatus,
});

export const DevJobResponse = z.object({
  jobId: z.string().uuid(),
  status: DevJobStatus,
  imageUrl: z.string().url().optional(),
  error: z.string().optional(),
});

export const DevJobParams = z.object({ id: z.string().uuid() });

// JSON/base64 alternative to the multipart/form-data upload — same three
// logical inputs, for callers whose stack can't easily build multipart bodies.
// `person`/`garment` accept a raw base64 string or a `data:image/...;base64,` URI.
export const DevTryonJsonBody = z.object({
  category: z.string().min(1),
  person: z.string().min(1),
  garment: z.string().min(1),
});

// JSON/base64 alternative to the multipart upload for the saree-mannequin
// endpoint — single image, no category/person (see DevTryonJsonBody above).
export const DevSareeMannequinJsonBody = z.object({
  garment: z.string().min(1),
});

export const DevCategoriesResponse = z.object({
  categories: z.array(z.object({ slug: z.string(), name: z.string() })),
});

export const DevMeResponse = z.object({
  merchantId: z.string().uuid(),
  companyName: z.string(),
  credits: z.number().int(),
});

export const ApiKeyCreateBody = z.object({
  label: z.string().min(1).max(64),
});

// `key` is present ONLY here — the one and only time the plaintext is returned.
export const ApiKeyCreateResponse = z.object({
  id: z.string().uuid(),
  label: z.string(),
  key: z.string(),
  keyPrefix: z.string(),
  createdAt: z.string(),
});
export type ApiKeyCreateResponse = z.infer<typeof ApiKeyCreateResponse>;

export const ApiKeyListResponse = z.object({
  keys: z.array(
    z.object({
      id: z.string().uuid(),
      label: z.string(),
      keyPrefix: z.string(),
      lastUsedAt: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
});
export type ApiKeyListResponse = z.infer<typeof ApiKeyListResponse>;
export type ApiKey = ApiKeyListResponse['keys'][number];

export const ApiUsageResponse = z.object({
  usage: z.array(
    z.object({
      jobId: z.string().uuid(),
      status: z.string(),
      creditsCharged: z.number().int(),
      createdAt: z.string(),
      keyLabel: z.string(),
      keyPrefix: z.string(),
    }),
  ),
});
export type ApiUsageResponse = z.infer<typeof ApiUsageResponse>;
export type ApiUsageRow = ApiUsageResponse['usage'][number];

// ---- Admin management of the developer-API catalog (see /admin/dev-api/*) ----

const slugRule = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9-]+$/, 'slug must be lowercase letters, numbers, and hyphens');

export const CreateDevTryonCategoryBody = z.object({
  name: z.string().min(1).max(120),
  slug: slugRule,
  workflowTemplateId: z.string().uuid().nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});
export type CreateDevTryonCategoryBody = z.infer<typeof CreateDevTryonCategoryBody>;

export const UpdateDevTryonCategoryBody = z.object({
  name: z.string().min(1).max(120).optional(),
  workflowTemplateId: z.string().uuid().nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});
export type UpdateDevTryonCategoryBody = z.infer<typeof UpdateDevTryonCategoryBody>;

export const UpdateDevSareeConfigBody = z.object({
  workflowTemplateId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional(),
});
export type UpdateDevSareeConfigBody = z.infer<typeof UpdateDevSareeConfigBody>;

export const DevTryonCategoryRow = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  workflowTemplateId: z.string().uuid().nullable(),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type DevTryonCategoryRow = z.infer<typeof DevTryonCategoryRow>;

export const DevSareeConfigRow = z.object({
  workflowTemplateId: z.string().uuid().nullable(),
  isActive: z.boolean(),
  updatedAt: z.string(),
});
export type DevSareeConfigRow = z.infer<typeof DevSareeConfigRow>;
