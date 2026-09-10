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
import { X } from 'lucide-react';
import { useState } from 'react';

import { C } from '@/components/tokens';
import { GradBtn } from '@/components/ui/grad-btn';
import { PremiumSelect } from '@/components/ui/premium-select';
import { Tooltip } from '@/components/ui/tooltip';
import { api } from '@/lib/api';
import type { ImageSource } from './types';

interface SampleVideoOption {
  id: string;
  title: string;
  thumbnailUrl: string;
  previewVideoUrl: string;
  duration: number;
  quality: PixverseQuality;
  creditCost: number;
}

interface SampleVideosResponse {
  items: SampleVideoOption[];
  pixverseVideoPricing: PixverseVideoPricingConfig;
}

type Choice = { sampleVideoId: string; duration: number; quality: PixverseQuality };

// The inline grid shows a fixed 4x2 page of presets; anything beyond that
// only surfaces through the "View all" picker modal, so the panel doesn't
// grow taller as the admin-curated catalogue grows.
const VISIBLE_PRESET_COUNT = 8;

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

// Right half of the Motion Studio main screen — a single screen, not a
// multi-step wizard: pick a preset (which supplies the prompt), adjust its
// duration/quality if wanted, and Generate — cost and the Generate button
// sit fixed at the bottom throughout. No standalone Custom mode for now —
// every video comes from an admin-curated preset. The preset grid and the
// duration/quality controls are all preloaded unconditionally (not gated on
// `source` or on picking a preset first) so the user can browse and adjust
// everything up front — Generate itself still requires a source and a preset.
const DEFAULT_DURATION = 8;
const DEFAULT_QUALITY: PixverseQuality = '720p';

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
  const [sampleVideoId, setSampleVideoId] = useState<string | null>(null);
  const [duration, setDuration] = useState<number>(DEFAULT_DURATION);
  const [quality, setQuality] = useState<PixverseQuality>(DEFAULT_QUALITY);
  const [presetPickerOpen, setPresetPickerOpen] = useState(false);

  const {
    data: sampleVideos,
    isLoading: sampleVideosLoading,
    isError: sampleVideosError,
    refetch: refetchSampleVideos,
  } = useQuery<SampleVideosResponse>({
    queryKey: ['sample-videos'],
    queryFn: () => api.get('/v1/models/sample-videos'),
  });

  const { data: creditsData } = useQuery<{ balance: number }>({
    queryKey: ['credits'],
    queryFn: () => api.get('/v1/credits'),
  });

  const balance = creditsData?.balance;
  const pricing = sampleVideos?.pixverseVideoPricing;
  const allPresets = sampleVideos?.items ?? [];
  const visiblePresets = allPresets.slice(0, VISIBLE_PRESET_COUNT);
  const hasMorePresets = allPresets.length > VISIBLE_PRESET_COUNT;
  const selectedSample = allPresets.find((option) => option.id === sampleVideoId);
  // Duration/quality are always set (defaulted up front, then pre-filled from
  // whichever preset is picked) — cost recomputes live via the same formula
  // the server charges with, so an override is reflected immediately. Falls
  // back to the preset's own listed creditCost only while pricing hasn't
  // loaded yet.
  const cost = pricing
    ? computePixverseVideoCost(duration, quality, pricing)
    : selectedSample?.creditCost;
  const insufficientCredits =
    typeof cost === 'number' && typeof balance === 'number' && balance < cost;
  const generateDisabled = !source || !sampleVideoId;

  function selectPreset(option: SampleVideoOption) {
    setSampleVideoId(option.id);
    // Always reset to the newly picked preset's own values, discarding any
    // override left over from a previously selected preset — "pre-fill from
    // the preset" should hold for every fresh selection, not just the first.
    setDuration(option.duration);
    setQuality(option.quality);
  }

  function handleGenerate() {
    if (!source || !sampleVideoId) return;
    if (insufficientCredits || submitting) return;
    onSubmit({ sampleVideoId, duration, quality });
  }

  return (
    <div style={CARD_STYLE}>
      <style>{`
        .config-panel-preset-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 8px;
        }
        @media (max-width: 639px) {
          .config-panel-preset-grid {
            grid-template-columns: repeat(2, 1fr);
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
        Configure your video
      </div>

      <div style={{ padding: 20, overflowY: 'auto', flex: 1, minHeight: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {sampleVideosLoading ? (
            <p style={{ color: C.mid, fontSize: 13 }}>Loading motion templates...</p>
          ) : sampleVideosError ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <p style={{ margin: 0, color: '#D63B4C', fontSize: 13 }}>
                Couldn't load video options.
              </p>
              <button
                type="button"
                onClick={() => refetchSampleVideos()}
                style={{
                  alignSelf: 'flex-start',
                  border: `1px solid ${C.border2}`,
                  borderRadius: 8,
                  background: 'transparent',
                  color: C.text,
                  padding: '6px 12px',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Retry
              </button>
            </div>
          ) : allPresets.length === 0 ? (
            <p style={{ color: C.mid, fontSize: 13 }}>No video templates are available.</p>
          ) : (
            <div className="config-panel-preset-grid">
              {visiblePresets.map((option) => {
                const selected = option.id === sampleVideoId;
                return (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => selectPreset(option)}
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
                    <div style={{ aspectRatio: '3 / 4', background: C.lighter }}>
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
                        padding: '6px 8px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        textAlign: 'center',
                        color: C.text,
                        fontSize: 11,
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

          {hasMorePresets && (
            <button
              type="button"
              onClick={() => setPresetPickerOpen(true)}
              style={{
                alignSelf: 'flex-start',
                border: `1px solid ${C.border2}`,
                borderRadius: 8,
                background: 'transparent',
                color: C.text,
                padding: '6px 12px',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              View all {allPresets.length} templates
            </button>
          )}

          {submitError && (
            <p style={{ margin: 0, color: '#D63B4C', fontSize: 13 }}>{submitError}</p>
          )}
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          padding: '16px 20px',
          borderTop: `1px solid ${C.border}`,
        }}
      >
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: C.text }}>
              Duration (seconds)
            </label>
            <input
              type="number"
              step={1}
              min={PIXVERSE_DURATION_MIN}
              max={PIXVERSE_DURATION_MAX}
              value={duration}
              onChange={(event) =>
                setDuration(
                  Math.round(
                    Math.min(
                      PIXVERSE_DURATION_MAX,
                      Math.max(PIXVERSE_DURATION_MIN, Number(event.target.value)),
                    ),
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
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: C.text }}>Quality</label>
            <div
              style={{
                border: `1px solid ${C.border2}`,
                borderRadius: 8,
                background: C.field,
              }}
            >
              <PremiumSelect
                value={quality}
                onChange={(val) => setQuality(val as PixverseQuality)}
                options={PIXVERSE_QUALITIES.map((q) => ({ value: q, label: q }))}
                fullWidth
                height={38}
                fontSize={14}
                ariaLabel="Quality"
              />
            </div>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: insufficientCredits ? '#D63B4C' : C.mid,
            }}
          >
            {typeof cost === 'number'
              ? `${cost} credits required${
                  typeof balance === 'number' ? ` — you have ${balance} credits` : ''
                }${insufficientCredits ? '. Top up to generate a video.' : ''}`
              : 'Loading pricing...'}
          </span>
          <Tooltip
            tip={
              insufficientCredits
                ? `You need ${cost} credits and have ${balance}. Top up to continue.`
                : !source && sampleVideoId
                  ? 'Choose a source image on the left to continue'
                  : undefined
            }
          >
            <GradBtn
              disabled={generateDisabled || submitting || insufficientCredits}
              onClick={handleGenerate}
            >
              {submitting ? 'Starting...' : 'Generate video'}
            </GradBtn>
          </Tooltip>
        </div>
      </div>

      {presetPickerOpen && (
        <PresetPickerModal
          items={allPresets}
          selectedId={sampleVideoId}
          onClose={() => setPresetPickerOpen(false)}
          onSelect={(option) => {
            selectPreset(option);
            setPresetPickerOpen(false);
          }}
        />
      )}
    </div>
  );
}

// "View all" surface for the preset grid above — same backdrop/dialog
// pattern CataloguePickerModal uses, scoped to its own class names so the
// two modals' styles can't collide if either changes independently.
function PresetPickerModal({
  items,
  selectedId,
  onClose,
  onSelect,
}: {
  items: SampleVideoOption[];
  selectedId: string | null;
  onClose: () => void;
  onSelect: (option: SampleVideoOption) => void;
}): React.ReactElement {
  return (
    <>
      <style>{`
        .preset-picker-backdrop {
          position: fixed;
          inset: 0;
          z-index: 1000;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          background: rgba(8, 12, 24, 0.62);
        }

        .preset-picker-dialog {
          width: min(760px, calc(100vw - 40px));
          height: min(680px, calc(100vh - 40px));
          overflow: hidden;
          border: 1px solid ${C.border};
          border-radius: 8px;
          background: ${C.card};
          box-shadow: 0 20px 56px rgba(0, 0, 0, 0.32);
          display: flex;
          flex-direction: column;
        }

        .preset-picker-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
          gap: 12px;
        }

        @media (max-width: 639px) {
          .preset-picker-backdrop {
            padding: 10px;
          }
          .preset-picker-dialog {
            width: calc(100vw - 20px);
            height: calc(100vh - 20px);
          }
          .preset-picker-grid {
            grid-template-columns: repeat(2, 1fr);
            gap: 10px;
          }
        }
      `}</style>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: modal backdrop; click outside dismisses */}
      <div
        role="presentation"
        className="preset-picker-backdrop"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby="preset-picker-title"
          className="preset-picker-dialog"
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
            <h2 id="preset-picker-title" style={{ margin: 0, color: C.text, fontSize: 18 }}>
              All motion templates
            </h2>
            <button
              type="button"
              aria-label="Close"
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
                cursor: 'pointer',
              }}
            >
              <X size={16} />
            </button>
          </header>

          <div style={{ padding: 20, overflowY: 'auto', flex: 1, minHeight: 0 }}>
            <div className="preset-picker-grid">
              {items.map((option) => {
                const selected = option.id === selectedId;
                return (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => onSelect(option)}
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
                    <div style={{ aspectRatio: '3 / 4', background: C.lighter }}>
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
                        textAlign: 'center',
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
          </div>
        </section>
      </div>
    </>
  );
}
