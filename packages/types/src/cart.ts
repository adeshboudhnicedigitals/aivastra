import { z } from 'zod';

// CRM phase 3, slice 3b (docs/superpowers/plans/2026-11-12-crm-phase3-variants-stock-cart.md).

export const CartLineAddBody = z.object({
  variantId: z.string().uuid(),
  quantity: z.number().int().min(1).max(20).default(1),
});
export type CartLineAddBody = z.infer<typeof CartLineAddBody>;

/** Bill these lines; omitted = every open line. */
export const CartBillBody = z.object({
  lineIds: z.array(z.string().uuid()).min(1).max(100).optional(),
});
export type CartBillBody = z.infer<typeof CartBillBody>;

export interface CartLineView {
  id: string;
  variantId: string;
  catalogItemId: string;
  label: string;
  size: string;
  colour: string;
  sku: string | null;
  /** What the cashier scans (plan P1). */
  barcode: string | null;
  quantity: number;
  unitPricePaise: number;
  addedBy: 'shopper' | 'staff';
  billed: boolean;
}

export interface CartView {
  cartCode: string;
  status: 'open' | 'billed' | 'abandoned';
  branchId: string;
  lines: CartLineView[];
  totalPaise: number;
}
