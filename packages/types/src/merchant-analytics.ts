import { z } from 'zod';

export const MERCHANT_ANALYTICS_RANGES = ['7d', '30d', '90d'] as const;

export const MerchantAnalyticsQuery = z.object({
  range: z.enum(MERCHANT_ANALYTICS_RANGES).default('30d'),
});
export type MerchantAnalyticsQuery = z.infer<typeof MerchantAnalyticsQuery>;

const Ranked = z.object({ name: z.string(), tryOns: z.number().int() });

export const MerchantAnalyticsResponse = z.object({
  range: z.object({ from: z.string(), to: z.string(), previousFrom: z.string() }),
  totalTryOns: z.number().int(),
  previousTryOns: z.number().int(),
  // Earliest job that carries a catalog item id; null when none yet. Rankings
  // only cover try-ons since this instant.
  breakdownSince: z.string().nullable(),
  topGarmentType: Ranked.nullable(),
  mostTriedProduct: Ranked.nullable(),
  leastTriedProduct: Ranked.nullable(),
  categories: z.array(Ranked.extend({ pct: z.number() })),
  topProducts: z.array(Ranked.extend({ rank: z.number().int(), itemId: z.string() })),
});
export type MerchantAnalyticsResponse = z.infer<typeof MerchantAnalyticsResponse>;
