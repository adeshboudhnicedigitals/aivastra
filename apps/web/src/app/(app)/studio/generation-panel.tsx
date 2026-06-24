'use client';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { DownloadIcon, FullscreenIcon, SpinnerIcon, XIcon } from '@/components/icons';
import { C } from '@/components/tokens';
import { useJobStream } from '@/hooks/use-job-stream';
import { api } from '@/lib/api';

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
}

const TERMINAL_STATUSES = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

const STATUS_LABEL: Record<string, string> = {
  QUEUED: 'Queued',
  PREPROCESSING: 'Preparing…',
  GENERATING: 'Generating…',
  UPLOADING: 'Saving…',
  COMPLETED: 'Done',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
};

export function GenerationPanel({
  catalogueId,
  jobs,
  garmentPreviewUrl,
  onAllSettled,
}: GenerationPanelProps) {
  const qc = useQueryClient();
  const [statuses, setStatuses] = useState<Record<string, string>>(() =>
    Object.fromEntries(jobs.map((j) => [j.id, 'QUEUED'])),
  );
  const [selected, setSelected] = useState(0);
  const [downloading, setDownloading] = useState(false);

  // Reset local status map + selection whenever a new batch of jobs arrives.
  useEffect(() => {
    setStatuses(Object.fromEntries(jobs.map((j) => [j.id, 'QUEUED'])));
    setSelected(0);
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

  // Notify the parent once every job in this batch has reached a terminal
  // status, so it can re-enable the Generate button while results still render.
  useEffect(() => {
    const allSettled =
      jobs.length > 0 && jobs.every((j) => TERMINAL_STATUSES.has(statuses[j.id] ?? 'QUEUED'));
    if (allSettled) onAllSettled?.();
  }, [jobs, statuses, onAllSettled]);

  const completedIds = jobs.filter((j) => statuses[j.id] === 'COMPLETED').map((j) => j.id);
  const resultQueries = useQueries({
    queries: jobs.map((j) => ({
      queryKey: ['job-result', j.id],
      queryFn: () => api.get<{ url: string }>(`/v1/jobs/${j.id}/result`),
      enabled: completedIds.includes(j.id),
      staleTime: 55 * 60 * 1000,
    })),
  });
  const completedCount = completedIds.length;

  const current = jobs[selected];
  const currentStatus = current ? (statuses[current.id] ?? 'QUEUED') : 'QUEUED';
  const currentCompleted = currentStatus === 'COMPLETED';
  const currentFailed = currentStatus === 'FAILED' || currentStatus === 'CANCELLED';
  const currentResultUrl = resultQueries[selected]?.data?.url;

  function goPrev() {
    setSelected((s) => (s - 1 + jobs.length) % jobs.length);
  }
  function goNext() {
    setSelected((s) => (s + 1) % jobs.length);
  }

  async function downloadImage(url: string, jobId: string) {
    if (downloading) return;
    setDownloading(true);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status}`);
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
      const msg = (e as Error).message ?? '';
      alert(
        msg.includes('403')
          ? 'Download link expired. Please refresh the page and try again.'
          : 'Download failed. Please try again.',
      );
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        borderRadius: 20,
        background: 'rgba(245,245,245,0.4)',
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
          padding: '16px 20px',
          boxSizing: 'border-box',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 20, fontWeight: 600, color: C.text }}>
            {completedCount === jobs.length ? 'Catalogue Ready' : 'Generating Catalogue'}
          </span>
          <Link
            href={`/catalogues/${catalogueId}`}
            style={{ fontSize: 13, fontWeight: 600, color: C.pink, textDecoration: 'none' }}
          >
            View full catalogue →
          </Link>
        </div>
        {currentCompleted && currentResultUrl && (
          <button
            type="button"
            disabled={downloading}
            onClick={() => current && downloadImage(currentResultUrl, current.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              height: 40,
              padding: '0 16px',
              borderRadius: 8,
              border: 'none',
              background: '#141414',
              color: '#FEFEFE',
              fontFamily: 'inherit',
              fontSize: 13,
              fontWeight: 600,
              cursor: downloading ? 'not-allowed' : 'pointer',
              opacity: downloading ? 0.6 : 1,
            }}
          >
            <DownloadIcon size={16} /> {downloading ? 'Downloading…' : 'Download'}
          </button>
        )}
      </div>

      {/* ── Main preview ── */}
      <div style={{ flex: 1, minHeight: 0, padding: 16, boxSizing: 'border-box' }}>
        <div
          style={{
            position: 'relative',
            width: '100%',
            height: '100%',
            borderRadius: 12,
            overflow: 'hidden',
            background: C.lighter,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {current && currentCompleted && currentResultUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            // biome-ignore lint/performance/noImgElement: presigned R2 URL
            <img
              src={currentResultUrl}
              alt={current.label}
              onError={() => {
                qc.invalidateQueries({ queryKey: ['job-result', current.id] });
              }}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                objectPosition: 'top center',
              }}
            />
          ) : current ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {/* biome-ignore lint/performance/noImgElement: presigned R2 URL */}
              <img
                src={garmentPreviewUrl || current.thumbnailUrl}
                alt={current.label}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  objectPosition: 'top center',
                  filter: currentFailed ? 'none' : 'blur(6px)',
                  opacity: currentFailed ? 0.5 : 0.7,
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 10,
                  background: 'rgba(0,0,0,0.18)',
                  color: C.white,
                }}
              >
                {currentFailed ? <XIcon size={28} /> : <SpinnerIcon size={40} />}
                <span style={{ fontSize: 14, fontWeight: 500 }}>
                  {STATUS_LABEL[currentStatus] ?? currentStatus}
                </span>
              </div>
            </>
          ) : null}

          {jobs.length > 1 && (
            <>
              <button
                type="button"
                onClick={goPrev}
                style={{
                  position: 'absolute',
                  left: 16,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  width: 44,
                  height: 44,
                  borderRadius: '50%',
                  background: 'rgba(255,255,255,0.85)',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
                  border: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  fontSize: 18,
                  color: C.text,
                }}
              >
                ‹
              </button>
              <button
                type="button"
                onClick={goNext}
                style={{
                  position: 'absolute',
                  right: 16,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  width: 44,
                  height: 44,
                  borderRadius: '50%',
                  background: 'rgba(255,255,255,0.85)',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
                  border: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  fontSize: 18,
                  color: C.text,
                }}
              >
                ›
              </button>
            </>
          )}

          {currentCompleted && currentResultUrl && (
            <div style={{ position: 'absolute', right: 20, bottom: 18, display: 'flex', gap: 10 }}>
              <a
                href={currentResultUrl}
                target="_blank"
                rel="noreferrer"
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 10,
                  background: 'rgba(255,255,255,0.9)',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: C.text,
                }}
              >
                <FullscreenIcon />
              </a>
            </div>
          )}
        </div>
      </div>

      {/* ── Thumbnail strip ── */}
      {jobs.length > 1 && (
        <div style={{ padding: '0 16px 16px', display: 'flex', gap: 10 }}>
          {jobs.map((job, i) => {
            const status = statuses[job.id] ?? 'QUEUED';
            const isCompleted = status === 'COMPLETED';
            const isFailed = status === 'FAILED' || status === 'CANCELLED';
            const resultUrl = resultQueries[i]?.data?.url;
            const isSelected = i === selected;
            return (
              <button
                key={job.id}
                type="button"
                onClick={() => setSelected(i)}
                style={{
                  position: 'relative',
                  width: 72,
                  height: 72,
                  borderRadius: 8,
                  overflow: 'hidden',
                  flexShrink: 0,
                  padding: 0,
                  border: 'none',
                  cursor: 'pointer',
                  background: C.lighter,
                  boxShadow: isSelected
                    ? `inset 0 0 0 2px ${C.pink}`
                    : `inset 0 0 0 1px ${C.border2}`,
                }}
              >
                {isCompleted && resultUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  // biome-ignore lint/performance/noImgElement: presigned R2 URL
                  <img
                    src={resultUrl}
                    alt={job.label}
                    onError={() => {
                      qc.invalidateQueries({ queryKey: ['job-result', job.id] });
                    }}
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
                    {/* biome-ignore lint/performance/noImgElement: presigned R2 URL */}
                    <img
                      src={garmentPreviewUrl || job.thumbnailUrl}
                      alt={job.label}
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        objectPosition: 'top center',
                        filter: isFailed ? 'none' : 'blur(3px)',
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
                          color: C.white,
                        }}
                      >
                        <SpinnerIcon size={18} />
                      </div>
                    )}
                  </>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
