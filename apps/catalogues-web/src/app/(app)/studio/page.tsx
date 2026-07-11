'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckIcon, ImagePlusIcon, SparkleIcon, SpinnerIcon, XIcon } from '@/components/icons';
import { C, grad } from '@/components/tokens';
import { TopBar } from '@/components/topbar';
import { ErrorState } from '@/components/ui/error-state';
import { GradBtn } from '@/components/ui/grad-btn';
import { Tooltip } from '@/components/ui/tooltip';
import { api } from '@/lib/api';
import { type GenerationJob, GenerationPanel } from './generation-panel';
import { PreviewPanel } from './preview-panel';
import { SelectGridModal } from './select-modal';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface GarmentType {
  id: string;
  slug: string;
  label: string;
  thumbnailUrl?: string | null;
  instructionImageUrl?: string | null;
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
  categoryId?: number | null;
  tags?: string[];
  specialTag?: 'featured' | 'trending' | 'popular' | null;
}
interface BackgroundsResponse {
  items: BackgroundItem[];
}
interface BackgroundCategoriesResponse {
  items: {
    id: number;
    slug: string;
    label: string;
    thumbnailUrl: string | null;
  }[];
}
interface PoseItem {
  id: string;
  label: string;
  thumbnailUrl: string;
  hasLower: boolean;
  hasShoes: boolean;
}
interface TemplateLook {
  id: string;
  poseId: string;
  poseLabel: string;
  poseThumbnailUrl: string;
  backgroundId: string;
  backgroundLabel: string;
  backgroundThumbnailUrl: string;
  hasLower: boolean;
  hasShoes: boolean;
}
interface CatalogueTemplateItem {
  id: string;
  label: string;
  thumbnailUrl: string | null;
  looks: TemplateLook[];
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

const TAG_LABELS: Record<string, string> = {
  featured: 'Featured',
  trending: 'Trending',
  popular: 'Popular',
};

function TagBadge({ tag }: { tag?: string | null }) {
  if (!tag || !TAG_LABELS[tag]) return null;
  return (
    <span
      style={{
        position: 'absolute',
        top: 6,
        left: 6,
        fontSize: 10,
        fontWeight: 700,
        color: C.white,
        padding: '2px 7px',
        borderRadius: 999,
        background: grad,
        lineHeight: 1.4,
        zIndex: 1,
      }}
    >
      {TAG_LABELS[tag]}
    </span>
  );
}

function _findNodeForItem(tree: CatalogNode[], itemId: string): CatalogNode | null {
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
const ASPECT_PX: Record<string, { w: number; h: number }> = {
  '1:1': { w: 2048, h: 2048 },
  '2:3': { w: 1365, h: 2048 },
  '3:4': { w: 1331, h: 1774 },
  '4:5': { w: 1375, h: 1718 },
};
function resolutionFromOutputDims(w: number, h: number): 'HD' | '2K' | '4K' {
  const longer = Math.max(w, h);
  if (longer <= 1440) return 'HD';
  if (longer <= 2048) return '2K';
  return '4K';
}
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
  width = 108.8,
  ratio = 108.8 / 109,
}: {
  selected: boolean;
  onClick: () => void;
  img: string | null;
  label: string;
  imgStyle?: React.CSSProperties;
  width?: number | string;
  ratio?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        cursor: 'pointer',
        textAlign: 'center',
        flexShrink: 0,
        width: typeof width === 'string' ? width : undefined,
        background: 'none',
        border: 'none',
        padding: 0,
      }}
    >
      <div
        style={{
          width: typeof width === 'string' ? '100%' : width,
          aspectRatio: ratio,
          borderRadius: 8,
          overflow: 'hidden',
          position: 'relative',
          border: selected ? '2px solid transparent' : `2px solid ${C.border}`,
          backgroundImage: selected
            ? 'linear-gradient(90deg, var(--c-pink), var(--c-amber))'
            : 'none',
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
            // biome-ignore lint/performance/noImgElement: small UI thumbnail, Next Image not needed
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
              background: 'linear-gradient(90deg, var(--c-pink), var(--c-amber))',
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
        <div
          style={{
            fontSize: 12,
            fontWeight: 500,
            color: C.text,
            marginTop: 8,
            overflowWrap: 'anywhere',
            wordBreak: 'break-word',
          }}
        >
          {label}
        </div>
      )}
    </button>
  );
}

