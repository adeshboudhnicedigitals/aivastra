'use client';
import { useQueries } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { SpinnerIcon, XIcon } from '@/components/icons';
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
}

const STATUS_LABEL: Record<string, string> = {
  QUEUED: 'Queued',
  PREPROCESSING: 'Preparing…',
  GENERATING: 'Generating…',
  UPLOADING: 'Saving…',
  COMPLETED: 'Done',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
};

export function GenerationPanel({ catalogueId, jobs }: GenerationPanelProps) {
  const [statuses, setStatuses] = useState<Record<string, string>>(() =>
    Object.fromEntries(jobs.map((j) => [j.id, 'QUEUED'])),
  );

  // Reset local status map whenever a new batch of jobs arrives.
  useEffect(() => {
    setStatuses(Object.fromEntries(jobs.map((j) => [j.id, 'QUEUED'])));
  }, [jobs]);

  const jobIds = jobs.map((j) => j.id);
  useJobStream((evt) => {
    if (!jobIds.includes(evt.jobId)) return;
    setStatuses((prev) => ({ ...prev, [evt.jobId]: evt.status }));
  });

  const completedIds = jobs.filter((j) => statuses[j.id] === 'COMPLETED').map((j) => j.id);
  const resultQueries = useQueries({
    queries: jobs.map((j) => ({
      queryKey: ['job-result', j.id],
      queryFn: () => api.get<{ url: string }>(`/v1/jobs/${j.id}/result`),
      enabled: completedIds.includes(j.id),
      staleTime: 4 * 60 * 1000,
    })),
  });

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
          flexDirection: 'column',
          gap: 6,
          justifyContent: 'center',
        }}
      >
        <span style={{ fontSize: 18, fontWeight: 600, color: C.text }}>Generating Catalogue</span>
        <Link
          href={`/catalogues/${catalogueId}`}
          style={{ fontSize: 13, fontWeight: 600, color: C.pink, textDecoration: 'none' }}
        >
          View full catalogue →
        </Link>
      </div>
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        {jobs.map((job, i) => {
          const status = statuses[job.id] ?? 'QUEUED';
          const isCompleted = status === 'COMPLETED';
          const isFailed = status === 'FAILED' || status === 'CANCELLED';
          const resultUrl = resultQueries[i]?.data?.url;
          return (
            <div
              key={job.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: 10,
                borderRadius: 10,
                background: C.white,
                boxShadow: `inset 0 0 0 1px ${C.border2}`,
              }}
            >
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 8,
                  overflow: 'hidden',
                  flexShrink: 0,
                  background: C.lighter,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {isCompleted && resultUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  // biome-ignore lint/performance/noImgElement: presigned R2 URL
                  <img
                    src={resultUrl}
                    alt={job.label}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  // biome-ignore lint/performance/noImgElement: presigned R2 URL
                  <img
                    src={job.thumbnailUrl}
                    alt={job.label}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      opacity: isCompleted ? 1 : 0.5,
                    }}
                  />
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{job.label}</div>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 500,
                    color: isFailed ? C.pink : C.mid,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    marginTop: 2,
                  }}
                >
                  {!isCompleted && !isFailed && <SpinnerIcon size={12} />}
                  {isFailed && <XIcon size={12} />}
                  {STATUS_LABEL[status] ?? status}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
