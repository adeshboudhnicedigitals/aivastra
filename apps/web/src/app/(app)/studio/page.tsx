'use client';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useCallback, useRef, useState } from 'react';
import {
  ArrowLeft,
  CheckIcon,
  ChevronRight,
  ImagePlusIcon,
  LightbulbIcon,
  SearchIcon,
  SparkleIcon,
  SpinnerIcon,
  XIcon,
} from '@/components/icons';
import { StepBar } from '@/components/step-indicator';
import { C, grad } from '@/components/tokens';
import { TopBar } from '@/components/topbar';
import { DarkBtn } from '@/components/ui/dark-btn';
import { GradBtn } from '@/components/ui/grad-btn';
import { api } from '@/lib/api';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface GarmentType {
  id: string;
  slug: string;
  label: string;
  thumbnailUrl?: string | null;
}
interface FaceItem {
  id: string;
  label: string;
  thumbnailUrl: string;
  gender: string;
}
interface BackgroundItem {
  id: string;
  label: string;
  thumbnailUrl: string;
  previewUrl: string;
}
interface BackgroundsResponse {
  items: BackgroundItem[];
}
interface PoseItem {
  id: string;
  label: string;
  thumbnailUrl: string;
  hasLower: boolean;
  hasShoes: boolean;
}
interface CatalogItem {
  id: string;
  label: string;
  thumbnailUrl: string;
}
interface CatalogNode {
  id: number;
  slug: string;
  label: string;
  children: CatalogNode[];
  items: CatalogItem[];
}

function flattenCatalog(nodes: CatalogNode[]): CatalogItem[] {
  return nodes.flatMap((n) => [...n.items, ...flattenCatalog(n.children)]);
}

const GENDERS = [
  { value: 'women', label: 'Women', img: `${BASE}/assets/seg-women.png` },
  { value: 'men', label: 'Men', img: `${BASE}/assets/seg-men.png` },
  { value: 'boys', label: 'Boy', img: `${BASE}/assets/seg-boy.png` },
  { value: 'girls', label: 'Girl', img: `${BASE}/assets/seg-girl.png` },
];
interface BrandConfig {
  ratios: string[];
  default: string;
}
const BRAND_CONFIG: Record<string, BrandConfig> = {
  Amazon: { ratios: ['1:1'], default: '1:1' },
  Flipkart: { ratios: ['1:1', '3:4'], default: '1:1' },
  Myntra: { ratios: ['3:4'], default: '3:4' },
  AJIO: { ratios: ['1:1', '3:4'], default: '3:4' },
  Meesho: { ratios: ['1:1'], default: '1:1' },
  'Nykaa Fashion': { ratios: ['3:4'], default: '3:4' },
  Shopify: { ratios: ['1:1', '4:5', '16:9'], default: '1:1' },
  Etsy: { ratios: ['1:1', '4:5', '3:2'], default: '1:1' },
};
const PLATFORMS = Object.keys(BRAND_CONFIG);
const ALL_ASPECTS = ['1:1', '3:4', '4:5', '3:2', '9:16', '16:9'];
const ASPECT_DIMS: Record<string, string> = {
  '1:1': '1536 × 1536 px',
  '3:4': '1331 × 1774 px',
  '4:5': '1375 × 1718 px',
  '3:2': '2048 × 1365 px',
  '9:16': '1152 × 2048 px',
  '16:9': '2048 × 1152 px',
};
const OUTFIT_IMG: Record<string, string> = {
  kurta: `${BASE}/assets/outfit-kurta.png`,
  saree: `${BASE}/assets/outfit-saree.png`,
  top: `${BASE}/assets/outfit-top.png`,
};

