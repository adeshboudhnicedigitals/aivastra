// Shared between packages/types (request validation) and apps/api
// (apps/api/src/modules/shopify/payg.ts re-exports these rather than
// redefining them, so the two never drift).
export const MIN_PAYG_SPEND_CAP_USD_CENTS = 500; // $5
export const DEFAULT_PAYG_SPEND_CAP_USD_CENTS = 5000; // $50
