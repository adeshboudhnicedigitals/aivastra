import { z } from 'zod';

// CRM phase 3, slice 3a (docs/superpowers/plans/2026-11-12-crm-phase3-variants-stock-cart.md).

export const STOCK_STATUSES = ['in_stock', 'low', 'out'] as const;
export type StockStatus = (typeof STOCK_STATUSES)[number];

const text = (max: number) => z.string().trim().min(1).max(max);

export const VariantCreateBody = z.object({
  size: text(40),
  colour: z.string().trim().max(40).default(''),
  sku: text(64).optional(),
  barcode: z
    .string()
    .trim()
    .regex(/^[0-9A-Za-z-]{4,32}$/, 'letters, digits or dashes')
    .optional(),
  priceOverridePaise: z.number().int().min(0).max(100_000_000).optional(),
});
export type VariantCreateBody = z.infer<typeof VariantCreateBody>;

export const VariantUpdateBody = z
  .object({
    sku: text(64).nullable(),
    barcode: z
      .string()
      .trim()
      .regex(/^[0-9A-Za-z-]{4,32}$/, 'letters, digits or dashes')
      .nullable(),
    priceOverridePaise: z.number().int().min(0).max(100_000_000).nullable(),
    /** Map a free-text size onto a standard one so reports group it (spec §6.2). */
    standardSize: text(40).nullable(),
    isActive: z.boolean(),
    sortOrder: z.number().int().min(0).max(10_000),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'nothing to update');
export type VariantUpdateBody = z.infer<typeof VariantUpdateBody>;

export const StockPutBody = z.object({ status: z.enum(STOCK_STATUSES) });
export type StockPutBody = z.infer<typeof StockPutBody>;

export interface VariantStock {
  branchId: string;
  status: StockStatus;
  quantity: number | null;
  source: string;
  updatedAt: string;
}

export interface Variant {
  id: string;
  size: string;
  isCustom: boolean;
  standardSize: string | null;
  colour: string;
  sku: string | null;
  barcode: string | null;
  priceOverridePaise: number | null;
  isActive: boolean;
  sortOrder: number;
}

export interface MerchantVariantsResponse {
  /** The garment type's standard sizes, if one is attached. */
  sizeSet: { name: string; sizes: string[] } | null;
  variants: Array<Variant & { stock: VariantStock[] }>;
}

/** Tablet: sizes of one item with this branch's availability (spec §6.2 "At the kiosk"). */
export interface DeviceVariantsResponse {
  variants: Array<{
    id: string;
    size: string;
    colour: string;
    barcode: string | null;
    sku: string | null;
    pricePaise: number;
    /** This branch. Missing stock row = unknown, shown as available (nothing recorded "out"). */
    status: StockStatus | 'unknown';
    /** Other active branches holding it in stock or low, nearest by name order. */
    otherBranches: Array<{ branchId: string; name: string; status: 'in_stock' | 'low' }>;
  }>;
  /** Merchant store_url for "Buy online"; null hides it. */
  buyOnlineUrl: string | null;
}

export const SizeSetBody = z.object({
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]{2,40}$/),
  name: text(80),
  sizes: z.array(text(40)).min(1).max(60),
  isActive: z.boolean().optional(),
});
export type SizeSetBody = z.infer<typeof SizeSetBody>;

export const GarmentTypeSizeSetBody = z.object({ sizeSetId: z.string().uuid().nullable() });
export type GarmentTypeSizeSetBody = z.infer<typeof GarmentTypeSizeSetBody>;
