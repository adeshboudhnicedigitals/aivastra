import { MERCHANT_PLAN_BILLING, type MerchantPlanSlug } from '@aivastra/types';

export interface MerchantPlan {
  slug: string;
  name: string;
  description: string;
  /** Base price in INR (excl. GST) — sourced from @aivastra/types */
  priceInr: number;
  /** Sourced from @aivastra/types */
  credits: number;
  validityMonths: number;
  requestsPerMin: number;
  /** ₹ per credit */
  costPerCredit: number;
  badge: string;
  badgeBg: string;
  badgeColor: string;
  benefits: string[];
  featured: boolean;
}

export const GST_RATE = 0.18;

// Display-only metadata, keyed by slug. Price/credits/name come from the shared
// authoritative billing source so what's shown always matches what's charged.
const PLAN_META: Record<
  MerchantPlanSlug,
  Omit<MerchantPlan, 'slug' | 'name' | 'priceInr' | 'credits'>
> = {
  basic: {
    description: 'Best suited for growing businesses needing scalable AI Try-On requests.',
    validityMonths: 1,
    requestsPerMin: 2,
    costPerCredit: 2.5,
    badge: '5% OFF',
    badgeBg: 'var(--c-merchant-success-tint)',
    badgeColor: 'var(--c-merchant-success)',
    benefits: [
      'AI Virtual Try-On Access',
      'Secure API Access',
      'Dashboard Analytics',
      'Email Support',
    ],
    featured: false,
  },
  advanced: {
    description: 'For established stores scaling up their try-on volume and throughput.',
    validityMonths: 1,
    requestsPerMin: 4,
    costPerCredit: 2.0,
    badge: '41% OFF',
    badgeBg: 'var(--c-merchant-warning-tint)',
    badgeColor: 'var(--c-merchant-warning)',
    benefits: [
      'AI Virtual Try-On Access',
      'Secure API Access',
      'Dashboard Analytics',
      'Email Support',
    ],
    featured: false,
  },
  pro: {
    description: 'Our most popular plan — built for high-traffic catalogues and faster limits.',
    validityMonths: 1,
    requestsPerMin: 6,
    costPerCredit: 1.88,
    badge: 'Most Popular',
    badgeBg: 'var(--c-merchant-accent-tint)',
    badgeColor: 'var(--c-merchant-accent)',
    benefits: [
      'AI Virtual Try-On Access',
      'Secure API Access',
      'Dashboard Analytics',
      'Priority Support',
    ],
    featured: true,
  },
  ultra: {
    description: 'Enterprise-grade capacity with a dedicated manager and the highest limits.',
    validityMonths: 1,
    requestsPerMin: 12,
    costPerCredit: 1.5,
    badge: '31% OFF',
    badgeBg: 'var(--c-merchant-danger-tint)',
    badgeColor: 'var(--c-merchant-danger)',
    benefits: [
      'AI Virtual Try-On Access',
      'Secure API Access',
      'Dashboard Analytics',
      'Priority Support',
      'Dedicated Account Manager',
    ],
    featured: false,
  },
};

export const MERCHANT_PLANS: MerchantPlan[] = (
  Object.keys(MERCHANT_PLAN_BILLING) as MerchantPlanSlug[]
).map((slug) => {
  const billing = MERCHANT_PLAN_BILLING[slug];
  return {
    slug: billing.slug,
    name: billing.name,
    priceInr: billing.priceInr,
    credits: billing.credits,
    ...PLAN_META[slug],
  };
});

export function getPlan(slug: string): MerchantPlan | undefined {
  return MERCHANT_PLANS.find((p) => p.slug === slug);
}

/** Format a whole-rupee amount as e.g. ₹29,500.00 (Indian digit grouping). */
export function formatInr(amount: number): string {
  return `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
