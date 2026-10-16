/**
 * Which backend holds an object, decided purely by its key:
 *
 *   asset — admin-curated assets and merchant try-on library content. Stays on
 *           the VPS's self-hosted MinIO.
 *   user  — what end users upload or the pipeline generates for them: garment
 *           and shopper photos, results, Shopify product images, support
 *           attachments, invoices. Moves to Cloudflare R2 where configured.
 */
export type StorageBackend = 'asset' | 'user';

// Keyed by the key's first path segment, trailing slash included, and matched
// by exact lookup rather than startsWith — so `shopify/` (admin basket images)
// can never swallow `shopify-inputs/` or `shopify-garments/`, and
// `merchant-catalog/` stays distinct from `merchant-inputs/`.
//
// Every segment keys.ts produces must appear here (test/routing.test.ts runs
// every builder through backendFor). A segment absent from this table makes
// every operation on its keys throw — see UnroutableKeyError.
const BACKEND_BY_SEGMENT: Readonly<Record<string, StorageBackend>> = {
  // Admin-curated
  'models/': 'asset',
  'catalog/': 'asset',
  'demo-catalog/': 'asset',
  'tryon/': 'asset',
  'saree/': 'asset',
  'saree-styles/': 'asset',
  'shopify/': 'asset',
  'sample-videos/': 'asset',
  'fabric-garment-types/': 'asset',
  'config/': 'asset',
  'wordpress-plugin-releases/': 'asset',
  // Merchant library + branding — merchant-authored, but it's catalogue content
  // served to every shopper, not one shopper's data.
  'merchant-catalog/': 'asset',
  'merchant-logo/': 'asset',
  'merchant-loading-video/': 'asset',

  // End-user inputs
  'inputs/': 'user',
  'user-backgrounds/': 'user',
  'merchant-inputs/': 'user',
  'shopify-inputs/': 'user',
  'shopify-garments/': 'user',
  // Legacy: no builder writes this any more, but production job_inputs rows
  // still reference it. Shopify content, so it sits with shopify-garments/.
  'shopify-catalog-garments/': 'user',
  'extension/': 'user',
  'dev/': 'user',
  'support/': 'user',
  'invoices/': 'user',
  // End-user outputs
  'outputs/': 'user',
  'widget-outputs/': 'user',
};

/** Thrown for a key whose first segment is not in the routing table. Fails
 *  closed on purpose: silently defaulting would put a new kind of user data on
 *  whichever backend happened to be the default, with nothing to flag it. */
export class UnroutableKeyError extends Error {
  constructor(readonly key: string) {
    super(`storage key has no routing rule: ${JSON.stringify(key)}`);
    this.name = 'UnroutableKeyError';
  }
}

/** Backend for a key — or a listObjects prefix, which must include at least
 *  the first segment and its trailing slash. */
export function backendFor(key: string): StorageBackend {
  const slash = key.indexOf('/');
  const backend = slash > 0 ? BACKEND_BY_SEGMENT[key.slice(0, slash + 1)] : undefined;
  if (!backend) throw new UnroutableKeyError(key);
  return backend;
}
