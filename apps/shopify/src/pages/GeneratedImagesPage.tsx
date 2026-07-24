import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CatalogJobThumb } from '../components/CatalogJobThumb';
import { SpinnerIcon, SyncIcon } from '../components/icons';
import { PageHeader } from '../components/PageHeader';
import { ProductPickerGrid } from '../components/ProductPickerGrid';
import { apiFetch } from '../lib/api';
import { BRAND } from '../theme';
import type { CatalogGenerateJob, ShopifyProductListItem } from '../types';

interface Run {
  catalogueId: string;
  createdAt: string;
  sourceImageUrl: string;
  jobs: CatalogGenerateJob[];
}

function groupIntoRuns(items: CatalogGenerateJob[]): Run[] {
  const byCatalogue = new Map<string, Run>();
  for (const job of items) {
    const existing = byCatalogue.get(job.catalogueId);
    if (existing) {
      existing.jobs.push(job);
    } else {
      byCatalogue.set(job.catalogueId, {
        catalogueId: job.catalogueId,
        createdAt: job.createdAt,
        sourceImageUrl: job.sourceImageUrl,
        jobs: [job],
      });
    }
  }
  // Backend already orders rows by createdAt desc, but Map insertion order
  // follows first-seen-row order which matches that — no re-sort needed.
  return Array.from(byCatalogue.values());
}

export default function GeneratedImagesPage() {
  const [params] = useSearchParams();
  const productId = params.get('productId') ?? '';
  const navigate = useNavigate();

  const [pickerProducts, setPickerProducts] = useState<ShopifyProductListItem[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [jobs, setJobs] = useState<CatalogGenerateJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (productId) return;
    setPickerLoading(true);
    apiFetch<{ items: ShopifyProductListItem[] }>('/v1/shopify/products?pageSize=100')
      .then((res) => setPickerProducts(res.items))
      .catch((err) => setError((err as Error).message))
      .finally(() => setPickerLoading(false));
  }, [productId]);

  const load = useCallback(() => {
    if (!productId) return;
    setLoading(true);
    setError(null);
    apiFetch<{ items: CatalogGenerateJob[] }>(
      `/v1/shopify/catalog/jobs?shopifyProductId=${productId}`,
    )
      .then((res) => setJobs(res.items))
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [productId]);

  useEffect(() => {
    load();
  }, [load]);

  async function publish(jobId: string) {
    try {
      const res = await apiFetch<{ ok: boolean; mediaId: string }>(
        `/v1/shopify/catalog/jobs/${jobId}/publish`,
        { method: 'POST' },
      );
      if (res.ok) {
        setJobs((prev) => prev.map((j) => (j.jobId === jobId ? { ...j, published: true } : j)));
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const runs = useMemo(() => groupIntoRuns(jobs), [jobs]);

  return (
    <div>
      <PageHeader
        title="Generated images"
        backTo="/products"
        backLabel="Products"
        action={
          productId ? (
            <button
              type="button"
              onClick={load}
              disabled={loading}
              style={{
                height: '38px',
                padding: '0 16px',
                border: `1px solid ${BRAND.borderStrong}`,
                borderRadius: '10px',
                background: '#fff',
                color: BRAND.inkSoft,
                fontSize: '13.5px',
                fontWeight: 600,
                cursor: loading ? 'default' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '7px',
                whiteSpace: 'nowrap',
              }}
            >
              <SyncIcon size={14} />
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          ) : undefined
        }
      />

      {error && (
        <div
          style={{
            background: BRAND.dangerBg,
            border: '1px solid rgba(200,30,58,0.18)',
            borderRadius: '14px',
            padding: '12px 16px',
            marginBottom: '16px',
            fontSize: '13.5px',
            color: '#8C1830',
          }}
        >
          {error}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {!productId && (
          <div
            style={{
              background: '#fff',
              border: `1px solid ${BRAND.border}`,
              borderRadius: '16px',
              padding: '20px',
            }}
          >
            <div
              style={{
                fontSize: '13.5px',
                fontWeight: 700,
                color: BRAND.ink,
                marginBottom: '10px',
              }}
            >
              Choose a product
            </div>
            <ProductPickerGrid
              loading={pickerLoading}
              products={pickerProducts}
              onPick={(id) => navigate(`/generated-images?productId=${id}`, { replace: true })}
            />
          </div>
        )}

        {productId && loading && runs.length === 0 && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '64px 0',
            }}
          >
            <SpinnerIcon size={26} color={BRAND.purple} />
          </div>
        )}

        {productId && !loading && runs.length === 0 && !error && (
          <div
            style={{
              background: '#fff',
              border: `1px solid ${BRAND.border}`,
              borderRadius: '16px',
              padding: '64px 24px',
              textAlign: 'center',
              fontSize: '13.5px',
              color: BRAND.textMuted,
            }}
          >
            No catalog images have been generated for this product yet.
          </div>
        )}

        {runs.map((run) => (
          <div
            key={run.catalogueId}
            style={{
              background: '#fff',
              border: `1px solid ${BRAND.border}`,
              borderRadius: '16px',
              padding: '20px',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '14px',
              }}
            >
              <div style={{ fontSize: '13.5px', fontWeight: 700, color: BRAND.ink }}>
                {new Date(run.createdAt).toLocaleString()}
              </div>
              {/* biome-ignore lint/performance/noImgElement: dynamic remote thumbnail */}
              <img
                src={run.sourceImageUrl}
                alt="Source garment"
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '8px',
                  objectFit: 'cover',
                  background: '#F1F0F5',
                }}
              />
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                gap: '16px',
              }}
            >
              {run.jobs.map((j) => (
                <CatalogJobThumb key={j.jobId} job={j} onPublish={publish} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
