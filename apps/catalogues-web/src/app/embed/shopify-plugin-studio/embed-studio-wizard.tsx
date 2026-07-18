'use client';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { type GenerationJob, GenerationPanel } from '@/app/(app)/studio/generation-panel';
import { SelectGridModal } from '@/app/(app)/studio/select-modal';
import {
  GenderCard,
  SectionHead,
  SelCard,
  sectionCardStyle,
} from '@/app/(app)/studio/shared-cards';
import { SpinnerIcon } from '@/components/icons';
import { C } from '@/components/tokens';
import { api } from '@/lib/api';
import { postImageSelectedToParent } from '@/lib/shopify-plugin-embed-protocol';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

const GENDERS = [
  { value: 'women', label: 'Women', img: `${BASE}/assets/seg-women.png` },
  { value: 'men', label: 'Men', img: `${BASE}/assets/seg-men.png` },
  { value: 'boys', label: 'Boy', img: `${BASE}/assets/seg-boy.png` },
  { value: 'girls', label: 'Girl', img: `${BASE}/assets/seg-girl.png` },
];

// A subset of the fields Studio's GarmentType carries — this demo only
// supports plain single-upload garment types (see the design spec's Scope
// Boundaries section), so mannequin/dual-upload types are filtered out below.
interface EmbedGarmentType {
  id: string;
  label: string;
  thumbnailUrl?: string | null;
  requiresLowerUpload: boolean;
  requiresThirdUpload?: boolean;
  requiresMannequinStep?: boolean;
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
}
interface PoseItem {
  id: string;
  label: string;
  thumbnailUrl: string;
  hasLower: boolean;
  hasShoes: boolean;
}

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

