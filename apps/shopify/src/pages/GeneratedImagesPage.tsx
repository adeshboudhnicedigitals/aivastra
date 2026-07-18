import {
  Banner,
  BlockStack,
  Button,
  Card,
  InlineGrid,
  InlineStack,
  Page,
  Spinner,
  Text,
  Thumbnail,
} from '@shopify/polaris';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiFetch } from '../lib/api';
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
    <Page
      title="Generated images"
      backAction={{ content: 'Products', onAction: () => navigate('/products') }}
      primaryAction={productId ? { content: 'Refresh', onAction: load, loading } : undefined}
    >
      <BlockStack gap="400">
        {error && (
          <Banner tone="critical" title="Something went wrong" onDismiss={() => setError(null)}>
            {error}
          </Banner>
        )}

        {!productId && (
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">
                Choose a product
              </Text>
              {pickerLoading && <Spinner size="small" />}
              {!pickerLoading && pickerProducts.length === 0 && (
                <Text as="p" tone="subdued">
                  No products found.
                </Text>
              )}
              <InlineStack gap="200" wrap>
                {pickerProducts.map((p) => (
                  <Button
                    key={p.shopifyProductId}
                    onClick={() =>
                      navigate(`/generated-images?productId=${p.shopifyProductId}`, {
                        replace: true,
                      })
                    }
                  >
                    <BlockStack gap="100">
                      <Thumbnail source={p.thumbnailUrl} alt={p.title ?? ''} size="large" />
                      <Text as="span" variant="bodySm">
                        {p.title}
                      </Text>
                    </BlockStack>
                  </Button>
                ))}
              </InlineStack>
            </BlockStack>
          </Card>
        )}

        {productId && loading && runs.length === 0 && <Spinner size="large" />}

        {productId && !loading && runs.length === 0 && !error && (
          <Card>
            <Text as="p" tone="subdued">
              No catalog images have been generated for this product yet.
            </Text>
          </Card>
        )}

        {runs.map((run) => (
          <Card key={run.catalogueId}>
            <BlockStack gap="300">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingMd">
                  {new Date(run.createdAt).toLocaleString()}
                </Text>
                <Thumbnail source={run.sourceImageUrl} alt="Source garment" size="small" />
              </InlineStack>
              <InlineGrid columns={3} gap="300">
                {run.jobs.map((j) => (
                  <BlockStack key={j.jobId} gap="200">
                    {j.status === 'COMPLETED' && j.resultUrl ? (
                      <Thumbnail source={j.resultUrl} alt="" size="large" />
                    ) : j.status === 'FAILED' ? (
                      <Text as="p" tone="critical">
                        Generation failed{j.errorCode ? ` (${j.errorCode})` : ''}
                      </Text>
                    ) : (
                      <Spinner size="small" />
                    )}
                    {j.status === 'COMPLETED' && (
                      <Button disabled={j.published} onClick={() => publish(j.jobId)}>
                        {j.published ? 'Added to product' : 'Add to product'}
                      </Button>
                    )}
                  </BlockStack>
                ))}
              </InlineGrid>
            </BlockStack>
          </Card>
        ))}
      </BlockStack>
    </Page>
  );
}
