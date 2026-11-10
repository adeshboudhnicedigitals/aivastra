import type { MerchantCatalogGenerateStatus, MerchantCatalogItem } from '@aivastra/types';
import type { JobStatusEvent } from '@/components/job-stream-provider';
import { api } from '@/lib/api-client';
import { ApiError } from '@/lib/errors';

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

type JobStreamSubscribe = (fn: (evt: JobStatusEvent) => void) => () => void;

const GENERATE_POLL_INTERVAL_MS = 3_000;
// Consecutive transient failures (network blip, 5xx) tolerated before giving up —
// a flaky connection shouldn't lose a job that is still running server-side.
const GENERATE_POLL_MAX_TRANSIENT_FAILURES = 5;

/**
 * Waits for a single Path B generate job to reach a terminal status — no
 * client-side timeout, so a job queued behind others is never abandoned.
 *
 * Two sources race, first terminal status wins:
 *  - the app-wide job SSE stream (same channel Studio uses), for instant updates;
 *  - polling GET /v1/merchant/catalog/generate/:jobId every 3s. The stream is
 *    per-user and generate jobs are created under the merchant OWNER's user id,
 *    so a staff member's stream never receives this job's events; polling is
 *    what makes the wait finish for staff (and covers a job that finished before
 *    the subscription was live, since SSE has no replay).
 *
 * onStatus (optional): fired for every status this job passes through, from
 * either source, terminal or not — QUEUED/PREPROCESSING/GENERATING/UPLOADING are
 * the same dispatcher transitions every job type goes through
 * (apps/dispatcher/src/job/processor.ts), so a caller can drive the same
 * progress-ring UI catalogs/[id]/page.tsx uses.
 */
export function waitForGenerateJob(
  jobId: string,
  subscribe: JobStreamSubscribe,
  onStatus?: (status: string) => void,
): Promise<Pick<MerchantCatalogGenerateStatus, 'status' | 'errorCode'>> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let transientFailures = 0;
    const cleanup = () => {
      settled = true;
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
    const finish = (status: string, errorCode: string | null | undefined) => {
      if (settled) return;
      cleanup();
      resolve({ status, errorCode: errorCode ?? null });
    };
    const fail = (err: unknown) => {
      if (settled) return;
      cleanup();
      reject(err);
    };
    const unsubscribe = subscribe((evt) => {
      if (evt.jobId !== jobId) return;
      onStatus?.(evt.status);
      if (TERMINAL_STATUSES.has(evt.status)) finish(evt.status, evt.errorCode);
    });
    const poll = async () => {
      if (settled) return;
      try {
        const st = await api.get<MerchantCatalogGenerateStatus>(
          `/v1/merchant/catalog/generate/${jobId}`,
        );
        if (settled) return;
        transientFailures = 0;
        onStatus?.(st.status);
        if (TERMINAL_STATUSES.has(st.status)) {
          finish(st.status, st.errorCode);
          return;
        }
      } catch (err) {
        if (settled) return;
        // A 4xx (job not found / not ours / forbidden) won't fix itself.
        const permanent = err instanceof ApiError && err.status >= 400 && err.status < 500;
        if (permanent || ++transientFailures >= GENERATE_POLL_MAX_TRANSIENT_FAILURES) {
          fail(err);
          return;
        }
      }
      timer = setTimeout(poll, GENERATE_POLL_INTERVAL_MS);
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
 * Held batches run whenever an admin releases them, so there is no in-modal poll
 * to finalize them — the catalogue view calls this on mount instead. Rows come
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
