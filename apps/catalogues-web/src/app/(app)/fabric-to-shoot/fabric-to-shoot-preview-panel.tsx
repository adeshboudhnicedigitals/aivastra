'use client';

import { ExternalLink, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { type GenerationJob, GenerationPanel } from '@/app/(app)/studio/generation-panel';
import { CheckIcon, SpinnerIcon, XIcon } from '@/components/icons';
import { C } from '@/components/tokens';
import { GradBtn } from '@/components/ui/grad-btn';
import { ZoomableImage } from '@/components/ZoomableImage';
import type { PipelineStage } from './use-fabric-to-shoot';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const BENEFITS = ['Studio quality output', 'Multiple model options', 'Ready for ecommerce'];

// Mirrors STATUS_PROGRESS/steps in studio/generation-panel.tsx — duplicated
// locally rather than imported since that file is Studio-page-scoped and this
// page's job model is a single image, not a multi-pose batch.
const STATUS_PROGRESS: Record<string, number> = {
  QUEUED: 10,
  PREPROCESSING: 30,
  GENERATING: 60,
  UPLOADING: 85,
  COMPLETED: 100,
  FAILED: 100,
  CANCELLED: 100,
};

const STEPS = [
  { label: 'Removing Background', threshold: 20 },
  { label: 'Detecting Garment', threshold: 40 },
  { label: 'Understanding Fabric', threshold: 60 },
  { label: 'Generating Natural Folds', threshold: 75 },
  { label: 'Matching Body Pose', threshold: 90 },
  { label: 'Studio Lighting & Shadow', threshold: 100 },
];

const PROCESSING_MESSAGES = ['Analyzing garment details', ...STEPS.map((step) => step.label)];

function getStepInfo(status: string) {
  const progress = STATUS_PROGRESS[status] ?? 10;
  const idx = STEPS.findIndex((step) => progress < step.threshold);
  const stepIndex = idx === -1 ? STEPS.length - 1 : idx;
  return { progress, stepIndex: stepIndex + 1, stepLabel: STEPS[stepIndex]?.label ?? 'Generating' };
}

function Chevron() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 24,
        height: 280,
        position: 'relative',
        flexShrink: 0,
      }}
    >
      <div style={{ width: 1, height: '100%', background: C.border2 }} />
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
          width: 24,
          height: 24,
          borderRadius: '50%',
          border: '1px solid rgba(82, 29, 156, 0.2)',
          background: C.card,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#521D9C',
          boxShadow: '0 2px 6px rgba(82, 29, 156, 0.08)',
          fontSize: 12,
          fontWeight: 'bold',
          zIndex: 2,
        }}
      >
        ›
      </div>
    </div>
  );
}

