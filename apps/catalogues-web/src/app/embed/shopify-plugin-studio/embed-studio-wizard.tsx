'use client';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { GenderCard, SectionHead, sectionCardStyle } from '@/app/(app)/studio/shared-cards';
import { SpinnerIcon } from '@/components/icons';
import { C } from '@/components/tokens';
import { api } from '@/lib/api';

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
  // biome-ignore lint/correctness/noUnusedVariables: used by Task 6 (face/background/pose steps)
  const [garmentKey, setGarmentKey] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState('');

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
    </div>
  );
}
