'use client';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { InfoIcon } from '@/components/icons';
import { C, grad } from '@/components/tokens';
import { TopBar } from '@/components/topbar';
import { useJobStream } from '@/hooks/use-job-stream';
import { api } from '@/lib/api';

type TryonCategory = { id: string; name: string; slug: string };
type TryonCategoriesResponse = {
  categories: TryonCategory[];
  personSampleUrl: string | null;
  garmentSampleUrl: string | null;
};

const CREDITS_COST = 35;

function UploadZone({
  file,
  preview,
  progress,
  label,
  tip,
  icon,
  onFile,
  disabled,
  sampleUrl,
}: {
  file: File | null;
  preview: string | null;
  progress: number;
  label: string;
  tip: string;
  icon: React.ReactNode;
  onFile: (f: File) => void;
  disabled?: boolean;
  sampleUrl?: string | null;
}) {
  const [showSamples, setShowSamples] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const accept = (f: File) => {
    if (!f.type.startsWith('image/')) return;
    onFile(f);
  };

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const f = e.dataTransfer.files[0];
      if (f) accept(f);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accept],
  );

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        borderRadius: 12,
        background: C.bg,
        boxShadow: `inset 0 0 0 1px ${C.border}`,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: 12,
        boxSizing: 'border-box',
        position: 'relative',
      }}
    >
      {/* Info button — top-right corner */}
      {sampleUrl && (
        <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 10 }}>
          <button
            type="button"
            onMouseEnter={() => setShowSamples(true)}
            onMouseLeave={() => setShowSamples(false)}
            style={{
              width: 22,
              height: 22,
              borderRadius: '50%',
              border: 'none',
              background: 'transparent',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            <InfoIcon size={16} color={C.mid} />
          </button>
          {showSamples && (
            <div
              onMouseEnter={() => setShowSamples(true)}
              onMouseLeave={() => setShowSamples(false)}
              style={{
                position: 'absolute',
                top: 26,
                right: 0,
                zIndex: 100,
                background: C.white,
                boxShadow: `0 8px 24px rgba(0,0,0,0.18), inset 0 0 0 1px ${C.border}`,
                borderRadius: 12,
                padding: 10,
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: C.mid,
                  display: 'block',
                  marginBottom: 6,
                }}
              >
                Sample
              </span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={sampleUrl}
                alt=""
                style={{
                  width: 375,
                  height: 250,
                  objectFit: 'cover',
                  borderRadius: 8,
                  display: 'block',
                }}
              />
            </div>
          )}
        </div>
      )}

      <div>
        <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{label}</span>
      </div>

      {/* Drop zone */}
      {/* biome-ignore lint/a11y/useSemanticElements: drag-and-drop zone needs div for layout */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(e) => e.key === 'Enter' && !disabled && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        style={{
          flex: 1,
          margin: '12px 0',
          borderRadius: 12,
          outline: `1px dashed ${dragging ? C.pink : preview ? 'transparent' : C.lighter}`,
          outlineOffset: -1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          padding: 12,
          boxSizing: 'border-box',
          cursor: disabled ? 'default' : 'pointer',
          overflow: 'hidden',
          position: 'relative',
          transition: 'outline-color .15s',
        }}
      >
        {preview ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={preview}
            alt="preview"
            style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: 8 }}
          />
        ) : (
          <>
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: '50%',
                background: C.white,
                boxShadow: `inset 0 0 0 1px ${C.border2}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {icon}
            </div>
            <span
              style={{
                fontSize: 10,
                fontWeight: 500,
                textAlign: 'center',
                color: C.light,
                lineHeight: 1.5,
              }}
            >
              Drag and drop an image here · JPG, PNG · Max 10MB
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: C.text }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/assets/image-upload.svg"
                alt=""
                width={14}
                height={14}
                style={{ opacity: 0.7, filter: 'var(--icon-invert)' }}
              />
              <span style={{ fontSize: 12, fontWeight: 500 }}>Browse Image</span>
            </div>
          </>
        )}

        {/* Upload progress overlay */}
        {progress > 0 && progress < 100 && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(0,0,0,0.45)',
              borderRadius: 12,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            <span style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>{progress}%</span>
            <div
              style={{
                width: '60%',
                height: 4,
                background: 'rgba(255,255,255,0.2)',
                borderRadius: 4,
              }}
            >
              <div
                style={{
                  width: `${progress}%`,
                  height: '100%',
                  background: grad,
                  borderRadius: 4,
                  transition: 'width .2s',
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Tip */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}>
        {/* biome-ignore lint/performance/noImgElement: static SVG asset */}
        <img
          src="/assets/bulb.svg"
          alt=""
          width={12}
          height={14}
          style={{ flexShrink: 0, marginTop: 1 }}
        />
        <span style={{ fontSize: 10, fontWeight: 600, color: C.pink, flexShrink: 0 }}>Tips</span>
        <span style={{ fontSize: 10, fontWeight: 400, lineHeight: '16px', color: C.mid }}>
          {tip}
        </span>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) accept(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}

export default function TryOnPage() {
  const [personFile, setPersonFile] = useState<File | null>(null);
  const [garmentFile, setGarmentFile] = useState<File | null>(null);
  const [personPreview, setPersonPreview] = useState<string | null>(null);
  const [garmentPreview, setGarmentPreview] = useState<string | null>(null);
  const [personProgress, setPersonProgress] = useState(0);
  const [garmentProgress, setGarmentProgress] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingJobId, setPendingJobId] = useState<string | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);

  // Contact form
  const [showContact, setShowContact] = useState(false);
  const [contactSource, setContactSource] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactMessage, setContactMessage] = useState('');
  const [contactSubmitting, setContactSubmitting] = useState(false);
  const [contactDone, setContactDone] = useState(false);

  const handleContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setContactSubmitting(true);
    try {
      await api.post('/v1/contact', {
        name: contactName,
        email: contactEmail,
        phone: contactPhone,
        source: contactSource || undefined,
        message: contactMessage || undefined,
      });
      setContactDone(true);
    } catch {
      // silently stay open — user can retry
    } finally {
      setContactSubmitting(false);
    }
  };

  const openContact = (source: string) => {
    setContactSource(source);
    setContactName(me?.displayName ?? '');
    setContactEmail(me?.email ?? '');
    const rawPhone = (me?.phone ?? '').replace(/\D/g, '').slice(0, 10);
    setContactPhone(
      rawPhone.length > 5 ? `${rawPhone.slice(0, 5)} ${rawPhone.slice(5)}` : rawPhone,
    );
    setContactMessage('');
    setContactDone(false);
    setShowContact(true);
  };

  const { data: tryonData } = useQuery<TryonCategoriesResponse>({
    queryKey: ['tryon-categories'],
    queryFn: () => api.get('/v1/tryon/categories'),
    staleTime: 5 * 60 * 1000,
  });
  const categories = tryonData?.categories ?? [];
  const personSampleUrl = tryonData?.personSampleUrl ?? null;
  const garmentSampleUrl = tryonData?.garmentSampleUrl ?? null;

  useEffect(() => {
    if (categories.length > 0 && !selectedCategoryId) {
      setSelectedCategoryId(categories[0]?.id ?? null);
    }
  }, [categories, selectedCategoryId]);

  useJobStream(
    useCallback(
      (evt) => {
        if (!pendingJobId || evt.jobId !== pendingJobId) return;
        if (evt.status === 'COMPLETED') {
          setPendingJobId(null);
          api
            .get<{ url: string }>(`/v1/jobs/${pendingJobId}/result`)
            .then(({ url }) => setResultUrl(url))
            .catch(() => setError('Generation failed. Please try again or contact support.'))
            .finally(() => {
              setGenerating(false);
              setPersonProgress(0);
              setGarmentProgress(0);
            });
        } else if (evt.status === 'FAILED') {
          setPendingJobId(null);
          setError('Generation failed. Please try again or contact support.');
          setGenerating(false);
          setPersonProgress(0);
          setGarmentProgress(0);
        }
      },
      [pendingJobId],
    ),
  );

  const { data: credits } = useQuery<{ balance: number }>({
    queryKey: ['credits'],
    queryFn: () => api.get('/v1/credits'),
  });
  const { data: me } = useQuery<{ email: string; displayName?: string; phone?: string | null }>({
    queryKey: ['me'],
    queryFn: () => api.get('/v1/me'),
    staleTime: Infinity,
  });

  const pickFile = (file: File, setFile: (f: File) => void, setPreview: (s: string) => void) => {
    setFile(file);
    const reader = new FileReader();
    reader.onload = (e) => setPreview(e.target?.result as string);
    reader.readAsDataURL(file);
    setError(null);
    setResultUrl(null);
  };

  const handleGenerate = async () => {
    if (!personFile || !garmentFile) {
      setError('Upload both a person image and a garment image first.');
      return;
    }
    setGenerating(true);
    setError(null);
    setResultUrl(null);
    setPersonProgress(1);
    setGarmentProgress(1);
    try {
      const [personPresign, garmentPresign] = await Promise.all([
        api.post<{ uploadUrl: string; r2Key: string }>('/v1/uploads/presign', {
          contentType: personFile.type,
          contentLength: personFile.size,
        }),
        api.post<{ uploadUrl: string; r2Key: string }>('/v1/uploads/presign', {
          contentType: garmentFile.type,
          contentLength: garmentFile.size,
        }),
      ]);

      await Promise.all([
        api.uploadToR2WithProgress(personPresign.uploadUrl, personFile, setPersonProgress),
        api.uploadToR2WithProgress(garmentPresign.uploadUrl, garmentFile, setGarmentProgress),
      ]);

      setPersonProgress(100);
      setGarmentProgress(100);

      const { jobId } = await api.post<{ jobId: string; catalogueId: string }>(
        '/v1/jobs/simple-tryon',
        {
          personKey: personPresign.r2Key,
          garmentKey: garmentPresign.r2Key,
          ...(selectedCategoryId ? { categoryId: selectedCategoryId } : {}),
        },
      );

      // useJobStream callback above watches for this jobId and handles COMPLETED/FAILED
      setPendingJobId(jobId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      // Show user-friendly message; only expose safe messages (upload/credit errors)
      const safe = /upload|credit|image|file|size|format/i.test(msg);
      setError(safe ? msg : 'Something went wrong. Please try again.');
      setGenerating(false);
      setPersonProgress(0);
      setGarmentProgress(0);
    }
  };

  const canGenerate = !generating && !!personFile && !!garmentFile;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <TopBar title="AI Virtual Try-On (Beta)" subtitle="" />

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: '20px 20px 24px',
          boxSizing: 'border-box',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gridTemplateRows: '1fr',
          gap: 20,
        }}
      >
        {/* Grid: 2 columns × 2 rows — upload | preview / integrate | kiosk */}
        {/* ── Upload panel ── */}
        <div
          style={{
            borderRadius: 24,
            background: C.white,
            boxShadow: `inset 0 0 0 1px ${C.border}, 0 4px 15px rgba(0,0,0,0.04)`,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            padding: 16,
            boxSizing: 'border-box',
            minHeight: 400,
            minWidth: 320,
          }}
        >
          {/* Category selector */}
          {categories.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', flexShrink: 0 }}>
              {categories.map((cat) => {
                const active = cat.id === selectedCategoryId;
                return (
                  <label
                    key={cat.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '4px 12px',
                      borderRadius: 20,
                      cursor: 'pointer',
                      background: active ? 'rgba(245,92,122,0.12)' : C.bg,
                      boxShadow: active
                        ? `inset 0 0 0 1.5px ${C.pink}`
                        : `inset 0 0 0 1px ${C.border}`,
                      transition: 'box-shadow .15s, background .15s',
                    }}
                  >
                    <input
                      type="radio"
                      name="tryon-category"
                      value={cat.id}
                      checked={active}
                      onChange={() => setSelectedCategoryId(cat.id)}
                      style={{ display: 'none' }}
                    />
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: active ? 600 : 500,
                        color: active ? C.pink : C.mid,
                      }}
                    >
                      {cat.name}
                    </span>
                  </label>
                );
              })}
            </div>
          )}

          {/* Two upload cards */}
          <div style={{ display: 'flex', gap: 16, flex: 1, minHeight: 0 }}>
            <UploadZone
              file={personFile}
              preview={personPreview}
              progress={personProgress}
              label="1. Upload Person Image"
              tip="Front-facing images with good lighting deliver the most accurate results."
              disabled={generating}
              sampleUrl={personSampleUrl}
              onFile={(f) => pickFile(f, setPersonFile, setPersonPreview)}
              icon={
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="8" r="3.5" stroke={C.mid} strokeWidth="1.2" />
                  <path
                    d="M5 20C5 17 8 15 12 15C16 15 19 17 19 20"
                    stroke={C.mid}
                    strokeWidth="1.2"
                    strokeLinecap="round"
                  />
                </svg>
              }
            />
            <UploadZone
              file={garmentFile}
              preview={garmentPreview}
              progress={garmentProgress}
              label="2. Upload Garment Image"
              tip="Use clean garment images with minimal background distractions."
              disabled={generating}
              sampleUrl={garmentSampleUrl}
              onFile={(f) => pickFile(f, setGarmentFile, setGarmentPreview)}
              icon={
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M3 7L7 4H9.5C9.5 5.38 10.62 6.5 12 6.5C13.38 6.5 14.5 5.38 14.5 4H17L21 7L18.5 9.5L17 8V20H7V8L5.5 9.5L3 7Z"
                    stroke={C.mid}
                    strokeWidth="1.2"
                    strokeLinejoin="round"
                  />
                </svg>
              }
            />
          </div>

          {/* Error */}
          {error && (
            <div
              style={{
                fontSize: 13,
                color: '#f87171',
                padding: '6px 10px',
                background: 'rgba(220,38,38,0.12)',
                borderRadius: 8,
              }}
            >
              {error}
            </div>
          )}

          {/* Footer: credits + generate */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              height: 52,
              flexShrink: 0,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/assets/credit.png"
                alt=""
                width={16}
                height={16}
                style={{ opacity: 0.6 }}
              />
              <span style={{ fontSize: 14, fontWeight: 500, color: C.mid }}>
                Uses {CREDITS_COST} credits
                {credits && (
                  <span style={{ color: C.light, marginLeft: 6 }}>
                    ({credits.balance} available)
                  </span>
                )}
              </span>
            </div>
            <button
              onClick={handleGenerate}
              disabled={!canGenerate}
              style={{
                height: 52,
                paddingInline: 32,
                borderRadius: 12,
                background: canGenerate ? grad : C.border,
                border: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                cursor: canGenerate ? 'pointer' : 'not-allowed',
                boxShadow: canGenerate ? '0 6px 18px rgba(245,92,122,0.28)' : 'none',
                transition: 'opacity .15s',
                flexShrink: 0,
              }}
            >
              <span
                style={{ fontSize: 15, fontWeight: 600, color: canGenerate ? '#fff' : C.light }}
              >
                {generating ? 'Generating…' : 'Generate Try-On'}
              </span>
              {/* biome-ignore lint/performance/noImgElement: static SVG asset */}
              {!generating && (
                <img
                  src="/assets/generate-icon.svg"
                  alt=""
                  width={20}
                  height={20}
                  style={{ opacity: canGenerate ? 1 : 0.4 }}
                />
              )}
            </button>
          </div>
        </div>

        {/* ── Preview panel ── */}
        <div
          style={{
            borderRadius: 24,
            background: C.bg,
            boxShadow: `inset 0 0 0 1px ${C.border}, 0 4px 15px rgba(0,0,0,0.04)`,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            minHeight: 400,
            minWidth: 320,
          }}
        >
          {/* Header */}
          <div
            style={{
              borderBottom: `1px solid ${C.border}`,
              padding: 16,
              boxSizing: 'border-box',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              justifyContent: 'center',
              flexShrink: 0,
              height: 76,
            }}
          >
            <span style={{ fontSize: 18, fontWeight: 600, color: C.text }}>
              Your Try-On Preview
            </span>
            {resultUrl && (
              <span style={{ fontSize: 13, fontWeight: 500, color: C.mid }}>
                Try-on generated successfully.
              </span>
            )}
          </div>

          {/* Body */}
          <div
            style={{
              flex: 1,
              minHeight: 0,
              padding: 16,
              boxSizing: 'border-box',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {resultUrl ? (
              /* Result image */
              <div style={{ flex: 1, borderRadius: 8, overflow: 'hidden', position: 'relative' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={resultUrl}
                  alt="Try-on result"
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                />
              </div>
            ) : (
              /* Empty state */
              <div
                style={{
                  flex: 1,
                  borderRadius: 8,
                  outline: `2px dashed ${C.border2}`,
                  outlineOffset: -2,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 16,
                  padding: 24,
                  boxSizing: 'border-box',
                }}
              >
                <div
                  style={{
                    width: 120,
                    height: 120,
                    borderRadius: '50%',
                    background: C.bg,
                    boxShadow: `inset 0 0 0 1px ${C.border}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {generating ? (
                    <svg aria-hidden="true" width="40" height="40" viewBox="0 0 40 40" fill="none">
                      <circle cx="20" cy="20" r="16" stroke={C.border2} strokeWidth="3" />
                      <path
                        d="M20 4 A16 16 0 0 1 36 20"
                        stroke={C.pink}
                        strokeWidth="3"
                        strokeLinecap="round"
                      >
                        <animateTransform
                          attributeName="transform"
                          type="rotate"
                          from="0 20 20"
                          to="360 20 20"
                          dur="1s"
                          repeatCount="indefinite"
                        />
                      </path>
                    </svg>
                  ) : (
                    <svg aria-hidden="true" width="48" height="48" viewBox="0 0 48 48" fill="none">
                      <circle cx="24" cy="16" r="7" stroke={C.border2} strokeWidth="2" />
                      <path
                        d="M10 40C10 33 16 29 24 29C32 29 38 33 38 40"
                        stroke={C.border2}
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                      <path
                        d="M28 24L40 36"
                        stroke={C.border2}
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                      <path
                        d="M36 40L24 28"
                        stroke={C.border2}
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                    </svg>
                  )}
                </div>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    alignItems: 'center',
                  }}
                >
                  <span
                    style={{ fontSize: 16, fontWeight: 600, color: C.text, textAlign: 'center' }}
                  >
                    {generating ? 'Generating your try-on…' : 'No try-on generated yet'}
                  </span>
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      color: C.mid,
                      textAlign: 'center',
                      maxWidth: 340,
                      lineHeight: 1.5,
                    }}
                  >
                    {generating
                      ? 'This may take a moment. Please wait.'
                      : 'Upload your images and click Generate Try-On to preview the result here.'}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Contact Us modal */}
      {showContact && (
        // biome-ignore lint/a11y/useKeyWithClickEvents: modal backdrop close on click
        // biome-ignore lint/a11y/noStaticElementInteractions: modal backdrop
        <div
          onClick={() => !contactSubmitting && setShowContact(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: C.white,
              borderRadius: 16,
              width: '100%',
              maxWidth: contactDone ? 560 : 440,
              boxShadow: '0 24px 60px rgba(0,0,0,0.2)',
              overflow: 'hidden',
            }}
          >
            {/* Header — hidden on success */}
            {!contactDone && (
              <div
                style={{
                  padding: '20px 24px 16px',
                  borderBottom: `1px solid ${C.border}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 16, fontWeight: 700, color: C.text }}>
                    Let&apos;s Get in Touch
                  </span>
                  {contactSource && (
                    <span style={{ fontSize: 11, color: C.mid }}>Re: {contactSource}</span>
                  )}
                </div>
                <button
                  onClick={() => setShowContact(false)}
                  disabled={contactSubmitting}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 4,
                    color: C.mid,
                    fontSize: 18,
                    lineHeight: 1,
                  }}
                >
                  ✕
                </button>
              </div>
            )}

            {/* Body */}
            <div style={{ padding: contactDone ? 0 : '20px 24px 24px' }}>
              {contactDone ? (
                <div style={{ position: 'relative', width: '100%' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/assets/contact-us-finalinfo.png"
                    alt=""
                    style={{ width: '100%', height: 'auto', display: 'block' }}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'flex-start',
                      textAlign: 'center',
                      padding: '0 24px 24px',
                      paddingTop: '42%',
                      gap: 10,
                      overflowY: 'visible',
                    }}
                  >
                    <span style={{ fontSize: 20, fontWeight: 700, color: '#111111' }}>
                      Great Choice!
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a' }}>
                      Your request has been submitted successfully.
                    </span>
                    <span style={{ fontSize: 12, color: '#3a3a3a', lineHeight: 1.6 }}>
                      Our team will give you a quick call to understand your requirements and guide
                      you through the next steps.
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'rgb(249,115,22)' }}>
                      No waiting. No complicated process.
                    </span>
                    <button
                      onClick={() => setShowContact(false)}
                      style={{
                        background: 'none',
                        border: 'none',
                        outline: 'none',
                        cursor: 'pointer',
                        padding: 0,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        fontSize: 14,
                        fontWeight: 600,
                        color: '#111',
                      }}
                    >
                      Continue Browsing
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M5 12h14" />
                        <path d="m12 5 7 7-7 7" />
                      </svg>
                    </button>
                    <span style={{ fontSize: 11, color: '#555' }}>
                      ⏱ Average response time: Within 30 minutes during business hours.
                    </span>
                  </div>
                </div>
              ) : (
                <form
                  onSubmit={(e) => void handleContactSubmit(e)}
                  style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: C.text }}>
                      Full Name <span style={{ color: C.pink }}>*</span>
                    </label>
                    <input
                      required
                      value={contactName}
                      onChange={(e) => setContactName(e.target.value)}
                      disabled={contactSubmitting}
                      placeholder="John Doe"
                      style={{
                        height: 40,
                        borderRadius: 8,
                        border: `1px solid ${C.border2}`,
                        padding: '0 12px',
                        fontSize: 13,
                        color: C.text,
                        background: C.bg,
                        outline: 'none',
                        boxSizing: 'border-box',
                        width: '100%',
                      }}
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: C.text }}>
                      Email <span style={{ color: C.pink }}>*</span>
                    </label>
                    <input
                      required
                      type="email"
                      value={contactEmail}
                      onChange={(e) => setContactEmail(e.target.value)}
                      disabled={contactSubmitting}
                      placeholder="you@example.com"
                      style={{
                        height: 40,
                        borderRadius: 8,
                        border: `1px solid ${C.border2}`,
                        padding: '0 12px',
                        fontSize: 13,
                        color: C.text,
                        background: C.bg,
                        outline: 'none',
                        boxSizing: 'border-box',
                        width: '100%',
                      }}
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: C.text }}>
                      Phone Number <span style={{ color: C.pink }}>*</span>
                    </label>
                    <input
                      required
                      type="tel"
                      inputMode="numeric"
                      value={contactPhone}
                      onChange={(e) => {
                        const digits = e.target.value.replace(/\D/g, '').slice(0, 10);
                        setContactPhone(
                          digits.length > 5 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : digits,
                        );
                      }}
                      disabled={contactSubmitting}
                      placeholder="98765 43210"
                      style={{
                        height: 40,
                        borderRadius: 8,
                        border: `1px solid ${C.border2}`,
                        padding: '0 12px',
                        fontSize: 13,
                        color: C.text,
                        background: C.bg,
                        outline: 'none',
                        boxSizing: 'border-box',
                        width: '100%',
                      }}
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: C.text }}>
                      Message <span style={{ color: C.mid, fontWeight: 400 }}>(optional)</span>
                    </label>
                    <textarea
                      value={contactMessage}
                      onChange={(e) => setContactMessage(e.target.value)}
                      disabled={contactSubmitting}
                      placeholder="Tell us about your use case…"
                      rows={3}
                      style={{
                        borderRadius: 8,
                        border: `1px solid ${C.border2}`,
                        padding: '10px 12px',
                        fontSize: 13,
                        color: C.text,
                        background: C.bg,
                        outline: 'none',
                        boxSizing: 'border-box',
                        width: '100%',
                        resize: 'vertical',
                        fontFamily: 'inherit',
                      }}
                    />
                  </div>
                  <div
                    style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}
                  >
                    <button
                      type="button"
                      onClick={() => setShowContact(false)}
                      disabled={contactSubmitting}
                      style={{
                        height: 38,
                        padding: '0 16px',
                        borderRadius: 8,
                        border: 'none',
                        background: 'transparent',
                        color: C.mid,
                        fontSize: 13,
                        fontWeight: 500,
                        cursor: contactSubmitting ? 'not-allowed' : 'pointer',
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={contactSubmitting}
                      style={{
                        height: 38,
                        padding: '0 20px',
                        borderRadius: 8,
                        border: 'none',
                        background: grad,
                        color: '#fff',
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: contactSubmitting ? 'not-allowed' : 'pointer',
                        opacity: contactSubmitting ? 0.7 : 1,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {contactSubmitting ? 'Sending…' : 'Request a Call'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
