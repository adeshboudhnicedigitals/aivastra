import { z } from 'zod';

export const MerchantStatusSchema = z.enum(['ONBOARDING_REQUIRED', 'PENDING_ACTIVATION', 'ACTIVE']);
export type MerchantStatusSchema = z.infer<typeof MerchantStatusSchema>;

// Phone is the only mandatory field: contactName falls back to the Google
// display name, companyName to contactName, businessAddress to 'Not Provided'.
export const MerchantOnboardingBody = z.object({
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9]{10,15}$/, 'Enter a valid mobile number'),
  contactName: z.string().max(120).optional(),
  companyName: z.string().max(200).optional(),
  businessAddress: z.string().max(500).optional(),
});
export type MerchantOnboardingBody = z.infer<typeof MerchantOnboardingBody>;

/**
 * Authoritative merchant plan billing data — the single source of truth for
 * money. The API computes order amounts from THIS, never from client input.
 * The web pricing UI merges display-only metadata on top of these by slug.
 */
export interface MerchantPlanBilling {
  slug: string;
  name: string;
  /** Base price in INR, excluding GST */
  priceInr: number;
  credits: number;
}

export const MERCHANT_PLAN_SLUGS = ['basic', 'advanced', 'pro', 'ultra'] as const;
export type MerchantPlanSlug = (typeof MERCHANT_PLAN_SLUGS)[number];

export const MERCHANT_PLAN_BILLING: Record<MerchantPlanSlug, MerchantPlanBilling> = {
  basic: { slug: 'basic', name: 'Basic', priceInr: 25000, credits: 10000 },
  advanced: { slug: 'advanced', name: 'Advanced', priceInr: 50000, credits: 25000 },
  pro: { slug: 'pro', name: 'Pro', priceInr: 75000, credits: 40000 },
  ultra: { slug: 'ultra', name: 'Ultra', priceInr: 150000, credits: 100000 },
};

export const MerchantCheckoutBody = z.object({
  planSlug: z.enum(MERCHANT_PLAN_SLUGS),
});
export type MerchantCheckoutBody = z.infer<typeof MerchantCheckoutBody>;

export const MerchantPaymentVerify = z.object({
  razorpayOrderId: z.string().min(1),
  razorpayPaymentId: z.string().min(1),
  razorpaySignature: z.string().min(1),
});
export type MerchantPaymentVerify = z.infer<typeof MerchantPaymentVerify>;

export const MerchantCatalogModerationStatus = z.enum(['approved', 'rejected']);
export type MerchantCatalogModerationStatus = z.infer<typeof MerchantCatalogModerationStatus>;

export const MerchantCatalogPresignBody = z.object({
  assetId: z.string().uuid().optional(),
  kind: z.enum(['image', 'thumbnail', 'flat']),
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  contentLength: z
    .number()
    .int()
    .positive()
    .max(20 * 1024 * 1024),
});
export type MerchantCatalogPresignBody = z.infer<typeof MerchantCatalogPresignBody>;

export const MerchantCatalogCreateBody = z.object({
  subcategoryId: z.string().uuid(),
  label: z.string().min(1).max(200),
  sku: z.string().max(120).optional(),
  actualPrice: z.number().int().min(0), // rupees — converted to paise at the route layer
  offerPrice: z.number().int().min(0), // rupees — converted to paise at the route layer
  r2Key: z.string().min(1),
  thumbnailKey: z.string().min(1),
});
export type MerchantCatalogCreateBody = z.infer<typeof MerchantCatalogCreateBody>;

export const MerchantCatalogUpdateBody = z
  .object({
    subcategoryId: z.string().uuid().optional(),
    label: z.string().min(1).max(200).optional(),
    sku: z.string().max(120).nullable().optional(),
    actualPrice: z.number().int().min(0).optional(),
    offerPrice: z.number().int().min(0).optional(),
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(999999).optional(),
  })
  .refine(
    (body) =>
      body.subcategoryId !== undefined ||
      body.label !== undefined ||
      body.sku !== undefined ||
      body.actualPrice !== undefined ||
      body.offerPrice !== undefined ||
      body.isActive !== undefined ||
      body.sortOrder !== undefined,
    { message: 'at least one field is required' },
  );
export type MerchantCatalogUpdateBody = z.infer<typeof MerchantCatalogUpdateBody>;

export const MerchantCatalogImportBody = z.object({
  jobId: z.string().uuid(),
  subcategoryId: z.string().uuid(),
});
export type MerchantCatalogImportBody = z.infer<typeof MerchantCatalogImportBody>;

