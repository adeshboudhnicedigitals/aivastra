'use client';

import {
  computePixverseVideoCost,
  PIXVERSE_DURATION_MAX,
  PIXVERSE_DURATION_MIN,
  PIXVERSE_QUALITIES,
  type PixverseQuality,
  type PixverseVideoPricingConfig,
} from '@aivastra/types';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, SlidersHorizontal } from 'lucide-react';
import { useEffect, useState } from 'react';

import { C } from '@/components/tokens';
import { GradBtn } from '@/components/ui/grad-btn';
import { Tooltip } from '@/components/ui/tooltip';
import { api } from '@/lib/api';
import { JobThumbnail } from './JobThumbnail';
import type { ImageSource } from './types';

interface SampleVideoOption {
  id: string;
  title: string;
  thumbnailUrl: string;
  previewVideoUrl: string;
  creditCost: number;
}

interface SampleVideosResponse {
  items: SampleVideoOption[];
  pixverseVideoPricing: PixverseVideoPricingConfig;
}

type Choice = { sampleVideoId: string } | { duration: number; quality: PixverseQuality };

const CARD_STYLE: React.CSSProperties = {
  width: '100%',
  height: '100%',
  minHeight: 360,
  borderRadius: 20,
  background: C.card,
  boxShadow: `inset 0 0 0 1.5px ${C.border2}, 0 4px 15px rgba(0,0,0,0.08)`,
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

// Right half of the Motion Studio main screen. Two internal steps ("select"
// then "review") sit on top of a Preset/Custom mode choice — Preset reuses
// the admin-curated sample_videos catalogue (same grid CatalogVideoWizard's
// step 2 had); Custom lets the caller pick duration + quality directly, no
// prompt field (the server fills one in — see PIXVERSE_CUSTOM_VIDEO_PROMPT
// in packages/types). Disabled (no mode toggle at all) until a source image
// is chosen on the left.
export function ConfigPanel({
  source,
  submitting,
  submitError,
  onSubmit,
}: {
  source: ImageSource | null;
  submitting: boolean;
  submitError: string | null;
  onSubmit: (choice: Choice) => void;
}): React.ReactElement {
  const [configStep, setConfigStep] = useState<'select' | 'review'>('select');
  const [mode, setMode] = useState<'preset' | 'custom'>('preset');
  const [sampleVideoId, setSampleVideoId] = useState<string | null>(null);
  const [duration, setDuration] = useState(5);
  const [quality, setQuality] = useState<PixverseQuality>('720p');

  // Identity key for the current source — a plain object-reference check
  // would also fire on every re-render of an unrelated parent state change
  // if `source` were ever recreated with the same values, so key on the
  // field that actually identifies it.
  const sourceKey = source ? (source.kind === 'existing' ? source.jobId : source.r2Key) : null;
  // Changing (or clearing) the source image invalidates whatever config step
  // the user was on — jumping Review's "Generate" straight from a stale
  // source would generate a video for the wrong photo.
  useEffect(() => {
    setConfigStep('select');
  }, [sourceKey]);

  const { data: sampleVideos, isLoading: sampleVideosLoading } = useQuery<SampleVideosResponse>({
    queryKey: ['sample-videos'],
    queryFn: () => api.get('/v1/models/sample-videos'),
    enabled: source !== null,
  });

  const { data: creditsData } = useQuery<{ balance: number }>({
    queryKey: ['credits'],
    queryFn: () => api.get('/v1/credits'),
    enabled: source !== null,
  });

  const balance = creditsData?.balance;
  const pricing = sampleVideos?.pixverseVideoPricing;
  const selectedSample = sampleVideos?.items.find((option) => option.id === sampleVideoId);
  const customCost = pricing ? computePixverseVideoCost(duration, quality, pricing) : undefined;
  const cost = mode === 'preset' ? selectedSample?.creditCost : customCost;
  const insufficientCredits =
    typeof cost === 'number' && typeof balance === 'number' && balance < cost;
  const continueDisabled = mode === 'preset' ? !sampleVideoId : typeof customCost !== 'number';

  function handleGenerate() {
    if (insufficientCredits || submitting) return;
    if (mode === 'preset' && sampleVideoId) onSubmit({ sampleVideoId });
    else if (mode === 'custom') onSubmit({ duration, quality });
  }

  if (!source) {
    return (
      <div
        style={{
          ...CARD_STYLE,
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          padding: 40,
          textAlign: 'center',
          color: C.mid,
        }}
      >
        <SlidersHorizontal size={28} strokeWidth={1.5} />
        <span style={{ fontSize: 15, fontWeight: 700, color: C.text }}>
          Choose a source image to continue
        </span>
        <span style={{ fontSize: 13, maxWidth: 280, lineHeight: 1.5 }}>
          Upload or browse a catalogue image on the left, then configure your video here.
        </span>
      </div>
    );
  }

  return (
    <div style={CARD_STYLE}>
      <style>{`
        .config-panel-mode-toggle button {
          padding: 8px 16px;
          border-radius: 999px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
        }
        .config-panel-preset-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
          gap: 12px;
        }
        .config-panel-review-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
        }
        @media (max-width: 639px) {
          .config-panel-review-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
      <div
        style={{
          padding: '18px 20px',
          borderBottom: `1px solid ${C.border}`,
          fontSize: 16,
          fontWeight: 700,
          color: C.text,
        }}
      >
        {configStep === 'select' ? 'Configure your video' : 'Review & generate'}
      </div>

      <div style={{ padding: 20, overflowY: 'auto', flex: 1, minHeight: 0 }}>
        {configStep === 'select' ? (
          <>
            <div
              className="config-panel-mode-toggle"
              style={{ display: 'flex', gap: 8, marginBottom: 16 }}
            >
              {(['preset', 'custom'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={mode === m}
                  onClick={() => setMode(m)}
                  style={{
                    border: `1px solid ${mode === m ? C.pink : C.border}`,
                    background: mode === m ? 'rgba(245,92,122,0.08)' : 'transparent',
                    color: mode === m ? C.pink : C.mid,
                  }}
                >
                  {m === 'preset' ? 'Preset' : 'Custom'}
                </button>
              ))}
            </div>

            {mode === 'preset' ? (
              sampleVideosLoading ? (
                <p style={{ color: C.mid, fontSize: 13 }}>Loading motion templates...</p>
              ) : (sampleVideos?.items.length ?? 0) === 0 ? (
                <p style={{ color: C.mid, fontSize: 13 }}>No video templates are available.</p>
              ) : (
                <div className="config-panel-preset-grid">
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
                        <div style={{ aspectRatio: '9 / 16', background: C.lighter }}>
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
                        <span
                          style={{
                            display: 'block',
                            padding: '0 12px 10px',
                            fontSize: 11,
                            color: C.mid,
                          }}
                        >
                          {option.creditCost} credits
                        </span>
                      </button>
                    );
                  })}
                </div>
              )
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 320 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 13, fontWeight: 600, color: C.text }}>
                    Duration (seconds)
                  </label>
                  <input
                    type="number"
                    min={PIXVERSE_DURATION_MIN}
                    max={PIXVERSE_DURATION_MAX}
                    value={duration}
                    onChange={(event) =>
                      setDuration(
                        Math.min(
                          PIXVERSE_DURATION_MAX,
                          Math.max(PIXVERSE_DURATION_MIN, Number(event.target.value)),
                        ),
                      )
                    }
                    style={{
                      padding: '8px 12px',
                      borderRadius: 8,
                      border: `1px solid ${C.border2}`,
                      fontSize: 14,
                    }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 13, fontWeight: 600, color: C.text }}>Quality</label>
                  <select
                    value={quality}
                    onChange={(event) => setQuality(event.target.value as PixverseQuality)}
                    style={{
                      padding: '8px 12px',
                      borderRadius: 8,
                      border: `1px solid ${C.border2}`,
                      fontSize: 14,
                    }}
                  >
                    {PIXVERSE_QUALITIES.map((q) => (
                      <option key={q} value={q}>
                        {q}
                      </option>
                    ))}
                  </select>
                </div>
                {typeof customCost === 'number' && (
                  <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: C.mid }}>
                    {customCost} credits
                  </p>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="config-panel-review-grid">
            <div style={{ border: `1px solid ${C.border}`, borderRadius: 6, overflow: 'hidden' }}>
              <div style={{ aspectRatio: '3 / 4', background: C.lighter }}>
                {source.kind === 'existing' ? (
                  <JobThumbnail jobId={source.jobId} alt="Selected source" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  // biome-ignore lint/performance/noImgElement: local blob URL preview
                  <img
                    src={source.previewUrl}
                    alt="Selected source"
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                )}
              </div>
              <div style={{ padding: 10, color: C.mid, fontSize: 12 }}>
                {source.kind === 'upload' ? 'Uploaded image' : 'Catalogue image'}
              </div>
            </div>
            <div style={{ border: `1px solid ${C.border}`, borderRadius: 6, overflow: 'hidden' }}>
              <div style={{ aspectRatio: '3 / 4', background: C.lighter }}>
                {mode === 'preset' && selectedSample && (
                  <video
                    src={selectedSample.previewVideoUrl}
                    poster={selectedSample.thumbnailUrl}
                    muted
                    controls
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                )}
                {mode === 'custom' && (
                  <div
                    style={{
                      width: '100%',
                      height: '100%',
                      display: 'grid',
                      placeItems: 'center',
                      color: C.mid,
                      fontSize: 14,
                      fontWeight: 600,
                    }}
                  >
                    {duration}s · {quality}
                  </div>
                )}
              </div>
              <div style={{ padding: 10, color: C.mid, fontSize: 12 }}>
                {mode === 'preset'
                  ? (selectedSample?.title ?? 'Motion template')
                  : 'Custom configuration'}
              </div>
            </div>
            {typeof cost === 'number' && (
              <p
                style={{
                  gridColumn: '1 / -1',
                  margin: 0,
                  fontSize: 12,
                  fontWeight: 600,
                  color: insufficientCredits ? '#D63B4C' : C.mid,
                }}
              >
                {cost} credits required
                {typeof balance === 'number' ? ` — you have ${balance} credits` : ''}
                {insufficientCredits ? '. Top up to generate a video.' : ''}
              </p>
            )}
            {submitError && (
              <p style={{ gridColumn: '1 / -1', margin: 0, color: '#D63B4C', fontSize: 13 }}>
                {submitError}
              </p>
            )}
          </div>
        )}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '16px 20px',
          borderTop: `1px solid ${C.border}`,
        }}
      >
        {configStep === 'review' ? (
          <button
            type="button"
            disabled={submitting}
            onClick={() => setConfigStep('select')}
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
        {configStep === 'select' ? (
          <GradBtn disabled={continueDisabled} onClick={() => setConfigStep('review')}>
            Continue
          </GradBtn>
        ) : (
          <Tooltip
            tip={
              insufficientCredits
                ? `You need ${cost} credits and have ${balance}. Top up to continue.`
                : undefined
            }
          >
            <GradBtn disabled={submitting || insufficientCredits} onClick={handleGenerate}>
              {submitting ? 'Starting...' : 'Generate video'}
            </GradBtn>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
