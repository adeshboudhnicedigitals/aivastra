'use client';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { DownloadIcon, FullscreenIcon, SpinnerIcon, XIcon } from '@/components/icons';
import { C } from '@/components/tokens';
import { useJobStream } from '@/hooks/use-job-stream';
import { api } from '@/lib/api';
import { downloadErrorMessage } from '@/lib/errors';

export interface GenerationJob {
  id: string;
  poseId: string;
  label: string;
  thumbnailUrl: string;
}

export interface GenerationPanelProps {
  catalogueId: string;
  jobs: GenerationJob[];
  garmentPreviewUrl?: string;
  /** Called once when every job in this batch reaches a terminal status. */
  onAllSettled?: () => void;
  onCancel?: () => void;
  /** When provided, completed results show a "Use this image" button instead of/alongside download. */
  onUseImage?: (args: { url: string; jobId: string; poseLabel: string }) => void;
  /** Hides the "View full catalogue →" link — set when this panel is embedded in a context (e.g. an iframe) where navigating away would strand the user. */
  hideCatalogueLink?: boolean;
  /** Hides the "Download All" button and each result tile's download icon. */
  hideDownload?: boolean;
  /** Hides the "AI Processing" input/steps/preview block — that walkthrough is Studio-only; embedded contexts (e.g. the Shopify plugin) go straight to the Generated Results grid. */
  hideProcessingPreview?: boolean;
}

const TERMINAL_STATUSES = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

const STATUS_PROGRESS: Record<string, number> = {
  PENDING_MANNEQUIN: 3,
  QUEUED: 10,
  PREPROCESSING: 30,
  GENERATING: 60,
  UPLOADING: 85,
  COMPLETED: 100,
  FAILED: 100,
  CANCELLED: 100,
};

const steps = [
  { label: 'Removing Background', threshold: 20 },
  { label: 'Detecting Garment', threshold: 40 },
  { label: 'Understanding Fabric', threshold: 60 },
  { label: 'Generating Natural Folds', threshold: 75 },
  { label: 'Matching Body Pose', threshold: 90 },
  { label: 'Studio Lighting & Shadow', threshold: 100 },
];

