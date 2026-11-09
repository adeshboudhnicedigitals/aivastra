import type { DbTransaction } from '@aivastra/db';
import { atomicMerchantDeduct } from '../merchant/ledger.js';

/**
 * Seam for the subscription module (docs/architecture/v1-hld.md §6). Returns false
 * until that module ships, so every in-store try-on is paid with credits.
 * device_quota_per_month is enforced here once this can return true — not before.
 */
export async function isDeviceCovered(_deviceId: string): Promise<boolean> {
  return false;
}

/**
 * Decides how one in-store try-on is paid for. Runs inside the job-creation
 * transaction, so the deduct and the job insert commit or roll back together, and a
 * refund on terminal failure is unchanged. If the coverage check throws it counts as
 * NOT covered (also when it throws synchronously, and only a literal `true` counts as
 * covered): fall back to credits, never grant free usage. The spec's "or times out" is
 * not built here: a real I/O coverage check should be resolved BEFORE the job
 * transaction opens, not while it holds a connection and row locks. Insufficient credits throw
 * 402 INSUFFICIENT_CREDITS from the deduct, before any job row survives.
 */
export async function chargeInStoreTryon(
  tx: DbTransaction,
  ctx: { merchantId: string; deviceId: string; cost: number; jobId: string },
  covered: (deviceId: string) => Promise<boolean> = isDeviceCovered,
): Promise<void> {
  let isCovered = false;
  try {
    isCovered = (await covered(ctx.deviceId)) === true;
  } catch {
    isCovered = false;
  }
  if (isCovered) return;
  // biome-ignore lint/suspicious/noExplicitAny: tx type narrowing loses the custom methods added by the merchant ledger helper (same cast as create-tryon-job.ts).
  await atomicMerchantDeduct(tx as any, ctx.merchantId, ctx.cost, ctx.jobId);
}