export const MerchantCatalogSourceKind = z.enum(['uploaded', 'generated', 'imported']);
export type MerchantCatalogSourceKind = z.infer<typeof MerchantCatalogSourceKind>;

export const MerchantCatalogItem = z.object({
  id: z.string().uuid(),
  merchantId: z.string().uuid(),
  subcategoryId: z.string().uuid(),
  label: z.string(),
  sku: z.string().nullable(),
  actualPrice: z.number().int(), // rupees — converted from paise by the route layer
  offerPrice: z.number().int(),
  r2Key: z.string(),
  thumbnailKey: z.string(),
  imageUrl: z.string().url().nullable(),
  thumbnailUrl: z.string().url().nullable(),
  sourceJobId: z.string().uuid().nullable(),
  sourceKind: MerchantCatalogSourceKind,
  flatSourceKey: z.string().nullable(),
  isActive: z.boolean(),
  moderationStatus: MerchantCatalogModerationStatus,
  moderationNote: z.string().nullable(),
  sortOrder: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
  // Present and true only for admin-authored demo rows appended by the demo
  // catalog reader. Absent on the merchant's own rows.
  isDemo: z.boolean().optional(),
  readOnly: z.boolean().optional(),
});
export type MerchantCatalogItem = z.infer<typeof MerchantCatalogItem>;

export const MerchantCatalogListResponse = z.object({
  items: z.array(MerchantCatalogItem),
});
export type MerchantCatalogListResponse = z.infer<typeof MerchantCatalogListResponse>;

export const MerchantCatalogCategory = z.enum(['men', 'women', 'boys', 'girls']);
export type MerchantCatalogCategory = z.infer<typeof MerchantCatalogCategory>;

export const MerchantCatalogSubcategoryCreateBody = z.object({
  category: MerchantCatalogCategory,
  name: z.string().min(1).max(160),
  garmentSubcategoryId: z.string().uuid(),
});
export type MerchantCatalogSubcategoryCreateBody = z.infer<
  typeof MerchantCatalogSubcategoryCreateBody
>;

export const MerchantCatalogSubcategoryUpdateBody = z
  .object({
    name: z.string().min(1).max(160).optional(),
    garmentSubcategoryId: z.string().uuid().optional(),
    sortOrder: z.number().int().min(0).max(999999).optional(),
  })
  .refine(
    (body) =>
      body.name !== undefined ||
      body.garmentSubcategoryId !== undefined ||
      body.sortOrder !== undefined,
    { message: 'at least one field is required' },
  );
export type MerchantCatalogSubcategoryUpdateBody = z.infer<
  typeof MerchantCatalogSubcategoryUpdateBody
>;

export const MerchantCatalogSubcategory = z.object({
  id: z.string().uuid(),
  merchantId: z.string().uuid(),
  category: MerchantCatalogCategory,
  name: z.string(),
  garmentSubcategoryId: z.string().uuid(),
  sortOrder: z.number().int(),
  productCount: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
  // Present and true only for admin-authored demo rows appended by the demo
  // catalog reader. Absent on the merchant's own rows.
  isDemo: z.boolean().optional(),
  readOnly: z.boolean().optional(),
});
export type MerchantCatalogSubcategory = z.infer<typeof MerchantCatalogSubcategory>;

export const MerchantCatalogSubcategoryListResponse = z.object({
  items: z.array(MerchantCatalogSubcategory),
});
export type MerchantCatalogSubcategoryListResponse = z.infer<
  typeof MerchantCatalogSubcategoryListResponse
>;

export const MerchantCatalogGenerateBody = z.object({
  subcategoryId: z.string().uuid(),
  flatImageKey: z.string().min(1),
  // When true, skip the normal pose/background/face compositing (step 2) and
  // finalize the job with the mannequin-drape (step 1) output directly. Only
  // valid for garment types with requires_mannequin_step = true.
  mannequinOnly: z.boolean().optional(),
  // Selects which mannequin (step-1) workflow template generates this job —
  // matched against saree_mannequin_styles.label (case-insensitive), not the
  // row's id, so callers can send the human-readable style name shown in
  // admin/the app instead of looking up a UUID. Omitted = falls back to the
  // garment type's own mannequinWorkflowTemplateId (unchanged behavior).
  // When secondFlatImageKey is also present, the style must have its own
  // two-input workflow configured (mannequinTwoInputWorkflowTemplateId on
  // saree_mannequin_styles) — that takes precedence over the garment type's
  // default two-input workflow, mirroring single-input precedence.
  sareeStyleId: z.string().min(1).optional(),
  // Pallu image for the "Body & Pallu" two-input upload mode. Only valid for
  // garment types with mannequinTwoInputWorkflowTemplateId configured
  // (enforced server-side), unless sareeStyleId is also supplied — then the
  // style's own two-input workflow is used instead of the garment type's,
  // and the style must have one configured or the request is rejected.
  // Presigned the same way as flatImageKey, via POST /v1/merchant/catalog/presign
  // called a second time.
  secondFlatImageKey: z.string().min(1).optional(),
});
export type MerchantCatalogGenerateBody = z.infer<typeof MerchantCatalogGenerateBody>;