// ── Visual card (gender / outfit) ──
function VisualCard({
  selected,
  onClick,
  img,
  label,
  imgStyle,
}: {
  selected: boolean;
  onClick: () => void;
  img: string | null;
  label: string;
  imgStyle?: React.CSSProperties;
}) {
  return (
    <div onClick={onClick} style={{ cursor: 'pointer', textAlign: 'center', flexShrink: 0 }}>
      <div
        style={{
          width: 108.8,
          height: 109,
          borderRadius: 8,
          overflow: 'hidden',
          position: 'relative',
          border: selected ? '2px solid transparent' : `2px solid ${C.border}`,
          backgroundImage: selected ? 'linear-gradient(90deg, #F55C7A 0%, #F6B553 100%)' : 'none',
          padding: selected ? 2 : 0,
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            width: '100%',
            height: '100%',
            borderRadius: 6,
            overflow: 'hidden',
            background: C.lighter,
          }}
        >
          {img ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={img}
              alt={label}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                objectPosition: 'top center',
                ...imgStyle,
              }}
            />
          ) : (
            <div
              style={{
                width: '100%',
                height: '100%',
                background: C.field,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: C.light,
                fontSize: 11,
              }}
            >
              {label}
            </div>
          )}
        </div>
        {selected && (
          <div
            style={{
              position: 'absolute',
              top: 6,
              right: 6,
              width: 20,
              height: 20,
              borderRadius: '50%',
              background: 'linear-gradient(90deg, #F55C7A 0%, #F6B553 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <CheckIcon color={C.white} size={11} />
          </div>
        )}
      </div>
      <div style={{ fontSize: 12, fontWeight: 500, color: C.text, marginTop: 8 }}>{label}</div>
    </div>
  );
}

