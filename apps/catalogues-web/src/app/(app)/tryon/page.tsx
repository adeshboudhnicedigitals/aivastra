'use client';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { InfoIcon } from '@/components/icons';
import { C, grad } from '@/components/tokens';
import { TopBar } from '@/components/topbar';
import { useJobStream } from '@/hooks/use-job-stream';
import { api } from '@/lib/api';
import { downloadErrorMessage } from '@/lib/errors';

type TryonCategory = { id: string; name: string; slug: string };
type TryonCategoriesResponse = {
  categories: TryonCategory[];
  personSampleUrl: string | null;
  garmentSampleUrl: string | null;
  creditsCost: number;
};
type GarmentCatalogImage = {
  jobId: string;
  thumbnailUrl: string | null;
  garmentTypeName: string;
  tryonCategoryName: string;
};

const DEFAULT_CREDITS_COST = 5;

function CustomSelect({
  label,
  options,
  defaultValue,
}: {
  label: string;
  options: string[];
  defaultValue: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [value, setValue] = useState(defaultValue);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div>
      <div style={{ fontSize: 12, color: C.text, fontWeight: 500, marginBottom: 6 }}>{label}</div>
      <div ref={containerRef} style={{ position: 'relative', width: '100%' }}>
        <div
          onClick={() => setIsOpen(!isOpen)}
          style={{
            height: 40,
            borderRadius: 8,
            border: `1px solid ${C.border}`,
            padding: '0 12px',
            fontSize: 13,
            background: C.white,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            color: C.text,
          }}
        >
          <span>{value}</span>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </div>

        {isOpen && (
          <div
            style={{
              position: 'absolute',
              top: 'calc(100% + 4px)',
              left: 0,
              width: '100%',
              background: C.white,
              borderRadius: 8,
              border: `1px solid ${C.border}`,
              boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
              zIndex: 50,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {options.map((opt) => (
              <div
                key={opt}
                onClick={() => {
                  setValue(opt);
                  setIsOpen(false);
                }}
                style={{
                  padding: '10px 12px',
                  fontSize: 13,
                  cursor: 'pointer',
                  background: opt === value ? '#F5F3FF' : C.white,
                  color: opt === value ? '#818CF8' : C.text,
                  transition: 'background 0.15s',
                }}
                onMouseEnter={(e) => {
                  if (opt !== value) e.currentTarget.style.background = '#F9FAFB';
                }}
                onMouseLeave={(e) => {
                  if (opt !== value) e.currentTarget.style.background = C.white;
                }}
              >
                {opt}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function UploadZone({
  file: _file,
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

  const accept = useCallback(
    (f: File) => {
      if (!f.type.startsWith('image/')) return;
      onFile(f);
    },
    [onFile],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const f = e.dataTransfer.files[0];
      if (f) accept(f);
    },
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
      {/* Info button â€” top-right corner */}
      {sampleUrl && (
        <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 10 }}>
          <button
            type="button"
            onMouseEnter={() => setShowSamples(true)}
            onMouseLeave={() => setShowSamples(false)}
            onFocus={() => setShowSamples(true)}
            onBlur={() => setShowSamples(false)}
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
            // biome-ignore lint/a11y/noStaticElementInteractions: hover-sustain region for the popover triggered by the button above (which now also has onFocus/onBlur)
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
              {/* biome-ignore lint/performance/noImgElement: sample preview image */}
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
          // biome-ignore lint/performance/noImgElement: upload zone preview
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
              Drag and drop an image here Â· JPG, PNG Â· Max 10MB
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: C.text }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {/* biome-ignore lint/performance/noImgElement: upload icon SVG */}
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

      {/* Tip â€” only shown when tip text is provided */}
      {tip && (
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
      )}

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

function GarmentCatalogModal({
  onSelect,
  onClose,
}: {
  onSelect: (img: GarmentCatalogImage) => void;
  onClose: () => void;
}) {
  const { data, isLoading } = useQuery<GarmentCatalogImage[]>({
    queryKey: ['tryon-garment-images'],
    queryFn: () => api.get('/v1/tryon/garment-images'),
  });
  const images = data ?? [];

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: modal backdrop close on click
    // biome-ignore lint/a11y/noStaticElementInteractions: modal backdrop
    <div
      onClick={onClose}
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
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: stopPropagation only, not itself interactive */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: stopPropagation only, not itself interactive */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: C.white,
          borderRadius: 16,
          width: 'min(1180px, calc(100vw - 32px))',
          height: 'min(857px, calc(100vh - 32px))',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 24px 60px rgba(0,0,0,0.2)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '16px 20px',
            borderBottom: `1px solid ${C.border}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: C.text }}>
            <svg
              aria-hidden="true"
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ opacity: 0.7 }}
            >
              <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />
            </svg>
            <span style={{ fontSize: 12, fontWeight: 500, color: C.text }}>
              Browse from Catalog
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 8,
              color: C.mid,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 8,
            }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
        <div style={{ padding: 20, overflowY: 'auto', flex: 1 }}>
          {isLoading ? (
            <div style={{ textAlign: 'center', color: C.mid, padding: '2rem' }}>Loading…</div>
          ) : images.length === 0 ? (
            <div style={{ textAlign: 'center', color: C.mid, padding: '2rem', fontSize: 13 }}>
              No eligible catalog images yet — generate one in Studio first.
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(5, 1fr)',
                gap: 12,
              }}
            >
              {images.map((img) => (
                <button
                  key={img.jobId}
                  type="button"
                  onClick={() => onSelect(img)}
                  style={{
                    border: `1px solid ${C.border}`,
                    borderRadius: 10,
                    padding: 0,
                    overflow: 'hidden',
                    cursor: 'pointer',
                    background: 'none',
                    textAlign: 'left',
                  }}
                >
                  {img.thumbnailUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    // biome-ignore lint/performance/noImgElement: garment thumbnail in picker
                    <img
                      src={img.thumbnailUrl}
                      alt={img.garmentTypeName}
                      style={{
                        width: '100%',
                        aspectRatio: '3/4',
                        objectFit: 'cover',
                        display: 'block',
                      }}
                    />
                  ) : (
                    <div style={{ width: '100%', aspectRatio: '3/4', background: C.bg }} />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function TryOnPage() {
  const [personFile, setPersonFile] = useState<File | null>(null);
  const [personPreview, setPersonPreview] = useState<string | null>(null);
  const [personProgress, setPersonProgress] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultJobId, setResultJobId] = useState<string | null>(null);
  const [downloadingResult, setDownloadingResult] = useState(false);
  const [sharingResult, setSharingResult] = useState(false);
  const [resultActionFeedback, setResultActionFeedback] = useState<{
    tone: 'success' | 'error';
    message: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingJobId, setPendingJobId] = useState<string | null>(null);
  const [selectedGarmentJob, setSelectedGarmentJob] = useState<{
    jobId: string;
    thumbnailUrl: string | null;
    garmentTypeName: string;
  } | null>(null);
  const [showGarmentPicker, setShowGarmentPicker] = useState(false);
  const previewPanelRef = useRef<HTMLDivElement>(null);
  const [isPreviewFullscreen, setIsPreviewFullscreen] = useState(false);

  // Contact form
  const [showContact, setShowContact] = useState(false);
  const [contactSource, setContactSource] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactMessage, setContactMessage] = useState('');
  const [contactSubmitting, setContactSubmitting] = useState(false);
  const [contactDone, setContactDone] = useState(false);

  useEffect(() => {
    const syncFullscreen = () => {
      setIsPreviewFullscreen(document.fullscreenElement === previewPanelRef.current);
    };
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  }, []);

  const togglePreviewFullscreen = async () => {
    const previewPanel = previewPanelRef.current;
    if (!previewPanel) return;

    try {
      if (document.fullscreenElement === previewPanel) {
        await document.exitFullscreen();
      } else {
        await previewPanel.requestFullscreen();
      }
    } catch {
      setError('Full screen is not available in this browser.');
    }
  };

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
      // silently stay open â€” user can retry
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
  const personSampleUrl = tryonData?.personSampleUrl ?? null;
  const creditsCost = tryonData?.creditsCost ?? DEFAULT_CREDITS_COST;

  useJobStream(
    useCallback(
      (evt) => {
        if (!pendingJobId || evt.jobId !== pendingJobId) return;
        if (evt.status === 'COMPLETED') {
          setResultJobId(pendingJobId);
          setPendingJobId(null);
          api
            .get<{ url: string }>(`/v1/jobs/${pendingJobId}/result`)
            .then(({ url }) => setResultUrl(url))
            .catch(() => setError('Generation failed. Please try again or contact support.'))
            .finally(() => {
              setGenerating(false);
              setPersonProgress(0);
            });
        } else if (evt.status === 'FAILED') {
          setPendingJobId(null);
          setError('Generation failed. Please try again or contact support.');
          setGenerating(false);
          setPersonProgress(0);
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
    setResultJobId(null);
    setResultActionFeedback(null);
  };

  const handleGenerate = async () => {
    if (!personFile || !selectedGarmentJob) {
      setError('Select a garment from the catalog and upload a person image first.');
      return;
    }
    setGenerating(true);
    setError(null);
    setResultUrl(null);
    setResultJobId(null);
    setResultActionFeedback(null);
    setPersonProgress(1);
    try {
      const personPresign = await api.post<{ uploadUrl: string; r2Key: string }>(
        '/v1/uploads/presign',
        { contentType: personFile.type, contentLength: personFile.size },
      );

      await api.uploadToR2WithProgress(personPresign.uploadUrl, personFile, setPersonProgress);
      setPersonProgress(100);

      const { jobId } = await api.post<{ jobId: string; catalogueId: string }>(
        '/v1/jobs/simple-tryon',
        { personKey: personPresign.r2Key, sourceJobId: selectedGarmentJob.jobId },
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
    }
  };

  const handleSelectGarment = (img: GarmentCatalogImage) => {
    setSelectedGarmentJob({
      jobId: img.jobId,
      thumbnailUrl: img.thumbnailUrl,
      garmentTypeName: img.garmentTypeName,
    });
    setShowGarmentPicker(false);
    setError(null);
    setResultUrl(null);
    setResultJobId(null);
    setResultActionFeedback(null);
  };

  const fetchResultBlob = async () => {
    if (!resultUrl) throw new Error('Generate a Try On result first.');
    const response = await fetch(resultUrl);
    if (!response.ok) throw new Error(downloadErrorMessage(response.status));
    return response.blob();
  };

  const resultFile = (blob: Blob) => {
    const extension =
      blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg';
    const suffix = resultJobId?.slice(0, 8) ?? 'result';
    return new File([blob], `aivastra-tryon-${suffix}.${extension}`, {
      type: blob.type || 'image/jpeg',
    });
  };

  const handleDownloadResult = async () => {
    if (!resultUrl || downloadingResult) return;

    setDownloadingResult(true);
    setResultActionFeedback(null);
    try {
      const file = resultFile(await fetchResultBlob());
      const objectUrl = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = file.name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
      setResultActionFeedback({ tone: 'success', message: 'Image downloaded.' });
    } catch (downloadError) {
      setResultActionFeedback({
        tone: 'error',
        message:
          downloadError instanceof Error
            ? downloadError.message
            : 'The image could not be downloaded. Try again.',
      });
    } finally {
      setDownloadingResult(false);
    }
  };

  const handleShareResult = async () => {
    if (!resultUrl || sharingResult) return;

    setSharingResult(true);
    setResultActionFeedback(null);
    const shareData = {
      title: 'Ai Vastra Try On',
      text: 'My AI-generated Try On from Ai Vastra.',
    };

    try {
      if (navigator.share) {
        let fileShareAttempted = false;
        try {
          const file = resultFile(await fetchResultBlob());
          if (navigator.canShare?.({ files: [file] })) {
            fileShareAttempted = true;
            await navigator.share({ ...shareData, files: [file] });
            setResultActionFeedback({ tone: 'success', message: 'Image shared.' });
            return;
          }
        } catch (shareError) {
          if (shareError instanceof DOMException && shareError.name === 'AbortError') return;
          if (fileShareAttempted) throw shareError;
        }

        try {
          await navigator.share({ ...shareData, url: resultUrl });
          setResultActionFeedback({ tone: 'success', message: 'Result shared.' });
          return;
        } catch (shareError) {
          if (shareError instanceof DOMException && shareError.name === 'AbortError') return;
        }
      }

      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(resultUrl);
        setResultActionFeedback({
          tone: 'success',
          message: 'Result link copied to the clipboard.',
        });
        return;
      }

      throw new Error('Sharing is not available in this browser.');
    } catch (shareError) {
      setResultActionFeedback({
        tone: 'error',
        message:
          shareError instanceof Error
            ? shareError.message
            : 'The image could not be shared. Try again.',
      });
    } finally {
      setSharingResult(false);
    }
  };

  const canGenerate = !generating && !!personFile && !!selectedGarmentJob;
  const canUseResultActions = !!resultUrl && !downloadingResult && !sharingResult;

  return (
    <>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <TopBar
          title="AI Virtual Try On"
          subtitle="Create Stunning try on images in seconds with AI"
        />

        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            padding: '20px 24px',
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            gap: 24,
            backgroundColor: C.bg,
          }}
        >
          {/* Steps Indicator */}
          <div
            style={{
              background: C.white,
              padding: '16px',
              borderRadius: 20,
              border: `1px solid ${C.border}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
            }}
          >
            {[
              {
                num: '01',
                title: 'Select Garment',
                desc: 'Choose your outfit',
                color: '#7C3AED',
                lightColor: 'var(--tryon-step-bg-1)',
              },
              {
                num: '02',
                title: 'Upload Person',
                desc: 'Front-facing photo',
                color: '#EC4899',
                lightColor: 'var(--tryon-step-bg-2)',
              },
              {
                num: '03',
                title: 'AI Generate',
                desc: '10-15 seconds',
                color: '#F97316',
                lightColor: 'var(--tryon-step-bg-3)',
              },
              {
                num: '04',
                title: 'Download',
                desc: 'Save & share',
                color: '#10B981',
                lightColor: 'var(--tryon-step-bg-4)',
              },
            ].map((step, idx, arr) => (
              <div
                key={step.num}
                style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 16 }}
              >
                <div
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 16,
                    background: C.white,
                    padding: '12px 20px',
                    borderRadius: 14,
                    border: `1px solid ${C.border}`,
                    boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
                  }}
                >
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: '50%',
                      background: step.lightColor,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: '50%',
                        background: step.color,
                        color: '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 13,
                        fontWeight: 600,
                      }}
                    >
                      {step.num}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{step.title}</div>
                    <div style={{ fontSize: 12, color: C.mid, fontWeight: 500 }}>{step.desc}</div>
                  </div>
                </div>
                {idx < arr.length - 1 && (
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#9CA3AF"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ flexShrink: 0 }}
                  >
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                )}
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.22fr', gap: 24 }}>
            {/* Left Column */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              {/* Select Garment & Upload Person Row */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                {/* 1. Select Garment */}
                <div
                  style={{
                    background: C.white,
                    borderRadius: 16,
                    border: 'none',
                    padding: '16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                    boxShadow: '0 8px 30px rgba(0,0,0,0.05)',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>
                      1. Select Image from Catalogues
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => !generating && setShowGarmentPicker(true)}
                    style={{
                      flex: 1,
                      minHeight: 260,
                      borderRadius: 12,
                      border: `2px dashed ${selectedGarmentJob ? 'transparent' : 'var(--tryon-garment-dashed)'}`,
                      outlineOffset: -2,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 12,
                      padding: 16,
                      boxSizing: 'border-box',
                      cursor: generating ? 'default' : 'pointer',
                      overflow: 'hidden',
                      background: 'transparent',
                      font: 'inherit',
                      textAlign: 'inherit',
                      color: 'inherit',
                    }}
                  >
                    {selectedGarmentJob?.thumbnailUrl ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      // biome-ignore lint/performance/noImgElement: selected garment thumbnail
                      <img
                        src={selectedGarmentJob.thumbnailUrl}
                        alt={selectedGarmentJob.garmentTypeName}
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'contain',
                          borderRadius: 8,
                        }}
                      />
                    ) : (
                      <>
                        <div
                          style={{
                            width: 56,
                            height: 56,
                            borderRadius: '50%',
                            background: 'var(--tryon-garment-icon-bg)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                            <path
                              d="M3 7L7 4H9.5C9.5 5.38 10.62 6.5 12 6.5C13.38 6.5 14.5 5.38 14.5 4H17L21 7L18.5 9.5L17 8V20H7V8L5.5 9.5L3 7Z"
                              stroke="#818CF8"
                              strokeWidth="1.5"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </div>
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 500,
                            textAlign: 'center',
                            color: C.mid,
                            lineHeight: 1.6,
                          }}
                        >
                          Drag and drop an image here &middot; JPG, PNG &middot; Max 10MB
                        </span>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            background: C.white,
                            border: `1px solid ${C.border}`,
                            padding: '8px 18px',
                            borderRadius: 10,
                            boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
                          }}
                        >
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="#6366F1"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />
                          </svg>
                          <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>
                            Browse from Catalogues
                          </span>
                        </div>
                      </>
                    )}
                  </button>
                </div>

                {/* 2. Upload Person */}
                <div
                  style={{
                    background: C.white,
                    borderRadius: 16,
                    border: 'none',
                    padding: '16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                    boxShadow: '0 8px 30px rgba(0,0,0,0.05)',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>
                      2. Upload Person Image
                    </span>
                  </div>

                  {/* Dashed border wraps upload zone + tips + badges */}
                  <div
                    style={{
                      flex: 1,
                      display: 'flex',
                      flexDirection: 'column',
                      border: '2px dashed var(--tryon-person-dashed)',
                      borderRadius: 12,
                      background: 'transparent',
                      padding: '0 0 12px 0',
                      gap: 10,
                    }}
                  >
                    <UploadZone
                      file={personFile}
                      preview={personPreview}
                      progress={personProgress}
                      label=""
                      tip=""
                      disabled={generating}
                      sampleUrl={personSampleUrl}
                      onFile={(f) => pickFile(f, setPersonFile, setPersonPreview)}
                      icon={
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                          <circle cx="12" cy="8" r="3.5" stroke="#F472B6" strokeWidth="1.5" />
                          <path
                            d="M5 20C5 17 8 15 12 15C16 15 19 17 19 20"
                            stroke="#F472B6"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                          />
                        </svg>
                      }
                    />
                    {/* Tips + Badges inside the dashed border */}
                    <div style={{ paddingInline: 12 }}>
                      <div
                        style={{
                          display: 'flex',
                          gap: 8,
                          flexWrap: 'wrap',
                          justifyContent: 'center',
                        }}
                      >
                        <div
                          style={{
                            background: C.bg,
                            color: C.text,
                            fontSize: 11,
                            fontWeight: 600,
                            padding: '5px 12px',
                            borderRadius: 20,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 5,
                          }}
                        >
                          <svg
                            width="11"
                            height="11"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="#818CF8"
                            strokeWidth="3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M20 6 9 17l-5-5" />
                          </svg>
                          Front Facing
                        </div>
                        <div
                          style={{
                            background: C.bg,
                            color: C.text,
                            fontSize: 11,
                            fontWeight: 600,
                            padding: '5px 12px',
                            borderRadius: 20,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 5,
                          }}
                        >
                          <svg
                            width="11"
                            height="11"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="#818CF8"
                            strokeWidth="3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M20 6 9 17l-5-5" />
                          </svg>
                          Good Lighting
                        </div>
                        <div
                          style={{
                            background: C.bg,
                            color: C.text,
                            fontSize: 11,
                            fontWeight: 600,
                            padding: '5px 12px',
                            borderRadius: 20,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 5,
                          }}
                        >
                          <svg
                            width="11"
                            height="11"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="#818CF8"
                            strokeWidth="3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M20 6 9 17l-5-5" />
                          </svg>
                          Clear Image
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Try-On Settings + Credits + Generate â€” single unified card */}
              <div
                style={{
                  background: C.white,
                  borderRadius: 16,
                  border: 'none',
                  padding: '20px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 0,
                  boxShadow: '0 8px 30px rgba(0,0,0,0.05)',
                }}
              >
                {/* Settings header + dropdowns */}
                {/* <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 16 }}>
                  Try On Settings
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 16 }}>
                  <CustomSelect
                    label="Model"
                    defaultValue="Female"
                    options={['Female', 'Male', 'Kids', 'Unisex']}
                  />
                  <CustomSelect
                    label="Fit Preference"
                    defaultValue="Regular"
                    options={['Regular', 'Slim', 'Oversized', 'Relaxed']}
                  />
                  <CustomSelect
                    label="Output Quality"
                    defaultValue="High (2K)"
                    options={['Standard (1K)', 'High (2K)', 'Ultra (4K)']}
                  />
                  <CustomSelect
                    label="Background"
                    defaultValue="Clean (Auto)"
                    options={['Clean (Auto)', 'Studio', 'Street', 'Original']}
                  />
                </div> */}

                {/* Tips row */}
                <div
                  style={{
                    display: 'flex',
                    gap: 6,
                    marginTop: 16,
                    alignItems: 'center',
                    background: C.bg,
                    border: `1px solid ${C.border}`,
                    padding: '10px 16px',
                    borderRadius: 8,
                  }}
                >
                  <img
                    src="/assets/bulb.svg"
                    width={12}
                    height={14}
                    alt=""
                    style={{ filter: 'var(--icon-invert)', opacity: 0.8 }}
                  />
                  <span style={{ fontSize: 11, color: '#818CF8', fontWeight: 600 }}>Tips:</span>
                  <span style={{ fontSize: 11, color: C.mid }}>
                    For best results, use front-facing images with good lighting and clear outfit
                    details.
                  </span>
                </div>

                {/* Error (inline, inside the card) */}
                {error && (
                  <div
                    style={{
                      fontSize: 13,
                      color: '#f87171',
                      padding: '10px 14px',
                      background: 'rgba(220,38,38,0.12)',
                      borderRadius: 8,
                      marginTop: 12,
                    }}
                  >
                    {error}
                  </div>
                )}

                {/* Divider */}
                <div
                  style={{
                    height: 1,
                    background: C.border,
                    marginTop: 16,
                    marginBottom: 16,
                    marginInline: -20,
                  }}
                />

                {/* Credits + Generate button row */}
                <div
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 8,
                        background: '#FDF2F8',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <img src="/assets/credit.png" width={20} height={20} alt="" />
                    </div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>
                        {creditsCost} credits required
                      </div>
                      <div style={{ fontSize: 12, color: C.mid }}>
                        You have {credits?.balance ?? 0} credits (
                        {Math.floor((credits?.balance ?? 0) / creditsCost)} generations)
                      </div>
                    </div>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <button
                      type="button"
                      onClick={handleGenerate}
                      disabled={!canGenerate}
                      style={{
                        height: 48,
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
                      <img
                        src="/assets/generate-icon.svg"
                        alt=""
                        width={20}
                        height={20}
                        style={{
                          filter: 'brightness(0) invert(1)',
                          opacity: canGenerate ? 1 : 0.4,
                        }}
                      />
                      <span
                        style={{
                          fontSize: 15,
                          fontWeight: 600,
                          color: canGenerate ? '#fff' : C.light,
                        }}
                      >
                        {generating ? 'Generating…' : 'Generate Try On'}
                      </span>
                    </button>
                    {!generating && (
                      <div style={{ fontSize: 11, color: C.mid }}>Estimated Time:~ 25 seconds</div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column (Preview) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div
                ref={previewPanelRef}
                style={{
                  flex: 1,
                  background: C.white,
                  borderRadius: isPreviewFullscreen ? 0 : 16,
                  border: 'none',
                  display: 'flex',
                  flexDirection: 'column',
                  padding: 20,
                  minHeight: isPreviewFullscreen ? '100vh' : 500,
                  height: isPreviewFullscreen ? '100vh' : undefined,
                  width: '100%',
                  boxSizing: 'border-box',
                  boxShadow: '0 8px 30px rgba(0,0,0,0.05)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 16,
                  }}
                >
                  <span style={{ fontSize: 16, fontWeight: 600, color: C.text }}>
                    Your Try On Preview
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <button
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        background: C.bg,
                        border: `1px solid ${C.border}`,
                        padding: '6px 12px',
                        borderRadius: 8,
                        fontSize: 12,
                        fontWeight: 600,
                        color: C.text,
                        cursor: 'pointer',
                      }}
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4" />
                        <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                        <line x1="12" y1="3" x2="12" y2="21" />
                      </svg>
                      Compare
                    </button>
                    <button
                      type="button"
                      onClick={() => void togglePreviewFullscreen()}
                      aria-pressed={isPreviewFullscreen}
                      title={isPreviewFullscreen ? 'Exit full screen' : 'Enter full screen'}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        background: C.bg,
                        border: `1px solid ${C.border}`,
                        padding: '6px 12px',
                        borderRadius: 8,
                        fontSize: 12,
                        fontWeight: 600,
                        color: C.text,
                        cursor: 'pointer',
                      }}
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M8 3H5a2 2 0 0 0-2 2v3" />
                        <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
                        <path d="M3 16v3a2 2 0 0 0 2 2h3" />
                        <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
                      </svg>
                      {isPreviewFullscreen ? 'Exit Full Screen' : 'Full Screen'}
                    </button>
                  </div>
                </div>

                <div style={{ flex: 1, display: 'flex', gap: 12, minHeight: 0 }}>
                  {resultUrl ? (
                    <>
                      <div
                        style={{
                          flex: 1,
                          position: 'relative',
                          borderRadius: 8,
                          overflow: 'hidden',
                          background: C.border,
                        }}
                      >
                        <div
                          style={{
                            position: 'absolute',
                            top: 12,
                            left: 12,
                            background: 'rgba(0,0,0,0.4)',
                            color: '#fff',
                            padding: '4px 10px',
                            borderRadius: 6,
                            fontSize: 12,
                            fontWeight: 600,
                            zIndex: 10,
                          }}
                        >
                          Before
                        </div>
                        {personPreview && (
                          <img
                            src={personPreview}
                            alt="Before"
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                        )}
                      </div>
                      <div
                        style={{
                          flex: 1,
                          position: 'relative',
                          borderRadius: 8,
                          overflow: 'hidden',
                          background: C.border,
                        }}
                      >
                        <div
                          style={{
                            position: 'absolute',
                            top: 12,
                            right: 12,
                            background: '#818CF8',
                            color: '#fff',
                            padding: '4px 10px',
                            borderRadius: 6,
                            fontSize: 12,
                            fontWeight: 600,
                            zIndex: 10,
                          }}
                        >
                          After AI
                        </div>
                        <img
                          src={resultUrl}
                          alt="After AI"
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      </div>
                    </>
                  ) : (
                    <div
                      style={{
                        flex: 1,
                        borderRadius: 8,
                        background: C.bg,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 16,
                      }}
                    >
                      {generating ? (
                        <>
                          <svg
                            aria-hidden="true"
                            width="40"
                            height="40"
                            viewBox="0 0 40 40"
                            fill="none"
                          >
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
                          <span style={{ fontSize: 16, fontWeight: 600, color: C.text }}>
                            Generating your try on...
                          </span>
                        </>
                      ) : (
                        <>
                          <div
                            style={{
                              width: 80,
                              height: 80,
                              borderRadius: '50%',
                              background: C.white,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              boxShadow: '0 4px 20px rgba(0,0,0,0.05)',
                            }}
                          >
                            <svg
                              width="32"
                              height="32"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="#D1D5DB"
                              strokeWidth="2"
                            >
                              <circle cx="12" cy="8" r="5" />
                              <path d="M20 21a8 8 0 0 0-16 0" />
                            </svg>
                          </div>
                          <span style={{ fontSize: 14, color: C.mid }}>
                            Your preview will appear here
                          </span>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, 1fr)',
                    gap: 12,
                    marginTop: 16,
                  }}
                >
                  <button
                    type="button"
                    onClick={handleDownloadResult}
                    disabled={!canUseResultActions}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                      height: 40,
                      background: C.white,
                      border: `1px solid ${C.border}`,
                      borderRadius: 8,
                      fontSize: 13,
                      fontWeight: 600,
                      color: C.text,
                      cursor: canUseResultActions ? 'pointer' : 'not-allowed',
                      opacity: canUseResultActions ? 1 : 0.55,
                    }}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    {downloadingResult ? 'Downloading...' : 'Download'}
                  </button>
                  <button
                    type="button"
                    onClick={handleShareResult}
                    disabled={!canUseResultActions}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                      height: 40,
                      background: C.white,
                      border: `1px solid ${C.border}`,
                      borderRadius: 8,
                      fontSize: 13,
                      fontWeight: 600,
                      color: C.text,
                      cursor: canUseResultActions ? 'pointer' : 'not-allowed',
                      opacity: canUseResultActions ? 1 : 0.55,
                    }}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                      <polyline points="16 6 12 2 8 6" />
                      <line x1="12" y1="2" x2="12" y2="15" />
                    </svg>
                    {sharingResult ? 'Sharing...' : 'Share'}
                  </button>
                </div>
                {resultActionFeedback && (
                  <div
                    role={resultActionFeedback.tone === 'error' ? 'alert' : 'status'}
                    style={{
                      marginTop: 8,
                      color: resultActionFeedback.tone === 'error' ? '#DC2626' : '#059669',
                      fontSize: 12,
                      fontWeight: 500,
                      textAlign: 'center',
                    }}
                  >
                    {resultActionFeedback.message}
                  </div>
                )}

                {/* Badges */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(4, 1fr)',
                    gap: 16,
                    marginTop: 16,
                    border: `1px solid ${C.border}`,
                    padding: '16px',
                    borderRadius: 12,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: '50%',
                        background: 'var(--tryon-badge-icon-bg)',
                        color: '#6366F1',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
                      </svg>
                    </div>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>AI Powered</div>
                      <div style={{ fontSize: 11, color: C.mid }}>High Accuracy</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: '50%',
                        background: 'var(--tryon-badge-icon-bg)',
                        color: '#6366F1',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                      </svg>
                    </div>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>
                        Private & Secure
                      </div>
                      <div style={{ fontSize: 11, color: C.mid }}>Your data is safe</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: '50%',
                        background: 'var(--tryon-badge-icon-bg)',
                        color: '#6366F1',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                      </svg>
                    </div>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>
                        Commercial Use
                      </div>
                      <div style={{ fontSize: 11, color: C.mid }}>100% Allowed</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: '50%',
                        background: 'var(--tryon-badge-icon-bg)',
                        color: '#6366F1',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <circle cx="12" cy="12" r="10" />
                        <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                      </svg>
                    </div>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>
                        No Watermark
                      </div>
                      <div style={{ fontSize: 11, color: C.mid }}>Clean Output</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Garment catalog picker modal */}
      {showGarmentPicker && (
        <GarmentCatalogModal
          onSelect={handleSelectGarment}
          onClose={() => setShowGarmentPicker(false)}
        />
      )}
    </>
  );
}
