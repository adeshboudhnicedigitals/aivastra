'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckIcon,
  ImagePlusIcon,
  LightbulbIcon,
  SparkleIcon,
  SpinnerIcon,
  XIcon,
} from '@/components/icons';
import { C, grad } from '@/components/tokens';
import { TopBar } from '@/components/topbar';
import { ErrorState } from '@/components/ui/error-state';
import { GradBtn } from '@/components/ui/grad-btn';
import { Tooltip } from '@/components/ui/tooltip';
import { api } from '@/lib/api';
import type { GenerationJob } from './generation-panel';
import { PreviewPanel } from './preview-panel';
import { SelectGridModal } from './select-modal';
import { useVisibleCount } from './use-visible-count';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface GarmentType {
  id: string;
  slug: string;
  label: string;
  thumbnailUrl?: string | null;
  requiresLowerUpload: boolean;
  defaultLowerCatalogId?: string | null;
  defaultShoeCatalogId?: string | null;
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
  isWhiteBg?: boolean;
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
  thumbnailUrl?: string | null;
  children: CatalogNode[];
  items: CatalogItem[];
}

function flattenNode(node: CatalogNode): CatalogItem[] {
  return [...node.items, ...node.children.flatMap((c) => flattenNode(c))];
}

function findNodeForItem(tree: CatalogNode[], itemId: string): CatalogNode | null {
  for (const node of tree) {
    if (flattenNode(node).some((i) => i.id === itemId)) return node;
  }
  return null;
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
  Amazon: { ratios: ['1:1', '2:3'], default: '1:1' },
  Flipkart: { ratios: ['1:1', '2:3', '3:4'], default: '1:1' },
  Myntra: { ratios: ['2:3', '3:4'], default: '3:4' },
  AJIO: { ratios: ['1:1', '2:3', '3:4'], default: '3:4' },
  Meesho: { ratios: ['1:1', '2:3'], default: '1:1' },
  'Nykaa Fashion': { ratios: ['2:3', '3:4'], default: '3:4' },
  Shopify: { ratios: ['1:1', '2:3', '4:5'], default: '1:1' },
};
const PLATFORMS = Object.keys(BRAND_CONFIG);
const ALL_ASPECTS = ['1:1', '2:3', '3:4', '4:5'];
const ASPECT_DIMS: Record<string, string> = {
  '1:1': '2048 × 2048 px',
  '2:3': '1365 × 2048 px',
  '3:4': '1331 × 1774 px',
  '4:5': '1375 × 1718 px',
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
      {label && (
        <div style={{ fontSize: 12, fontWeight: 500, color: C.text, marginTop: 8 }}>{label}</div>
      )}
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
  imageUrl?: string | null;
  label?: string;
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
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {imageUrl ? (
            <div data-zoom style={{ width: '100%', height: '100%', transition: 'transform .3s' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageUrl}
                alt={label}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            </div>
          ) : (
            <span
              style={{
                fontSize: 28,
                fontWeight: 700,
                color: C.mid,
                textTransform: 'uppercase',
                lineHeight: 1,
              }}
            >
              {label?.charAt(0)}
            </span>
          )}
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
export default function StudioPage(): React.ReactElement {
  const router = useRouter();
  const qc = useQueryClient();
  const [gender, setGender] = useState('women');
  const [garmentTypeId, setGarmentTypeId] = useState('');
  const [garmentModalOpen, setGarmentModalOpen] = useState(false);
  const [platform, setPlatform] = useState('Amazon');
  const [aspect, setAspect] = useState(BRAND_CONFIG.Amazon?.default ?? '1:1');
  const [amazonPoseModalOpen, setAmazonPoseModalOpen] = useState(false);
  const [amazonMainPoseId, setAmazonMainPoseId] = useState('');
  const [amazonUseWhiteBg, setAmazonUseWhiteBg] = useState(true);

  const brandAspects = BRAND_CONFIG[platform]?.ratios ?? ALL_ASPECTS;

  const handlePlatformChange = (p: string) => {
    setPlatform(p);
    const cfg = BRAND_CONFIG[p];
    if (cfg) setAspect(cfg.default);
    if (p === 'Amazon') setAmazonUseWhiteBg(true);
  };
  const [garmentFile, setGarmentFile] = useState<File | null>(null);
  const [garmentKey, setGarmentKey] = useState('');
  const [lowerGarmentFile, setLowerGarmentFile] = useState<File | null>(null);
  const [lowerGarmentKey, setLowerGarmentKey] = useState('');
  const [isUploadingLower, setIsUploadingLower] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lowerFileInputRef = useRef<HTMLInputElement>(null);
  const { visibleCount: garmentVisibleCount, rowRef: garmentRowRef } = useVisibleCount(108.8, 20);
  const { visibleCount: modelVisibleCount, rowRef: modelRowRef } = useVisibleCount(215.2, 16);
  const [modelModalOpen, setModelModalOpen] = useState(false);
  const { visibleCount: backgroundVisibleCount, rowRef: backgroundRowRef } = useVisibleCount(
    215.2,
    16,
  );
  const [backgroundModalOpen, setBackgroundModalOpen] = useState(false);
  const { visibleCount: poseVisibleCount, rowRef: poseRowRef } = useVisibleCount(215.2, 8);
  const [poseModalOpen, setPoseModalOpen] = useState(false);

  const [faceId, setFaceId] = useState('');
  const [backgroundId, setBackgroundId] = useState('');
  const [poseIds, setPoseIds] = useState<string[]>([]);
  const [lowerCatalogId, setLowerCatalogId] = useState('');
  const [shoeCatalogId, setShoeCatalogId] = useState('');
  const [lowerCatModal, setLowerCatModal] = useState<CatalogNode | null>(null);
  const [shoeCatModal, setShoeCatModal] = useState<CatalogNode | null>(null);
  const [resolution, setResolution] = useState<'HD' | '2K' | '4K' | ''>('');
  useEffect(() => {
    if (!resolution) {
      setResolution('HD');
    }
  }, [resolution]);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [activeGeneration, setActiveGeneration] = useState<{
    catalogueId: string;
    jobs: GenerationJob[];
  } | null>(null);
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
  const didAutoGarment = useRef('');
  useEffect(() => {
    if (garmentTypes?.items?.length && !garmentTypeId && didAutoGarment.current !== gender) {
      setGarmentTypeId(garmentTypes.items[0]?.id ?? '');
      didAutoGarment.current = gender;
    }
  }, [garmentTypes, garmentTypeId, gender]);
  const {
    data: faces,
    isError: facesError,
    refetch: refetchFaces,
  } = useQuery<{ items: FaceItem[] }>({
    queryKey: ['faces', gender],
    queryFn: () => api.get(`/v1/models/faces?gender=${gender}`),
    enabled: !!gender,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
  const filteredFaces = useMemo(() => faces?.items ?? [], [faces?.items]);
  useEffect(() => {
    if (!filteredFaces.length) return;
    if (!filteredFaces.some((f) => f.id === faceId)) {
      setFaceId(filteredFaces[0]?.id ?? '');
    }
  }, [filteredFaces, faceId]);
  const {
    data: backgrounds,
    isError: backgroundsError,
    refetch: refetchBackgrounds,
  } = useQuery<BackgroundsResponse>({
    queryKey: ['backgrounds', gender],
    queryFn: () => api.get(`/v1/models/backgrounds?gender=${gender}`),
    enabled: !!gender,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
  useEffect(() => {
    if (backgrounds?.items?.length && !backgroundId) {
      setBackgroundId(backgrounds.items[0]?.id ?? '');
    }
  }, [backgrounds, backgroundId]);
  const {
    data: poses,
    isError: posesError,
    refetch: refetchPoses,
  } = useQuery<{ items: PoseItem[] }>({
    queryKey: ['poses', gender, garmentTypeId],
    queryFn: () =>
      api.get(
        `/v1/models/poses?gender=${gender}${garmentTypeId ? `&garmentTypeId=${garmentTypeId}` : ''}`,
      ),
    enabled: !!gender,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  const selectedPoses = poses?.items.filter((p) => poseIds.includes(p.id)) ?? [];
  const needsLower = selectedPoses.some((p) => p.hasLower);
  const needsShoes = selectedPoses.some((p) => p.hasShoes);

  // Find the white background (tagged for Amazon) from loaded backgrounds
  const whiteBg = backgrounds?.items.find((b) => b.isWhiteBg);

  const poseIdsParam = poseIds.length > 0 ? `poseIds=${poseIds.join(',')}` : '';
  const { data: lowerCatalog } = useQuery<{ type: string; tree: CatalogNode[] }>({
    queryKey: ['catalog', 'lower', gender, garmentTypeId, poseIds.join(',')],
    queryFn: () => {
      const params = [
        poseIdsParam,
        gender ? `gender=${gender}` : '',
        garmentTypeId ? `garmentTypeId=${garmentTypeId}` : '',
      ]
        .filter(Boolean)
        .join('&');
      return api.get(`/v1/catalog/lower?${params}`);
    },
    enabled: needsLower,
  });
  const { data: shoesCatalog } = useQuery<{ type: string; tree: CatalogNode[] }>({
    queryKey: ['catalog', 'shoe', gender, garmentTypeId, poseIds.join(',')],
    queryFn: () => {
      const params = [
        poseIdsParam,
        gender ? `gender=${gender}` : '',
        garmentTypeId ? `garmentTypeId=${garmentTypeId}` : '',
      ]
        .filter(Boolean)
        .join('&');
      return api.get(`/v1/catalog/shoe?${params}`);
    },
    enabled: needsShoes,
  });

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

  async function handleLowerGarmentUpload(file: File) {
    setLowerGarmentFile(file);
    setIsUploadingLower(true);
    try {
      const { uploadUrl, r2Key } = await api.post<{
        uploadUrl: string;
        r2Key: string;
        expiresIn: number;
      }>('/v1/uploads/presign', { contentType: file.type, contentLength: file.size });
      await api.uploadToR2WithProgress(uploadUrl, file, () => {});
      setLowerGarmentKey(r2Key);
    } catch (e) {
      showToast(`Lower garment upload failed: ${(e as Error).message}`);
      setLowerGarmentFile(null);
    } finally {
      setIsUploadingLower(false);
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
    setPoseIds((prev) => {
      const next = prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id];
      const nextPoses = poses?.items.filter((p) => next.includes(p.id)) ?? [];
      const nextNeedsLower = nextPoses.some((p) => p.hasLower);
      const nextNeedsShoes = nextPoses.some((p) => p.hasShoes);
      // Clear when no longer needed; leave empty otherwise (default sent at submit time)
      if (!nextNeedsLower) setLowerCatalogId('');
      if (!nextNeedsShoes) setShoeCatalogId('');
      return next;
    });
  }

  const RESOLUTION_COSTS = { HD: 25, '2K': 35, '4K': 40 } as const;

  async function handleSubmit() {
    if (!garmentKey || !faceId || !backgroundId || poseIds.length === 0 || !resolution) return;

    // Amazon main listing + multiple poses → show picker modal to choose main image.
    // Lifestyle mode or single pose → submit directly.
    if (platform === 'Amazon' && amazonUseWhiteBg && poseIds.length > 1) {
      setAmazonMainPoseId('');
      setAmazonPoseModalOpen(true);
      return;
    }

    setIsSubmitting(true);
    setSubmitError('');
    try {
      // Send platform:'Amazon' only when white bg override is wanted (main listing).
      // Lifestyle mode: omit platform so the API doesn't force white bg.
      // The aspectRatio (1:1) is already captured in `aspect` independently.
      const effectivePlatform =
        platform === 'Amazon' ? (amazonUseWhiteBg ? 'Amazon' : undefined) : platform;
      const effectiveLowerId =
        lowerCatalogId ||
        (needsLower ? (selectedGarmentType?.defaultLowerCatalogId ?? undefined) : undefined);
      const effectiveShoesId =
        shoeCatalogId ||
        (needsShoes ? (selectedGarmentType?.defaultShoeCatalogId ?? undefined) : undefined);
      const { catalogueId, jobIds } = await api.post<{ catalogueId: string; jobIds: string[] }>(
        '/v1/jobs/tryon',
        {
          inputs: {
            upperGarmentKey: garmentKey,
            faceId,
            backgroundId,
            poseIds,
            garmentTypeId: garmentTypeId || undefined,
            lowerCatalogId: effectiveLowerId,
            lowerGarmentKey: lowerGarmentKey || undefined,
            shoeCatalogId: effectiveShoesId,
          },
          aspectRatio: aspect,
          resolution,
          ...(effectivePlatform ? { platform: effectivePlatform } : {}),
        },
      );
      // Credits were deducted server-side — refresh balance + catalogues list.
      qc.invalidateQueries({ queryKey: ['credits'] });
      qc.invalidateQueries({ queryKey: ['catalogues'] });
      setActiveGeneration({
        catalogueId,
        jobs: poseIds.map((poseId, i) => {
          const pose = poses?.items.find((p) => p.id === poseId);
          return {
            id: jobIds[i]!,
            poseId,
            label: pose?.label ?? `Pose ${i + 1}`,
            thumbnailUrl: pose?.thumbnailUrl ?? '',
          };
        }),
      });
      setIsSubmitting(false);
    } catch (e) {
      setSubmitError((e as Error).message);
      setIsSubmitting(false);
    }
  }

  async function submitAmazonPose(mainPoseId: string) {
    setAmazonPoseModalOpen(false);
    setIsSubmitting(true);
    setSubmitError('');
    try {
      const effectiveLowerId =
        lowerCatalogId ||
        (needsLower ? (selectedGarmentType?.defaultLowerCatalogId ?? undefined) : undefined);
      const effectiveShoesId =
        shoeCatalogId ||
        (needsShoes ? (selectedGarmentType?.defaultShoeCatalogId ?? undefined) : undefined);

      // Main image: white Amazon-compliant background
      const { catalogueId } = await api.post<{ catalogueId: string }>('/v1/jobs/tryon', {
        inputs: {
          upperGarmentKey: garmentKey,
          faceId,
          backgroundId,
          poseIds: [mainPoseId],
          garmentTypeId: garmentTypeId || undefined,
          lowerCatalogId: effectiveLowerId,
          lowerGarmentKey: lowerGarmentKey || undefined,
          shoeCatalogId: effectiveShoesId,
        },
        aspectRatio: aspect,
        resolution,
        platform: 'Amazon',
      });

      // Remaining poses: same catalogue, original background, no Amazon override
      const remainingPoseIds = poseIds.filter((id) => id !== mainPoseId);
      if (remainingPoseIds.length > 0) {
        await api.post('/v1/jobs/tryon', {
          catalogueId,
          inputs: {
            upperGarmentKey: garmentKey,
            faceId,
            backgroundId,
            poseIds: remainingPoseIds,
            garmentTypeId: garmentTypeId || undefined,
            lowerCatalogId: effectiveLowerId,
            lowerGarmentKey: lowerGarmentKey || undefined,
            shoeCatalogId: effectiveShoesId,
          },
          aspectRatio: aspect,
          resolution,
        });
      }

      qc.invalidateQueries({ queryKey: ['credits'] });
      qc.invalidateQueries({ queryKey: ['catalogues'] });
      router.push(`/catalogues/${catalogueId}`);
    } catch (e) {
      setSubmitError((e as Error).message);
      setIsSubmitting(false);
    }
  }

  const selectedGarmentType = garmentTypes?.items.find((g) => g.id === garmentTypeId);
  const requiresLowerUpload = selectedGarmentType?.requiresLowerUpload ?? false;

  const creditCost = resolution ? RESOLUTION_COSTS[resolution] * poseIds.length : 0;
  const canGenerate =
    poseIds.length > 0 &&
    !!garmentKey &&
    !!faceId &&
    !!backgroundId &&
    !!resolution &&
    !isUploading &&
    !isSubmitting;

  const generateBlocker = isUploading
    ? 'Waiting for upload to finish…'
    : !garmentKey
      ? 'Upload a garment image first'
      : poseIds.length === 0
        ? 'Select at least one pose'
        : !resolution
          ? 'Select an output resolution'
          : '';

  return (
    <>
      <TopBar title="Create Catalogue" />
      <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 20, padding: '24px 28px' }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              paddingRight: 8,
              display: 'flex',
              flexDirection: 'column',
              gap: 28,
            }}
          >
            {/* ── Setup ── */}
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
                      setGarmentModalOpen(false);
                    }}
                    imgStyle={{ transform: 'scale(1.4)', transformOrigin: 'center 1%' }}
                  />
                ))}
              </div>
            </section>

            <section>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 14,
                }}
              >
                <h3 style={{ fontWeight: 700, fontSize: 14, color: C.text, margin: 0 }}>
                  Garment Type
                </h3>
                {garmentTypes && garmentTypes.items.length > garmentVisibleCount && (
                  <button
                    onClick={() => setGarmentModalOpen(true)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      cursor: 'pointer',
                      height: 16,
                    }}
                  >
                    <span
                      style={{
                        fontFamily: 'var(--font-poppins), Poppins, sans-serif',
                        fontWeight: 600,
                        fontSize: 12,
                        lineHeight: '16px',
                        color: '#626262',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      View more
                    </span>
                    <svg
                      width="8"
                      height="5"
                      viewBox="0 0 8 5"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                      style={{ transform: 'rotate(-90deg)' }}
                    >
                      <path
                        d="M1 1L4 4L7 1"
                        stroke="#626262"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                )}
              </div>
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
                <div
                  ref={garmentRowRef}
                  style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center' }}
                >
                  {(() => {
                    const all = garmentTypes.items;
                    const inFirstN = all
                      .slice(0, garmentVisibleCount)
                      .some((s) => s.id === garmentTypeId);
                    const visible =
                      garmentTypeId && !inFirstN
                        ? [
                            all.find((s) => s.id === garmentTypeId)!,
                            ...all
                              .filter((s) => s.id !== garmentTypeId)
                              .slice(0, garmentVisibleCount - 1),
                          ]
                        : all.slice(0, garmentVisibleCount);
                    return visible.map((s) => {
                      const fallbackKey = Object.keys(OUTFIT_IMG).find(
                        (k) =>
                          s.slug.toLowerCase().includes(k) || s.label.toLowerCase().includes(k),
                      );
                      const img = s.thumbnailUrl ?? (fallbackKey ? OUTFIT_IMG[fallbackKey]! : null);
                      return (
                        <VisualCard
                          key={s.id}
                          img={img}
                          label={s.label}
                          selected={garmentTypeId === s.id}
                          onClick={() => {
                            const next = garmentTypeId === s.id ? '' : s.id;
                            setGarmentTypeId(next);
                            if (next && next !== garmentTypeId) {
                              setFaceId('');
                              setBackgroundId('');
                              setPoseIds([]);
                              setLowerCatalogId('');
                              setShoeCatalogId('');
                            }
                          }}
                        />
                      );
                    });
                  })()}
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
                {platform === 'Amazon' && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <button
                      onClick={() => setAmazonUseWhiteBg(true)}
                      style={pill(amazonUseWhiteBg)}
                    >
                      Main listing
                    </button>
                    <button
                      onClick={() => setAmazonUseWhiteBg(false)}
                      style={pill(!amazonUseWhiteBg)}
                    >
                      Lifestyle
                    </button>
                  </div>
                )}
              </section>
              <section style={{ flex: 1, minWidth: 200 }}>
                <SectionHead title="Aspect Ratio" />
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {ALL_ASPECTS.map((r) => {
                    const supported = brandAspects.includes(r);
                    return (
                      <button
                        key={r}
                        onClick={supported ? () => setAspect(r) : undefined}
                        style={{
                          ...pill(aspect === r),
                          ...(!supported ? { opacity: 0.35, cursor: 'not-allowed' } : {}),
                        }}
                      >
                        {r}
                      </button>
                    );
                  })}
                </div>
                <div style={{ marginTop: 8, fontSize: 11, color: C.light }}>
                  {ASPECT_DIMS[aspect]}
                </div>
              </section>
            </div>

            <section>
              <SectionHead
                title={requiresLowerUpload ? 'Upload Garment Images' : 'Upload Garment Image'}
              />
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                {/* Dashed upload box — single zone or split into two */}
                <div
                  style={{
                    flex: 1,
                    minWidth: 260,
                    height: 238,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: requiresLowerUpload ? 8 : 0,
                    background: '#F9F9F9',
                    borderRadius: 12,
                    border: '1px dashed #B1B1B1',
                    padding: '0 10px',
                    boxSizing: 'border-box',
                  }}
                >
                  {/* Upper garment label */}
                  <label
                    style={{
                      flex: requiresLowerUpload ? 1 : 'none',
                      width: requiresLowerUpload ? undefined : 265,
                      minWidth: 0,
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
                      overflow: 'hidden',
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
                          style={{
                            width: requiresLowerUpload ? 56 : 92,
                            height: requiresLowerUpload ? 56 : 92,
                            borderRadius: 8,
                            objectFit: 'cover',
                          }}
                        />
                        <span
                          style={{
                            width: '100%',
                            fontSize: requiresLowerUpload ? 11 : 12,
                            fontWeight: 500,
                            lineHeight: '100%',
                            color: '#141414',
                            textAlign: 'center',
                          }}
                        >
                          {requiresLowerUpload ? 'Top Wear' : 'Upload Top Wear'}
                        </span>
                        <span
                          style={{
                            width: '100%',
                            fontSize: 10,
                            fontWeight: 500,
                            lineHeight: '140%',
                            color: '#939393',
                            textAlign: 'center',
                          }}
                        >
                          {requiresLowerUpload
                            ? 'JPG, PNG · Max 10MB'
                            : 'Drag and drop an image here · JPG, PNG · Max 10MB'}
                        </span>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                          }}
                        >
                          <ImagePlusIcon size={14} />
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 500,
                              lineHeight: '18px',
                              color: '#141414',
                            }}
                          >
                            Browse
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

                  {/* Lower garment label — only when requiresLowerUpload */}
                  {requiresLowerUpload && (
                    <label
                      style={{
                        flex: 1,
                        minWidth: 0,
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
                        overflow: 'hidden',
                      }}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const f = e.dataTransfer.files?.[0];
                        if (f && ['image/jpeg', 'image/png', 'image/webp'].includes(f.type))
                          handleLowerGarmentUpload(f);
                      }}
                    >
                      {lowerGarmentFile ? (
                        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={URL.createObjectURL(lowerGarmentFile)}
                            alt={lowerGarmentFile.name}
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
                              setLowerGarmentFile(null);
                              setLowerGarmentKey('');
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
                          {isUploadingLower && (
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
                                <SpinnerIcon size={14} /> Uploading…
                              </div>
                            </div>
                          )}
                          {lowerGarmentKey && (
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
                            alt="Lower garment reference"
                            style={{ width: 56, height: 56, borderRadius: 8, objectFit: 'cover' }}
                          />
                          <span
                            style={{
                              width: '100%',
                              fontSize: 11,
                              fontWeight: 500,
                              lineHeight: '100%',
                              color: '#141414',
                              textAlign: 'center',
                            }}
                          >
                            Bottom Wear
                          </span>
                          <span
                            style={{
                              width: '100%',
                              fontSize: 10,
                              fontWeight: 500,
                              lineHeight: '140%',
                              color: '#939393',
                              textAlign: 'center',
                            }}
                          >
                            JPG, PNG · Max 10MB
                          </span>
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                            }}
                          >
                            <ImagePlusIcon size={14} />
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 500,
                                lineHeight: '18px',
                                color: '#141414',
                              }}
                            >
                              Browse
                            </span>
                          </div>
                        </>
                      )}
                      <input
                        ref={lowerFileInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        style={{ display: 'none' }}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleLowerGarmentUpload(f);
                        }}
                      />
                    </label>
                  )}
                </div>
                {/* Tips panel — always on the right */}
                <div
                  style={{
                    flex: 1,
                    minWidth: 260,
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
                        width: '100%',
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

            {/* ── Model ── */}
            <section>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 14,
                }}
              >
                <SectionHead title="Choose your model" />
                {filteredFaces.length > modelVisibleCount && (
                  <button
                    onClick={() => setModelModalOpen(true)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      cursor: 'pointer',
                      height: 16,
                    }}
                  >
                    <span style={{ fontWeight: 600, fontSize: 12, color: '#626262' }}>
                      View more
                    </span>
                  </button>
                )}
              </div>
              {facesError ? (
                <ErrorState
                  compact
                  title="Couldn't load models"
                  message="There was a problem fetching models. Please try again."
                  onRetry={() => refetchFaces()}
                />
              ) : !faces ? (
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
                <div ref={modelRowRef} style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  {filteredFaces.slice(0, modelVisibleCount).map((f) => (
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
              {modelModalOpen && faces && (
                <SelectGridModal
                  title="Choose your model"
                  items={filteredFaces}
                  selectedIds={faceId ? [faceId] : []}
                  cardHeight={190}
                  onSelect={(id) => {
                    handleFaceSelect(id);
                    setModelModalOpen(false);
                  }}
                  onClose={() => setModelModalOpen(false)}
                />
              )}
            </section>

            {/* ── Background ── */}
            <section>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 14,
                }}
              >
                <SectionHead title="Select Background" />
                {(backgrounds?.items.length ?? 0) > backgroundVisibleCount && (
                  <button
                    onClick={() => setBackgroundModalOpen(true)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      cursor: 'pointer',
                      height: 16,
                    }}
                  >
                    <span style={{ fontWeight: 600, fontSize: 12, color: '#626262' }}>
                      View more
                    </span>
                  </button>
                )}
              </div>
              {backgroundsError ? (
                <ErrorState
                  compact
                  title="Couldn't load backgrounds"
                  message="There was a problem fetching backgrounds. Please try again."
                  onRetry={() => refetchBackgrounds()}
                />
              ) : !backgrounds ? (
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
                <div ref={backgroundRowRef} style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  {backgrounds.items.slice(0, backgroundVisibleCount).map((b) => (
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
              {backgroundModalOpen && backgrounds && (
                <SelectGridModal
                  title="Select Background"
                  items={backgrounds.items}
                  selectedIds={backgroundId ? [backgroundId] : []}
                  cardHeight={150}
                  onSelect={(id) => {
                    handleBackgroundSelect(id);
                    setBackgroundModalOpen(false);
                  }}
                  onClose={() => setBackgroundModalOpen(false)}
                />
              )}
            </section>

            {/* ── Poses ── */}
            <section>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 14,
                }}
              >
                <SectionHead title="Choose Poses" />
                {(poses?.items.length ?? 0) > poseVisibleCount && (
                  <button
                    onClick={() => setPoseModalOpen(true)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      cursor: 'pointer',
                      height: 16,
                    }}
                  >
                    <span style={{ fontWeight: 600, fontSize: 12, color: '#626262' }}>
                      View more
                    </span>
                  </button>
                )}
              </div>
              {posesError ? (
                <ErrorState
                  compact
                  title="Couldn't load poses"
                  message="There was a problem fetching poses. Please try again."
                  onRetry={() => refetchPoses()}
                />
              ) : !poses ? (
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
                <div ref={poseRowRef} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {poses.items.slice(0, poseVisibleCount).map((p) => (
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
              {poseModalOpen && poses && (
                <SelectGridModal
                  title="Choose Poses"
                  items={poses.items}
                  selectedIds={poseIds}
                  multiSelect
                  cardHeight={200}
                  onSelect={(id) => handlePoseSelect(id)}
                  onClose={() => setPoseModalOpen(false)}
                />
              )}
            </section>

            {needsLower && !requiresLowerUpload && (
              <section>
                <SectionHead title="Lower Garment" />
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
                ) : lowerCatalog.tree.length === 0 ? (
                  <p style={{ fontSize: 14, color: C.mid }}>
                    No lower garment options available yet.
                  </p>
                ) : (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, 120px)',
                      gap: 12,
                    }}
                  >
                    {lowerCatalog.tree
                      .filter((node) => node.slug !== 'other')
                      .map((node) => {
                        const nodeItems = flattenNode(node);
                        const isActive =
                          !!lowerCatalogId &&
                          findNodeForItem(lowerCatalog.tree, lowerCatalogId)?.id === node.id;
                        const selectedItem = isActive
                          ? nodeItems.find((i) => i.id === lowerCatalogId)
                          : null;
                        const thumb =
                          selectedItem?.thumbnailUrl ??
                          node.thumbnailUrl ??
                          nodeItems[0]?.thumbnailUrl;
                        return (
                          <SelCard
                            key={node.id}
                            selected={isActive}
                            onClick={() => setLowerCatModal(node)}
                            imageUrl={thumb}
                            label={node.label}
                            w={120}
                            h={160}
                          />
                        );
                      })}
                  </div>
                )}
              </section>
            )}

            {needsShoes && (
              <section>
                <SectionHead title="Footwear" />
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
                ) : shoesCatalog.tree.length === 0 ? (
                  <p style={{ fontSize: 14, color: C.mid }}>No shoe options available yet.</p>
                ) : (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, 120px)',
                      gap: 12,
                    }}
                  >
                    {shoesCatalog.tree
                      .filter((node) => node.slug !== 'other')
                      .map((node) => {
                        const nodeItems = flattenNode(node);
                        const isActive =
                          !!shoeCatalogId &&
                          findNodeForItem(shoesCatalog.tree, shoeCatalogId)?.id === node.id;
                        const selectedItem = isActive
                          ? nodeItems.find((i) => i.id === shoeCatalogId)
                          : null;
                        const thumb =
                          selectedItem?.thumbnailUrl ??
                          node.thumbnailUrl ??
                          nodeItems[0]?.thumbnailUrl;
                        return (
                          <SelCard
                            key={node.id}
                            selected={isActive}
                            onClick={() => setShoeCatModal(node)}
                            imageUrl={thumb}
                            label={node.label}
                            w={120}
                            h={120}
                          />
                        );
                      })}
                  </div>
                )}
              </section>
            )}

            {/* ── Resolution ── */}
            <section>
              <SectionHead title="Output Resolution" />
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {(
                  [
                    { key: 'HD', label: 'HD', credits: 25 },
                    { key: '2K', label: '2K', credits: 35 },
                    { key: '4K', label: '4K', credits: 40 },
                  ] as const
                ).map((r) => {
                  const active = resolution === r.key;
                  return (
                    <div
                      key={r.key}
                      onClick={() => setResolution(r.key)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '8px 16px',
                        borderRadius: 99,
                        border: active ? `1.5px solid ${C.pink}` : `1.5px solid ${C.border2}`,
                        background: active ? 'rgba(245,92,122,0.04)' : C.white,
                        cursor: 'pointer',
                        boxSizing: 'border-box',
                        userSelect: 'none',
                      }}
                    >
                      {/* Radio circle */}
                      <div
                        style={{
                          width: 16,
                          height: 16,
                          borderRadius: '50%',
                          border: active ? `5px solid ${C.pink}` : `1.5px solid #BDBDBD`,
                          background: C.white,
                          flexShrink: 0,
                          boxSizing: 'border-box',
                        }}
                      />
                      <span
                        style={{ fontSize: 14, fontWeight: 600, color: active ? C.pink : C.text }}
                      >
                        {r.label}
                      </span>
                      <span
                        style={{ fontSize: 13, color: active ? C.pink : C.mid, fontWeight: 400 }}
                      >
                        ({r.credits} credits)
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>

          {/* Footer (pinned, left column only) */}
          <div
            style={{
              borderTop: `1px solid ${C.border}`,
              paddingTop: 16,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              flexShrink: 0,
            }}
          >
            {submitError && (
              <div
                style={{
                  padding: '8px 14px',
                  borderRadius: 8,
                  border: `1px solid ${C.pink}`,
                  background: 'rgba(245,92,122,0.06)',
                  fontSize: 13,
                  color: C.pink,
                }}
              >
                {submitError}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {creditCost > 0 && (
                  <>
                    <span style={{ color: C.pink, display: 'flex' }}>
                      <SparkleIcon />
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 500, color: C.mid }}>
                      {creditCost} Credits Required to Generate
                    </span>
                  </>
                )}
              </div>
              <Tooltip tip={generateBlocker || undefined}>
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
                      <SparkleIcon /> Create Catalogue
                    </>
                  )}
                </GradBtn>
              </Tooltip>
            </div>
          </div>
        </div>

        <div style={{ width: 480, flexShrink: 0 }}>
          <PreviewPanel />
        </div>
      </div>

      {/* Garment Type Modal */}
      {garmentModalOpen && garmentTypes && (
        <SelectGridModal
          title="Choose Garment Type"
          items={garmentTypes.items.map((s) => ({
            id: s.id,
            label: s.label,
            thumbnailUrl:
              s.thumbnailUrl ??
              (() => {
                const fallbackKey = Object.keys(OUTFIT_IMG).find(
                  (k) => s.slug.toLowerCase().includes(k) || s.label.toLowerCase().includes(k),
                );
                return fallbackKey ? OUTFIT_IMG[fallbackKey] : null;
              })(),
          }))}
          selectedIds={garmentTypeId ? [garmentTypeId] : []}
          onSelect={(id) => {
            const changed = id !== garmentTypeId;
            setGarmentTypeId(id);
            setGarmentModalOpen(false);
            if (changed) {
              setFaceId('');
              setBackgroundId('');
              setPoseIds([]);
              setLowerCatalogId('');
              setShoeCatalogId('');
            }
          }}
          onClose={() => setGarmentModalOpen(false)}
        />
      )}

      {/* Lower Garment Category Modal */}
      {lowerCatModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={() => setLowerCatModal(null)}
        >
          <div
            style={{
              background: C.white,
              borderRadius: 12,
              padding: 24,
              width: 700,
              maxWidth: '92vw',
              maxHeight: '82vh',
              overflowY: 'auto',
              boxShadow: '0 10px 40px rgba(0,0,0,0.15)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 20,
              }}
            >
              <h2 style={{ fontSize: 18, fontWeight: 700, color: C.text, margin: 0 }}>
                {lowerCatModal.label}
              </h2>
              <button
                onClick={() => setLowerCatModal(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: C.mid,
                }}
              >
                <XIcon size={20} />
              </button>
            </div>
            {flattenNode(lowerCatModal).length === 0 ? (
              <p style={{ fontSize: 14, color: C.mid }}>No items in this category yet.</p>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, 1fr)',
                  gap: 12,
                }}
              >
                {flattenNode(lowerCatModal).map((i) => (
                  <SelCard
                    key={i.id}
                    selected={lowerCatalogId === i.id}
                    onClick={() => {
                      setLowerCatalogId(lowerCatalogId === i.id ? '' : i.id);
                      setLowerCatModal(null);
                    }}
                    imageUrl={i.thumbnailUrl}
                    w={152.57}
                    h={203}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Shoe Category Modal */}
      {shoeCatModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={() => setShoeCatModal(null)}
        >
          <div
            style={{
              background: C.white,
              borderRadius: 12,
              padding: 24,
              width: 700,
              maxWidth: '92vw',
              maxHeight: '82vh',
              overflowY: 'auto',
              boxShadow: '0 10px 40px rgba(0,0,0,0.15)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 20,
              }}
            >
              <h2 style={{ fontSize: 18, fontWeight: 700, color: C.text, margin: 0 }}>
                {shoeCatModal.label}
              </h2>
              <button
                onClick={() => setShoeCatModal(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: C.mid,
                }}
              >
                <XIcon size={20} />
              </button>
            </div>
            {flattenNode(shoeCatModal).length === 0 ? (
              <p style={{ fontSize: 14, color: C.mid }}>No items in this category yet.</p>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, 152.57px)',
                  gap: 12,
                }}
              >
                {flattenNode(shoeCatModal).map((i) => (
                  <SelCard
                    key={i.id}
                    selected={shoeCatalogId === i.id}
                    onClick={() => {
                      setShoeCatalogId(shoeCatalogId === i.id ? '' : i.id);
                      setShoeCatModal(null);
                    }}
                    imageUrl={i.thumbnailUrl}
                    w={152.57}
                    h={152.57}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Amazon Pose Picker Modal */}
      {amazonPoseModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={() => setAmazonPoseModalOpen(false)}
        >
          <div
            style={{
              background: C.white,
              borderRadius: 16,
              padding: 32,
              maxWidth: 600,
              width: 'calc(100vw - 40px)',
              maxHeight: '80vh',
              overflowY: 'auto',
              boxShadow: '0 8px 40px rgba(0,0,0,0.15)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              style={{
                fontSize: 18,
                fontWeight: 700,
                color: C.text,
                marginBottom: 6,
              }}
            >
              Select Amazon main image pose
            </h2>
            <p style={{ fontSize: 13, color: C.mid, marginBottom: 16 }}>
              All {selectedPoses.length} poses will be generated. Pick which one gets the white
              Amazon-compliant background as the main listing image.
            </p>

            {whiteBg && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 14px',
                  borderRadius: 10,
                  border: `1px solid ${C.border2}`,
                  background: '#fafafa',
                  marginBottom: 20,
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={whiteBg.previewUrl}
                  alt="White background"
                  style={{
                    width: 64,
                    height: 48,
                    objectFit: 'cover',
                    borderRadius: 6,
                    border: `1px solid ${C.border}`,
                  }}
                />
                <div>
                  <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>
                    {whiteBg.label}
                  </span>
                  <span style={{ fontSize: 11, color: C.light, display: 'block', marginTop: 2 }}>
                    White background will replace original
                  </span>
                </div>
              </div>
            )}

            <p style={{ fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 12 }}>
              Selected poses:
            </p>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, 152.57px)',
                gap: 12,
                justifyContent: 'center',
              }}
            >
              {selectedPoses.map((p) => (
                <SelCard
                  key={p.id}
                  selected={amazonMainPoseId === p.id}
                  onClick={() => setAmazonMainPoseId(p.id)}
                  imageUrl={p.thumbnailUrl}
                  label={p.label}
                  w={152.57}
                  h={200}
                />
              ))}
            </div>
            <div style={{ marginTop: 24, display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setAmazonPoseModalOpen(false)}
                style={{
                  padding: '10px 24px',
                  borderRadius: 8,
                  border: `1px solid ${C.border2}`,
                  background: C.white,
                  fontFamily: 'inherit',
                  fontSize: 14,
                  cursor: 'pointer',
                  color: C.mid,
                }}
              >
                Cancel
              </button>
              <GradBtn
                onClick={() => submitAmazonPose(amazonMainPoseId)}
                disabled={!amazonMainPoseId || isSubmitting}
                style={{ padding: '10px 28px', gap: 8 }}
              >
                {isSubmitting ? (
                  <>
                    <SpinnerIcon size={16} /> Generating…
                  </>
                ) : (
                  <>
                    <SparkleIcon /> Generate
                  </>
                )}
              </GradBtn>
            </div>
          </div>
        </div>
      )}

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
