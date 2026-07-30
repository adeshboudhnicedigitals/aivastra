import { z } from 'zod';
import { MerchantCatalogCategory } from './widget.js';

export const DemoCatalogSetCreateBody = z.object({
  name: z.string().min(1).max(160),
  description: z.string().max(500).optional(),
  sortOrder: z.number().int().min(0).max(999999).optional(),
});
export type DemoCatalogSetCreateBody = z.infer<typeof DemoCatalogSetCreateBody>;

export const DemoCatalogSetUpdateBody = z
  .object({
    name: z.string().min(1).max(160).optional(),
    description: z.string().max(500).nullable().optional(),
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(999999).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'at least one field is required',
  });
export type DemoCatalogSetUpdateBody = z.infer<typeof DemoCatalogSetUpdateBody>;

export const DemoCatalogSubcategoryCreateBody = z.object({
  setId: z.string().uuid(),
  category: MerchantCatalogCategory,
  name: z.string().min(1).max(160),
  garmentSubcategoryId: z.string().uuid(),
  sortOrder: z.number().int().min(0).max(999999).optional(),
});
export type DemoCatalogSubcategoryCreateBody = z.infer<typeof DemoCatalogSubcategoryCreateBody>;

export const DemoCatalogSubcategoryUpdateBody = z
  .object({
    category: MerchantCatalogCategory.optional(),
    name: z.string().min(1).max(160).optional(),
    garmentSubcategoryId: z.string().uuid().optional(),
    sortOrder: z.number().int().min(0).max(999999).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'at least one field is required',
  });
export type DemoCatalogSubcategoryUpdateBody = z.infer<typeof DemoCatalogSubcategoryUpdateBody>;
