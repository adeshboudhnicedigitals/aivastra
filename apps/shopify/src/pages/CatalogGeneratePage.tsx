import {
  Banner,
  BlockStack,
  Button,
  Card,
  InlineGrid,
  InlineStack,
  Page,
  Select,
  Spinner,
  Text,
  Thumbnail,
} from '@shopify/polaris';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import type {
  CatalogGenerateJob,
  CatalogOptions,
  ShopifyProductImage,
  ShopifyProductListItem,
} from '../types';

const GENDERS = [
  { label: 'Women', value: 'women' },
  { label: 'Men', value: 'men' },
  { label: 'Girls', value: 'girls' },
  { label: 'Boys', value: 'boys' },
];

export default function CatalogGeneratePage() {
  const [params] = useSearchParams();
  const productId = params.get('productId') ?? '';
  const navigate = useNavigate();

  const [images, setImages] = useState<ShopifyProductImage[]>([]);
  const [selectedImageSrc, setSelectedImageSrc] = useState<string>('');
  const [gender, setGender] = useState('women');
  const [options, setOptions] = useState<CatalogOptions | null>(null);
  const [garmentTypeId, setGarmentTypeId] = useState<string>('');
  const [faceId, setFaceId] = useState<string>('');
  const [selectedLooks, setSelectedLooks] = useState<Set<string>>(new Set());
  const [backgroundId, setBackgroundId] = useState<string>('');
  const [lowerCatalogId, setLowerCatalogId] = useState<string>('');
  const [shoeCatalogId, setShoeCatalogId] = useState<string>('');
  const [generating, setGenerating] = useState(false);
  const [jobs, setJobs] = useState<CatalogGenerateJob[]>([]);
  const [catalogueId, setCatalogueId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [pickerProducts, setPickerProducts] = useState<ShopifyProductListItem[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);

  useEffect(() => {
    if (productId) return;
    setPickerLoading(true);
    apiFetch<{ items: ShopifyProductListItem[] }>('/v1/shopify/products?pageSize=100')
      .then((res) => setPickerProducts(res.items))
      .catch((err) => setError((err as Error).message))
      .finally(() => setPickerLoading(false));
  }, [productId]);

  useEffect(() => {
    if (!productId) return;
    apiFetch<{ images: ShopifyProductImage[] }>(`/v1/shopify/products/${productId}/images`)
      .then((res) => {
        setImages(res.images);
        if (res.images[0]) setSelectedImageSrc(res.images[0].src);
      })
      .catch((err) => setError((err as Error).message));
  }, [productId]);

  const optionsRequestId = useRef(0);

  useEffect(() => {
    const requestId = ++optionsRequestId.current;
    setFaceId('');
    setBackgroundId('');
    setSelectedLooks(new Set());
    setLowerCatalogId('');
    setShoeCatalogId('');
    const query = new URLSearchParams({ gender });
    if (garmentTypeId) query.set('garmentTypeId', garmentTypeId);
    apiFetch<CatalogOptions>(`/v1/shopify/catalog/options?${query.toString()}`)
      .then((res) => {
        if (requestId !== optionsRequestId.current) return; // stale — a newer request has since started
        setOptions(res);
      })
      .catch((err) => {
        if (requestId !== optionsRequestId.current) return;
        setError((err as Error).message);
      });
  }, [gender, garmentTypeId]);

  const poseNeedsLower = useMemo(
    () => options?.poses.some((p) => selectedLooks.has(p.id) && p.hasLower) ?? false,
    [options, selectedLooks],
  );
  const poseNeedsShoes = useMemo(
    () => options?.poses.some((p) => selectedLooks.has(p.id) && p.hasShoes) ?? false,
    [options, selectedLooks],
  );

  function togglePose(poseId: string) {
    setSelectedLooks((prev) => {
      const next = new Set(prev);
      if (next.has(poseId)) next.delete(poseId);
      else next.add(poseId);
      return next;
    });
  }

  const generate = useCallback(async () => {
    if (!selectedImageSrc || !faceId || !backgroundId || selectedLooks.size === 0) {
      setError('Pick a garment image, face, background, and at least one pose first.');
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      const res = await apiFetch<{ catalogueId: string; jobIds: string[] }>(
        '/v1/shopify/catalog/generate',
        {
          method: 'POST',
          body: JSON.stringify({
            shopifyProductId: Number(productId),
            sourceImageUrl: selectedImageSrc,
            faceId,
            garmentTypeId: garmentTypeId || undefined,
            looks: Array.from(selectedLooks).map((poseId) => ({ poseId, backgroundId })),
            lowerCatalogId: poseNeedsLower ? lowerCatalogId || undefined : undefined,
            shoeCatalogId: poseNeedsShoes ? shoeCatalogId || undefined : undefined,
            aspectRatio: '3:4',
            resolution: 'HD',
          }),
        },
      );
      setJobs([]);
      setCatalogueId(res.catalogueId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGenerating(false);
    }
  }, [
    selectedImageSrc,
    faceId,
    backgroundId,
    selectedLooks,
    garmentTypeId,
    poseNeedsLower,
    poseNeedsShoes,
    lowerCatalogId,
    shoeCatalogId,
    productId,
  ]);

  useEffect(() => {
    if (!catalogueId) return;
    const fetchJobs = () => {
      apiFetch<{ items: CatalogGenerateJob[] }>(
        `/v1/shopify/catalog/jobs?catalogueId=${catalogueId}`,
      )
        .then((res) => setJobs(res.items))
        .catch((err) => setError((err as Error).message));
    };
    fetchJobs();
    const interval = setInterval(fetchJobs, 3000);
    return () => clearInterval(interval);
  }, [catalogueId]);

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

  return (
    <Page
      title="Generate catalog images"
      backAction={{ content: 'Products', onAction: () => navigate('/products') }}
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
                      navigate(`/catalog-generate?productId=${p.shopifyProductId}`, {
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

        {productId && (
          <>
            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">
                  Garment image
                </Text>
                <InlineStack gap="200" wrap>
                  {images.map((img) => (
                    <Button
                      key={img.id}
                      pressed={selectedImageSrc === img.src}
                      onClick={() => setSelectedImageSrc(img.src)}
                    >
                      <Thumbnail source={img.src} alt="" size="large" />
                    </Button>
                  ))}
                </InlineStack>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="200">
                <Select label="Gender" options={GENDERS} value={gender} onChange={setGender} />
                <Select
                  label="Garment type"
                  options={[
                    { label: 'Select...', value: '' },
                    ...(options?.garmentTypes.map((g) => ({ label: g.label, value: g.id })) ?? []),
                  ]}
                  value={garmentTypeId}
                  onChange={setGarmentTypeId}
                />
              </BlockStack>
            </Card>

            {options && (
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    Model face
                  </Text>
                  <InlineStack gap="200" wrap>
                    {options.faces.map((f) => (
                      <Button key={f.id} pressed={faceId === f.id} onClick={() => setFaceId(f.id)}>
                        <Thumbnail source={f.thumbnailUrl} alt={f.label} />
                      </Button>
                    ))}
                  </InlineStack>

                  <Text as="h2" variant="headingMd">
                    Background
                  </Text>
                  <InlineStack gap="200" wrap>
                    {options.backgrounds.map((b) => (
                      <Button
                        key={b.id}
                        pressed={backgroundId === b.id}
                        onClick={() => setBackgroundId(b.id)}
                      >
                        <Thumbnail source={b.thumbnailUrl} alt={b.label} />
                      </Button>
                    ))}
                  </InlineStack>

                  <Text as="h2" variant="headingMd">
                    Poses (select one or more)
                  </Text>
                  <InlineStack gap="200" wrap>
                    {options.poses.map((p) => (
                      <Button
                        key={p.id}
                        pressed={selectedLooks.has(p.id)}
                        onClick={() => togglePose(p.id)}
                      >
                        <Thumbnail source={p.thumbnailUrl} alt={p.label} />
                      </Button>
                    ))}
                  </InlineStack>

                  {poseNeedsLower && (
                    <Select
                      label="Lower garment"
                      options={[
                        { label: 'Select...', value: '' },
                        ...options.lowerItems.map((i) => ({ label: i.label, value: i.id })),
                      ]}
                      value={lowerCatalogId}
                      onChange={setLowerCatalogId}
                    />
                  )}
                  {poseNeedsShoes && (
                    <Select
                      label="Shoes"
                      options={[
                        { label: 'Select...', value: '' },
                        ...options.shoeItems.map((i) => ({ label: i.label, value: i.id })),
                      ]}
                      value={shoeCatalogId}
                      onChange={setShoeCatalogId}
                    />
                  )}

                  <Button variant="primary" loading={generating} onClick={generate}>
                    Generate
                  </Button>
                </BlockStack>
              </Card>
            )}
          </>
        )}

        {jobs.length > 0 && (
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Results
              </Text>
              <InlineGrid columns={3} gap="300">
                {jobs.map((j) => (
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
        )}
      </BlockStack>
    </Page>
  );
}
