import { z } from 'zod';

export const DevJobStatus = z.enum(['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED']);

export const DevTryonResponse = z.object({
  jobId: z.string().uuid(),
  status: DevJobStatus,
  // The stored key for the uploaded person photo — lets a caller offer
  // "reuse this photo" on a later job without re-uploading it (see
  // POST /v1/dev/photo/preview). Omitted for callers where that doesn't
  // apply (e.g. the saree-mannequin route has no person photo).
  personKey: z.string().optional(),
});

export const DevPhotoPreviewRequest = z.object({
  personKey: z.string().min(1),
});

export const DevPhotoPreviewResponse = z.object({
  previewUrl: z.string().url(),
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
  tryOnsRemaining: z.number().int(),
});

// Deliberately available to both 'full' and 'widget' scoped keys (unlike
// /v1/dev/me) — a credit count is not sensitive, and integrations like the
// WordPress plugin only ever hold a widget-scoped key day-to-day.
export const DevBalanceResponse = z.object({
  credits: z.number().int(),
  // Computed from the live, admin-tunable tryon.creditCost (getTryonCreditCost),
  // not a hardcoded divisor — callers must not re-derive this from `credits`
  // themselves, since that would drift the moment an admin retunes the cost.
  tryOnsRemaining: z.number().int(),
});

export const DevPlan = z.object({
  slug: z.string(),
  name: z.string(),
  priceInr: z.number().int(),
  credits: z.number().int(),
  // Same admin-curated marketing fields the consumer /pricing page already
  // renders (packages/db/src/schema/credits.ts) — surfaced here so the
  // WordPress card doesn't invent a second, out-of-sync presentation of the
  // same plan.
  isHighlighted: z.boolean(),
  badge: z.string().nullable(),
  perUnitPriceLabel: z.string().nullable(),
  unitCountLabel: z.string().nullable(),
});

// Deliberately available to a widget-scoped key — plan pricing is public
// display data, no different from a price list on a website.
export const DevPlansResponse = z.object({
  plans: z.array(DevPlan),
});

// Plan slugs come from the admin-managed credit_plans table, not a fixed
// enum — an admin can add/rename/retire tryon-type plans at any time.
// Existence and type ('tryon') are validated against the DB in the handler.
export const DevPaymentOrderBody = z.object({
  planSlug: z.string().min(1).max(64),
});

// keyId is Razorpay's public key id, not a secret — safe to hand to a browser.
export const DevPaymentOrderResponse = z.object({
  orderId: z.string(),
  amount: z.number().int(),
  currency: z.string(),
  keyId: z.string(),
  credits: z.number().int(),
  label: z.string(),
});

export const DevPaymentVerifyBody = z.object({
  razorpayOrderId: z.string().min(1),
  razorpayPaymentId: z.string().min(1),
  razorpaySignature: z.string().min(1),
});

export const DevPaymentVerifyResponse = z.object({
  ok: z.literal(true),
  alreadyCredited: z.boolean(),
  balance: z.number().int(),
  tryOnsRemaining: z.number().int(),
});

export const ApiKeyScope = z.enum(['full', 'widget']);
export type ApiKeyScope = z.infer<typeof ApiKeyScope>;

export const ApiKeyIntegration = z.enum(['generic', 'wordpress']);
export type ApiKeyIntegration = z.infer<typeof ApiKeyIntegration>;

export const ApiKeyCreateBody = z
  .object({
    label: z.string().min(1).max(64),
    // When omitted: defaults to 'full' scope + 'generic' integration.
    // 'wordpress_widget' is the atomic preset for the merchant portal's
    // "Create WordPress Widget Key" button (scope=widget, integration=wordpress).
    kind: z.enum(['full', 'wordpress_widget']).optional(),
    // Required (and only meaningful) for kind: 'wordpress_widget' — the
    // merchant's storefront URL. Normalized server-side to its origin and
    // stored as api_keys.allowedOrigin, the value the CORS check in
    // server.ts matches the browser's Origin header against.
    siteUrl: z.string().url().optional(),
  })
  .superRefine((body, ctx) => {
    if (body.kind === 'wordpress_widget' && !body.siteUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['siteUrl'],
        message: 'siteUrl is required for a WordPress widget key',
      });
    }
  });
