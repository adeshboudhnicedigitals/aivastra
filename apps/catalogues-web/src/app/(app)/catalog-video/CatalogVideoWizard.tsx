'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronLeft, X } from 'lucide-react';
import { useState } from 'react';

import { C } from '@/components/tokens';
import { GradBtn } from '@/components/ui/grad-btn';
import { Tooltip } from '@/components/ui/tooltip';
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
    creditCost: number;
    items: SampleVideoOption[];
  }>({
    queryKey: ['sample-videos'],
    queryFn: () => api.get('/v1/models/sample-videos'),
    enabled: step >= 2,
  });

  const { data: creditsData } = useQuery<{ balance: number }>({
    queryKey: ['credits'],
    queryFn: () => api.get('/v1/credits'),
    enabled: step >= 2,
  });

  const creditCost = sampleVideos?.creditCost;
  const balance = creditsData?.balance;
  const insufficientCredits =
    typeof creditCost === 'number' && typeof balance === 'number' && balance < creditCost;

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
    if (!sourceJobId || !sampleVideoId || insufficientCredits) return;
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
    <>
      <style>{`
        .wizard-backdrop {
          position: fixed;
          inset: 0;
          z-index: 1000;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          background: rgba(8, 12, 24, 0.62);
        }

        .wizard-dialog {
          width: min(960px, calc(100vw - 40px));
          height: min(800px, calc(100vh - 40px));
          overflow: hidden;
          border: 1px solid ${C.border};
          border-radius: 8px;
          background: ${C.card};
          box-shadow: 0 20px 56px rgba(0, 0, 0, 0.32);
          display: flex;
          flex-direction: column;
        }

        .wizard-step1-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
          gap: 12px;
        }

        .wizard-step2-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
          gap: 16px;
        }

        .wizard-step3-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
        }

        @media (max-width: 639px) {
          .wizard-backdrop {
            padding: 10px;
          }
          .wizard-dialog {
            width: calc(100vw - 20px);
            height: calc(100vh - 20px);
          }
          .wizard-step1-grid {
            grid-template-columns: repeat(2, 1fr);
            gap: 10px;
          }
          .wizard-step2-grid {
            grid-template-columns: repeat(2, 1fr);
            gap: 10px;
          }
          .wizard-step3-grid {
            grid-template-columns: 1fr;
            gap: 12px;
          }
        }
      `}</style>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: modal backdrop; click outside dismisses */}
      <div
        role="presentation"
        className="wizard-backdrop"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget && !submitting) onClose();
        }}
      >
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby="catalog-video-wizard-title"
          className="wizard-dialog"
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
              <h2
                id="catalog-video-wizard-title"
                style={{ margin: 0, color: C.text, fontSize: 18 }}
              >
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

          <div style={{ padding: 20, overflowY: 'auto', flex: 1, minHeight: 0 }}>
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
                  <div className="wizard-step1-grid">
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
                <p style={{ margin: '0 0 8px', color: C.mid, fontSize: 13 }}>
                  Choose the motion template for your video.
                </p>
                {typeof creditCost === 'number' && (
                  <p
                    style={{
                      margin: '0 0 16px',
                      fontSize: 12,
                      fontWeight: 600,
                      color: insufficientCredits ? '#D63B4C' : C.mid,
                    }}
                  >
                    {creditCost} credits required
                    {typeof balance === 'number' ? ` — you have ${balance} credits` : ''}
                    {insufficientCredits ? '. Top up to generate a video.' : ''}
                  </p>
                )}
                {sampleVideosLoading ? (
                  <p style={{ color: C.mid, fontSize: 13 }}>Loading motion templates...</p>
                ) : (sampleVideos?.items.length ?? 0) === 0 ? (
                  <p style={{ color: C.mid, fontSize: 13 }}>No video templates are available.</p>
                ) : (
                  <div className="wizard-step2-grid">
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
                            padding: 0,
                            textAlign: 'left',
                            overflow: 'hidden',
                            border: selected ? `2px solid ${C.pink}` : `1px solid ${C.border}`,
                            borderRadius: 8,
                            background: C.card,
                            cursor: 'pointer',
                          }}
                        >
                          <div
                            style={{
                              position: 'relative',
                              aspectRatio: '9 / 16',
                              background: C.lighter,
                            }}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            {/* biome-ignore lint/performance/noImgElement: animated GIF preview, presigned R2 URL */}
                            <img
                              src={option.thumbnailUrl}
                              alt={option.title}
                              style={{
                                width: '100%',
                                height: '100%',
                                objectFit: 'cover',
                                display: 'block',
                              }}
                            />
                            {selected && (
                              <span
                                style={{
                                  position: 'absolute',
                                  top: 10,
                                  right: 10,
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
                          </div>
                          <span
                            style={{
                              display: 'block',
                              padding: '10px 12px',
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
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            )}

            {step === 3 && (
              <div className="wizard-step3-grid">
                <div
                  style={{ border: `1px solid ${C.border}`, borderRadius: 6, overflow: 'hidden' }}
                >
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
                <div
                  style={{ border: `1px solid ${C.border}`, borderRadius: 6, overflow: 'hidden' }}
                >
                  <div style={{ aspectRatio: '3 / 4', background: C.lighter }}>
                    {selectedSample && (
                      <video
                        src={selectedSample.previewVideoUrl}
                        poster={selectedSample.thumbnailUrl}
                        muted
                        controls
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                          display: 'block',
                        }}
                      />
                    )}
                  </div>
                  <div style={{ padding: 10, color: C.mid, fontSize: 12 }}>
                    {selectedSample?.title ?? 'Motion template'}
                  </div>
                </div>
                {insufficientCredits && (
                  <p style={{ gridColumn: '1 / -1', margin: 0, color: '#D63B4C', fontSize: 13 }}>
                    This video costs {creditCost} credits and you have {balance} credits. Top up to
                    generate this video.
                  </p>
                )}
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
              <Tooltip
                tip={
                  insufficientCredits
                    ? `You need ${creditCost} credits and have ${balance}. Top up to continue.`
                    : undefined
                }
              >
                <GradBtn disabled={submitting || insufficientCredits} onClick={handleSubmit}>
                  {submitting ? 'Starting...' : 'Generate video'}
                </GradBtn>
              </Tooltip>
            )}
          </footer>
        </section>
      </div>
    </>
  );
}
