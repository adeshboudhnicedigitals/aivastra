import { z } from 'zod';

export const WidgetClientSignup = z.object({
  companyName: z.string().min(1),
  contactName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(1),
  websiteUrl: z.string().url(),
  companySize: z.enum(['1-10', '11-50', '51-200', '200+']),
  purpose: z.enum(['ecommerce', 'fashion_brand', 'tailoring', 'marketplace', 'enterprise']),
  businessAddress: z.string().min(1),
  password: z.string().min(8),
});
export type WidgetClientSignup = z.infer<typeof WidgetClientSignup>;

export const WidgetClientLogin = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type WidgetClientLogin = z.infer<typeof WidgetClientLogin>;

export const WidgetClientProfileUpdate = z.object({
  contactName: z.string().min(1).max(120),
  phone: z.string().min(1).max(40),
  companyName: z.string().min(1).max(160),
  websiteUrl: z.string().url(),
});
export type WidgetClientProfileUpdate = z.infer<typeof WidgetClientProfileUpdate>;

/**
 * Authoritative merchant plan billing data â€” the single source of truth for
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

export const WidgetSettingsUpdate = z.object({
  settings: z
    .object({
      widgetName: z.string().max(80).optional(),
      position: z.enum(['bottom-right', 'bottom-left', 'top-right', 'top-left']).optional(),
      primaryColor: z.string().max(32).optional(),
      buttonColor: z.string().max(32).optional(),
      bgColor: z.string().max(32).optional(),
      borderRadius: z.number().int().min(0).max(64).optional(),
      shadow: z.boolean().optional(),
      minSizeMb: z.number().min(0).max(50).optional(),
      maxSizeMb: z.number().min(0).max(50).optional(),
      cameraUpload: z.boolean().optional(),
      customCss: z.string().max(5000).optional(),
    })
    .optional(),
  allowedOrigins: z.array(z.string().max(255)).max(50).optional(),
});
export type WidgetSettingsUpdate = z.infer<typeof WidgetSettingsUpdate>;

export const WidgetJobRequest = z.object({
  garmentImageUrl: z.string().url(),
  customerPhotoKey: z.string(),
  aspectRatio: z.enum(['1:1', '2:3', '3:4', '4:5']).default('2:3'),
});
export type WidgetJobRequest = z.infer<typeof WidgetJobRequest>;

export const WidgetPresignRequest = z.object({
  contentType: z.string(),
  contentLength: z
    .number()
    .int()
    .positive()
    .max(5 * 1024 * 1024),
});
export type WidgetPresignRequest = z.infer<typeof WidgetPresignRequest>;

export const WidgetConfigResponse = z.object({
  widgetClientId: z.string().uuid(),
  companyName: z.string(),
  isActive: z.boolean(),
});
export type WidgetConfigResponse = z.infer<typeof WidgetConfigResponse>;

export const MerchantCatalogGender = z.enum(['men', 'women', 'boy', 'girl']);
export type MerchantCatalogGender = z.infer<typeof MerchantCatalogGender>;

export const MerchantCatalogModerationStatus = z.enum(['approved', 'rejected']);
export type MerchantCatalogModerationStatus = z.infer<typeof MerchantCatalogModerationStatus>;

export const MerchantCatalogPresignBody = z.object({
  assetId: z.string().uuid().optional(),
  kind: z.enum(['image', 'thumbnail']),
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  contentLength: z
    .number()
    .int()
    .positive()
    .max(5 * 1024 * 1024),
});
export type MerchantCatalogPresignBody = z.infer<typeof MerchantCatalogPresignBody>;

export const MerchantCatalogCreateBody = z.object({
  label: z.string().min(1).max(200),
  sku: z.string().max(120).optional(),
  gender: MerchantCatalogGender.nullish(),
  category: z.string().max(120).nullish(),
  r2Key: z.string().min(1),
  thumbnailKey: z.string().min(1),
});
export type MerchantCatalogCreateBody = z.infer<typeof MerchantCatalogCreateBody>;

export const MerchantCatalogUpdateBody = z
  .object({
    label: z.string().min(1).max(200).optional(),
    sku: z.string().max(120).nullable().optional(),
    gender: MerchantCatalogGender.nullish(),
    category: z.string().max(120).nullable().optional(),
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(999999).optional(),
  })
  .refine(
    (body) =>
      body.label !== undefined ||
      body.sku !== undefined ||
      body.gender !== undefined ||
      body.category !== undefined ||
      body.isActive !== undefined ||
      body.sortOrder !== undefined,
    { message: 'at least one field is required' },
  );
export type MerchantCatalogUpdateBody = z.infer<typeof MerchantCatalogUpdateBody>;

export const MerchantCatalogImportBody = z.object({
  jobId: z.string().uuid(),
});
export type MerchantCatalogImportBody = z.infer<typeof MerchantCatalogImportBody>;

export const MerchantCatalogItem = z.object({
  id: z.string().uuid(),
  widgetClientId: z.string().uuid(),
  label: z.string(),
  sku: z.string().nullable(),
  gender: MerchantCatalogGender.nullable(),
  category: z.string().nullable(),
  r2Key: z.string(),
  thumbnailKey: z.string(),
  imageUrl: z.string().url().nullable(),
  thumbnailUrl: z.string().url().nullable(),
  sourceJobId: z.string().uuid().nullable(),
  sourceKind: z.enum(['imported', 'uploaded']),
  isActive: z.boolean(),
  moderationStatus: MerchantCatalogModerationStatus,
  moderationNote: z.string().nullable(),
  sortOrder: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MerchantCatalogItem = z.infer<typeof MerchantCatalogItem>;

export const MerchantCatalogListResponse = z.object({
  items: z.array(MerchantCatalogItem),
});
export type MerchantCatalogListResponse = z.infer<typeof MerchantCatalogListResponse>;

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
  gender: MerchantCatalogGender.nullable(),
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
    .max(5 * 1024 * 1024),
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
  widgetClientId: z.string().uuid(),
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
export const MerchantRefreshBody = z.object({
  refreshToken: z.string().min(1),
});
export type MerchantRefreshBody = z.infer<typeof MerchantRefreshBody>;

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

export const AdminWidgetClientUpdateBody = z
  .object({
    isActive: z.boolean().optional(),
    companyName: z.string().min(1).max(160).optional(),
    allowedOrigins: z.array(z.string().max(255)).max(50).optional(),
    webhookUrl: z.string().url().nullable().optional(),
    webhookSecret: z.string().max(512).nullable().optional(),
    kioskEnabled: z.boolean().optional(),
    maxKioskDevices: z.number().int().min(1).max(100).optional(),
    userId: z.string().uuid().nullable().optional(),
  })
  .refine(
    (body) =>
      body.isActive !== undefined ||
      body.companyName !== undefined ||
      body.allowedOrigins !== undefined ||
      body.webhookUrl !== undefined ||
      body.webhookSecret !== undefined ||
      body.kioskEnabled !== undefined ||
      body.maxKioskDevices !== undefined ||
      body.userId !== undefined,
    { message: 'at least one field is required' },
  );
export type AdminWidgetClientUpdateBody = z.infer<typeof AdminWidgetClientUpdateBody>;
