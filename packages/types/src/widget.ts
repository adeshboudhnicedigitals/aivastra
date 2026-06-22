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
    .max(10 * 1024 * 1024),
});
export type WidgetPresignRequest = z.infer<typeof WidgetPresignRequest>;

export const WidgetConfigResponse = z.object({
  widgetClientId: z.string().uuid(),
  companyName: z.string(),
  isActive: z.boolean(),
});
export type WidgetConfigResponse = z.infer<typeof WidgetConfigResponse>;