export const MerchantCatalogGenerateBulkBody = z.object({
  subcategoryId: z.string().uuid(),
  flatImageKeys: z.array(z.string().min(1)).min(1).max(50),
});
export type MerchantCatalogGenerateBulkBody = z.infer<typeof MerchantCatalogGenerateBulkBody>;

export const MerchantCatalogGenerateStatus = z.object({
  jobId: z.string().uuid(),
  status: z.string(),
  resultUrl: z.string().url().nullable(),
  errorCode: z.string().nullable(),
});
export type MerchantCatalogGenerateStatus = z.infer<typeof MerchantCatalogGenerateStatus>;

export const MerchantSareeStyle = z.object({
  id: z.string().uuid(),
  label: z.string(),
  previewUrl: z.string().url().nullable(),
  sortOrder: z.number().int(),
  supportsTwoInput: z.boolean(),
});
export type MerchantSareeStyle = z.infer<typeof MerchantSareeStyle>;

export const MerchantSareeStyleListResponse = z.object({
  items: z.array(MerchantSareeStyle),
});
export type MerchantSareeStyleListResponse = z.infer<typeof MerchantSareeStyleListResponse>;

export const MerchantCatalogGenerateBulkStatusResponse = z.object({
  items: z.array(MerchantCatalogGenerateStatus),
});
export type MerchantCatalogGenerateBulkStatusResponse = z.infer<
  typeof MerchantCatalogGenerateBulkStatusResponse
>;

export const MerchantCatalogueStudioJob = z.object({
  jobId: z.string().uuid(),
  catalogueId: z.string().uuid(),
  label: z.string(),
  thumbnailUrl: z.string().url().nullable(),
  createdAt: z.string(),
  imported: z.boolean(),
});
export type MerchantCatalogueStudioJob = z.infer<typeof MerchantCatalogueStudioJob>;

export const MerchantCatalogueStudioGroup = z.object({
  catalogueId: z.string().uuid(),
  label: z.string(),
  createdAt: z.string(),
  jobs: z.array(MerchantCatalogueStudioJob),
});
export type MerchantCatalogueStudioGroup = z.infer<typeof MerchantCatalogueStudioGroup>;

export const MerchantCataloguesResponse = z.object({
  catalogues: z.array(MerchantCatalogueStudioGroup),
});
export type MerchantCataloguesResponse = z.infer<typeof MerchantCataloguesResponse>;

export const KioskCatalogItem = z.object({
  id: z.string().uuid(),
  label: z.string(),
  sku: z.string().nullable(),
  gender: MerchantCatalogCategory.nullable(),
  category: z.string().nullable(),
  imageUrl: z.string().url().nullable(),
  thumbnailUrl: z.string().url().nullable(),
});
export type KioskCatalogItem = z.infer<typeof KioskCatalogItem>;

export const KioskCatalogListResponse = z.object({
  items: z.array(KioskCatalogItem),
});
export type KioskCatalogListResponse = z.infer<typeof KioskCatalogListResponse>;

export const KioskPresignBody = z.object({
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  contentLength: z
    .number()
    .int()
    .positive()
    .max(20 * 1024 * 1024),
});
export type KioskPresignBody = z.infer<typeof KioskPresignBody>;

export const KioskJobCreateBody = z.object({
  merchantCatalogItemId: z.string().uuid(),
  customerPhotoKey: z.string().min(1),
});
export type KioskJobCreateBody = z.infer<typeof KioskJobCreateBody>;

