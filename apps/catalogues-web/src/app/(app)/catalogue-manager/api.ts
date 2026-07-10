import type { MerchantCatalogGenerateStatus, MerchantCatalogItem } from '@aivastra/types';
import { api } from '@/lib/api';

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

/** Polls a single Path B generate job until it reaches a terminal status. */
export async function pollGenerateJob(
  jobId: string,
  opts: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<MerchantCatalogGenerateStatus> {
  const intervalMs = opts.intervalMs ?? 2500;
  const timeoutMs = opts.timeoutMs ?? 180_000;
  const startedAt = Date.now();
  for (;;) {
    const status = await api.get<MerchantCatalogGenerateStatus>(
      `/v1/merchant/catalog/generate/${jobId}`,
    );
    if (TERMINAL_STATUSES.has(status.status)) return status;
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('Timed out waiting for the catalogue image to generate.');
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/**
 * Polls a batch of Path B generate jobs via the single-request batch status
 * endpoint until every job reaches a terminal status, reporting each tick so
 * the caller can update per-item UI (and import each job as soon as it's done
 * rather than waiting for the whole batch).
 */
export async function pollGenerateBatch(
  jobIds: string[],
  onTick: (items: MerchantCatalogGenerateStatus[]) => void,
  opts: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<void> {
  const intervalMs = opts.intervalMs ?? 2500;
  const timeoutMs = opts.timeoutMs ?? 300_000;
  const startedAt = Date.now();
  let pending = jobIds;
  while (pending.length > 0) {
    const { items } = await api.get<{ items: MerchantCatalogGenerateStatus[] }>(
      `/v1/merchant/catalog/generate/status?jobIds=${pending.join(',')}`,
    );
    onTick(items);
    pending = items.filter((i) => !TERMINAL_STATUSES.has(i.status)).map((i) => i.jobId);
    if (pending.length === 0) return;
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('Timed out waiting for the catalogue images to generate.');
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
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
