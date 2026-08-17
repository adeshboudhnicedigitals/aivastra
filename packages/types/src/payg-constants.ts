// Shared between packages/types (request validation), apps/api, apps/dispatcher
// and apps/shopify (apps/api/src/modules/shopify/payg.ts and
// apps/dispatcher/src/job/processor.ts re-export/import these rather than
// redefining them, so none of them can drift apart).
export const MIN_PAYG_SPEND_CAP_USD_CENTS = 500; // $5
export const DEFAULT_PAYG_SPEND_CAP_USD_CENTS = 5000; // $50

// The code-side mirror of the Partner Dashboard meter price. Must match it
// exactly — this is what the spend cap is checked against, and what the
// dispatcher stamps onto every shopify_usage_events row. If the Partner
// Dashboard price ever changes, this constant changes in the same PR.
export const PAYG_PRICE_PER_TRYON_USD_CENTS = 10;