// ── Selection card (model / bg / pose / catalog) ──
function SelCard({
  selected,
  onClick,
  imageUrl,
  label,
  w = 130,
  h = 170,
  badges,
}: {
  selected: boolean;
  onClick: () => void;
  imageUrl: string;
  label: string;
  w?: number;
  h?: number;
  badges?: React.ReactNode;
}) {
  return (
    <div onClick={onClick} style={{ cursor: 'pointer', textAlign: 'center', flexShrink: 0 }}>
      <div
        style={{
          width: w,
          height: h,
          borderRadius: 8,
          overflow: 'hidden',
          position: 'relative',
          border: selected ? '2px solid transparent' : `2px solid ${C.border}`,
          background: selected ? 'linear-gradient(90deg, #F55C7A 0%, #F6B553 100%)' : 'transparent',
          padding: selected ? 2 : 0,
          boxSizing: 'border-box',
        }}
        onMouseOver={(e) => {
          const zoom = e.currentTarget.querySelector('[data-zoom]') as HTMLElement;
          if (zoom) zoom.style.transform = 'scale(1.05)';
        }}
        onMouseOut={(e) => {
          const zoom = e.currentTarget.querySelector('[data-zoom]') as HTMLElement;
          if (zoom) zoom.style.transform = 'scale(1)';
        }}
      >
        <div
          style={{
            width: '100%',
            height: '100%',
            borderRadius: 6,
            overflow: 'hidden',
            background: C.lighter,
          }}
        >
          <div data-zoom style={{ width: '100%', height: '100%', transition: 'transform .3s' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl}
              alt={label}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          </div>
        </div>
        {selected && (
          <div
            style={{
              position: 'absolute',
              top: 8,
              right: 8,
              width: 20,
              height: 20,
              borderRadius: '50%',
              background: 'linear-gradient(90deg, #F55C7A 0%, #F6B553 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <CheckIcon color={C.white} size={11} />
          </div>
        )}
        {badges}
      </div>
      <div style={{ fontSize: 12, fontWeight: 500, color: C.text, marginTop: 8 }}>{label}</div>
    </div>
  );
}

function SectionHead({ title }: { title: string }) {
  return (
    <h3 style={{ fontWeight: 700, fontSize: 14, color: C.text, marginBottom: 14 }}>{title}</h3>
  );
}

const pill = (active: boolean): React.CSSProperties => ({
  padding: '7px 14px',
  borderRadius: 8,
  border: `1px solid ${active ? C.pink : C.border2}`,
  background: active ? 'rgba(245,92,122,0.08)' : C.white,
  color: active ? C.pink : C.text,
  fontFamily: 'inherit',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
});
const ghostBtn: React.CSSProperties = {
  padding: '10px 24px',
  borderRadius: 8,
  border: `1px solid ${C.border2}`,
  background: C.white,
  fontFamily: 'inherit',
  fontSize: 14,
  cursor: 'pointer',
  color: C.text,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};

export default function StudioPage(): React.ReactElement {
  const router = useRouter();
  const [step, setStep] = useState(0); // 0..3

  const [gender, setGender] = useState('women');
  const [garmentTypeId, setGarmentTypeId] = useState('');
  const [platform, setPlatform] = useState('Amazon');
  const [aspect, setAspect] = useState(BRAND_CONFIG.Amazon?.default ?? '1:1');

  const brandAspects = BRAND_CONFIG[platform]?.ratios ?? ALL_ASPECTS;

  const handlePlatformChange = (p: string) => {
    setPlatform(p);
    const cfg = BRAND_CONFIG[p];
    if (cfg) setAspect(cfg.default);
  };
  const [garmentFile, setGarmentFile] = useState<File | null>(null);
  const [garmentKey, setGarmentKey] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [modelFilter, setModelFilter] = useState('All');
  const [faceId, setFaceId] = useState('');
  const [backgroundId, setBackgroundId] = useState('');
  const [poseIds, setPoseIds] = useState<string[]>([]);
  const [lowerCatalogId, setLowerCatalogId] = useState('');
  const [shoeCatalogId, setShoeCatalogId] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [toast, setToast] = useState('');
  const showToast = useCallback((m: string) => {
    setToast(m);
    setTimeout(() => setToast(''), 1800);
  }, []);

  const { data: garmentTypes } = useQuery<{ items: GarmentType[] }>({
    queryKey: ['garmentTypes', gender],
    queryFn: () => api.get(`/v1/models/garment-types?gender=${gender}`),
    enabled: !!gender,
  });
  const { data: faces } = useQuery<{ items: FaceItem[] }>({
    queryKey: ['faces', gender, garmentTypeId],
    queryFn: () => {
      const p = new URLSearchParams({ gender });
      if (garmentTypeId) p.set('garmentTypeId', garmentTypeId);
      return api.get(`/v1/models/faces?${p}`);
    },
    enabled: !!gender && step >= 1,
  });
  const { data: backgrounds } = useQuery<BackgroundsResponse>({
    queryKey: ['backgrounds', faceId, garmentTypeId],
    queryFn: () => {
      const p = new URLSearchParams();
      if (faceId) p.set('faceId', faceId);
      if (garmentTypeId) p.set('garmentTypeId', garmentTypeId);
      return api.get(`/v1/models/backgrounds?${p}`);
    },
    enabled: !!faceId && step >= 2,
  });
  const { data: poses } = useQuery<{ items: PoseItem[] }>({
    queryKey: ['poses', garmentTypeId, faceId, backgroundId],
    queryFn: () =>
      api.get(
        `/v1/models/poses?garmentTypeId=${garmentTypeId}&faceId=${faceId}&backgroundId=${backgroundId}`,
      ),
    enabled: !!(garmentTypeId && faceId && backgroundId && step >= 3),
  });

  const selectedPoses = poses?.items.filter((p) => poseIds.includes(p.id)) ?? [];
  const needsLower = selectedPoses.some((p) => p.hasLower);
  const needsShoes = selectedPoses.some((p) => p.hasShoes);

  const poseIdsParam = poseIds.length > 0 ? `poseIds=${poseIds.join(',')}` : '';
  const { data: lowerCatalog } = useQuery<{ type: string; tree: CatalogNode[] }>({
    queryKey: ['catalog', 'lower', gender, poseIds.join(',')],
    queryFn: () =>
      api.get(
        `/v1/catalog/lower?${[poseIdsParam, gender ? `gender=${gender}` : ''].filter(Boolean).join('&')}`,
      ),
    enabled: step >= 3 && needsLower,
  });
  const { data: shoesCatalog } = useQuery<{ type: string; tree: CatalogNode[] }>({
    queryKey: ['catalog', 'shoe', gender, poseIds.join(',')],
    queryFn: () =>
      api.get(
        `/v1/catalog/shoe?${[poseIdsParam, gender ? `gender=${gender}` : ''].filter(Boolean).join('&')}`,
      ),
    enabled: step >= 3 && needsShoes,
  });
  const lowerItems = lowerCatalog ? flattenCatalog(lowerCatalog.tree) : [];
  const shoeItems = shoesCatalog ? flattenCatalog(shoesCatalog.tree) : [];

  async function handleGarmentUpload(file: File) {
    setGarmentFile(file);
    setIsUploading(true);
    setUploadProgress(0);
    try {
      const { uploadUrl, r2Key } = await api.post<{
        uploadUrl: string;
        r2Key: string;
        expiresIn: number;
      }>('/v1/uploads/presign', { contentType: file.type, contentLength: file.size });
      await api.uploadToR2WithProgress(uploadUrl, file, setUploadProgress);
      setGarmentKey(r2Key);
    } catch (e) {
      showToast(`Upload failed: ${(e as Error).message}`);
      setGarmentFile(null);
    } finally {
      setIsUploading(false);
    }
  }

  function handleFaceSelect(id: string) {
    setFaceId(id);
    setBackgroundId('');
    setPoseIds([]);
    setLowerCatalogId('');
    setShoeCatalogId('');
  }
  function handleBackgroundSelect(id: string) {
    setBackgroundId(id);
    setPoseIds([]);
    setLowerCatalogId('');
    setShoeCatalogId('');
  }
  function handlePoseSelect(id: string) {
    setPoseIds((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
    setLowerCatalogId('');
    setShoeCatalogId('');
  }

  async function handleSubmit() {
    if (!garmentKey || !faceId || !backgroundId || poseIds.length === 0) return;
    setIsSubmitting(true);
    setSubmitError('');
    try {
      const { catalogueId } = await api.post<{ catalogueId: string }>('/v1/jobs/tryon', {
        inputs: {
          upperGarmentKey: garmentKey,
          faceId,
          backgroundId,
          poseIds,
          lowerCatalogId: lowerCatalogId || undefined,
          shoeCatalogId: shoeCatalogId || undefined,
        },
        aspectRatio: aspect,
      });
      router.push(`/catalogues/${catalogueId}`);
    } catch (e) {
      setSubmitError((e as Error).message);
      setIsSubmitting(false);
    }
  }

  const canNext = (): boolean => {
    if (step === 0) return !!gender && !!garmentTypeId && (!!garmentFile || !!garmentKey);
    if (step === 1) return !!faceId;
    if (step === 2) return !!backgroundId;
    return true;
  };
  const canGenerate = poseIds.length > 0 && !!garmentKey && !isUploading && !isSubmitting;

  function goNext() {
    if (step < 3) setStep((s) => s + 1);
  }
  function goBack() {
    if (step > 0) setStep((s) => s - 1);
  }
  function reset() {
    setGender('');
    setGarmentTypeId('');
    setFaceId('');
    setBackgroundId('');
    setPoseIds([]);
    setLowerCatalogId('');
    setShoeCatalogId('');
    setGarmentFile(null);
    setGarmentKey('');
    setStep(0);
    showToast('Setup reset');
  }

  const credits = poseIds.length;
  const visibleStep = step + 1; // 0..3 → 1..4

  return (
    <>
      <TopBar
        title="Create Catalogue"
        subtitle="Create premium AI catalogue shoots from flat lay garments in minutes."
        right={<StepBar step={visibleStep} />}
      />
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: '24px 28px',
          display: 'flex',
          flexDirection: 'column',
          gap: 28,
        }}
      >
        {/* ── Step 0: Setup ── */}
        {step === 0 && (
          <>
            <section>
              <SectionHead title="Catalogue For" />
              <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                {GENDERS.map((g) => (
                  <VisualCard
                    key={g.value}
                    img={g.img}
                    label={g.label}
                    selected={gender === g.value}
                    onClick={() => {
                      setGender(g.value);
                      setGarmentTypeId('');
                    }}
                    imgStyle={{ transform: 'scale(2.5)', transformOrigin: 'top center' }}
                  />
                ))}
              </div>
            </section>

            <section>
              <SectionHead title="Garment Type" />
              {!gender ? (
                <p style={{ fontSize: 13, color: C.mid }}>Select a segment first.</p>
              ) : !garmentTypes ? (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 13,
                    color: C.mid,
                  }}
                >
                  <SpinnerIcon size={16} /> Loading…
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  {garmentTypes.items.map((s) => {
                    // Use DB thumbnail if available, fall back to static OUTFIT_IMG map
                    const fallbackKey = Object.keys(OUTFIT_IMG).find(
                      (k) => s.slug.toLowerCase().includes(k) || s.label.toLowerCase().includes(k),
                    );
                    const img = s.thumbnailUrl ?? (fallbackKey ? OUTFIT_IMG[fallbackKey]! : null);
                    return (
                      <VisualCard
                        key={s.id}
                        img={img}
                        label={s.label}
                        selected={garmentTypeId === s.id}
                        onClick={() => setGarmentTypeId(garmentTypeId === s.id ? '' : s.id)}
                      />
                    );
                  })}
                </div>
              )}
            </section>

            <div style={{ display: 'flex', gap: 40, flexWrap: 'wrap' }}>
              <section style={{ flex: 1, minWidth: 280 }}>
                <SectionHead title="Publishing Platform" />
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {PLATFORMS.map((p) => (
                    <button
                      key={p}
                      onClick={() => handlePlatformChange(p)}
                      style={pill(platform === p)}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </section>
              <section style={{ flex: 1, minWidth: 200 }}>
                <SectionHead title="Aspect Ratio" />
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {brandAspects.map((r) => (
                    <button key={r} onClick={() => setAspect(r)} style={pill(aspect === r)}>
                      {r}
                    </button>
                  ))}
                </div>
                <div style={{ marginTop: 8, fontSize: 11, color: C.light }}>
                  {ASPECT_DIMS[aspect]}
                </div>
              </section>
            </div>

            <section>
              <SectionHead title="Upload Garment Image" />
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div
                  style={{
                    width: 560,
                    height: 238,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: '#F9F9F9',
                    borderRadius: 12,
                    border: '1px dashed #B1B1B1',
                    padding: '0 10px',
                    boxSizing: 'border-box',
                  }}
                >
                  <label
                    style={{
                      width: 265,
                      height: 210,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 12,
                      background: '#FEFEFE',
                      border: '1px solid #EEEEEE',
                      borderRadius: 8,
                      padding: 12,
                      cursor: 'pointer',
                      boxSizing: 'border-box',
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const f = e.dataTransfer.files?.[0];
                      if (f && ['image/jpeg', 'image/png', 'image/webp'].includes(f.type))
                        handleGarmentUpload(f);
                    }}
                  >
                    {garmentFile ? (
                      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={URL.createObjectURL(garmentFile)}
                          alt={garmentFile.name}
                          style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                            borderRadius: 6,
                          }}
                        />
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            setGarmentFile(null);
                            setGarmentKey('');
                          }}
                          style={{
                            position: 'absolute',
                            top: 6,
                            right: 6,
                            width: 24,
                            height: 24,
                            borderRadius: '50%',
                            background: 'rgba(0,0,0,0.5)',
                            border: 'none',
                            color: 'white',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <XIcon size={14} />
                        </button>
                        {isUploading && (
                          <div
                            style={{
                              position: 'absolute',
                              bottom: 8,
                              left: 8,
                              right: 8,
                              background: 'rgba(255,255,255,0.95)',
                              borderRadius: 8,
                              padding: '6px 10px',
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                fontSize: 12,
                                color: C.text,
                              }}
                            >
                              <SpinnerIcon size={14} /> {uploadProgress}%
                            </div>
                            <div
                              style={{
                                marginTop: 4,
                                height: 4,
                                borderRadius: 99,
                                background: C.border,
                                overflow: 'hidden',
                              }}
                            >
                              <div
                                style={{
                                  height: '100%',
                                  width: `${uploadProgress}%`,
                                  background: grad,
                                  borderRadius: 99,
                                  transition: 'width .3s',
                                }}
                              />
                            </div>
                          </div>
                        )}
                        {garmentKey && (
                          <div
                            style={{
                              position: 'absolute',
                              top: 8,
                              left: 8,
                              background: C.mint,
                              color: 'white',
                              borderRadius: 6,
                              padding: '3px 8px',
                              fontSize: 11,
                              fontWeight: 600,
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                            }}
                          >
                            <CheckIcon color="#fff" size={10} /> Uploaded
                          </div>
                        )}
                      </div>
                    ) : (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`${BASE}/assets/upperGarmentRef.png`}
                          alt="Upper garment reference"
                          style={{ width: 92, height: 92, borderRadius: 8, objectFit: 'cover' }}
                        />
                        <span
                          style={{
                            width: 241,
                            height: 18,
                            fontSize: 12,
                            fontWeight: 500,
                            lineHeight: '100%',
                            color: '#141414',
                            textAlign: 'center',
                          }}
                        >
                          Upload Top Wear
                        </span>
                        <span
                          style={{
                            width: 241,
                            height: 30,
                            fontSize: 10,
                            fontWeight: 500,
                            lineHeight: '100%',
                            color: '#939393',
                            textAlign: 'center',
                          }}
                        >
                          Drag and drop an image here · JPG, PNG · Max 10MB
                        </span>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            width: 110,
                            height: 18,
                          }}
                        >
                          <ImagePlusIcon size={16} />
                          <span
                            style={{
                              fontSize: 12,
                              fontWeight: 500,
                              lineHeight: '18px',
                              color: '#141414',
                              textAlign: 'center',
                            }}
                          >
                            Browse Image
                          </span>
                        </div>
                      </>
                    )}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleGarmentUpload(f);
                      }}
                    />
                  </label>
                </div>
                <div
                  style={{
                    width: 560,
                    height: 238,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    background: '#FEFEFE',
                    borderRadius: 12,
                    border: '1px solid #EEEEEE',
                    padding: 16,
                    boxSizing: 'border-box',
                  }}
                >
                  <div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 4,
                        width: 528,
                        height: 18,
                        marginBottom: 12,
                      }}
                    >
                      <span style={{ display: 'flex', color: C.text }}>
                        <LightbulbIcon size={14} />
                      </span>
                      <span
                        style={{ fontSize: 12, fontWeight: 500, lineHeight: '100%', color: C.text }}
                      >
                        Use clean flat lay images for best AI catalogue results.
                      </span>
                    </div>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`${BASE}/assets/instructions.png`}
                      alt="Garment guidelines"
                      style={{ width: '100%', height: 173, objectFit: 'contain', borderRadius: 8 }}
                    />
                  </div>
                </div>
              </div>
            </section>
          </>
        )}

        {/* ── Step 1: Model ── */}
        {step === 1 && (
          <section>
            <SectionHead title="Choose your model" />
            {faces && faces.items.length > 0 && (
              <div
                style={{
                  display: 'flex',
                  gap: 10,
                  flexWrap: 'wrap',
                  marginBottom: 16,
                  alignItems: 'center',
                }}
              >
                {['All', ...Array.from(new Set(faces.items.map((f) => f.gender)))].map((f) => (
                  <button
                    key={f}
                    onClick={() => setModelFilter(f)}
                    style={{
                      padding: '7px 16px',
                      borderRadius: 8,
                      border: 'none',
                      background: modelFilter === f ? C.text : C.white,
                      color: modelFilter === f ? C.white : C.text,
                      fontFamily: 'inherit',
                      fontSize: 13,
                      fontWeight: 500,
                      cursor: 'pointer',
                      boxShadow: modelFilter === f ? 'none' : `0 0 0 1px ${C.border2}`,
                    }}
                  >
                    {f === 'All' ? `All (${faces.items.length})` : f}
                  </button>
                ))}
                <div style={{ marginLeft: 'auto', position: 'relative' }}>
                  <span
                    style={{
                      position: 'absolute',
                      left: 10,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      color: C.mid,
                    }}
                  >
                    <SearchIcon />
                  </span>
                  <input
                    placeholder="Search models..."
                    style={{
                      paddingLeft: 34,
                      height: 36,
                      borderRadius: 8,
                      border: `1px solid ${C.border2}`,
                      fontFamily: 'inherit',
                      fontSize: 13,
                      outline: 'none',
                      background: C.white,
                      width: 200,
                    }}
                  />
                </div>
              </div>
            )}
            {!faces ? (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'center',
                  padding: '32px 0',
                  color: C.mid,
                }}
              >
                <SpinnerIcon />
              </div>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, 215.2px)',
                  gap: 16,
                  width: '100%',
                }}
              >
                {faces.items
                  .filter((f) => modelFilter === 'All' || f.gender === modelFilter)
                  .map((f) => (
                    <SelCard
                      key={f.id}
                      selected={faceId === f.id}
                      onClick={() => handleFaceSelect(f.id)}
                      imageUrl={f.thumbnailUrl}
                      label={f.label}
                      w={215.2}
                      h={212.67}
                    />
                  ))}
              </div>
            )}
          </section>
        )}

        {/* ── Step 2: Background ── */}
        {step === 2 && (
          <section>
            <SectionHead title="Select Background" />
            {!backgrounds ? (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'center',
                  padding: '32px 0',
                  color: C.mid,
                }}
              >
                <SpinnerIcon />
              </div>
            ) : backgrounds.items.length === 0 ? (
              <p style={{ fontSize: 14, color: C.mid }}>
                No backgrounds available for this model yet. Try a different model.
              </p>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, 215.2px)',
                  gap: 16,
                  width: '100%',
                }}
              >
                {backgrounds.items.map((b) => (
                  <SelCard
                    key={b.id}
                    selected={backgroundId === b.id}
                    onClick={() => handleBackgroundSelect(b.id)}
                    imageUrl={b.previewUrl || b.thumbnailUrl}
                    label={b.label}
                    w={215.2}
                    h={212.67}
                  />
                ))}
              </div>
            )}
          </section>
        )}

        {/* ── Step 3: Poses ── */}
        {step === 3 && (
          <>
            <section>
              <SectionHead title="Choose Poses" />
              {!poses ? (
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'center',
                    padding: '32px 0',
                    color: C.mid,
                  }}
                >
                  <SpinnerIcon />
                </div>
              ) : poses.items.length === 0 ? (
                <p style={{ fontSize: 14, color: C.mid }}>
                  No poses for this combination. Go back and try a different background.
                </p>
              ) : (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, 215.2px)',
                    gap: 8,
                    width: '100%',
                  }}
                >
                  {poses.items.map((p) => (
                    <SelCard
                      key={p.id}
                      selected={poseIds.includes(p.id)}
                      onClick={() => handlePoseSelect(p.id)}
                      imageUrl={p.thumbnailUrl}
                      label={p.label}
                      w={215.2}
                      h={282}
                    />
                  ))}
                </div>
              )}
            </section>

            <section>
              <SectionHead title="Lower Garment" />
              <p style={{ fontSize: 12, color: C.mid, marginTop: -10, marginBottom: 12 }}>
                Optional — select if your pose shows lower body
              </p>
              {!lowerCatalog ? (
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'center',
                    padding: '24px 0',
                    color: C.mid,
                  }}
                >
                  <SpinnerIcon />
                </div>
              ) : lowerItems.length === 0 ? (
                <p style={{ fontSize: 14, color: C.mid }}>
                  No lower garment options available yet.
                </p>
              ) : (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, 152.57px)',
                    gap: 12,
                    width: '100%',
                  }}
                >
                  {lowerItems.map((i) => (
                    <SelCard
                      key={i.id}
                      selected={lowerCatalogId === i.id}
                      onClick={() => setLowerCatalogId(lowerCatalogId === i.id ? '' : i.id)}
                      imageUrl={i.thumbnailUrl}
                      label={i.label}
                      w={152.57}
                      h={119}
                    />
                  ))}
                </div>
              )}
            </section>

            <section>
              <SectionHead title="Shoes" />
              <p style={{ fontSize: 12, color: C.mid, marginTop: -10, marginBottom: 12 }}>
                Optional — select if your pose shows feet
              </p>
              {!shoesCatalog ? (
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'center',
                    padding: '24px 0',
                    color: C.mid,
                  }}
                >
                  <SpinnerIcon />
                </div>
              ) : shoeItems.length === 0 ? (
                <p style={{ fontSize: 14, color: C.mid }}>No shoe options available yet.</p>
              ) : (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, 152.57px)',
                    gap: 12,
                    width: '100%',
                  }}
                >
                  {shoeItems.map((i) => (
                    <SelCard
                      key={i.id}
                      selected={shoeCatalogId === i.id}
                      onClick={() => setShoeCatalogId(shoeCatalogId === i.id ? '' : i.id)}
                      imageUrl={i.thumbnailUrl}
                      label={i.label}
                      w={152.57}
                      h={119}
                    />
                  ))}
                </div>
              )}
            </section>
          </>
        )}

        {step === 3 && submitError && (
          <div
            style={{
              padding: '10px 14px',
              borderRadius: 10,
              border: `1px solid ${C.pink}`,
              background: 'rgba(245,92,122,0.06)',
              fontSize: 14,
              color: C.pink,
            }}
          >
            {submitError}
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        style={{
          borderTop: `1px solid ${C.border}`,
          padding: '16px 28px',
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'center',
          gap: 12,
          background: C.white,
          flexShrink: 0,
        }}
      >
        {step === 1 && (
          <span style={{ fontSize: 13, color: C.mid, marginRight: 4 }}>
            {faceId ? '1 model selected' : 'No model selected'}
          </span>
        )}
        {step === 2 && (
          <span style={{ fontSize: 13, color: C.mid, marginRight: 4 }}>
            {backgroundId ? '1 background selected' : 'No background selected'}
          </span>
        )}
        {step === 3 && (
          <span style={{ fontSize: 13, color: C.mid, marginRight: 4 }}>
            {poseIds.length} pose{poseIds.length !== 1 ? 's' : ''} selected
          </span>
        )}
        <button
          onClick={reset}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            width: 85,
            height: 44,
            borderRadius: 8,
            border: `1px solid ${C.border}`,
            background: C.field,
            padding: '12px 20px',
            fontFamily: 'var(--font-poppins), Poppins, sans-serif',
            fontWeight: 600,
            fontSize: 16,
            lineHeight: '20px',
            color: C.mid,
            cursor: 'pointer',
            textAlign: 'center',
          }}
        >
          Reset
        </button>
        <button
          onClick={goBack}
          disabled={step === 0}
          style={{ ...ghostBtn, opacity: step === 0 ? 0.3 : 1 }}
        >
          <ArrowLeft /> Back
        </button>
        {step < 3 ? (
          <DarkBtn onClick={goNext} disabled={!canNext()} style={{ padding: '10px 24px', gap: 8 }}>
            Next Step <ChevronRight />
          </DarkBtn>
        ) : (
          <GradBtn
            onClick={handleSubmit}
            disabled={!canGenerate}
            style={{ padding: '10px 28px', gap: 8, fontSize: 15 }}
          >
            {isSubmitting ? (
              <>
                <SpinnerIcon size={16} /> Generating…
              </>
            ) : isUploading ? (
              <>
                <SpinnerIcon size={16} /> Uploading…
              </>
            ) : (
              <>
                <SparkleIcon /> Generate Catalogue ({credits} credits)
              </>
            )}
          </GradBtn>
        )}
      </div>

      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            background: C.dark,
            color: C.white,
            padding: '10px 20px',
            borderRadius: 8,
            fontSize: 13,
            zIndex: 1000,
          }}
        >
          {toast}
        </div>
      )}
    </>
  );
}
