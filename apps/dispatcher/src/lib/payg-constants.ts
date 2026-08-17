// Kept in sync by hand with apps/api/src/modules/shopify/payg.ts's
// PAYG_PRICE_PER_TRYON_USD_CENTS — the two packages don't share a runtime
// dependency, so this is a deliberate duplication, not an import. If the
// price ever changes, both files change in the same PR.
export const PAYG_PRICE_PER_TRYON_USD_CENTS = 10;