// ── Gender card — horizontal landscape layout (SVG/PNG spec: Frame 446) ──
// border-image + border-radius are incompatible in CSS; gradient border is
// achieved via a 1px gradient-background wrapper (same visual result).
function GenderCard({
  selected,
  onClick,
  img,
  label,
}: {
  selected: boolean;
  onClick: () => void;
  img: string | null;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        cursor: 'pointer',
        background: selected ? 'linear-gradient(90deg, var(--c-pink), var(--c-amber))' : C.white,
        borderRadius: 8,
        padding: selected ? 1 : 0,
        border: selected ? 'none' : `1px solid ${C.border}`,
        boxShadow: selected ? '0px 2px 15px 0px rgba(246,181,83,0.08)' : 'none',
        height: 72,
        boxSizing: 'border-box',
        width: '100%',
        textAlign: 'left',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          background: C.white,
          borderRadius: selected ? 7 : 8,
          padding: '0 12px',
          position: 'relative',
          height: '100%',
        }}
      >
        {/* Circular image — gradient ring when selected, grey when not */}
        <div
          style={{
            flexShrink: 0,
            width: 40,
            height: 40,
            borderRadius: 100,
            padding: 1,
            background: selected ? 'linear-gradient(90deg, var(--c-pink), var(--c-amber))' : C.mid,
            boxSizing: 'border-box',
          }}
        >
          <div
            style={{
              width: '100%',
              height: '100%',
              borderRadius: 100,
              overflow: 'hidden',
              background: C.lighter,
            }}
          >
            {img && (
              // eslint-disable-next-line @next/next/no-img-element
              // biome-ignore lint/performance/noImgElement: small UI thumbnail, Next Image not needed
              <img
                src={img}
                alt={label}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  objectPosition: 'top center',
                  transform: 'scale(1.35)',
                  transformOrigin: 'center 5%',
                }}
              />
            )}
          </div>
        </div>

        {/* Label */}
        <span
          style={{
            fontFamily: 'Poppins, sans-serif',
            fontWeight: 500,
            fontSize: 14,
            lineHeight: '18px',
            letterSpacing: 0,
            color: C.text,
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </span>

        {/* Selected checkmark badge — top-right corner */}
        {selected && (
          <div
            style={{
              position: 'absolute',
              top: 6,
              right: 6,
              width: 20,
              height: 20,
              borderRadius: '50%',
              background: 'linear-gradient(90deg, var(--c-pink), var(--c-amber))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <CheckIcon color={C.white} size={11} />
          </div>
        )}
      </div>
    </button>
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
  ratio,
  badges,
  emptyContent,
}: {
  selected: boolean;
  onClick: () => void;
  imageUrl?: string | null;
  label?: string;
  w?: number | string;
  h?: number;
  ratio?: number;
  badges?: React.ReactNode;
  emptyContent?: React.ReactNode;
}) {
  const fluid = typeof w === 'string';
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: preview tile; parent button handles keyboard a11y
    <div
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onClick?.();
      }}
      className="garment-card"
      style={{
        cursor: 'pointer',
        textAlign: 'center',
        flexShrink: 0,
        width: fluid ? w : undefined,
      }}
    >
      <div
        style={{
          width: fluid ? '100%' : w,
          aspectRatio: fluid ? ratio : undefined,
          height: fluid ? undefined : h,
          borderRadius: 8,
          overflow: 'hidden',
          position: 'relative',
          border: selected ? '2px solid transparent' : `2px solid ${C.border}`,
          background: selected
            ? 'linear-gradient(90deg, var(--c-pink), var(--c-amber))'
            : 'transparent',
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
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {imageUrl ? (
            <div data-zoom style={{ width: '100%', height: '100%', transition: 'transform .3s' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {/* biome-ignore lint/performance/noImgElement: small selection card thumbnail */}
              <img
                src={imageUrl}
                alt={label}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            </div>
          ) : emptyContent ? (
            emptyContent
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
              background: 'linear-gradient(90deg, var(--c-pink), var(--c-amber))',
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
      <div
        style={{
          fontSize: 12,
          fontWeight: 500,
          color: C.text,
          marginTop: 8,
          overflowWrap: 'anywhere',
          wordBreak: 'break-word',
        }}
      >
        {label}
      </div>
    </div>
  );
}

function SectionHead({
  title,
  titleSuffix,
  right,
}: {
  title: string;
  titleSuffix?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 14,
        position: 'relative',
      }}
    >
      <h3 style={{ fontWeight: 700, fontSize: 14, color: C.text, margin: 0 }}>
        {title}
        {titleSuffix}
      </h3>
      {right}
    </div>
  );
}

// ── Garment upload tips — hover popover ──

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
  const qc = useQueryClient();
  const [gender, setGender] = useState('women');
  const [garmentTypeId, setGarmentTypeId] = useState('');
  const [garmentModalOpen, setGarmentModalOpen] = useState(false);
  const [platform, setPlatform] = useState('Amazon');
  const [aspect, setAspect] = useState(BRAND_CONFIG.Amazon?.default ?? '1:1');
  const [customRatio, setCustomRatio] = useState('');
  const [customWStr, setCustomWStr] = useState('');
  const [customHStr, setCustomHStr] = useState('');
  const [amazonPoseModalOpen, setAmazonPoseModalOpen] = useState(false);
  const [amazonMainPoseId, setAmazonMainPoseId] = useState('');
  // Bypassed: Amazon no longer forces white bg. Logic kept dormant for future use.
  const [amazonUseWhiteBg, _setAmazonUseWhiteBg] = useState(false);

  const brandAspects = BRAND_CONFIG[platform]?.ratios ?? ALL_ASPECTS;
  const effectiveAspect = aspect === 'custom' && customRatio ? customRatio : aspect;

  const { data: resolutionConfigData } = useQuery<{
    resolutions: Record<string, { enabled: boolean; creditCost: number }>;
    maxOutputPx: number;
  }>({
    queryKey: ['resolution-configs'],
    queryFn: () => api.get('/v1/config/resolutions'),
    staleTime: 10 * 60 * 1000,
  });
  const resolutionConfig = resolutionConfigData?.resolutions ?? {
    HD: { enabled: true, creditCost: 25 },
    '2K': { enabled: true, creditCost: 35 },
    '4K': { enabled: true, creditCost: 40 },
  };
  // Admin-configured platform ceiling (Settings → Max Output Resolution) — falls back
  // to 2048 only until the query resolves, never as a silent permanent cap.
  const maxOutputPx = resolutionConfigData?.maxOutputPx ?? 2048;

  // Custom dimension validation — computed at component level so handleSubmit and
  // canGenerate can both reference them without re-deriving inside the render IIFE.
  const customWNum = Number(customWStr);
  const customHNum = Number(customHStr);
  const customWErr =
    customWStr !== '' && (Number.isNaN(customWNum) || customWNum < 768 || customWNum > maxOutputPx);
  const customHErr =
    customHStr !== '' && (Number.isNaN(customHNum) || customHNum < 768 || customHNum > maxOutputPx);
  const customDimsReady =
    aspect !== 'custom' ||
    (!!customRatio && !!customWStr && !!customHStr && !customWErr && !customHErr);
  const customParams =
    aspect === 'custom' && customDimsReady
      ? { outputWidth: customWNum, outputHeight: customHNum }
      : {};

  const outputDims: { w: number; h: number } | null = (() => {
    if (aspect === 'custom') {
      return customDimsReady && customWNum > 0 && customHNum > 0
        ? { w: customWNum, h: customHNum }
        : null;
    }
    const d = ASPECT_PX[effectiveAspect];
    return d ?? null;
  })();
  const resolution: 'HD' | '2K' | '4K' | null = outputDims
    ? resolutionFromOutputDims(outputDims.w, outputDims.h)
    : null;

  const handlePlatformChange = (p: string) => {
    setPlatform(p);
    const cfg = BRAND_CONFIG[p];
    if (cfg) setAspect(cfg.default);
  };
  const [garmentFile, setGarmentFile] = useState<File | null>(null);
  const garmentPreviewUrl = useMemo(
    () => (garmentFile ? URL.createObjectURL(garmentFile) : ''),
    [garmentFile],
  );
  useEffect(() => {
    return () => {
      if (garmentPreviewUrl) URL.revokeObjectURL(garmentPreviewUrl);
    };
  }, [garmentPreviewUrl]);
  const [garmentKey, setGarmentKey] = useState('');
  const [lowerGarmentFile, setLowerGarmentFile] = useState<File | null>(null);
  const lowerGarmentPreviewUrl = useMemo(
    () => (lowerGarmentFile ? URL.createObjectURL(lowerGarmentFile) : ''),
    [lowerGarmentFile],
  );
  useEffect(() => {
    return () => {
      if (lowerGarmentPreviewUrl) URL.revokeObjectURL(lowerGarmentPreviewUrl);
    };
  }, [lowerGarmentPreviewUrl]);
  const [lowerGarmentKey, setLowerGarmentKey] = useState('');
  const [isUploadingLower, setIsUploadingLower] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lowerFileInputRef = useRef<HTMLInputElement>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const lowerUploadAbortRef = useRef<AbortController | null>(null);

  // Abort any in-flight XHR uploads when the component unmounts (user navigates away)
  useEffect(() => {
    return () => {
      uploadAbortRef.current?.abort();
      lowerUploadAbortRef.current?.abort();
    };
  }, []);
  const garmentVisibleCount = 5;
  const modelVisibleCount = 5;
  const [modelModalOpen, setModelModalOpen] = useState(false);
  const backgroundVisibleCount = 5;
  const [backgroundModalOpen, setBackgroundModalOpen] = useState(false);
  const [backgroundItemFilter, setBackgroundItemFilter] = useState<number | ''>('');
  const [backgroundTagFilter, setBackgroundTagFilter] = useState<string>('');
  const templateVisibleCount = 5;
  const [catalogueTemplateId, setCatalogueTemplateId] = useState('custom');
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const poseVisibleCount = 5;
  const [poseModalOpen, setPoseModalOpen] = useState(false);

  const [faceId, setFaceId] = useState('');
  const [backgroundId, setBackgroundId] = useState('');
  const [poseIds, setPoseIds] = useState<string[]>([]);
  const [selectedLookIds, setSelectedLookIds] = useState<string[]>([]);
  const [lowerCatalogId, setLowerCatalogId] = useState('');
  const [shoeCatalogId, setShoeCatalogId] = useState('');
  const [lowerItemsOpen, setLowerItemsOpen] = useState(false);
  const [shoeItemsOpen, setShoeItemsOpen] = useState(false);
  const lowerVisibleCount = 5;
  const shoeVisibleCount = 5;

  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);
  const [submitError, setSubmitError] = useState('');
  const [activeGeneration, setActiveGeneration] = useState<{
    catalogueId: string;
    jobs: GenerationJob[];
  } | null>(null);
  // True from the moment a batch is enqueued until every job in it settles —
  // keeps Generate disabled while the right panel is still rendering progress.
  const [generationInProgress, setGenerationInProgress] = useState(false);
  const [toast, setToast] = useState('');
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((m: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(m);
    toastTimerRef.current = setTimeout(() => setToast(''), 5000);
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
  const { data: backgroundCategories } = useQuery<BackgroundCategoriesResponse>({
    queryKey: ['background-categories', gender],
    queryFn: () => api.get(`/v1/models/background-categories?gender=${gender}`),
    enabled: !!gender,
    staleTime: 60_000,
  });
  const bgNodes = useMemo<CatalogNode[]>(() => {
    if (!backgrounds) return [];
    const byCat = new Map<number, CatalogItem[]>();
    for (const b of backgrounds.items) {
      if (b.categoryId == null) continue;
      if (!byCat.has(b.categoryId)) byCat.set(b.categoryId, []);
      byCat.get(b.categoryId)?.push(b);
    }
    const nodes: CatalogNode[] = (backgroundCategories?.items ?? [])
      .filter((c) => byCat.has(c.id))
      .map((c) => ({
        id: c.id,
        slug: c.slug,
        label: c.label,
        thumbnailUrl: c.thumbnailUrl,
        children: [],
        items: byCat.get(c.id) ?? [],
      }));
    const uncategorized = backgrounds.items.filter((b) => b.categoryId == null);
    if (uncategorized.length > 0) {
      nodes.push({
        id: 0,
        slug: 'other',
        label: 'Other',
        thumbnailUrl: null,
        children: [],
        items: uncategorized,
      });
    }
    return nodes;
  }, [backgrounds, backgroundCategories]);
  const { data: catalogueTemplatesData } = useQuery<{ items: CatalogueTemplateItem[] }>({
    queryKey: ['catalogue-templates', gender, garmentTypeId],
    queryFn: () =>
      api.get(
        `/v1/models/catalogue-templates?gender=${gender}${garmentTypeId ? `&garmentTypeId=${garmentTypeId}` : ''}`,
      ),
    enabled: !!gender,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
  const catalogueTemplates = useMemo(
    () => [
      { id: 'custom', label: 'Custom', thumbnailUrl: null, looks: [] as TemplateLook[] },
      ...(catalogueTemplatesData?.items ?? []),
    ],
    [catalogueTemplatesData],
  );
  const activeTemplate = catalogueTemplates.find((t) => t.id === catalogueTemplateId);
  const selectedLooks = (activeTemplate?.looks ?? []).filter((l) => selectedLookIds.includes(l.id));
  useEffect(() => {
    if (
      catalogueTemplateId !== 'custom' &&
      !(catalogueTemplatesData?.items ?? []).some((t) => t.id === catalogueTemplateId)
    ) {
      setCatalogueTemplateId('custom');
      setSelectedLookIds([]);
    }
  }, [catalogueTemplateId, catalogueTemplatesData]);
  const bgTagsById = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const b of backgrounds?.items ?? []) m.set(b.id, b.tags ?? []);
    return m;
  }, [backgrounds]);
  const bgSpecialTagById = useMemo(() => {
    const m = new Map<string, string | null | undefined>();
    for (const b of backgrounds?.items ?? []) m.set(b.id, b.specialTag);
    return m;
  }, [backgrounds]);
  const bgTags = useMemo(() => {
    const set = new Set<string>();
    for (const b of backgrounds?.items ?? []) for (const t of b.tags ?? []) set.add(t);
    return Array.from(set).sort();
  }, [backgrounds]);
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
  const needsLower =
    catalogueTemplateId === 'custom'
      ? selectedPoses.some((p) => p.hasLower)
      : selectedLooks.some((l) => l.hasLower);
  const needsShoes =
    catalogueTemplateId === 'custom'
      ? selectedPoses.some((p) => p.hasShoes)
      : selectedLooks.some((l) => l.hasShoes);
  const selectedCount = catalogueTemplateId === 'custom' ? poseIds.length : selectedLookIds.length;

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
  const lowerRandomItems = useMemo(() => {
    const allItems = (lowerCatalog?.tree.filter((n) => n.slug !== 'other') ?? []).flatMap(
      flattenNode,
    );
    return [...allItems].sort(() => Math.random() - 0.5).slice(0, lowerVisibleCount);
  }, [lowerCatalog]);
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

  const shoeRandomItems = useMemo(() => {
    const allItems = (shoesCatalog?.tree.filter((n) => n.slug !== 'other') ?? []).flatMap(
      flattenNode,
    );
    return [...allItems].sort(() => Math.random() - 0.5).slice(0, shoeVisibleCount);
  }, [shoesCatalog]);
  const lowerNodes = useMemo(
    () => lowerCatalog?.tree.filter((node) => node.slug !== 'other') ?? [],
    [lowerCatalog],
  );
  const shoeNodes = useMemo(
    () => shoesCatalog?.tree.filter((node) => node.slug !== 'other') ?? [],
    [shoesCatalog],
  );
  const [lowerItemFilter, setLowerItemFilter] = useState<number | ''>('');
  const [shoeItemFilter, setShoeItemFilter] = useState<number | ''>('');

  async function isSupportedImageBytes(file: File): Promise<boolean> {
    const buf = await file.slice(0, 12).arrayBuffer();
    const b = new Uint8Array(buf);
    const isJpeg = b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    const isPng =
      b[0] === 0x89 &&
      b[1] === 0x50 &&
      b[2] === 0x4e &&
      b[3] === 0x47 &&
      b[4] === 0x0d &&
      b[5] === 0x0a &&
      b[6] === 0x1a &&
      b[7] === 0x0a;
    const isWebp =
      b[0] === 0x52 &&
      b[1] === 0x49 &&
      b[2] === 0x46 &&
      b[3] === 0x46 &&
      b[8] === 0x57 &&
      b[9] === 0x45 &&
      b[10] === 0x42 &&
      b[11] === 0x50;
    return isJpeg || isPng || isWebp;
  }

  async function handleGarmentUpload(file: File) {
    if (isUploading) return;
    if (file.size > 10 * 1024 * 1024) {
      showToast('File exceeds 10 MB. Please choose a smaller image.');
      return;
    }
    if (!(await isSupportedImageBytes(file))) {
      showToast('Unsupported file type. Please upload a JPEG, PNG, or WebP image.');
      return;
    }
    setGarmentFile(file);
    setIsUploading(true);
    setUploadProgress(0);
    const abort = new AbortController();
    uploadAbortRef.current = abort;
    try {
      const { uploadUrl, r2Key } = await api.post<{
        uploadUrl: string;
        r2Key: string;
        expiresIn: number;
      }>('/v1/uploads/presign', { contentType: file.type, contentLength: file.size });
      await api.uploadToR2WithProgress(uploadUrl, file, setUploadProgress, abort.signal);
      setGarmentKey(r2Key);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      const msg = (e as Error).message ?? '';
      showToast(
        msg.includes('403')
          ? 'Upload session expired. Please re-select your image and try again.'
          : `Upload failed: ${msg}`,
      );
      setGarmentFile(null);
    } finally {
      setIsUploading(false);
    }
  }

  async function handleLowerGarmentUpload(file: File) {
    if (isUploadingLower) return;
    if (file.size > 10 * 1024 * 1024) {
      showToast('File exceeds 10 MB. Please choose a smaller image.');
      return;
    }
    if (!(await isSupportedImageBytes(file))) {
      showToast('Unsupported file type. Please upload a JPEG, PNG, or WebP image.');
      return;
    }
    setLowerGarmentFile(file);
    setIsUploadingLower(true);
    const lowerAbort = new AbortController();
    lowerUploadAbortRef.current = lowerAbort;
    try {
      const { uploadUrl, r2Key } = await api.post<{
        uploadUrl: string;
        r2Key: string;
        expiresIn: number;
      }>('/v1/uploads/presign', { contentType: file.type, contentLength: file.size });
      await api.uploadToR2WithProgress(uploadUrl, file, () => {}, lowerAbort.signal);
      setLowerGarmentKey(r2Key);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      const msg = (e as Error).message ?? '';
      showToast(
        msg.includes('403')
          ? 'Upload session expired. Please re-select your image and try again.'
          : `Lower garment upload failed: ${msg}`,
      );
      setLowerGarmentFile(null);
      setLowerGarmentKey('');
    } finally {
      setIsUploadingLower(false);
    }
  }

  function handleFaceSelect(id: string) {
    setFaceId(id);
    setCatalogueTemplateId('custom');
    setSelectedLookIds([]);
    setBackgroundId('');
    setPoseIds([]);
    setLowerCatalogId('');
    setShoeCatalogId('');
  }
  function handleBackgroundSelect(id: string) {
    setCatalogueTemplateId('custom');
    setBackgroundId(id);
    setPoseIds([]);
    setLowerCatalogId('');
    setShoeCatalogId('');
  }
  function handleCatalogueTemplateSelect(id: string) {
    setCatalogueTemplateId(id);
    setSelectedLookIds([]);
    setBackgroundId('');
    setPoseIds([]);
    setLowerCatalogId('');
    setShoeCatalogId('');
  }
  function handleLookToggle(id: string) {
    setSelectedLookIds((prev) =>
      prev.includes(id) ? prev.filter((l) => l !== id) : [...prev, id],
    );
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

  const RESOLUTION_COSTS = {
    HD: resolutionConfig.HD?.creditCost ?? 25,
    '2K': resolutionConfig['2K']?.creditCost ?? 35,
    '4K': resolutionConfig['4K']?.creditCost ?? 40,
  } as const;

  async function handleSubmit() {
    if (isSubmittingRef.current) return;
    if (!garmentKey || !faceId || !backgroundId || poseIds.length === 0 || !resolution) return;

    // Amazon main listing + multiple poses → show picker modal to choose main image.
    // Lifestyle mode or single pose → submit directly.
    if (platform === 'Amazon' && amazonUseWhiteBg && poseIds.length > 1) {
      setAmazonMainPoseId('');
      setAmazonPoseModalOpen(true);
      return;
    }

    isSubmittingRef.current = true;
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
          aspectRatio: effectiveAspect,
          resolution,
          ...(Object.keys(customParams).length ? { params: customParams } : {}),
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
            // biome-ignore lint/style/noNonNullAssertion: jobIds and poseIds are the same length by construction
            id: jobIds[i]!,
            poseId,
            label: pose?.label ?? `Pose ${i + 1}`,
            thumbnailUrl: pose?.thumbnailUrl ?? '',
          };
        }),
      });
      setGenerationInProgress(true);
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    } catch (e) {
      setSubmitError((e as Error).message);
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  async function submitAmazonPose(mainPoseId: string) {
    if (isSubmittingRef.current) return;
    setAmazonPoseModalOpen(false);
    isSubmittingRef.current = true;
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
      const { catalogueId, jobIds: mainJobIds } = await api.post<{
        catalogueId: string;
        jobIds: string[];
      }>('/v1/jobs/tryon', {
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
        aspectRatio: effectiveAspect,
        resolution,
        ...(Object.keys(customParams).length ? { params: customParams } : {}),
        platform: 'Amazon',
      });

      // Remaining poses: same catalogue, original background, no Amazon override
      const remainingPoseIds = poseIds.filter((id) => id !== mainPoseId);
      let remainingJobIds: string[] = [];
      if (remainingPoseIds.length > 0) {
        const remaining = await api.post<{ jobIds: string[] }>('/v1/jobs/tryon', {
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
          aspectRatio: effectiveAspect,
          resolution,
          ...(Object.keys(customParams).length ? { params: customParams } : {}),
        });
        remainingJobIds = remaining.jobIds;
      }

      qc.invalidateQueries({ queryKey: ['credits'] });
      qc.invalidateQueries({ queryKey: ['catalogues'] });
      const orderedPoseIds = [mainPoseId, ...remainingPoseIds];
      const orderedJobIds = [...mainJobIds, ...remainingJobIds];
      setActiveGeneration({
        catalogueId,
        jobs: orderedPoseIds.map((poseId, i) => {
          const pose = poses?.items.find((p) => p.id === poseId);
          return {
            // biome-ignore lint/style/noNonNullAssertion: orderedJobIds and orderedPoseIds are the same length by construction
            id: orderedJobIds[i]!,
            poseId,
            label: pose?.label ?? `Pose ${i + 1}`,
            thumbnailUrl: pose?.thumbnailUrl ?? '',
          };
        }),
      });
      setGenerationInProgress(true);
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    } catch (e) {
      setSubmitError((e as Error).message);
      isSubmittingRef.current = false;
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
    customDimsReady &&
    !!resolution &&
    !isUploading &&
    !isUploadingLower &&
    !isSubmitting &&
    !generationInProgress;

  const generateBlocker = generationInProgress
    ? 'Generation in progress…'
    : isUploading
      ? 'Waiting for upload to finish…'
      : !garmentKey
        ? 'Upload a garment image first'
        : poseIds.length === 0
          ? 'Select at least one pose'
          : !customDimsReady
            ? 'Enter valid width and height for custom size'
            : '';

  return (
    <>
      <TopBar
        title="Studio"
        subtitle="Create premium AI catalogue shoots from flat lay garments in minutes."
      />
      <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 20, padding: '24px 28px' }}>
        <div
          style={{
            flex: '1 1 0',
            minWidth: 0,
            maxWidth: 880,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
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
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20 }}>
                {GENDERS.map((g) => (
                  <GenderCard
                    key={g.value}
                    img={g.img}
                    label={g.label}
                    selected={gender === g.value}
                    onClick={() => {
                      setGender(g.value);
                      setGarmentTypeId('');
                      setCatalogueTemplateId('custom');
                      setGarmentModalOpen(false);
                    }}
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
                    type="button"
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
                      aria-hidden="true"
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
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 20 }}>
                  {(() => {
                    const all = garmentTypes.items;
                    const inFirstN = all
                      .slice(0, garmentVisibleCount)
                      .some((s) => s.id === garmentTypeId);
                    const visible =
                      garmentTypeId && !inFirstN
                        ? [
                            // biome-ignore lint/style/noNonNullAssertion: inFirstN is false here, so the find returns a value
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
                      const img =
                        s.thumbnailUrl ??
                        // biome-ignore lint/style/noNonNullAssertion: fallbackKey is derived from a key in OUTFIT_IMG
                        (fallbackKey ? OUTFIT_IMG[fallbackKey]! : null);
                      return (
                        <VisualCard
                          key={s.id}
                          img={img}
                          label={s.label}
                          width="100%"
                          selected={garmentTypeId === s.id}
                          onClick={() => {
                            const next = garmentTypeId === s.id ? '' : s.id;
                            setGarmentTypeId(next);
                            if (next && next !== garmentTypeId) {
                              setFaceId('');
                              setCatalogueTemplateId('custom');
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
                    gap: 12,
                    background: C.field,
                    borderRadius: 12,
                    border: `1px dashed ${C.border}`,
                    padding: '0 10px',
                    boxSizing: 'border-box',
                  }}
                >
                  {/* Upload zone wrapper — stacks vertically when two uploads */}
                  <div
                    style={{
                      flex: 1,
                      display: 'flex',
                      flexDirection: requiresLowerUpload ? 'column' : 'row',
                      gap: requiresLowerUpload ? 8 : 0,
                      height: 210,
                      minWidth: 0,
                    }}
                  >
                    {/* Upper garment label */}
                    <label
                      style={{
                        flex: 1,
                        minWidth: 0,
                        height: requiresLowerUpload ? undefined : 210,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 12,
                        background: C.card,
                        border: `1px solid ${C.border}`,
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
                          {/* biome-ignore lint/performance/noImgElement: static image, Next Image not needed */}
                          <img
                            src={garmentPreviewUrl}
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
                          <div
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              gap: 4,
                            }}
                          >
                            <span
                              style={{
                                width: '100%',
                                fontSize: requiresLowerUpload ? 11 : 12,
                                fontWeight: 500,
                                lineHeight: '100%',
                                color: C.text,
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
                                color: C.mid,
                                textAlign: 'center',
                              }}
                            >
                              {requiresLowerUpload
                                ? 'JPG, PNG · Max 10MB'
                                : 'Drag and drop an image here · JPG, PNG · Max 10MB'}
                            </span>
                          </div>
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: 6,
                            }}
                          >
                            <ImagePlusIcon size={14} />
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 500,
                                lineHeight: '18px',
                                color: C.text,
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

                    {requiresLowerUpload && (
                      <label
                        style={{
                          flex: 1,
                          minWidth: 0,
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 12,
                          background: C.card,
                          border: `1px solid ${C.border}`,
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
                            {/* biome-ignore lint/performance/noImgElement: static image, Next Image not needed */}
                            <img
                              src={lowerGarmentPreviewUrl}
                              alt={lowerGarmentFile.name}
                              style={{
                                width: '100%',
                                height: '100%',
                                objectFit: 'contain',
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
                            <div
                              style={{
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                gap: 4,
                              }}
                            >
                              <span
                                style={{
                                  width: '100%',
                                  fontSize: 11,
                                  fontWeight: 500,
                                  lineHeight: '100%',
                                  color: C.text,
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
                                  color: C.mid,
                                  textAlign: 'center',
                                }}
                              >
                                JPG, PNG · Max 10MB
                              </span>
                            </div>
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: 6,
                              }}
                            >
                              <ImagePlusIcon size={14} />
                              <span
                                style={{
                                  fontSize: 11,
                                  fontWeight: 500,
                                  lineHeight: '18px',
                                  color: C.text,
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

                  {selectedGarmentType?.instructionImageUrl && (
                    <div
                      style={{
                        flex: 1,
                        height: 210,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        minWidth: 0,
                        borderRadius: 8,
                        overflow: 'hidden',
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {/* biome-ignore lint/performance/noImgElement: dynamic instruction image */}
                      <img
                        src={selectedGarmentType.instructionImageUrl}
                        alt="Upload instructions"
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'contain',
                        }}
                      />
                    </div>
                  )}
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
                    type="button"
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
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16 }}>
                  {(() => {
                    const inFirstN = filteredFaces
                      .slice(0, modelVisibleCount)
                      .some((f) => f.id === faceId);
                    const selectedFace = faceId
                      ? filteredFaces.find((f) => f.id === faceId)
                      : undefined;
                    const visibleFaces =
                      selectedFace && !inFirstN
                        ? [
                            selectedFace,
                            ...filteredFaces
                              .filter((f) => f.id !== faceId)
                              .slice(0, modelVisibleCount - 1),
                          ]
                        : filteredFaces.slice(0, modelVisibleCount);
                    return visibleFaces.map((f) => (
                      <SelCard
                        key={f.id}
                        selected={faceId === f.id}
                        onClick={() => handleFaceSelect(f.id)}
                        imageUrl={f.thumbnailUrl}
                        label={f.label}
                        w="100%"
                        ratio={215.2 / 212.67}
                      />
                    ));
                  })()}
                </div>
              )}
              {modelModalOpen && faces && (
                <SelectGridModal
                  title="Choose your model"
                  items={filteredFaces}
                  selectedIds={faceId ? [faceId] : []}
                  aspect={1}
                  columns={5}
                  onSelect={(id) => {
                    handleFaceSelect(id);
                    setModelModalOpen(false);
                  }}
                  onClose={() => setModelModalOpen(false)}
                />
              )}
            </section>

            {/* ── Ready-made catalogue templates ── */}
            <section>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 14,
                }}
              >
                <SectionHead title="Select a Ready-Made Catalogue Template" />
                {catalogueTemplates.length > templateVisibleCount && (
                  <button
                    type="button"
                    onClick={() => setTemplateModalOpen(true)}
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
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
                {(() => {
                  const firstN = catalogueTemplates.slice(0, templateVisibleCount);
                  const selected = catalogueTemplates.find(
                    (template) => template.id === catalogueTemplateId,
                  );
                  const visibleTemplates =
                    selected && !firstN.some((template) => template.id === selected.id)
                      ? [selected, ...firstN].slice(0, templateVisibleCount)
                      : firstN;
                  return visibleTemplates.map((template) => (
                    <SelCard
                      key={template.id}
                      selected={catalogueTemplateId === template.id}
                      onClick={() => handleCatalogueTemplateSelect(template.id)}
                      imageUrl={template.thumbnailUrl}
                      label={template.label}
                      w="100%"
                      ratio={215.2 / 282}
                      emptyContent={
                        template.id === 'custom' ? (
                          <div
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: 10,
                              padding: 16,
                              color: C.text,
                            }}
                          >
                            <span
                              style={{
                                width: 44,
                                height: 44,
                                borderRadius: 10,
                                display: 'grid',
                                placeItems: 'center',
                                background: C.white,
                                border: `1px solid ${C.border}`,
                                color: C.pink,
                              }}
                            >
                              <ImagePlusIcon size={22} />
                            </span>
                            <span
                              style={{
                                maxWidth: 110,
                                fontSize: 12,
                                fontWeight: 600,
                                lineHeight: 1.35,
                              }}
                            >
                              Create your own look
                            </span>
                          </div>
                        ) : undefined
                      }
                    />
                  ));
                })()}
              </div>
              {templateModalOpen && (
                <SelectGridModal
                  title="Select a Ready-Made Catalogue Template"
                  items={catalogueTemplates}
                  selectedIds={[catalogueTemplateId]}
                  aspect={215.2 / 282}
                  columns={5}
                  onSelect={(id) => {
                    handleCatalogueTemplateSelect(id);
                    setTemplateModalOpen(false);
                  }}
                  onClose={() => setTemplateModalOpen(false)}
                />
              )}
            </section>

            {/* ── Background (custom mode only) ── */}
            {catalogueTemplateId === 'custom' && (
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
                      type="button"
                      onClick={() => {
                        setBackgroundItemFilter('');
                        setBackgroundTagFilter('');
                        setBackgroundModalOpen(true);
                      }}
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
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16 }}>
                    {(() => {
                      const frontIds = new Set(
                        backgrounds.items.filter((b) => b.specialTag).map((b) => b.id),
                      );
                      const allItems = [...backgrounds.items].sort(
                        (a, b) => (frontIds.has(a.id) ? 0 : 1) - (frontIds.has(b.id) ? 0 : 1),
                      );
                      const firstN = allItems.slice(0, backgroundVisibleCount);
                      const inFirstN = firstN.some((b) => b.id === backgroundId);
                      const selected = allItems.find((b) => b.id === backgroundId);
                      const visibleItems =
                        selected && !inFirstN
                          ? [selected, ...firstN].slice(0, backgroundVisibleCount)
                          : firstN;
                      return visibleItems.map((b) => (
                        <SelCard
                          key={b.id}
                          selected={backgroundId === b.id}
                          onClick={() => handleBackgroundSelect(b.id)}
                          imageUrl={b.thumbnailUrl}
                          label={b.label}
                          w="100%"
                          ratio={1}
                          badges={<TagBadge tag={b.specialTag} />}
                        />
                      ));
                    })()}
                  </div>
                )}
                {backgroundModalOpen &&
                  (() => {
                    const byCategory =
                      backgroundItemFilter === ''
                        ? bgNodes.flatMap(flattenNode)
                        : flattenNode(
                            bgNodes.find((n) => n.id === backgroundItemFilter) ?? {
                              id: 0,
                              slug: '',
                              label: '',
                              thumbnailUrl: null,
                              children: [],
                              items: [],
                            },
                          );
                    const filteredItems =
                      backgroundTagFilter === ''
                        ? byCategory
                        : byCategory.filter((i) =>
                            (bgTagsById.get(i.id) ?? []).includes(backgroundTagFilter),
                          );
                    return (
                      // biome-ignore lint/a11y/noStaticElementInteractions: modal backdrop; click outside dismisses
                      <div
                        role="presentation"
                        style={{
                          position: 'fixed',
                          inset: 0,
                          background: 'rgba(0,0,0,0.4)',
                          zIndex: 1000,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                        onClick={() => setBackgroundModalOpen(false)}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') setBackgroundModalOpen(false);
                        }}
                      >
                        {/* biome-ignore lint/a11y/noStaticElementInteractions: modal panel; click swallowed to prevent backdrop dismiss */}
                        <div
                          style={{
                            background: C.white,
                            borderRadius: 12,
                            padding: 24,
                            width: 1180,
                            height: 857,
                            maxWidth: '90vw',
                            maxHeight: '90vh',
                            overflowY: 'auto',
                            boxSizing: 'border-box',
                            boxShadow: '0 10px 40px rgba(0,0,0,0.15)',
                          }}
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={() => {}}
                        >
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              marginBottom: 16,
                            }}
                          >
                            <h2 style={{ fontSize: 18, fontWeight: 700, color: C.text, margin: 0 }}>
                              Select Background
                            </h2>
                            <button
                              type="button"
                              onClick={() => setBackgroundModalOpen(false)}
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
                          <div
                            style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}
                          >
                            <button
                              type="button"
                              onClick={() => setBackgroundItemFilter('')}
                              style={pill(backgroundItemFilter === '')}
                            >
                              All
                            </button>
                            {bgNodes.map((node) => (
                              <button
                                type="button"
                                key={node.id}
                                onClick={() => setBackgroundItemFilter(node.id)}
                                style={pill(backgroundItemFilter === node.id)}
                              >
                                {node.label}
                              </button>
                            ))}
                          </div>
                          {bgTags.length > 0 && (
                            <div
                              style={{
                                display: 'flex',
                                flexWrap: 'wrap',
                                gap: 8,
                                marginBottom: 20,
                              }}
                            >
                              <button
                                type="button"
                                onClick={() => setBackgroundTagFilter('')}
                                style={pill(backgroundTagFilter === '')}
                              >
                                All tags
                              </button>
                              {bgTags.map((tag) => (
                                <button
                                  type="button"
                                  key={tag}
                                  onClick={() => setBackgroundTagFilter(tag)}
                                  style={pill(backgroundTagFilter === tag)}
                                >
                                  {tag}
                                </button>
                              ))}
                            </div>
                          )}
                          {filteredItems.length === 0 ? (
                            <p style={{ fontSize: 14, color: C.mid }}>
                              No backgrounds in this category yet.
                            </p>
                          ) : (
                            <div
                              style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(5, 1fr)',
                                gap: 12,
                              }}
                            >
                              {filteredItems.map((i) => (
                                <SelCard
                                  key={i.id}
                                  selected={backgroundId === i.id}
                                  onClick={() => {
                                    handleBackgroundSelect(i.id);
                                    setBackgroundModalOpen(false);
                                  }}
                                  imageUrl={i.thumbnailUrl}
                                  label={i.label}
                                  w="100%"
                                  ratio={1}
                                  badges={<TagBadge tag={bgSpecialTagById.get(i.id)} />}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}
              </section>
            )}

            {/* ── Poses (custom mode only) ── */}
            {catalogueTemplateId === 'custom' && (
              <section>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 14,
                  }}
                >
                  <SectionHead
                    title="Choose Poses"
                    titleSuffix={
                      poseIds.length > 0 && (
                        <span
                          style={{ fontWeight: 500, fontSize: 12, color: C.mid, marginLeft: 6 }}
                        >
                          ({poseIds.length} selected)
                        </span>
                      )
                    }
                  />
                  {(poses?.items.length ?? 0) > poseVisibleCount && (
                    <button
                      type="button"
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
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
                    {(() => {
                      const firstN = poses.items.slice(0, poseVisibleCount);
                      const offScreenSelected = poseIds
                        .filter((id) => !firstN.some((p) => p.id === id))
                        .map((id) => poses.items.find((p) => p.id === id))
                        .filter((p): p is PoseItem => !!p);
                      const visiblePoses = [...offScreenSelected, ...firstN].slice(
                        0,
                        poseVisibleCount,
                      );
                      return visiblePoses.map((p) => (
                        <SelCard
                          key={p.id}
                          selected={poseIds.includes(p.id)}
                          onClick={() => handlePoseSelect(p.id)}
                          imageUrl={p.thumbnailUrl}
                          label={p.label}
                          w="100%"
                          ratio={215.2 / 282}
                        />
                      ));
                    })()}
                  </div>
                )}
                {poseModalOpen && poses && (
                  <SelectGridModal
                    title="Choose Poses"
                    items={poses.items}
                    selectedIds={poseIds}
                    multiSelect
                    aspect={3 / 4}
                    columns={5}
                    onSelect={(id) => handlePoseSelect(id)}
                    onClose={() => setPoseModalOpen(false)}
                    continueLabel="Continue with {count} poses"
                  />
                )}
              </section>
            )}

            {/* ── Choose Looks (template mode only) ── */}
            {catalogueTemplateId !== 'custom' && (
              <section>
                <SectionHead
                  title="Choose Looks"
                  titleSuffix={
                    selectedLookIds.length > 0 && (
                      <span style={{ fontWeight: 500, fontSize: 12, color: C.mid, marginLeft: 6 }}>
                        ({selectedLookIds.length} selected)
                      </span>
                    )
                  }
                />
                {(activeTemplate?.looks.length ?? 0) === 0 ? (
                  <p style={{ fontSize: 14, color: C.mid }}>
                    No looks available for this garment type yet.
                  </p>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
                    {(activeTemplate?.looks ?? []).map((look) => (
                      <SelCard
                        key={look.id}
                        selected={selectedLookIds.includes(look.id)}
                        onClick={() => handleLookToggle(look.id)}
                        imageUrl={look.poseThumbnailUrl}
                        label={`${look.poseLabel} · ${look.backgroundLabel}`}
                        w="100%"
                        ratio={215.2 / 282}
                      />
                    ))}
                  </div>
                )}
              </section>
            )}

            {needsLower &&
              !requiresLowerUpload &&
              (() => {
                const lowerNodes = lowerCatalog?.tree.filter((node) => node.slug !== 'other') ?? [];
                const totalItems = lowerNodes.reduce((n, node) => n + flattenNode(node).length, 0);
                return (
                  <section>
                    <SectionHead
                      title="Lower Garment"
                      right={
                        totalItems > lowerVisibleCount && (
                          <button
                            type="button"
                            onClick={() => {
                              setLowerItemFilter('');
                              setLowerItemsOpen(true);
                            }}
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
                        )
                      }
                    />
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
                    ) : totalItems === 0 ? (
                      <p style={{ fontSize: 14, color: C.mid }}>
                        No lower garment options available yet.
                      </p>
                    ) : (
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(5, 1fr)',
                          gap: 12,
                        }}
                      >
                        {(() => {
                          const allItems = lowerNodes.flatMap(flattenNode);
                          const selectedItem = lowerCatalogId
                            ? allItems.find((i) => i.id === lowerCatalogId)
                            : null;
                          const inFirstN =
                            !!selectedItem &&
                            lowerRandomItems.some((i) => i.id === selectedItem.id);
                          const visibleItems =
                            selectedItem && !inFirstN
                              ? [
                                  selectedItem,
                                  ...lowerRandomItems.filter((i) => i.id !== selectedItem.id),
                                ].slice(0, lowerVisibleCount)
                              : lowerRandomItems;
                          return visibleItems.map((i) => (
                            <SelCard
                              key={i.id}
                              selected={lowerCatalogId === i.id}
                              onClick={() => setLowerCatalogId(lowerCatalogId === i.id ? '' : i.id)}
                              imageUrl={i.thumbnailUrl}
                              w="100%"
                              ratio={3 / 4}
                            />
                          ));
                        })()}
                      </div>
                    )}
                  </section>
                );
              })()}

            {needsShoes &&
              (() => {
                const shoeNodes = shoesCatalog?.tree.filter((node) => node.slug !== 'other') ?? [];
                const totalItems = shoeNodes.reduce((n, node) => n + flattenNode(node).length, 0);
                return (
                  <section>
                    <SectionHead
                      title="Footwear"
                      right={
                        totalItems > shoeVisibleCount && (
                          <button
                            type="button"
                            onClick={() => {
                              setShoeItemFilter('');
                              setShoeItemsOpen(true);
                            }}
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
                        )
                      }
                    />
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
                    ) : totalItems === 0 ? (
                      <p style={{ fontSize: 14, color: C.mid }}>No shoe options available yet.</p>
                    ) : (
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(5, 1fr)',
                          gap: 12,
                        }}
                      >
                        {(() => {
                          const allItems = shoeNodes.flatMap(flattenNode);
                          const selectedItem = shoeCatalogId
                            ? allItems.find((i) => i.id === shoeCatalogId)
                            : null;
                          const inFirstN =
                            !!selectedItem && shoeRandomItems.some((i) => i.id === selectedItem.id);
                          const visibleItems =
                            selectedItem && !inFirstN
                              ? [
                                  selectedItem,
                                  ...shoeRandomItems.filter((i) => i.id !== selectedItem.id),
                                ].slice(0, shoeVisibleCount)
                              : shoeRandomItems;
                          return visibleItems.map((i) => (
                            <SelCard
                              key={i.id}
                              selected={shoeCatalogId === i.id}
                              onClick={() => setShoeCatalogId(shoeCatalogId === i.id ? '' : i.id)}
                              imageUrl={i.thumbnailUrl}
                              w="100%"
                              ratio={1}
                            />
                          ));
                        })()}
                      </div>
                    )}
                  </section>
                );
              })()}

            <section>
              <SectionHead title="Publishing Platform" />
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {PLATFORMS.map((p) => (
                  <button
                    type="button"
                    key={p}
                    onClick={() => handlePlatformChange(p)}
                    style={pill(platform === p)}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </section>

            <section>
              <SectionHead title="Aspect Ratio" />

              {/* ── Pill row: hide presets when custom is active ── */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {aspect !== 'custom' &&
                  ALL_ASPECTS.map((r) => {
                    const supported = brandAspects.includes(r);
                    return (
                      <button
                        type="button"
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
                <button
                  type="button"
                  onClick={() => {
                    setAspect('custom');
                    setCustomRatio('');
                    setCustomWStr('');
                    setCustomHStr('');
                  }}
                  style={pill(aspect === 'custom')}
                >
                  Custom
                </button>
              </div>

              {/* ── Custom sub-panel ── */}
              {aspect === 'custom' &&
                (() => {
                  const [rW, rH] = customRatio ? customRatio.split(':').map(Number) : [0, 0];
                  const wErr = customWErr;
                  const hErr = customHErr;
                  const wNum = customWNum;
                  const hNum = customHNum;

                  const handleWChange = (val: string) => {
                    setCustomWStr(val);
                    if (rW && rH && val !== '') {
                      const n = Math.round((Number(val) * rH) / rW);
                      setCustomHStr(String(n));
                    }
                  };
                  const handleHChange = (val: string) => {
                    setCustomHStr(val);
                    if (rW && rH && val !== '') {
                      const n = Math.round((Number(val) * rW) / rH);
                      setCustomWStr(String(n));
                    }
                  };

                  const inputBase: React.CSSProperties = {
                    width: 86,
                    padding: '6px 8px',
                    borderRadius: 6,
                    fontSize: 13,
                    color: C.text,
                    background: C.bg,
                    outline: 'none',
                  };

                  return (
                    <div style={{ marginTop: 12 }}>
                      <p style={{ fontSize: 11, color: C.light, margin: '0 0 6px' }}>
                        Select aspect ratio
                      </p>
                      {/* Ratio pills + inputs in one aligned row */}
                      <div
                        style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
                      >
                        {ALL_ASPECTS.map((r) => (
                          <button
                            type="button"
                            key={r}
                            onClick={() => {
                              setCustomRatio(r);
                              setCustomWStr('');
                              setCustomHStr('');
                            }}
                            style={{ ...pill(customRatio === r), flexShrink: 0 }}
                          >
                            {r}
                          </button>
                        ))}

                        {customRatio && (
                          <>
                            <div
                              style={{ width: 1, height: 24, background: C.border, flexShrink: 0 }}
                            />

                            <input
                              type="number"
                              placeholder="Width"
                              value={customWStr}
                              onChange={(e) => handleWChange(e.target.value)}
                              style={{
                                ...inputBase,
                                border: `1px solid ${wErr ? '#F55C7A' : C.border}`,
                              }}
                            />

                            <span style={{ fontSize: 13, color: C.light, flexShrink: 0 }}>×</span>

                            <input
                              type="number"
                              placeholder="Height"
                              value={customHStr}
                              onChange={(e) => handleHChange(e.target.value)}
                              style={{
                                ...inputBase,
                                border: `1px solid ${hErr ? '#F55C7A' : C.border}`,
                              }}
                            />
                          </>
                        )}
                      </div>

                      {customRatio && (
                        <p
                          style={{
                            fontSize: 11,
                            color: wErr || hErr ? '#F55C7A' : C.light,
                            margin: '5px 0 0',
                          }}
                        >
                          {wErr || hErr
                            ? `${(wErr && wNum < 768) || (hErr && hNum < 768) ? 'Min 768px' : `Max ${maxOutputPx}px`}`
                            : `Min 768px · Max ${maxOutputPx}px`}
                        </p>
                      )}
                    </div>
                  );
                })()}

              {/* ── Dimension hint ── */}
              {aspect !== 'custom' && (
                <div style={{ marginTop: 8, fontSize: 11, color: C.light }}>
                  {ASPECT_DIMS[aspect]}
                </div>
              )}
            </section>

            {/* ── Resolution (read-only, auto-derived from output dims) ── */}
            {resolution && (
              <section>
                <SectionHead
                  title="Output Resolution"
                  right={
                    <span style={{ fontSize: 11, color: C.light, fontWeight: 400 }}>Auto</span>
                  }
                />
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  {(
                    [
                      { key: 'HD' as const, label: 'HD' },
                      { key: '2K' as const, label: '2K' },
                      { key: '4K' as const, label: '4K' },
                    ] as const
                  )
                    .filter((r) => resolutionConfig[r.key]?.enabled !== false)
                    .map((r) => {
                      const credits =
                        resolutionConfig[r.key]?.creditCost ?? RESOLUTION_COSTS[r.key];
                      const active = resolution === r.key;
                      return (
                        <div
                          key={r.key}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '8px 16px',
                            borderRadius: 99,
                            border: active ? `1.5px solid ${C.pink}` : `1.5px solid ${C.border2}`,
                            background: active ? 'rgba(245,92,122,0.04)' : C.white,
                            boxSizing: 'border-box',
                            userSelect: 'none',
                            opacity: active ? 1 : 0.45,
                          }}
                        >
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
                            style={{
                              fontSize: 14,
                              fontWeight: 600,
                              color: active ? C.pink : C.text,
                            }}
                          >
                            {r.label}
                          </span>
                          <span
                            style={{
                              fontSize: 13,
                              color: active ? C.pink : C.mid,
                              fontWeight: 400,
                            }}
                          >
                            ({credits} credits)
                          </span>
                        </div>
                      );
                    })}
                </div>
              </section>
            )}
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
                  {isSubmitting || generationInProgress ? (
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

        <div style={{ flex: '1 1 0', minWidth: 0, maxWidth: 880 }}>
          {activeGeneration ? (
            <GenerationPanel
              catalogueId={activeGeneration.catalogueId}
              jobs={activeGeneration.jobs}
              garmentPreviewUrl={garmentPreviewUrl}
              onAllSettled={() => setGenerationInProgress(false)}
            />
          ) : (
            <PreviewPanel />
          )}
        </div>
      </div>

      {/* Garment Type Modal */}
      {garmentModalOpen && garmentTypes && (
        <SelectGridModal
          title="Choose Garment Type"
          aspect={1}
          columns={5}
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
              setCatalogueTemplateId('custom');
              setBackgroundId('');
              setPoseIds([]);
              setLowerCatalogId('');
              setShoeCatalogId('');
            }
          }}
          onClose={() => setGarmentModalOpen(false)}
        />
      )}

      {/* Lower Garment items modal — categories act as filters */}
      {lowerItemsOpen &&
        (() => {
          const filteredItems =
            lowerItemFilter === ''
              ? lowerNodes.flatMap(flattenNode)
              : flattenNode(
                  lowerNodes.find((n) => n.id === lowerItemFilter) ?? {
                    id: 0,
                    slug: '',
                    label: '',
                    thumbnailUrl: null,
                    children: [],
                    items: [],
                  },
                );
          return (
            // biome-ignore lint/a11y/noStaticElementInteractions: modal backdrop; click outside dismisses
            <div
              role="presentation"
              style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(0,0,0,0.4)',
                zIndex: 1000,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              onClick={() => setLowerItemsOpen(false)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setLowerItemsOpen(false);
              }}
            >
              {/* biome-ignore lint/a11y/noStaticElementInteractions: modal panel; click swallowed to prevent backdrop dismiss */}
              <div
                style={{
                  background: C.white,
                  borderRadius: 12,
                  padding: 24,
                  width: 1180,
                  height: 857,
                  maxWidth: '90vw',
                  maxHeight: '90vh',
                  overflowY: 'auto',
                  boxSizing: 'border-box',
                  boxShadow: '0 10px 40px rgba(0,0,0,0.15)',
                }}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={() => {}}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 16,
                  }}
                >
                  <h2 style={{ fontSize: 18, fontWeight: 700, color: C.text, margin: 0 }}>
                    Lower Garment
                  </h2>
                  <button
                    type="button"
                    onClick={() => setLowerItemsOpen(false)}
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
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
                  <button
                    type="button"
                    onClick={() => setLowerItemFilter('')}
                    style={pill(lowerItemFilter === '')}
                  >
                    All
                  </button>
                  {lowerNodes.map((node) => (
                    <button
                      type="button"
                      key={node.id}
                      onClick={() => setLowerItemFilter(node.id)}
                      style={pill(lowerItemFilter === node.id)}
                    >
                      {node.label}
                    </button>
                  ))}
                </div>
                {filteredItems.length === 0 ? (
                  <p style={{ fontSize: 14, color: C.mid }}>No items in this category yet.</p>
                ) : (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(5, 1fr)',
                      gap: 12,
                    }}
                  >
                    {filteredItems.map((i) => (
                      <SelCard
                        key={i.id}
                        selected={lowerCatalogId === i.id}
                        onClick={() => {
                          setLowerCatalogId(lowerCatalogId === i.id ? '' : i.id);
                          setLowerItemsOpen(false);
                        }}
                        imageUrl={i.thumbnailUrl}
                        w="100%"
                        ratio={3 / 4}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })()}

      {/* Footwear items modal — categories act as filters */}
      {shoeItemsOpen &&
        (() => {
          const filteredItems =
            shoeItemFilter === ''
              ? shoeNodes.flatMap(flattenNode)
              : flattenNode(
                  shoeNodes.find((n) => n.id === shoeItemFilter) ?? {
                    id: 0,
                    slug: '',
                    label: '',
                    thumbnailUrl: null,
                    children: [],
                    items: [],
                  },
                );
          return (
            // biome-ignore lint/a11y/noStaticElementInteractions: modal backdrop; click outside dismisses
            <div
              role="presentation"
              style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(0,0,0,0.4)',
                zIndex: 1000,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              onClick={() => setShoeItemsOpen(false)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setShoeItemsOpen(false);
              }}
            >
              {/* biome-ignore lint/a11y/noStaticElementInteractions: modal panel; click swallowed to prevent backdrop dismiss */}
              <div
                style={{
                  background: C.white,
                  borderRadius: 12,
                  padding: 24,
                  width: 1180,
                  height: 857,
                  maxWidth: '90vw',
                  maxHeight: '90vh',
                  overflowY: 'auto',
                  boxSizing: 'border-box',
                  boxShadow: '0 10px 40px rgba(0,0,0,0.15)',
                }}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={() => {}}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 16,
                  }}
                >
                  <h2 style={{ fontSize: 18, fontWeight: 700, color: C.text, margin: 0 }}>
                    Footwear
                  </h2>
                  <button
                    type="button"
                    onClick={() => setShoeItemsOpen(false)}
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
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
                  <button
                    type="button"
                    onClick={() => setShoeItemFilter('')}
                    style={pill(shoeItemFilter === '')}
                  >
                    All
                  </button>
                  {shoeNodes.map((node) => (
                    <button
                      type="button"
                      key={node.id}
                      onClick={() => setShoeItemFilter(node.id)}
                      style={pill(shoeItemFilter === node.id)}
                    >
                      {node.label}
                    </button>
                  ))}
                </div>
                {filteredItems.length === 0 ? (
                  <p style={{ fontSize: 14, color: C.mid }}>No items in this category yet.</p>
                ) : (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(5, 1fr)',
                      gap: 12,
                    }}
                  >
                    {filteredItems.map((i) => (
                      <SelCard
                        key={i.id}
                        selected={shoeCatalogId === i.id}
                        onClick={() => {
                          setShoeCatalogId(shoeCatalogId === i.id ? '' : i.id);
                          setShoeItemsOpen(false);
                        }}
                        imageUrl={i.thumbnailUrl}
                        w="100%"
                        ratio={1}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })()}

      {/* Amazon Pose Picker Modal */}
      {amazonPoseModalOpen && (
        // biome-ignore lint/a11y/noStaticElementInteractions: modal backdrop; click outside dismisses
        <div
          role="presentation"
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
          onKeyDown={(e) => {
            if (e.key === 'Escape') setAmazonPoseModalOpen(false);
          }}
        >
          {/* biome-ignore lint/a11y/noStaticElementInteractions: modal panel; click swallowed to prevent backdrop dismiss */}
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
            onKeyDown={() => {}}
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
                {/* biome-ignore lint/performance/noImgElement: static image, Next Image not needed */}
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
                type="button"
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
            padding: '10px 16px',
            borderRadius: 8,
            fontSize: 13,
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            maxWidth: 480,
          }}
        >
          <span>{toast}</span>
          <button
            type="button"
            onClick={() => setToast('')}
            style={{
              background: 'none',
              border: 'none',
              color: 'rgba(255,255,255,0.6)',
              cursor: 'pointer',
              fontSize: 16,
              lineHeight: 1,
              padding: 0,
              flexShrink: 0,
            }}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}
    </>
  );
}
