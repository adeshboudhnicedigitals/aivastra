import type { MerchantCatalogGenerateStatus, MerchantCatalogItem } from '@aivastra/types';
import { createSSEConnection, type SSEConnection } from '@/lib/sse';
import { catalogAppApi as api, getCatalogAppToken, tryRefresh } from './catalog-app-api';

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

/**
 * Waits for a single Path B generate job to reach a terminal status over the job SSE
 * stream (same channel Studio uses) — no client-side timeout, so a job queued behind
 * others is never abandoned client-side. This route keeps its own session isolated from
 * the main site's (see catalog-app-api.ts), so it opens its own short-lived connection
 * with this route's token instead of using the app-wide JobStreamProvider.
 *
 * SSE has no replay, so the status is re-read every time the connection (re)connects —
 * that covers a job that finished before the stream was live and any event dropped
 * during a reconnect gap.
 */
export function waitForGenerateJob(
  jobId: string,
): Promise<Pick<MerchantCatalogGenerateStatus, 'status' | 'errorCode'>> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let conn: SSEConnection | undefined;
    const finish = (status: string, errorCode: string | null | undefined) => {
      if (settled) return;
      settled = true;
      conn?.close();
      resolve({ status, errorCode: errorCode ?? null });
    };
    const checkStatus = () => {
      api
        .get<MerchantCatalogGenerateStatus>(`/v1/merchant/catalog/generate/${jobId}`)
        .then((st) => {
          if (TERMINAL_STATUSES.has(st.status)) finish(st.status, st.errorCode);
        })
        .catch((err) => {
          if (settled) return;
          settled = true;
          conn?.close();
          reject(err);
        });
    };
    conn = createSSEConnection<{ jobId: string; status: string; errorCode?: string }>(
      '/v1/jobs/stream',
      (e) => {
        if (e.type === 'STATUS' && e.data.jobId === jobId && TERMINAL_STATUSES.has(e.data.status)) {
          finish(e.data.status, e.data.errorCode);
        }
      },
      undefined,
      (state) => {
        if (state === 'connected') checkStatus();
      },
      { getToken: getCatalogAppToken, refresh: tryRefresh },
    );
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