export type ApiKeyCreateBody = z.infer<typeof ApiKeyCreateBody>;

// `key` is present ONLY here — the one and only time the plaintext is returned.
export const ApiKeyCreateResponse = z.object({
  id: z.string().uuid(),
  label: z.string(),
  key: z.string(),
  keyPrefix: z.string(),
  scope: ApiKeyScope,
  integration: ApiKeyIntegration,
  allowedOrigin: z.string().nullable(),
  createdAt: z.string(),
});
export type ApiKeyCreateResponse = z.infer<typeof ApiKeyCreateResponse>;

export const ApiKeyListResponse = z.object({
  keys: z.array(
    z.object({
      id: z.string().uuid(),
      label: z.string(),
      keyPrefix: z.string(),
      scope: ApiKeyScope,
      integration: ApiKeyIntegration,
      allowedOrigin: z.string().nullable(),
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

// ---------------------------------------------------------------------------
// Widget analytics — advisory-only event log feeding the WordPress plugin's
// Analytics card. Same "client-reported, forgeable" contract as Shopify's
// shopify_widget_events (packages/db/src/schema/shopify.ts): never consulted
// for a credit, limit, or authorization decision. See
// apps/api/src/modules/dev/analytics.ts for which response fields are real
// (drawn from the unforgeable `jobs` table) versus advisory (drawn from this
// event log) — unlike Shopify, the WordPress dev-API's job-creation route
// carries no product id or shopper identity, so more of this response is
// advisory-only than its Shopify equivalent.
// ---------------------------------------------------------------------------

export const DevWidgetEventType = z.enum([
  'button_click',
  'upload',
  'result_view',
  'add_to_cart',
  'share',
]);
export type DevWidgetEventType = z.infer<typeof DevWidgetEventType>;

export const DevWidgetEventBody = z.object({
  type: DevWidgetEventType,
  // WooCommerce product id — omitted for events with no product context.
  productId: z.number().int().positive().optional(),
  // Client-generated, persisted in the shopper's browser localStorage —
  // never PII, just a random id for distinct-shopper counting.
  clientId: z.string().min(1).max(64).optional(),
  device: z.enum(['mobile', 'desktop']).optional(),
});
export type DevWidgetEventBody = z.infer<typeof DevWidgetEventBody>;

export const DevWidgetEventResponse = z.object({ ok: z.literal(true) });

export const DevAnalyticsCards = z.object({
  /** Real: count(*) on `jobs` filtered to this merchant's WordPress-sourced jobs. */
  tryOns: z.number().int(),
  /** Advisory: distinct client_id in merchant_widget_events. */
  uniqueShoppers: z.number().int(),
  /** Advisory: count of add_to_cart events. */
  addedToCart: z.number().int(),
  /** 0..1. Named add-to-cart, never "conversion" — it is not a sale. */
  addToCartRate: z.number(),
});
export type DevAnalyticsCards = z.infer<typeof DevAnalyticsCards>;

export const DevAnalyticsProduct = z.object({
  productId: z.number().int(),
  tryOns: z.number().int(),
  uniqueShoppers: z.number().int(),
  addedToCart: z.number().int(),
  addToCartRate: z.number(),
});
export type DevAnalyticsProduct = z.infer<typeof DevAnalyticsProduct>;

export const DevAnalyticsResponse = z.object({
  cards: DevAnalyticsCards,
  daily: z.array(z.object({ day: z.string(), tryOns: z.number().int() })),
  products: z.array(DevAnalyticsProduct),
});
export type DevAnalyticsResponse = z.infer<typeof DevAnalyticsResponse>;
