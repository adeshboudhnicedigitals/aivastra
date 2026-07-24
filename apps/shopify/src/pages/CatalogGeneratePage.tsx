import type { CSSProperties, ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CatalogJobThumb } from '../components/CatalogJobThumb';
import { CheckIcon, SpinnerIcon } from '../components/icons';
import { PageHeader } from '../components/PageHeader';
import { ProductPickerGrid } from '../components/ProductPickerGrid';
import { apiFetch } from '../lib/api';
import { BRAND } from '../theme';
import type {
  CatalogGenerateJob,
  CatalogOptions,
  ShopifyProductImage,
  ShopifyProductListItem,
} from '../types';

const THUMB_PAGE_SIZE = 14;

const GENDERS = [
  { label: 'Women', value: 'women' },
  { label: 'Men', value: 'men' },
  { label: 'Girls', value: 'girls' },
  { label: 'Boys', value: 'boys' },
];

const cardStyle: CSSProperties = {
  background: '#fff',
  border: `1px solid ${BRAND.border}`,
  borderRadius: '16px',
  padding: '20px',
};

const sectionLabelStyle: CSSProperties = {
  fontSize: '13.5px',
  fontWeight: 700,
  color: BRAND.ink,
  marginBottom: '10px',
};

const selectStyle: CSSProperties = {
  height: '38px',
  border: `1px solid ${BRAND.borderInput}`,
  borderRadius: '10px',
  padding: '0 12px',
  fontSize: '13.5px',
  color: BRAND.ink,
  background: '#fff',
  cursor: 'pointer',
};

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <label htmlFor={id} style={{ fontSize: '12.5px', fontWeight: 600, color: BRAND.textMuted }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function SelectableThumb({
  src,
  alt,
  selected,
  onClick,
  size = 132,
  aspectRatio = '1',
}: {
  src: string;
  alt: string;
  selected: boolean;
  onClick: () => void;
  size?: number;
  aspectRatio?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={alt}
      style={{
        position: 'relative',
        width: `${size}px`,
        aspectRatio,
        padding: 0,
        borderRadius: '12px',
        overflow: 'hidden',
        cursor: 'pointer',
        flexShrink: 0,
        background: '#F1F0F5',
        border: selected ? `2px solid ${BRAND.purple}` : `1px solid ${BRAND.border}`,
        boxShadow: selected ? `0 0 0 3px ${BRAND.purpleTint}` : 'none',
      }}
    >
      {/* biome-ignore lint/performance/noImgElement: dynamic remote thumbnail */}
      <img src={src} alt={alt} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      {selected && (
        <span
          style={{
            position: 'absolute',
            top: '4px',
            right: '4px',
            width: '18px',
            height: '18px',
            borderRadius: '50%',
            background: BRAND.purple,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <CheckIcon size={11} color="#fff" strokeWidth={3} />
        </span>
      )}
    </button>
  );
}

function ThumbRow<T extends { id: string; label: string; thumbnailUrl: string }>({
  items,
  isSelected,
  onSelect,
  aspectRatio = '1',
}: {
  items: T[];
  isSelected: (item: T) => boolean;
  onSelect: (item: T) => void;
  aspectRatio?: string;
}) {
  const [visibleCount, setVisibleCount] = useState(THUMB_PAGE_SIZE);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset the page on a genuinely new item list, not every render
  useEffect(() => {
    setVisibleCount(THUMB_PAGE_SIZE);
  }, [items]);

  const visible = items.slice(0, visibleCount);
  const remaining = items.length - visible.length;

  return (
    <>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, 132px)',
          gap: '16px',
          alignItems: 'start',
        }}
      >
        {visible.map((item) => (
          <SelectableThumb
            key={item.id}
            src={item.thumbnailUrl}
            alt={item.label}
            selected={isSelected(item)}
            onClick={() => onSelect(item)}
            aspectRatio={aspectRatio}
          />
        ))}
      </div>
      {remaining > 0 && (
        <button
          type="button"
          onClick={() => setVisibleCount((n) => n + THUMB_PAGE_SIZE)}
          style={{
            marginTop: '10px',
            border: 'none',
            background: 'none',
            color: BRAND.purple,
            fontSize: '12.5px',
            fontWeight: 600,
            cursor: 'pointer',
            padding: 0,
          }}
        >
          Load {Math.min(remaining, THUMB_PAGE_SIZE)} more
        </button>
      )}
    </>
  );
}

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
    <div>
      <PageHeader title="Generate catalog images" backTo="/products" backLabel="Products" />

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
          <div style={cardStyle}>
            <div style={sectionLabelStyle}>Choose a product</div>
            <ProductPickerGrid
              loading={pickerLoading}
              products={pickerProducts}
              onPick={(id) => navigate(`/catalog-generate?productId=${id}`, { replace: true })}
            />
          </div>
        )}

        {productId && (
          <>
            <div style={cardStyle}>
              <div style={sectionLabelStyle}>Garment image</div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, 132px)',
                  gap: '16px',
                  alignItems: 'start',
                }}
              >
                {images.map((img) => (
                  <SelectableThumb
                    key={img.id}
                    src={img.src}
                    alt=""
                    selected={selectedImageSrc === img.src}
                    onClick={() => setSelectedImageSrc(img.src)}
                  />
                ))}
              </div>
            </div>

            <div style={cardStyle}>
              <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                <Field id="catalog-gen-gender" label="Gender">
                  <select
                    id="catalog-gen-gender"
                    value={gender}
                    onChange={(e) => setGender(e.target.value)}
                    style={{ ...selectStyle, minWidth: '160px' }}
                  >
                    {GENDERS.map((g) => (
                      <option key={g.value} value={g.value}>
                        {g.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field id="catalog-gen-garment-type" label="Garment type">
                  <select
                    id="catalog-gen-garment-type"
                    value={garmentTypeId}
                    onChange={(e) => setGarmentTypeId(e.target.value)}
                    style={{ ...selectStyle, minWidth: '200px' }}
                  >
                    <option value="">Select…</option>
                    {options?.garmentTypes.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            </div>

            {options && (
              <div style={cardStyle}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  <div>
                    <div style={sectionLabelStyle}>Model face</div>
                    <ThumbRow
                      items={options.faces}
                      isSelected={(f) => faceId === f.id}
                      onSelect={(f) => setFaceId(f.id)}
                    />
                  </div>

                  <div>
                    <div style={sectionLabelStyle}>Background</div>
                    <ThumbRow
                      items={options.backgrounds}
                      isSelected={(b) => backgroundId === b.id}
                      onSelect={(b) => setBackgroundId(b.id)}
                    />
                  </div>

                  <div>
                    <div style={sectionLabelStyle}>Poses (select one or more)</div>
                    <ThumbRow
                      items={options.poses}
                      isSelected={(p) => selectedLooks.has(p.id)}
                      onSelect={(p) => togglePose(p.id)}
                      aspectRatio="3 / 4"
                    />
                  </div>

                  {poseNeedsLower && (
                    <div>
                      <div style={sectionLabelStyle}>Lower garment</div>
                      <ThumbRow
                        items={options.lowerItems}
                        isSelected={(i) => lowerCatalogId === i.id}
                        onSelect={(i) => setLowerCatalogId(i.id)}
                      />
                    </div>
                  )}

                  {poseNeedsShoes && (
                    <div>
                      <div style={sectionLabelStyle}>Shoes</div>
                      <ThumbRow
                        items={options.shoeItems}
                        isSelected={(i) => shoeCatalogId === i.id}
                        onSelect={(i) => setShoeCatalogId(i.id)}
                      />
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={generate}
                    disabled={generating}
                    style={{
                      alignSelf: 'flex-start',
                      height: '40px',
                      padding: '0 22px',
                      border: 'none',
                      borderRadius: '10px',
                      background: BRAND.buttonGradient,
                      color: '#fff',
                      fontSize: '13.5px',
                      fontWeight: 700,
                      cursor: generating ? 'default' : 'pointer',
                      opacity: generating ? 0.7 : 1,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '8px',
                    }}
                  >
                    {generating && <SpinnerIcon size={14} color="#fff" />}
                    {generating ? 'Generating…' : 'Generate'}
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {jobs.length > 0 && (
          <div style={cardStyle}>
            <div style={sectionLabelStyle}>Results</div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                gap: '16px',
              }}
            >
              {jobs.map((j) => (
                <CatalogJobThumb key={j.jobId} job={j} onPublish={publish} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
