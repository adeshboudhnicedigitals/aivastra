import { z } from 'zod';

// WhatsApp baskets: admin-made groups of one gender's garment types that run
// the same workflow. The bot confirms a basket rather than a type (see
// apps/api/src/modules/messaging/baskets.ts).

export const WHATSAPP_GENDERS = ['women', 'men', 'boys', 'girls'] as const;

// Why a garment type cannot be offered on WhatsApp at all: the chat takes one
// garment photo, so any type that needs (or offers) a second upload is out.
// The studio and Shopify keep these types; this applies to WhatsApp only.
export const WhatsAppIneligibleReason = z.enum([
  'lower_upload',
  'third_upload',
  'fourth_upload',
  'mannequin_step',
]);
export type WhatsAppIneligibleReason = z.infer<typeof WhatsAppIneligibleReason>;

export const CreateWhatsAppBasketBody = z.object({
  genderSlug: z.enum(WHATSAPP_GENDERS),
  name: z.string().trim().min(1).max(60),
  memberIds: z.array(z.string().uuid()).max(100).default([]),
  // Must be one of memberIds. Null = the first ready member by sort order.
  representativeSubcategoryId: z.string().uuid().nullable().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});
export type CreateWhatsAppBasketBody = z.infer<typeof CreateWhatsAppBasketBody>;

// The gender is fixed once created: members are per-gender type rows.
export const PatchWhatsAppBasketBody = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  // Replaces the whole member set when given.
  memberIds: z.array(z.string().uuid()).max(100).optional(),
  representativeSubcategoryId: z.string().uuid().nullable().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  isActive: z.boolean().optional(),
});
export type PatchWhatsAppBasketBody = z.infer<typeof PatchWhatsAppBasketBody>;
