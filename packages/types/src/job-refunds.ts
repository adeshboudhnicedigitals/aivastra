// Every ledger reason that means "this job's charge was already returned".
//
// A refund is idempotent per (job_id, reason) at the database, but a job can be ended by
// more than one actor (the dispatcher, the stuck-job sweeper, an admin or merchant cancel),
// each writing its own reason. The unique index cannot see across reasons, so every writer
// must instead ask "has ANY of these been paid for this job?" before refunding. Production
// carried 21 user jobs and 1 store job refunded twice because the dispatcher's widget and
// Shopify paths checked only JOB_FAIL_REFUND while the API cancel wrote REFUND_ADMIN_CANCEL.
//
// Keep the dispatcher's settlement and the API's cancel/refund paths on this one list so
// the two sides cannot drift apart again.
//
// Ledger applicability: `credit_ledger` (user/merchant-owning user) accepts all of them;
// `shopify_credit_ledger` only ever receives JOB_FAIL_REFUND, REFUND_ADMIN_CANCEL and
// REFUND_ENQUEUE_FAIL today. Checking the full list against either ledger is harmless.
// REFUND_USER_REQUEST is the approved refund-request flow (jobs/refund-requests.ts). Do not
// add the API error codes REFUND_REQUESTED / REFUND_APPROVED: they are AppError codes, not
// ledger reasons.
export const JOB_REFUND_REASONS = [
  'JOB_FAIL_REFUND',
  'JOB_CANCEL_REFUND',
  'REFUND_ADMIN_CANCEL',
  'REFUND_CANCELLED',
  'REFUND_ENQUEUE_FAIL',
  'REFUND_USER_REQUEST',
] as const;
export type JobRefundReason = (typeof JOB_REFUND_REASONS)[number];