export const KioskJobDetailResponse = z.object({
  id: z.string().uuid(),
  status: z.string(),
  merchantId: z.string().uuid(),
  kioskDeviceId: z.string().uuid().nullable(),
  resultKey: z.string().nullable(),
  shareUrl: z.string().url().nullable(),
  errorCode: z.string().nullable(),
  liked: z.boolean(),
  inCart: z.boolean(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
});
export type KioskJobDetailResponse = z.infer<typeof KioskJobDetailResponse>;

export const MerchantTryonPresignBody = z.object({
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  contentLength: z
    .number()
    .int()
    .positive()
    .max(20 * 1024 * 1024),
});
export type MerchantTryonPresignBody = z.infer<typeof MerchantTryonPresignBody>;

export const MerchantTryonJobCreateBody = z.object({
  merchantCatalogItemId: z.string().uuid(),
  customerPhotoKey: z.string().min(1),
});
export type MerchantTryonJobCreateBody = z.infer<typeof MerchantTryonJobCreateBody>;

export const MerchantTryonJobDetailResponse = z.object({
  id: z.string().uuid(),
  status: z.string(),
  merchantId: z.string().uuid(),
  resultKey: z.string().nullable(),
  shareUrl: z.string().url().nullable(),
  errorCode: z.string().nullable(),
  liked: z.boolean(),
  inCart: z.boolean(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
});
export type MerchantTryonJobDetailResponse = z.infer<typeof MerchantTryonJobDetailResponse>;
export const MerchantUploadSessionCreateResponse = z.object({
  token: z.string(),
  qrUrl: z.string().url(),
  expiresIn: z.number().int(),
});
export type MerchantUploadSessionCreateResponse = z.infer<
  typeof MerchantUploadSessionCreateResponse
>;

export const MerchantUploadSessionStatusResponse = z.object({
  status: z.enum(['pending', 'uploaded']),
  r2Key: z.string().nullable(),
});
export type MerchantUploadSessionStatusResponse = z.infer<
  typeof MerchantUploadSessionStatusResponse
>;

export const PublicUploadSessionPresignBody = z.object({
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  contentLength: z
    .number()
    .int()
    .positive()
    .max(20 * 1024 * 1024),
});
export type PublicUploadSessionPresignBody = z.infer<typeof PublicUploadSessionPresignBody>;

export const PublicUploadSessionPresignResponse = z.object({
  uploadUrl: z.string().url(),
  expiresIn: z.number().int(),
});
export type PublicUploadSessionPresignResponse = z.infer<typeof PublicUploadSessionPresignResponse>;

export const AdminMerchantCatalogUpdateBody = z
  .object({
    isActive: z.boolean().optional(),
    moderationStatus: MerchantCatalogModerationStatus.optional(),
    moderationNote: z.string().max(1000).nullable().optional(),
  })
  .refine(
    (body) =>
      body.isActive !== undefined ||
      body.moderationStatus !== undefined ||
      body.moderationNote !== undefined,
    { message: 'at least one field is required' },
  );
export type AdminMerchantCatalogUpdateBody = z.infer<typeof AdminMerchantCatalogUpdateBody>;

export const AdminMerchantUpdateBody = z
  .object({
    isActive: z.boolean().optional(),
    companyName: z.string().min(1).max(160).optional(),
    contactName: z.string().min(1).max(120).optional(),
    phone: z.string().min(1).max(40).optional(),
    businessAddress: z.string().min(1).optional(),
    demoData: z.boolean().optional(),
    webhookUrl: z.string().url().nullable().optional(),
    webhookSecret: z.string().max(512).nullable().optional(),
    kioskEnabled: z.boolean().optional(),
    maxKioskDevices: z.number().int().min(1).max(100).optional(),
    logoKey: z.string().max(500).nullable().optional(),
  })
  .refine((body) => Object.values(body).some((v) => v !== undefined), {
    message: 'at least one field is required',
  });
export type AdminMerchantUpdateBody = z.infer<typeof AdminMerchantUpdateBody>;

export const ShopifyCustomerPresignRequest = z.object({
  contentType: z.string(),
  contentLength: z
    .number()
    .int()
    .positive()
    .max(20 * 1024 * 1024),
});
export type ShopifyCustomerPresignRequest = z.infer<typeof ShopifyCustomerPresignRequest>;

export const ShopifyCustomerJobRequest = z.object({
  customerPhotoKey: z.string(),
  shopifyProductId: z.number().int().positive(),
});
export type ShopifyCustomerJobRequest = z.infer<typeof ShopifyCustomerJobRequest>;

export const ShopifyCustomerPhotoPreviewRequest = z.object({
  r2Key: z.string().min(1),
});
export type ShopifyCustomerPhotoPreviewRequest = z.infer<typeof ShopifyCustomerPhotoPreviewRequest>;
