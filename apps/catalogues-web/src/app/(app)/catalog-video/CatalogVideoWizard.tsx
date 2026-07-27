'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronLeft, X } from 'lucide-react';
import { useState } from 'react';

import { C } from '@/components/tokens';
import { GradBtn } from '@/components/ui/grad-btn';
import { api } from '@/lib/api';

interface CatalogueImageOption {
  jobId: string;
  catalogueId: string;
  thumbUrl: string | null;
}

interface SampleVideoOption {
  id: string;
  title: string;
  thumbnailUrl: string;
  previewVideoUrl: string;
}

type CatalogueResponse = Array<{
  catalogueId: string;
  coverThumbUrl: string | null;
  jobs: Array<{ id: string; status: string }>;
}>;

export function CatalogVideoWizard({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}): React.ReactElement {
  const qc = useQueryClient();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [sourceJobId, setSourceJobId] = useState<string | null>(null);
  const [sampleVideoId, setSampleVideoId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: catalogues, isLoading: cataloguesLoading } = useQuery<CatalogueResponse>({
    queryKey: ['catalogues'],
    queryFn: () => api.get('/v1/catalogues'),
  });

  const { data: sampleVideos, isLoading: sampleVideosLoading } = useQuery<{
    items: SampleVideoOption[];
  }>({
    queryKey: ['sample-videos'],
    queryFn: () => api.get('/v1/models/sample-videos'),
    enabled: step >= 2,
  });

  const imageOptions: CatalogueImageOption[] = (catalogues ?? []).flatMap((catalogue) =>
    catalogue.jobs
      .filter((job) => job.status === 'COMPLETED')
      .map((job) => ({
        jobId: job.id,
        catalogueId: catalogue.catalogueId,
        thumbUrl: catalogue.coverThumbUrl,
      })),
  );
  const selectedImage = imageOptions.find((option) => option.jobId === sourceJobId);
  const selectedSample = sampleVideos?.items.find((option) => option.id === sampleVideoId);

  const handleSubmit = async () => {
    if (!sourceJobId || !sampleVideoId) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.post('/v1/jobs/catalog-video', { sourceJobId, sampleVideoId });
      await qc.invalidateQueries({ queryKey: ['catalog-videos'] });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start video generation');
    } finally {
      setSubmitting(false);
    }
  };

  const nextDisabled = (step === 1 && !sourceJobId) || (step === 2 && !sampleVideoId) || submitting;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: modal backdrop; click outside dismisses
    <div
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        background: 'rgba(8, 12, 24, 0.62)',
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="catalog-video-wizard-title"
        style={{
          width: 'min(760px, 100%)',
          maxHeight: 'calc(100vh - 40px)',
          overflow: 'hidden',
          border: `1px solid ${C.border}`,
          borderRadius: 8,
          background: C.card,
          boxShadow: '0 20px 56px rgba(0, 0, 0, 0.32)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            padding: '18px 20px',
            borderBottom: `1px solid ${C.border}`,
          }}
        >
          <div>
            <h2 id="catalog-video-wizard-title" style={{ margin: 0, color: C.text, fontSize: 18 }}>
              New Catalog Video
            </h2>
            {/* biome-ignore lint/a11y/useSemanticElements: decorative step indicator, not a form control group — <fieldset> would misrepresent it */}
            <div
              role="group"
              style={{ display: 'flex', gap: 6, marginTop: 10 }}
              aria-label={`Step ${step} of 3`}
            >
              {[1, 2, 3].map((item) => (
                <span
                  key={item}
                  style={{
                    display: 'block',
                    width: 42,
                    height: 3,
                    background: item <= step ? C.pink : C.border,
                  }}
                />
              ))}
            </div>
          </div>
          <button
            type="button"
            aria-label="Close"
            disabled={submitting}
            onClick={onClose}
            style={{
              width: 32,
              height: 32,
              border: `1px solid ${C.border}`,
              borderRadius: 6,
              background: 'transparent',
              color: C.mid,
              display: 'grid',
              placeItems: 'center',
              cursor: submitting ? 'not-allowed' : 'pointer',
            }}
          >
            <X size={16} />
          </button>
        </header>

        <div style={{ padding: 20, overflowY: 'auto' }}>
          {step === 1 && (
            <>
              <p style={{ margin: '0 0 16px', color: C.mid, fontSize: 13 }}>
                Choose a completed catalogue image.
              </p>
              {cataloguesLoading ? (
                <p style={{ color: C.mid, fontSize: 13 }}>Loading images...</p>
              ) : imageOptions.length === 0 ? (
                <p style={{ color: C.mid, fontSize: 13 }}>
                  No completed catalogue images are available.
                </p>
              ) : (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(132px, 1fr))',
                    gap: 12,
                  }}
                >
                  {imageOptions.map((option) => {
                    const selected = option.jobId === sourceJobId;
                    return (
                      <button
                        key={option.jobId}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => setSourceJobId(option.jobId)}
                        style={{
                          position: 'relative',
                          aspectRatio: '3 / 4',
                          overflow: 'hidden',
                          border: selected ? `2px solid ${C.pink}` : `1px solid ${C.border}`,
                          borderRadius: 6,
                          padding: 0,
                          background: C.lighter,
                          cursor: 'pointer',
                        }}
                      >
                        {option.thumbUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          // biome-ignore lint/performance/noImgElement: presigned R2 URL
                          <img
                            src={option.thumbUrl}
                            alt=""
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                        ) : (
                          <span style={{ color: C.mid, fontSize: 12 }}>Image unavailable</span>
                        )}
                        {selected && (
                          <span
                            style={{
                              position: 'absolute',
                              top: 8,
                              right: 8,
                              width: 22,
                              height: 22,
                              borderRadius: 999,
                              background: C.pink,
                              color: C.white,
                              display: 'grid',
                              placeItems: 'center',
                            }}
                          >
                            <Check size={14} />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <p style={{ margin: '0 0 16px', color: C.mid, fontSize: 13 }}>
                Choose the motion template for your video.
              </p>
              {sampleVideosLoading ? (
                <p style={{ color: C.mid, fontSize: 13 }}>Loading motion templates...</p>
              ) : (sampleVideos?.items.length ?? 0) === 0 ? (
                <p style={{ color: C.mid, fontSize: 13 }}>No video templates are available.</p>
              ) : (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(176px, 1fr))',
                    gap: 12,
                  }}
                >
                  {(sampleVideos?.items ?? []).map((option) => {
                    const selected = option.id === sampleVideoId;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => setSampleVideoId(option.id)}
                        style={{
                          position: 'relative',
                          padding: 8,
                          textAlign: 'left',
                          overflow: 'hidden',
                          border: selected ? `2px solid ${C.pink}` : `1px solid ${C.border}`,
                          borderRadius: 6,
                          background: C.field,
                          cursor: 'pointer',
                        }}
                      >
                        <video
                          src={option.previewVideoUrl}
                          poster={option.thumbnailUrl}
                          muted
                          preload="metadata"
                          style={{
                            width: '100%',
                            aspectRatio: '16 / 9',
                            objectFit: 'cover',
                            display: 'block',
                          }}
                        />
                        <span
                          style={{
                            display: 'block',
                            marginTop: 8,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            color: C.text,
                            fontSize: 13,
                            fontWeight: 600,
                          }}
                        >
                          {option.title}
                        </span>
                        {selected && (
                          <span
                            style={{
                              position: 'absolute',
                              top: 14,
                              right: 14,
                              width: 22,
                              height: 22,
                              borderRadius: 999,
                              background: C.pink,
                              color: C.white,
                              display: 'grid',
                              placeItems: 'center',
                            }}
                          >
                            <Check size={14} />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {step === 3 && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div style={{ border: `1px solid ${C.border}`, borderRadius: 6, overflow: 'hidden' }}>
                <div style={{ aspectRatio: '3 / 4', background: C.lighter }}>
                  {selectedImage?.thumbUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    // biome-ignore lint/performance/noImgElement: presigned R2 URL
                    <img
                      src={selectedImage.thumbUrl}
                      alt="Selected catalogue"
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  )}
                </div>
                <div style={{ padding: 10, color: C.mid, fontSize: 12 }}>Catalogue image</div>
              </div>
              <div style={{ border: `1px solid ${C.border}`, borderRadius: 6, overflow: 'hidden' }}>
                {selectedSample && (
                  <video
                    src={selectedSample.previewVideoUrl}
                    poster={selectedSample.thumbnailUrl}
                    muted
                    controls
                    style={{
                      width: '100%',
                      aspectRatio: '16 / 9',
                      objectFit: 'cover',
                      display: 'block',
                    }}
                  />
                )}
                <div style={{ padding: 10, color: C.mid, fontSize: 12 }}>
                  {selectedSample?.title ?? 'Motion template'}
                </div>
              </div>
              {error && (
                <p style={{ gridColumn: '1 / -1', margin: 0, color: '#D63B4C', fontSize: 13 }}>
                  {error}
                </p>
              )}
            </div>
          )}
        </div>

        <footer
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '16px 20px',
            borderTop: `1px solid ${C.border}`,
          }}
        >
          {step > 1 ? (
            <button
              type="button"
              disabled={submitting}
              onClick={() => setStep((current) => (current - 1) as 1 | 2 | 3)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                border: 'none',
                background: 'transparent',
                color: C.mid,
                padding: 8,
                fontSize: 13,
                cursor: submitting ? 'not-allowed' : 'pointer',
              }}
            >
              <ChevronLeft size={16} />
              Back
            </button>
          ) : (
            <span />
          )}
          {step < 3 ? (
            <GradBtn
              disabled={nextDisabled}
              onClick={() => setStep((current) => (current + 1) as 1 | 2 | 3)}
            >
              Next
            </GradBtn>
          ) : (
            <GradBtn disabled={submitting} onClick={handleSubmit}>
              {submitting ? 'Starting...' : 'Generate video'}
            </GradBtn>
          )}
        </footer>
      </section>
    </div>
  );
}
