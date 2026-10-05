import type { MerchantCatalogGenerateStatus, MerchantCatalogItem } from '@aivastra/types';
import { ApiError } from '@/lib/errors';
import { catalogAppApi as api, CatalogAppSessionExpiredError } from './catalog-app-api';

const ALLOWED_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
type AllowedContentType = (typeof ALLOWED_CONTENT_TYPES)[number];

export function toAllowedContentType(file: File): AllowedContentType {
  if ((ALLOWED_CONTENT_TYPES as readonly string[]).includes(file.type)) {
    return file.type as AllowedContentType;
  }
  throw new Error('Only JPEG, PNG, or WEBP images are supported.');
}

/** Presigns an R2 upload slot and pushes the file to it. Returns the resolved key. */
export async function presignAndUpload(
  file: File,
  kind: 'image' | 'thumbnail' | 'flat',
): Promise<{ assetId: string; r2Key: string }> {
  const contentType = toAllowedContentType(file);
  const { assetId, uploadUrl, r2Key } = await api.post<{
    assetId: string;
    uploadUrl: string;
    r2Key: string;
  }>('/v1/merchant/catalog/presign', { kind, contentType, contentLength: file.size });
  await api.uploadToR2(uploadUrl, file);
  return { assetId, r2Key };
}

const TERMINAL_STATUSES = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

const GENERATE_POLL_INTERVAL_MS = 3_000;
// Consecutive transient failures (network blip, 5xx) tolerated before giving up —
// a phone on a flaky connection shouldn't lose a job that is still running server-side.
const GENERATE_POLL_MAX_TRANSIENT_FAILURES = 5;

/**
 * Waits for a single Path B generate job to reach a terminal status by polling
 * GET /v1/merchant/catalog/generate/:jobId — no client-side timeout, so a job queued
 * behind others is never abandoned client-side.
 *
 * Deliberately not the job SSE stream (/v1/jobs/stream) that Studio uses: that route is
 * requireUser, which rejects this app's `catalog-app`-audience tokens by design (see
 * plugins/auth.ts), so the stream could never connect here and the wait hung forever.
 * The status route is requireMerchant, which this session is allowed to call.
 */
export function waitForGenerateJob(
  jobId: string,
): Promise<Pick<MerchantCatalogGenerateStatus, 'status' | 'errorCode'>> {
  return new Promise((resolve, reject) => {
    let transientFailures = 0;
    const poll = async () => {
      try {
        const st = await api.get<MerchantCatalogGenerateStatus>(
          `/v1/merchant/catalog/generate/${jobId}`,
        );
        transientFailures = 0;
        if (TERMINAL_STATUSES.has(st.status)) {
          resolve({ status: st.status, errorCode: st.errorCode ?? null });
          return;
        }
      } catch (err) {
        // Session expiry and 4xx (job not found / not ours) won't fix themselves.
        const permanent =
          err instanceof CatalogAppSessionExpiredError ||
          (err instanceof ApiError && err.status >= 400 && err.status < 500);
        if (permanent || ++transientFailures >= GENERATE_POLL_MAX_TRANSIENT_FAILURES) {
          reject(err);
          return;
        }
      }
      setTimeout(poll, GENERATE_POLL_INTERVAL_MS);
    };
    void poll();
  });
}

/** Copies a completed job's output into a merchant_catalog_items row (Path A import, also used to finalize Path B generates). */
export function finalizeGeneratedProduct(
  jobId: string,
  subcategoryId: string,
): Promise<MerchantCatalogItem> {
  return api.post<MerchantCatalogItem>('/v1/merchant/catalog/import', { jobId, subcategoryId });
}

/** Best-effort cleanup of an orphaned $0 product (e.g. user closes the modal after generating but before saving). */
export function deleteProduct(id: string): Promise<void> {
  return api.del<void>(`/v1/merchant/catalog/${id}`).catch(() => undefined);
}

/**
 * Materializes any bulk-flat batches that finished while the merchant was away.
 * Held batches run whenever an admin releases them, so there is no in-page poll
 * to finalize them — the products screen calls this on mount instead. Rows come
 * back inactive until the merchant fills in SKU and prices.
 *
 * `failed` distinguishes two very different situations for the caller:
 *  - a non-negative number is the server's own count of rows it could not
 *    finalize (a genuine partial failure, already logged server-side);
 *  - `-1` means the request itself never reached/completed against the server
 *    (network error, 5xx, session expiry) — reconciliation state is unknown,
 *    not "zero rows failed." Flattening this to 0 would silently hide a
 *    systemic failure behind an identical "nothing new yet" UI.
 */
export function reconcileHeldProducts(): Promise<{
  created: MerchantCatalogItem[];
  failed: number;
}> {
  return api
    .post<{ created: MerchantCatalogItem[]; failed: number }>(
      '/v1/merchant/catalog/reconcile-held',
      {},
    )
    .catch(() => ({ created: [], failed: -1 }));
}
