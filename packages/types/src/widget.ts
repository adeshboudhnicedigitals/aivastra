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
  garmentImageUrl: z.string().url().optional(),
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

export const ShopifyCustomerPresignRequest = z.object({
  contentType: z.string(),
  contentLength: z
    .number()
    .int()
    .positive()
    .max(5 * 1024 * 1024),
});
export type ShopifyCustomerPresignRequest = z.infer<typeof ShopifyCustomerPresignRequest>;

export const ShopifyCustomerJobRequest = z.object({
  customerPhotoKey: z.string(),
  shopifyProductId: z.number().int().positive(),
});
export type ShopifyCustomerJobRequest = z.infer<typeof ShopifyCustomerJobRequest>;