export function GenerationPanel({
  catalogueId,
  jobs,
  garmentPreviewUrl,
  onAllSettled,
  onCancel,
  onUseImage,
  hideCatalogueLink,
  hideDownload,
  hideProcessingPreview,
}: GenerationPanelProps) {
  const qc = useQueryClient();
  const [statuses, setStatuses] = useState<Record<string, string>>(() =>
    Object.fromEntries(jobs.map((j) => [j.id, 'QUEUED'])),
  );
  const [selected, setSelected] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [selectedJobs, setSelectedJobs] = useState<string[]>(() => jobs.map((j) => j.id));
  const [favorites, setFavorites] = useState<string[]>([]);
  const [zoomUrl, setZoomUrl] = useState<string | null>(null);
  const [zoomVisible, setZoomVisible] = useState(false);

  // Reset local status map + selection whenever a new batch of jobs arrives.
  useEffect(() => {
    setStatuses(Object.fromEntries(jobs.map((j) => [j.id, 'QUEUED'])));
    setSelected(0);
    setSelectedJobs(jobs.map((j) => j.id));
    setFavorites([]);
  }, [jobs]);

  const jobIds = jobs.map((j) => j.id);
  useJobStream((evt) => {
    if (!jobIds.includes(evt.jobId)) return;
    setStatuses((prev) => ({ ...prev, [evt.jobId]: evt.status }));

    // Keep the catalogue detail cache in sync so navigating to /catalogues/:id
    // shows the correct status immediately without waiting for a re-fetch.
    qc.setQueryData(
      ['catalogue', catalogueId],
      (old: { jobs: { id: string; status: string }[] } | undefined) => {
        if (!old) return old;
        return {
          ...old,
          jobs: old.jobs.map((j) => (j.id === evt.jobId ? { ...j, status: evt.status } : j)),
        };
      },
    );

    if (evt.status === 'COMPLETED') {
      qc.prefetchQuery({
        queryKey: ['job-result', evt.jobId],
        queryFn: () => api.get<{ url: string }>(`/v1/jobs/${evt.jobId}/result`),
        staleTime: 55 * 60 * 1000,
      });
      qc.prefetchQuery({
        queryKey: ['job-thumb', evt.jobId],
        queryFn: () => api.get<{ url: string }>(`/v1/jobs/${evt.jobId}/thumbnail`),
        staleTime: 55 * 60 * 1000,
      });
    }
  });

  // SSE is the primary channel, but a dropped/missed event (reconnect window,
  // tab backgrounded, etc.) can leave a job stuck at a non-terminal status here
  // forever even though it actually finished server-side. Poll as a fallback —
  // same pattern as the catalogue detail page — so this panel can never drift
  // from what /catalogues/:id already shows.
  const { data: polledCatalogue } = useQuery<{ jobs: { id: string; status: string }[] }>({
    queryKey: ['catalogue', catalogueId],
    queryFn: () => api.get(`/v1/catalogues/${catalogueId}`),
    enabled: !!catalogueId,
    refetchInterval: (query) => {
      const d = query.state.data as { jobs: { id: string; status: string }[] } | undefined;
      if (!d) return 5_000;
      const hasActive = d.jobs.some(
        (j) => jobIds.includes(j.id) && !TERMINAL_STATUSES.has(j.status),
      );
      return hasActive ? 5_000 : false;
    },
  });

  useEffect(() => {
    if (!polledCatalogue) return;
    setStatuses((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const j of polledCatalogue.jobs) {
        if (jobIds.includes(j.id) && next[j.id] !== j.status) {
          next[j.id] = j.status;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polledCatalogue]);

  const allSettled =
    jobs.length > 0 && jobs.every((j) => TERMINAL_STATUSES.has(statuses[j.id] ?? 'QUEUED'));

  // Notify the parent once every job in this batch has reached a terminal
  // status, so it can re-enable the Generate button while results still render.
  useEffect(() => {
    if (allSettled) onAllSettled?.();
  }, [allSettled, onAllSettled]);

  const completedIds = jobs.filter((j) => statuses[j.id] === 'COMPLETED').map((j) => j.id);
  const resultQueries = useQueries({
    queries: jobs.map((j) => ({
      queryKey: ['job-result', j.id],
      queryFn: () => api.get<{ url: string }>(`/v1/jobs/${j.id}/result`),
      enabled: completedIds.includes(j.id),
      staleTime: 55 * 60 * 1000,
    })),
  });

  const current = jobs[selected];
  const currentStatus = current ? (statuses[current.id] ?? 'QUEUED') : 'QUEUED';
  const currentCompleted = currentStatus === 'COMPLETED';
  const currentFailed = currentStatus === 'FAILED' || currentStatus === 'CANCELLED';
  const currentResultUrl = resultQueries[selected]?.data?.url;

  async function downloadImage(url: string, jobId: string) {
    if (downloading) return;
    setDownloading(true);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(downloadErrorMessage(res.status));
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = `aivastra-${jobId.slice(0, 8)}.jpg`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'The image could not be downloaded. Try again.');
    } finally {
      setDownloading(false);
    }
  }

  // Calculate overall progress percentage (average of all jobs)
  const totalProgress = jobs.reduce((acc, job) => {
    const status = statuses[job.id] ?? 'QUEUED';
    return acc + (STATUS_PROGRESS[status] ?? 10);
  }, 0);
  const progressPercent = jobs.length > 0 ? Math.round(totalProgress / jobs.length) : 0;

  // Toggle selection for a single job
  const handleToggleSelectJob = (id: string) => {
    setSelectedJobs((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  // Toggle selection for all jobs
  const handleToggleSelectAll = () => {
    if (selectedJobs.length === jobs.length) {
      setSelectedJobs([]);
    } else {
      setSelectedJobs(jobs.map((j) => j.id));
    }
  };

  // Download all completed images
  const handleDownloadAll = async () => {
    const completedSelected = jobs.filter((j) => statuses[j.id] === 'COMPLETED');
    for (const job of completedSelected) {
      const idx = jobs.findIndex((j) => j.id === job.id);
      const url = resultQueries[idx]?.data?.url;
      if (url) {
        await downloadImage(url, job.id);
      }
    }
  };

  // Toggle favorite state
  const toggleFavorite = (id: string) => {
    setFavorites((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, width: '100%' }}>
        {/* ── Block 1: AI Processing (Studio only — see hideProcessingPreview) ── */}
        {!hideProcessingPreview && (
          <div
            style={{
              background: C.card,
              borderRadius: 20,
              border: `1px solid ${C.border}`,
              boxShadow: '0 4px 20px rgba(0,0,0,0.05)',
              padding: 24,
              display: 'flex',
              flexDirection: 'column',
              gap: 20,
              width: '100%',
              boxSizing: 'border-box',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <h3 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: C.text }}>
                  AI Processing
                </h3>
                <span style={{ fontSize: 13, color: C.mid }}>Our AI is working its magic</span>
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
                  background: 'transparent',
                  padding: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 12,
                  height: 280,
                  justifyContent: 'space-between',
                  boxSizing: 'border-box',
                }}
              >
                <div
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}
                >
                  <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>Input Image</span>
                  <span style={{ fontSize: 11, color: C.light }}>Your uploaded garment</span>
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
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={garmentPreviewUrl}
                      alt="Garment Preview"
                      style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                    />
                  ) : (
                    <div style={{ color: C.light, fontSize: 12 }}>No image</div>
                  )}
                </div>
              </div>

              {/* Chevron Separator 1 */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
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

              {/* Column 2: Steps Checklist */}
              <div
                style={{
                  flex: 1.6,
                  background: 'transparent',
                  padding: '0 24px',
                  display: 'flex',
                  flexDirection: 'column',
                  height: 280,
                  justifyContent: 'space-between',
                  boxSizing: 'border-box',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span
                    style={{ fontSize: 13, fontWeight: 600, color: C.text, textAlign: 'center' }}
                  >
                    AI Processing
                  </span>
                  <span style={{ fontSize: 11, color: C.light, textAlign: 'center' }}>
                    Generating studio quality images
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
                  {steps.map((step, idx) => {
                    const isDone = progressPercent >= step.threshold;
                    const isCurrent =
                      progressPercent < step.threshold &&
                      (idx === 0 || progressPercent >= (steps[idx - 1]?.threshold ?? 0));

                    return (
                      <div
                        key={step.label}
                        style={{ display: 'flex', alignItems: 'center', gap: 10 }}
                      >
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
                      fontSize: 12,
                      fontWeight: 500,
                    }}
                  >
                    <span style={{ color: C.mid }}>
                      {progressPercent === 100
                        ? 'Rendering Final Output....'
                        : 'Rendering Final Output....'}
                    </span>
                    <span style={{ color: C.text }}>{progressPercent}%</span>
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
                        width: `${progressPercent}%`,
                        height: '100%',
                        background: 'linear-gradient(180deg, #521D9C 0%, #754AB0 100%)',
                        borderRadius: 3,
                        transition: 'width 0.4s ease-out',
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* Chevron Separator 2 */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
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

              {/* Column 3: Preview Output */}
              <div
                style={{
                  flex: 1.2,
                  background: 'transparent',
                  padding: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 12,
                  height: 280,
                  justifyContent: 'space-between',
                  boxSizing: 'border-box',
                }}
              >
                <div
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}
                >
                  <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>
                    Preview Output
                  </span>
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
                  {currentCompleted && currentResultUrl ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={currentResultUrl}
                        alt="Preview Output"
                        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                      />
                      <div
                        style={{
                          position: 'absolute',
                          right: 8,
                          bottom: 8,
                          display: 'flex',
                          gap: 6,
                        }}
                      >
                        {onUseImage && current && (
                          <button
                            type="button"
                            onClick={() =>
                              onUseImage({
                                url: currentResultUrl,
                                jobId: current.id,
                                poseLabel: current.label,
                              })
                            }
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              height: 32,
                              padding: '0 12px',
                              borderRadius: 8,
                              background: 'linear-gradient(135deg, #521D9C 0%, #754AB0 100%)',
                              color: '#fff',
                              border: 'none',
                              fontSize: 12,
                              fontWeight: 600,
                              cursor: 'pointer',
                              boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
                            }}
                          >
                            Use this image
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setZoomUrl(currentResultUrl);
                            requestAnimationFrame(() => setZoomVisible(true));
                          }}
                          style={{
                            width: 32,
                            height: 32,
                            borderRadius: 8,
                            background: C.card,
                            boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
                            border: `1px solid ${C.border}`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: C.text,
                            cursor: 'pointer',
                          }}
                        >
                          <FullscreenIcon />
                        </button>
                      </div>
                    </>
                  ) : current ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={garmentPreviewUrl || current.thumbnailUrl}
                        alt="Loading Preview"
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                          objectPosition: 'top center',
                          filter: currentFailed ? 'none' : 'blur(6px)',
                          opacity: 0.6,
                        }}
                      />
                      <div
                        style={{
                          position: 'absolute',
                          inset: 0,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: 'rgba(0,0,0,0.1)',
                        }}
                      >
                        {currentFailed ? (
                          <XIcon size={24} color={C.pink} />
                        ) : (
                          <div style={{ color: C.pink }}>
                            <SpinnerIcon size={24} />
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
        )}

        {/* ── Block 2: Generated Results ── */}
        <div
          style={{
            background: C.card,
            borderRadius: 20,
            border: `1px solid ${C.border}`,
            boxShadow: '0 4px 20px rgba(0,0,0,0.05)',
            padding: 24,
            display: 'flex',
            flexDirection: 'column',
            gap: 20,
            width: '100%',
            boxSizing: 'border-box',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <h3 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: C.text }}>
                {allSettled ? 'Generated Results' : 'Generating Results'}
              </h3>
              <span style={{ fontSize: 13, color: C.mid }}>
                {allSettled
                  ? `${jobs.length} stunning variations generated for you`
                  : 'Your studio-quality images are on the way'}
              </span>
            </div>
            {!hideDownload && (
              <div style={{ display: 'flex', gap: 10 }}>
                {/* Download All Button */}
                <button
                  type="button"
                  onClick={handleDownloadAll}
                  disabled={downloading || jobs.every((j) => statuses[j.id] !== 'COMPLETED')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    background: '#141414',
                    color: '#FEFEFE',
                    border: 'none',
                    borderRadius: 8,
                    padding: '8px 16px',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor:
                      downloading || jobs.every((j) => statuses[j.id] !== 'COMPLETED')
                        ? 'not-allowed'
                        : 'pointer',
                    opacity:
                      downloading || jobs.every((j) => statuses[j.id] !== 'COMPLETED') ? 0.5 : 1,
                  }}
                >
                  <DownloadIcon size={14} /> Download All
                </button>
              </div>
            )}
          </div>

          {/* Variations Grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 12,
              width: '100%',
            }}
          >
            {jobs.map((job, idx) => {
              const status = statuses[job.id] ?? 'QUEUED';
              const isCompleted = status === 'COMPLETED';
              const isFailed = status === 'FAILED' || status === 'CANCELLED';
              const resultUrl = resultQueries[idx]?.data?.url;
              const isSelected = selected === idx;
              const isBestMatch = idx === 0;

              return (
                <div
                  key={job.id}
                  onClick={() => setSelected(idx)}
                  style={{
                    position: 'relative',
                    background: isSelected
                      ? `linear-gradient(${C.card}, ${C.card}) padding-box, linear-gradient(180deg, #521D9C 0%, #754AB0 100%) border-box`
                      : `linear-gradient(${C.card}, ${C.card}) padding-box, linear-gradient(${C.border}, ${C.border}) border-box`,
                    border: '1.5px solid transparent',
                    borderRadius: 12,
                    padding: 0,
                    overflow: 'hidden',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    boxShadow: isSelected ? '0 4px 12px rgba(82, 29, 156, 0.12)' : 'none',
                    transition: 'box-shadow 0.2s, transform 0.2s',
                    boxSizing: 'border-box',
                  }}
                >
                  {/* Image section */}
                  <div
                    style={{
                      width: '100%',
                      aspectRatio: '3/4',
                      position: 'relative',
                      background: C.lighter,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {isCompleted && resultUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={resultUrl}
                        alt={job.label}
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                          objectPosition: 'top center',
                        }}
                      />
                    ) : (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={garmentPreviewUrl || job.thumbnailUrl}
                          alt={job.label}
                          style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                            objectPosition: 'top center',
                            filter: isFailed ? 'none' : 'blur(4px)',
                            opacity: isFailed ? 0.5 : 0.7,
                          }}
                        />
                        {!isFailed && (
                          <div
                            style={{
                              position: 'absolute',
                              inset: 0,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              background: 'rgba(0,0,0,0.15)',
                            }}
                          >
                            <div style={{ color: C.pink }}>
                              <SpinnerIcon size={24} />
                            </div>
                          </div>
                        )}
                      </>
                    )}

                    {/* Download icon on top right */}
                    {!hideDownload && (
                      <button
                        type="button"
                        disabled={!isCompleted || !resultUrl}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (resultUrl) downloadImage(resultUrl, job.id);
                        }}
                        style={{
                          position: 'absolute',
                          top: 8,
                          right: 8,
                          background: 'rgba(255, 255, 255, 0.85)',
                          backdropFilter: 'blur(4px)',
                          border: 'none',
                          borderRadius: '50%',
                          width: 28,
                          height: 28,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: isCompleted && resultUrl ? 'pointer' : 'not-allowed',
                          opacity: isCompleted && resultUrl ? 1 : 0.45,
                          color: '#141414',
                          boxShadow: '0 2px 6px rgba(0,0,0,0.1)',
                          zIndex: 2,
                        }}
                      >
                        <DownloadIcon size={14} />
                      </button>
                    )}
                    {onUseImage && isCompleted && resultUrl && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onUseImage({ url: resultUrl, jobId: job.id, poseLabel: job.label });
                        }}
                        style={{
                          position: 'absolute',
                          left: 8,
                          right: 8,
                          bottom: 8,
                          height: 26,
                          borderRadius: 8,
                          background: 'linear-gradient(135deg, #521D9C 0%, #754AB0 100%)',
                          color: '#fff',
                          border: 'none',
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: 'pointer',
                          boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
                          zIndex: 2,
                        }}
                      >
                        Use this image
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        {!hideCatalogueLink && (
          <Link
            href={`/catalogues/${catalogueId}`}
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: C.pink,
              textDecoration: 'none',
              alignSelf: 'flex-start',
              marginTop: -8,
            }}
          >
            View full catalogue →
          </Link>
        )}
      </div>

      {zoomUrl && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Image preview"
          onClick={() => {
            setZoomVisible(false);
            setTimeout(() => setZoomUrl(null), 300);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setZoomVisible(false);
              setTimeout(() => setZoomUrl(null), 300);
            }
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
          <button
            type="button"
            onClick={() => {
              setZoomVisible(false);
              setTimeout(() => setZoomUrl(null), 300);
            }}
            style={{
              position: 'absolute',
              top: 20,
              right: 20,
              width: 40,
              height: 40,
              borderRadius: '50%',
              background: 'rgba(255,255,255,0.15)',
              border: 'none',
              color: '#fff',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <XIcon size={20} />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={zoomUrl}
            alt=""
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              objectFit: 'contain',
              borderRadius: 8,
              transform: zoomVisible ? 'scale(1)' : 'scale(0.95)',
              opacity: zoomVisible ? 1 : 0,
              transition: 'transform 300ms ease-out, opacity 300ms ease-out',
              pointerEvents: 'none',
            }}
          />
        </div>
      )}
    </>
  );
}