// Right-hand panel, reflecting whichever stage of the single-button pipeline
// is live: an empty-state before anything has been submitted (identical to
// studio's PreviewPanel), the in-flight "AI Processing" 3-column block
// (input → steps/progress → output) while the fabric->garment job is live
// (matching studio's GenerationPanel Block 1, collapsed to a single job), a
// brief transitional card while the result is claimed, then either a
// standalone "Garment Ready" result (preset not linked to a Studio garment
// type — the pipeline stops here) or a hand-off to Studio's own
// GenerationPanel for the tryon job's progress/result.
export function FabricToShootPreviewPanel({
  garmentPreviewUrl,
  jobStatus,
  resultUrl,
  pipelineRunning,
  pipelineStage,
  hasGarmentType,
  pipelineError,
  onGenerateAnother,
  activeGeneration,
}: {
  garmentPreviewUrl: string | null;
  jobStatus: string | null;
  resultUrl: string | null;
  pipelineRunning: boolean;
  pipelineStage: PipelineStage;
  hasGarmentType: boolean;
  pipelineError: string | null;
  onGenerateAnother: () => void;
  activeGeneration: { catalogueId: string; jobs: GenerationJob[] } | null;
}): React.ReactElement {
  const status = jobStatus ?? 'QUEUED';
  const completed = status === 'COMPLETED';
  const failed = status === 'FAILED' || status === 'CANCELLED';
  const generating = pipelineStage === 'garment';
  const allSettled = !generating && (completed || failed);
  const { progress, stepIndex, stepLabel } = getStepInfo(status);

  const [activeMessageIndex, setActiveMessageIndex] = useState(0);
  useEffect(() => {
    if (!generating) return;
    const interval = setInterval(() => {
      setActiveMessageIndex((prev) => (prev + 1) % PROCESSING_MESSAGES.length);
    }, 2500);
    return () => clearInterval(interval);
  }, [generating]);

  const [zoomUrl, setZoomUrl] = useState<string | null>(null);
  const [zoomVisible, setZoomVisible] = useState(false);
  const closeZoom = () => {
    setZoomVisible(false);
    setTimeout(() => setZoomUrl(null), 300);
  };

  const hasStarted = pipelineStage !== null || activeGeneration !== null || jobStatus !== null;

  if (!hasStarted) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          borderRadius: 20,
          background: C.card,
          boxShadow: `inset 0 0 0 1px ${C.border2}, 0 4px 15px rgba(0,0,0,0.08)`,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            height: 88,
            borderBottom: `1px solid ${C.border2}`,
            padding: 16,
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            justifyContent: 'center',
          }}
        >
          <span style={{ fontSize: 16, fontWeight: 700, color: C.text }}>Catalogue Preview</span>
          <span style={{ fontSize: 12, fontWeight: 500, color: C.mid }}>
            Your generation results will appear here
          </span>
        </div>
        <div style={{ flex: 1, padding: 16, boxSizing: 'border-box' }}>
          <div
            style={{
              height: '100%',
              borderRadius: 8,
              outline: `2px dashed ${C.border2}`,
              outlineOffset: -2,
              padding: 16,
              boxSizing: 'border-box',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              alignItems: 'center',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: '100%',
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {/* biome-ignore lint/performance/noImgElement: static placeholder asset, same as studio/preview-panel.tsx */}
              <img
                src={`${BASE}/assets/catelouge-preview.png`}
                alt="Catalogue Preview"
                style={{ width: '80%', height: 'auto', objectFit: 'contain' }}
              />
            </div>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 16,
                width: '100%',
                padding: '16px 8px 0',
                boxSizing: 'border-box',
              }}
            >
              <div
                style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}
              >
                <span style={{ fontSize: 18, fontWeight: 700, textAlign: 'center', color: C.text }}>
                  Turn garments into catalogue ready visuals
                </span>
                <span
                  style={{
                    fontSize: 14,
                    fontWeight: 500,
                    textAlign: 'center',
                    color: C.mid,
                    maxWidth: 500,
                    lineHeight: 1.5,
                  }}
                >
                  Upload a garment, choose your preferred style, and generate professional catalogue
                  images in just a few clicks.
                </span>
              </div>
              <div
                style={{
                  display: 'flex',
                  gap: 24,
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexWrap: 'wrap',
                  marginTop: 8,
                }}
              >
                {BENEFITS.map((b) => (
                  <div key={b} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: '#521D9C', display: 'flex' }}>
                      <CheckIcon size={16} />
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{b}</span>
                  </div>
                ))}
              </div>
            </div>
            <span
              style={{
                fontSize: 14,
                fontWeight: 500,
                fontStyle: 'italic',
                textAlign: 'center',
                color: C.light,
                paddingTop: 16,
              }}
            >
              Preview your AI generated output here before download.
            </span>
          </div>
        </div>
      </div>
    );
  }

  // The pipeline stopped (any stage) without reaching a generation to show —
  // surfaced once, ahead of the in-progress branches below.
  if (pipelineError && !pipelineRunning && !activeGeneration) {
    return (
      <div
        style={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          gap: 16,
          padding: 24,
          textAlign: 'center',
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: '50%',
            background: 'rgba(239, 68, 68, 0.12)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <XIcon size={22} color="#EF4444" />
        </div>
        <p style={{ margin: 0, fontSize: 14, color: C.text, maxWidth: 320 }}>{pipelineError}</p>
        <GradBtn onClick={onGenerateAnother}>
          <RefreshCw size={14} />
          Try again
        </GradBtn>
      </div>
    );
  }

  // Once the Studio-style steps (face/background/pose/...) have been
  // submitted, this panel hands off to Studio's own GenerationPanel for the
  // real try-on job's progress/result — same component Studio's page and
  // the embed wizard use, imported as-is.
  if (activeGeneration) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          <GenerationPanel
            catalogueId={activeGeneration.catalogueId}
            jobs={activeGeneration.jobs}
            garmentPreviewUrl={resultUrl ?? undefined}
          />
        </div>
      </div>
    );
  }

  // Garment stage finished and the result was claimed — the pipeline is
  // about to (or already did) kick off the tryon job. A brief transitional
  // beat between the two stages rather than a dead-looking screen.
  if (hasGarmentType && pipelineStage === 'claiming') {
    return (
      <div
        style={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <SpinnerIcon size={24} />
        <p style={{ margin: 0, fontSize: 14, color: C.text }}>Starting your photoshoot…</p>
      </div>
    );
  }

  // Once the garment job completes, the generated image replaces the AI
  // Processing block entirely rather than sitting inside its "Preview
  // Output" column — clicking it opens the same ZoomableImage lightbox
  // studio's own GenerationPanel uses for completed result tiles. Only the
  // final state when the preset isn't linked to a Studio garment type — a
  // linked preset continues straight into the photoshoot stage above.
  if (!hasGarmentType && completed && resultUrl) {
    return (
      <>
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div
            style={{
              flex: 1,
              minHeight: 0,
              background: C.card,
              borderRadius: 20,
              border: `1px solid ${C.border}`,
              boxShadow: '0 4px 20px rgba(0,0,0,0.05)',
              padding: 24,
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
              boxSizing: 'border-box',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  background: 'rgba(16, 185, 129, 0.12)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <CheckIcon size={16} color="#10B981" />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: C.text }}>
                  Garment Ready
                </h3>
                <span style={{ fontSize: 12, color: C.mid }}>
                  Click the image to view full size
                </span>
              </div>
            </div>
            <div
              style={{
                flex: 1,
                minHeight: 0,
                borderRadius: 12,
                overflow: 'hidden',
                border: `1px solid ${C.border2}`,
                position: 'relative',
                background: C.lighter,
              }}
            >
              {/* biome-ignore lint/performance/noImgElement: presigned R2 URL */}
              <img
                src={resultUrl}
                alt="Generated garment"
                draggable={false}
                onContextMenu={(event) => event.preventDefault()}
                onClick={() => {
                  setZoomUrl(resultUrl);
                  requestAnimationFrame(() => setZoomVisible(true));
                }}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  cursor: 'pointer',
                  WebkitTouchCallout: 'none',
                  WebkitUserSelect: 'none',
                  userSelect: 'none',
                }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
            <a
              href={resultUrl}
              target="_blank"
              rel="noreferrer"
              style={{
                flex: 1,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                height: 44,
                borderRadius: 10,
                fontSize: 14,
                fontWeight: 600,
                color: C.text,
                border: `1px solid ${C.border2}`,
                textDecoration: 'none',
                background: C.card,
              }}
            >
              <ExternalLink size={16} />
              Open result
            </a>
            <GradBtn onClick={onGenerateAnother} style={{ flex: 1 }}>
              <RefreshCw size={14} />
              Generate again
            </GradBtn>
          </div>
        </div>

        {zoomUrl && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Image preview"
            onClick={closeZoom}
            onKeyDown={(event) => {
              if (event.key === 'Escape') closeZoom();
            }}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.85)',
              zIndex: 1000,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 40,
            }}
          >
            <ZoomableImage src={zoomUrl} visible={zoomVisible} variant="scale" />
          </div>
        )}
      </>
    );
  }

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
        width: '100%',
      }}
    >
      <div
        style={{
          flex: 1,
          minHeight: 0,
          background: C.card,
          borderRadius: 20,
          border: `1px solid ${C.border}`,
          boxShadow: '0 4px 20px rgba(0,0,0,0.05)',
          padding: 24,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: 20,
          width: '100%',
          boxSizing: 'border-box',
          overflow: 'auto',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h3 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: C.text }}>
              AI Processing
            </h3>
            <span style={{ fontSize: 13, color: C.mid }}>
              {allSettled
                ? failed
                  ? 'Generation failed'
                  : 'Your image is ready'
                : PROCESSING_MESSAGES[activeMessageIndex]}
            </span>
          </div>
        </div>

        <div
          style={{
            background:
              'linear-gradient(180deg, rgba(82, 29, 156, 0.04) 0%, rgba(117, 74, 176, 0.01) 100%)',
            border: `1px solid ${C.border}`,
            borderRadius: 16,
            padding: '24px 20px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            width: '100%',
            boxSizing: 'border-box',
          }}
        >
          {/* Column 1: Input Image */}
          <div
            style={{
              flex: 1.2,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 12,
              height: 280,
              justifyContent: 'space-between',
              boxSizing: 'border-box',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>Input Image</span>
              <span style={{ fontSize: 11, color: C.light }}>Your uploaded fabric</span>
            </div>
            <div
              style={{
                width: '100%',
                flex: 1,
                borderRadius: 8,
                overflow: 'hidden',
                border: `1px solid ${C.border2}`,
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: C.lighter,
              }}
            >
              {garmentPreviewUrl ? (
                // biome-ignore lint/performance/noImgElement: local blob URL preview
                <img
                  src={garmentPreviewUrl}
                  alt="Garment Preview"
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                <div style={{ color: C.light, fontSize: 12 }}>No image</div>
              )}
            </div>
          </div>

          <Chevron />

          {/* Column 2: Steps Checklist */}
          <div
            style={{
              flex: 1.6,
              display: 'flex',
              flexDirection: 'column',
              height: 280,
              justifyContent: 'space-between',
              padding: '0 16px',
              boxSizing: 'border-box',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: C.text, textAlign: 'center' }}>
                AI Processing
              </span>
              <span style={{ fontSize: 11, color: C.light, textAlign: 'center' }}>
                Generating studio quality image
              </span>
            </div>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                margin: '10px 0',
                paddingLeft: 12,
              }}
            >
              {STEPS.map((step, idx) => {
                const isDone = progress >= step.threshold;
                const isCurrent =
                  progress < step.threshold &&
                  (idx === 0 || progress >= (STEPS[idx - 1]?.threshold ?? 0));
                return (
                  <div key={step.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {isDone ? (
                      <div
                        style={{
                          width: 16,
                          height: 16,
                          borderRadius: '50%',
                          background: 'linear-gradient(180deg, #521D9C 0%, #754AB0 100%)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#fff',
                          fontSize: 9,
                          fontWeight: 'bold',
                        }}
                      >
                        ✓
                      </div>
                    ) : isCurrent ? (
                      <SpinnerIcon size={16} />
                    ) : (
                      <div
                        style={{
                          width: 16,
                          height: 16,
                          borderRadius: '50%',
                          border: `2px solid ${C.border2}`,
                          boxSizing: 'border-box',
                        }}
                      />
                    )}
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: isCurrent ? 600 : 500,
                        color: isDone ? C.text : isCurrent ? '#521D9C' : C.light,
                      }}
                    >
                      {step.label}
                    </span>
                  </div>
                );
              })}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  fontSize: 12,
                  fontWeight: 500,
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ color: C.text, fontWeight: 600 }}>
                    {allSettled ? (failed ? 'Generation failed' : 'Garment Ready') : stepLabel}
                  </span>
                  <span style={{ fontSize: 11, color: C.mid }}>
                    {allSettled
                      ? failed
                        ? ''
                        : 'All stages completed'
                      : `Stage ${stepIndex} of ${STEPS.length}`}
                  </span>
                </div>
                <span style={{ color: '#521D9C', fontWeight: 600 }}>{progress}%</span>
              </div>
              <div
                style={{
                  width: '100%',
                  height: 6,
                  background: C.lighter,
                  borderRadius: 3,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${progress}%`,
                    height: '100%',
                    background: 'linear-gradient(90deg, #521D9C 0%, #754AB0 100%)',
                    borderRadius: 3,
                    transition: 'width 0.4s ease-out',
                  }}
                />
              </div>
            </div>
          </div>

          <Chevron />

          {/* Column 3: Preview Output */}
          <div
            style={{
              flex: 1.2,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 12,
              height: 280,
              justifyContent: 'space-between',
              boxSizing: 'border-box',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>Preview Output</span>
              <span style={{ fontSize: 11, color: C.light }}>Studio quality result</span>
            </div>
            <div
              style={{
                width: '100%',
                flex: 1,
                borderRadius: 8,
                overflow: 'hidden',
                border: `1px solid ${C.border2}`,
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: C.lighter,
              }}
            >
              {completed && resultUrl ? (
                // biome-ignore lint/performance/noImgElement: presigned R2 URL
                <img
                  src={resultUrl}
                  alt="Preview Output"
                  draggable={false}
                  onContextMenu={(event) => event.preventDefault()}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                    WebkitTouchCallout: 'none',
                    WebkitUserSelect: 'none',
                    userSelect: 'none',
                  }}
                />
              ) : garmentPreviewUrl ? (
                <>
                  {/* biome-ignore lint/performance/noImgElement: local blob URL preview */}
                  <img
                    src={garmentPreviewUrl}
                    alt="Loading Preview"
                    className={
                      !failed && status !== 'QUEUED' ? 'garment-deblur processing-pulse' : ''
                    }
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      objectPosition: 'top center',
                      filter: failed
                        ? 'grayscale(60%)'
                        : status === 'QUEUED'
                          ? 'blur(4px)'
                          : undefined,
                      opacity: failed ? 0.4 : 0.65,
                    }}
                  />
                  {!failed && status !== 'QUEUED' && (
                    <>
                      <div className="scan-line" aria-hidden="true" />
                      <div className="shimmer" aria-hidden="true" />
                    </>
                  )}
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: failed ? 'rgba(43, 20, 78, 0.5)' : 'rgba(43, 20, 78, 0.18)',
                      padding: 16,
                      gap: 8,
                      textAlign: 'center',
                    }}
                  >
                    {failed ? (
                      <>
                        <div
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: '50%',
                            background:
                              status === 'FAILED'
                                ? 'rgba(239, 68, 68, 0.2)'
                                : 'rgba(156, 163, 175, 0.2)',
                            border: `1px solid ${
                              status === 'FAILED'
                                ? 'rgba(239, 68, 68, 0.5)'
                                : 'rgba(156, 163, 175, 0.5)'
                            }`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: status === 'FAILED' ? '#EF4444' : '#9CA3AF',
                          }}
                        >
                          <XIcon size={20} color="currentColor" />
                        </div>
                        <span style={{ color: '#fff', fontSize: 12, fontWeight: 600 }}>
                          {status === 'FAILED' ? 'Generation failed' : 'Generation cancelled'}
                        </span>
                      </>
                    ) : (
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: 4,
                          background: 'rgba(43, 20, 78, 0.62)',
                          backdropFilter: 'blur(8px)',
                          padding: '8px 10px',
                          borderRadius: 10,
                          border: '1px solid rgba(255, 255, 255, 0.15)',
                          maxWidth: '90%',
                        }}
                      >
                        <div style={{ color: '#754AB0' }}>
                          <SpinnerIcon size={18} />
                        </div>
                        <span
                          style={{
                            color: '#fff',
                            fontSize: 11,
                            fontWeight: 600,
                            textAlign: 'center',
                            lineHeight: 1.3,
                          }}
                        >
                          {status === 'QUEUED' ? 'Waiting in queue' : stepLabel}
                        </span>
                        {status !== 'QUEUED' && (
                          <span style={{ color: 'rgba(255, 255, 255, 0.75)', fontSize: 10 }}>
                            {`Stage ${stepIndex}/${STEPS.length} • ${progress}%`}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div style={{ color: C.light, fontSize: 12 }}>Waiting...</div>
              )}
            </div>
          </div>
        </div>
      </div>

      {failed && (
        <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
          <GradBtn onClick={onGenerateAnother} style={{ flex: 1 }}>
            <RefreshCw size={14} />
            Try again
          </GradBtn>
        </div>
      )}
    </div>
  );
}