export function EmbedStudioWizard() {
  const [gender, setGender] = useState('women');
  const [garmentTypeId, setGarmentTypeId] = useState('');
  const [garmentFile, setGarmentFile] = useState<File | null>(null);
  const [garmentKey, setGarmentKey] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState('');
  const [faceId, setFaceId] = useState('');
  const [backgroundId, setBackgroundId] = useState('');
  const [poseIds, setPoseIds] = useState<string[]>([]);
  const [faceModalOpen, setFaceModalOpen] = useState(false);
  const [backgroundModalOpen, setBackgroundModalOpen] = useState(false);
  const [poseModalOpen, setPoseModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [activeGeneration, setActiveGeneration] = useState<{
    catalogueId: string;
    jobs: GenerationJob[];
  } | null>(null);

  const { data: facesData } = useQuery<{ items: FaceItem[] }>({
    queryKey: ['embed-faces', gender],
    queryFn: () => api.get(`/v1/models/faces?gender=${gender}`),
  });
  const faces = facesData?.items ?? [];

  const { data: backgroundsData } = useQuery<{ items: BackgroundItem[] }>({
    queryKey: ['embed-backgrounds', gender],
    queryFn: () => api.get(`/v1/models/backgrounds?gender=${gender}`),
  });
  const backgrounds = backgroundsData?.items ?? [];

  const { data: posesData } = useQuery<{ items: PoseItem[] }>({
    queryKey: ['embed-poses', gender, garmentTypeId],
    queryFn: () =>
      api.get(
        `/v1/models/poses?gender=${gender}${garmentTypeId ? `&garmentTypeId=${garmentTypeId}` : ''}`,
      ),
    enabled: !!garmentTypeId,
  });
  const poses = posesData?.items ?? [];

  function togglePose(id: string) {
    setPoseIds((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  }

  const canGenerate =
    !!garmentKey &&
    !!faceId &&
    !!backgroundId &&
    poseIds.length > 0 &&
    !isUploading &&
    !isSubmitting;

  async function handleGenerate() {
    if (!canGenerate || isSubmitting) return;
    setIsSubmitting(true);
    setSubmitError('');
    try {
      const selectedGarmentType = garmentTypes.find((g) => g.id === garmentTypeId);
      const selectedPoses = poses.filter((p) => poseIds.includes(p.id));
      const needsLower = selectedPoses.some((p) => p.hasLower);
      const needsShoes = selectedPoses.some((p) => p.hasShoes);
      const { catalogueId, jobIds } = await api.post<{ catalogueId: string; jobIds: string[] }>(
        '/v1/jobs/tryon',
        {
          inputs: {
            upperGarmentKey: garmentKey,
            faceId,
            backgroundId,
            poseIds,
            garmentTypeId: garmentTypeId || undefined,
            lowerCatalogId: needsLower
              ? (selectedGarmentType?.defaultLowerCatalogId ?? undefined)
              : undefined,
            shoeCatalogId: needsShoes
              ? (selectedGarmentType?.defaultShoeCatalogId ?? undefined)
              : undefined,
          },
          aspectRatio: '1:1',
          resolution: 'HD',
          platform: 'Shopify',
        },
      );
      const submittedLooks = poseIds.map((poseId) => {
        const pose = poses.find((p) => p.id === poseId);
        return { poseId, label: pose?.label ?? 'Pose', thumbnailUrl: pose?.thumbnailUrl ?? '' };
      });
      setActiveGeneration({
        catalogueId,
        jobs: jobIds.map((id, i) => ({
          id,
          poseId: submittedLooks[i]?.poseId ?? '',
          label: submittedLooks[i]?.label ?? `Look ${i + 1}`,
          thumbnailUrl: submittedLooks[i]?.thumbnailUrl ?? '',
        })),
      });
    } catch (e) {
      setSubmitError((e as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleStartOver() {
    setActiveGeneration(null);
    setPoseIds([]);
  }

  function handleUseImage(args: { url: string; jobId: string; poseLabel: string }) {
    postImageSelectedToParent({
      imageUrl: args.url,
      jobId: args.jobId,
      poseLabel: args.poseLabel,
    });
  }

  const garmentPreviewUrl = useMemo(
    () => (garmentFile ? URL.createObjectURL(garmentFile) : ''),
    [garmentFile],
  );
  useEffect(() => {
    return () => {
      if (garmentPreviewUrl) URL.revokeObjectURL(garmentPreviewUrl);
    };
  }, [garmentPreviewUrl]);

  const { data: garmentTypesData } = useQuery<{ items: EmbedGarmentType[] }>({
    queryKey: ['embed-garment-types', gender],
    queryFn: () => api.get(`/v1/models/garment-types?gender=${gender}`),
  });
  const garmentTypes = useMemo(
    () =>
      (garmentTypesData?.items ?? []).filter(
        (g) => !g.requiresMannequinStep && !g.requiresLowerUpload && !g.requiresThirdUpload,
      ),
    [garmentTypesData],
  );
  const didAutoGarmentType = useMemo(() => ({ current: '' }), []);
  useEffect(() => {
    if (garmentTypes.length && !garmentTypeId && didAutoGarmentType.current !== gender) {
      setGarmentTypeId(garmentTypes[0]?.id ?? '');
      didAutoGarmentType.current = gender;
    }
  }, [garmentTypes, garmentTypeId, gender, didAutoGarmentType]);

  function handleGenderSelect(value: string) {
    setGender(value);
    setGarmentTypeId('');
  }

  async function handleGarmentUpload(file: File) {
    if (isUploading) return;
    if (file.size > 10 * 1024 * 1024) {
      setUploadError('File exceeds 10 MB. Please choose a smaller image.');
      return;
    }
    if (!(await isSupportedImageBytes(file))) {
      setUploadError('Unsupported file type. Please upload a JPEG, PNG, or WebP image.');
      return;
    }
    setUploadError('');
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
      setUploadError(`Upload failed: ${(e as Error).message}`);
      setGarmentFile(null);
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <div
      style={{
        maxWidth: 720,
        margin: '0 auto',
        padding: '24px 20px 40px',
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: C.text }}>
          Generate a product photo with Ai Vastra
        </h2>
        <p style={{ margin: 0, fontSize: 13, color: C.mid }}>
          Every step below calls our real generation pipeline — the result is a genuine AI photo,
          not a placeholder.
        </p>
      </div>

      <div style={sectionCardStyle}>
        <SectionHead title="Who is this product for?" stepNumber={1} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
          {GENDERS.map((g) => (
            <GenderCard
              key={g.value}
              selected={gender === g.value}
              onClick={() => handleGenderSelect(g.value)}
              img={g.img}
              label={g.label}
            />
          ))}
        </div>
      </div>

      <div style={sectionCardStyle}>
        <SectionHead title="Garment type" stepNumber={2} />
        {garmentTypes.length === 0 ? (
          <span style={{ fontSize: 13, color: C.mid }}>Loading garment types…</span>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {garmentTypes.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => setGarmentTypeId(g.id)}
                style={{
                  cursor: 'pointer',
                  padding: '8px 14px',
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  border: `1.5px solid ${g.id === garmentTypeId ? C.pink : C.border2}`,
                  background: g.id === garmentTypeId ? 'rgba(189,37,135,0.08)' : C.white,
                  color: g.id === garmentTypeId ? C.pink : C.text,
                }}
              >
                {g.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div style={sectionCardStyle}>
        <SectionHead title="Upload the garment photo" stepNumber={3} />
        <label
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            height: 160,
            border: `1.5px dashed ${C.border2}`,
            borderRadius: 12,
            cursor: 'pointer',
            overflow: 'hidden',
            position: 'relative',
            background: C.lighter,
          }}
        >
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleGarmentUpload(file);
            }}
          />
          {garmentPreviewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            // biome-ignore lint/performance/noImgElement: uncontrolled preview
            <img
              src={garmentPreviewUrl}
              alt="Garment"
              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            />
          ) : (
            <>
              <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>
                Click to choose a garment photo
              </span>
              <span style={{ fontSize: 11, color: C.mid }}>JPEG, PNG, or WebP — up to 10 MB</span>
            </>
          )}
          {isUploading && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: 'rgba(255,255,255,0.75)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                fontSize: 12,
                fontWeight: 600,
                color: C.pink,
              }}
            >
              <SpinnerIcon size={16} /> Uploading… {uploadProgress}%
            </div>
          )}
        </label>
        {uploadError && (
          <span style={{ fontSize: 12, color: C.pink, marginTop: 8 }}>{uploadError}</span>
        )}
      </div>

      {activeGeneration ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <button
            type="button"
            onClick={handleStartOver}
            style={{
              alignSelf: 'flex-start',
              background: 'none',
              border: 'none',
              color: C.pink,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              padding: 0,
            }}
          >
            ← Start a new photo
          </button>
          <GenerationPanel
            catalogueId={activeGeneration.catalogueId}
            jobs={activeGeneration.jobs}
            garmentPreviewUrl={garmentPreviewUrl}
            onUseImage={handleUseImage}
            hideCatalogueLink
          />
        </div>
      ) : (
        <>
          <div style={sectionCardStyle}>
            <SectionHead
              title="Model face"
              stepNumber={4}
              right={
                faces.length > 4 && (
                  <button
                    type="button"
                    onClick={() => setFaceModalOpen(true)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: C.pink,
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    View all
                  </button>
                )
              }
            />
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {faces.slice(0, 4).map((f) => (
                <SelCard
                  key={f.id}
                  selected={faceId === f.id}
                  onClick={() => setFaceId(f.id)}
                  imageUrl={f.thumbnailUrl}
                  label={f.label}
                  w={100}
                  h={130}
                />
              ))}
            </div>
          </div>

          <div style={sectionCardStyle}>
            <SectionHead
              title="Background"
              stepNumber={5}
              right={
                backgrounds.length > 4 && (
                  <button
                    type="button"
                    onClick={() => setBackgroundModalOpen(true)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: C.pink,
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    View all
                  </button>
                )
              }
            />
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {backgrounds.slice(0, 4).map((b) => (
                <SelCard
                  key={b.id}
                  selected={backgroundId === b.id}
                  onClick={() => setBackgroundId(b.id)}
                  imageUrl={b.thumbnailUrl}
                  label={b.label}
                  w={100}
                  h={130}
                />
              ))}
            </div>
          </div>

          <div style={sectionCardStyle}>
            <SectionHead
              title="Pose(s)"
              subtitle="Select one or more — each becomes its own generated photo"
              stepNumber={6}
              right={
                poses.length > 4 && (
                  <button
                    type="button"
                    onClick={() => setPoseModalOpen(true)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: C.pink,
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    View all
                  </button>
                )
              }
            />
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {poses.slice(0, 4).map((p) => (
                <SelCard
                  key={p.id}
                  selected={poseIds.includes(p.id)}
                  onClick={() => togglePose(p.id)}
                  imageUrl={p.thumbnailUrl}
                  label={p.label}
                  w={100}
                  h={130}
                />
              ))}
            </div>
          </div>

          <div
            style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}
          >
            <button
              type="button"
              disabled={!canGenerate}
              onClick={handleGenerate}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                height: 44,
                padding: '0 24px',
                borderRadius: 10,
                border: 'none',
                fontSize: 14,
                fontWeight: 700,
                color: '#fff',
                background: canGenerate
                  ? 'linear-gradient(91.84deg, #521D9C 0.33%, #BD2587 50.77%, #F96657 99.67%)'
                  : C.border2,
                cursor: canGenerate ? 'pointer' : 'not-allowed',
              }}
            >
              {isSubmitting ? <SpinnerIcon size={16} /> : null}
              Generate product photo{poseIds.length > 1 ? 's' : ''}
            </button>
            {submitError && <span style={{ fontSize: 12, color: C.pink }}>{submitError}</span>}
          </div>
        </>
      )}

      {faceModalOpen && (
        <SelectGridModal
          title="Choose a model face"
          items={faces}
          selectedIds={faceId ? [faceId] : []}
          onSelect={(id) => {
            setFaceId(id);
            setFaceModalOpen(false);
          }}
          onClose={() => setFaceModalOpen(false)}
        />
      )}
      {backgroundModalOpen && (
        <SelectGridModal
          title="Choose a background"
          items={backgrounds}
          selectedIds={backgroundId ? [backgroundId] : []}
          onSelect={(id) => {
            setBackgroundId(id);
            setBackgroundModalOpen(false);
          }}
          onClose={() => setBackgroundModalOpen(false)}
        />
      )}
      {poseModalOpen && (
        <SelectGridModal
          title="Choose pose(s)"
          items={poses}
          selectedIds={poseIds}
          multiSelect
          continueLabel="Use {count} pose(s)"
          onSelect={togglePose}
          onClose={() => setPoseModalOpen(false)}
        />
      )}
    </div>
  );
}
