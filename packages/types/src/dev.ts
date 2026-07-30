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

// Shape of every error the dev API returns, from the global error handler in
// server.ts (`{ error: { code, message } }`). Declared once and reused across
// every dev route's 4xx response entries so Scalar shows real error examples
// instead of the routes appearing to only ever fail with a framework default.
export const DevErrorResponse = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

// ---------------------------------------------------------------------------
// Catalog generation — admin-curated asset selection over the public dev API.
//
// Assets are addressed by SLUG, never by internal UUID: the slug is a stable
// public contract that survives an admin deleting and recreating the underlying
// row, and it reads intelligibly in a third party's own code. See the
// public_api_slug column added in migration 0130.
// ---------------------------------------------------------------------------

const PUBLIC_SLUG = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'must be lowercase alphanumeric words separated by hyphens');

export const DevCatalogOptionsQuery = z.object({
  gender: z.enum(['men', 'women', 'boys', 'girls']),
  /** Public slug of a garment type. Narrows poses, lower garments and shoes to the
   *  ones configured for it — omit to see the unfiltered pool for this gender. */
  garmentType: PUBLIC_SLUG.optional(),
});

const DevCatalogAsset = z.object({
  slug: z.string(),
  label: z.string(),
  thumbnailUrl: z.string(),
});

const DevCatalogPose = DevCatalogAsset.extend({
  /** True when this pose's workflow accepts a lower garment; if false, passing
   *  `lower` on /v1/dev/catalog/generate has no effect for looks using this pose. */
  hasLower: z.boolean(),
  hasShoes: z.boolean(),
});

export const DevCatalogOptionsResponse = z.object({
  garmentTypes: z.array(z.object({ slug: z.string(), label: z.string() })),
  faces: z.array(DevCatalogAsset),
  backgrounds: z.array(DevCatalogAsset),
  poses: z.array(DevCatalogPose),
  lowerItems: z.array(DevCatalogAsset),
  shoeItems: z.array(DevCatalogAsset),
});

/** JSON/base64 body for catalog generation. The multipart form accepts the same
 *  field names, with `looks` as a JSON-encoded string. */
export const DevCatalogGenerateJsonBody = z.object({
  /** Raw base64 or a `data:image/...;base64,` URI. */
  garment: z.string().min(1),
  // Required even though slugs are globally unique: it scopes slug resolution to
  // one gender's asset pool, so a men's face paired with women's poses is rejected
  // as an unknown slug instead of silently producing a nonsense render.
  gender: z.enum(['men', 'women', 'boys', 'girls']),
  face: PUBLIC_SLUG,
  // Capped at 12 to match the Shopify catalog surface: each look is a separate
  // GPU job and a separate credit charge, so an unbounded array would let one
  // request drain a merchant's balance and monopolise the worker pool.
  looks: z
    .array(z.object({ pose: PUBLIC_SLUG, background: PUBLIC_SLUG }))
    .min(1)
    .max(12),
  garmentType: PUBLIC_SLUG.optional(),
  lower: PUBLIC_SLUG.optional(),
  shoe: PUBLIC_SLUG.optional(),
  aspectRatio: z.enum(['1:1', '2:3', '3:4', '4:5']),
  resolution: z.enum(['HD', '2K', '4K']),
});

export const DevCatalogGenerateResponse = z.object({
  /** Groups every job from this request; pass to GET /v1/dev/catalogues/:id. */
  catalogueId: z.string().uuid(),
  jobs: z.array(
    z.object({
      jobId: z.string().uuid(),
      pose: z.string(),
      background: z.string(),
    }),
  ),
});

export const DevCatalogueParams = z.object({ id: z.string().uuid() });

export const DevCatalogueResponse = z.object({
  catalogueId: z.string().uuid(),
  jobs: z.array(
    z.object({
      jobId: z.string().uuid(),
      status: DevJobStatus,
      imageUrl: z.string().url().optional(),
      error: z.string().optional(),
    }),
  ),
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
