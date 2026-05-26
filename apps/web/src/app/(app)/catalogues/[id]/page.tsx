'use client';
import { use, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface Job {
  id: string;
  status: string;
  createdAt: string;
  creditsCharged: number;
}

interface CatalogueDetail {
  catalogueId: string;
  jobs: Job[];
}

const TERMINAL = ['COMPLETED', 'FAILED', 'CANCELLED'];

const SpinnerIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="av-spin">
    <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
  </svg>
);
const FailIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
  </svg>
);
const DownloadIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="7 10 12 15 17 10"/>
    <line x1="12" y1="15" x2="12" y2="3"/>
  </svg>
);
const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"/>
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
    <path d="M10 11v6M14 11v6"/>
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
  </svg>
);

function ImageCard({ job, catalogueId }: { job: Job; catalogueId: string }) {
  const isCompleted = job.status === 'COMPLETED';
  const isFailed = job.status === 'FAILED';
  const isActive = !TERMINAL.includes(job.status);
  const isTerminal = TERMINAL.includes(job.status);
  const [deleting, setDeleting] = useState(false);
  const queryClient = useQueryClient();

  const { data: result } = useQuery<{ url: string }>({
    queryKey: ['job-result', job.id],
    queryFn: () => api.get(`/v1/jobs/${job.id}/result`),
    enabled: isCompleted,
    staleTime: 4 * 60 * 1000,
  });

  async function handleDelete() {
    if (!confirm('Delete this image? This cannot be undone.')) return;
    setDeleting(true);
    try {
      await api.del(`/v1/jobs/${job.id}`);
      // Remove from catalogue cache immediately
      queryClient.setQueryData<CatalogueDetail>(['catalogue', catalogueId], (old) => {
        if (!old) return old;
        return { ...old, jobs: old.jobs.filter((j) => j.id !== job.id) };
      });
      // Invalidate dashboard catalogues list
      queryClient.invalidateQueries({ queryKey: ['catalogues'] });
    } catch {
      alert('Failed to delete image. Please try again.');
      setDeleting(false);
    }
  }

  return (
    <div className="av-cdet-card">
      <div className="av-cdet-img">
        {isCompleted && result?.url ? (
          <img src={result.url} alt={`Output ${job.id.slice(0, 8)}`} />
        ) : isFailed ? (
          <div className="av-cat-placeholder av-cat-failed">
            <FailIcon /><span>Failed</span>
          </div>
        ) : (
          <div className="av-cat-placeholder av-cat-generating">
            <SpinnerIcon />
            <span>{job.status.toLowerCase().replace('_', ' ')}</span>
          </div>
        )}
        {isActive && <div className="av-cat-pulse" />}
      </div>
      <div className="av-cdet-footer">
        <span style={{ fontSize: 12, color: 'var(--mute)', fontFamily: 'var(--font-mono)' }}>#{job.id.slice(0, 8)}</span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {isCompleted && result?.url && (
            <a
              href={result.url}
              download={`aivastra-${job.id.slice(0, 8)}.jpg`}
              target="_blank"
              rel="noreferrer"
              className="av-btn av-btn-ghost"
              style={{ padding: '4px 10px', fontSize: 12, gap: 5 }}
            >
              <DownloadIcon /> Download
            </a>
          )}
          {isTerminal && (
            <button
              className="av-btn av-btn-ghost"
              style={{ padding: '4px 8px', fontSize: 12, color: 'var(--danger, #e05)', opacity: deleting ? 0.5 : 1 }}
              onClick={handleDelete}
              disabled={deleting}
              title="Delete image"
            >
              {deleting ? <SpinnerIcon /> : <TrashIcon />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function CataloguePage({ params }: { params: Promise<{ id: string }> }): React.ReactElement {
  const { id } = use(params);

  const { data, isLoading } = useQuery<CatalogueDetail>({
    queryKey: ['catalogue', id],
    queryFn: () => api.get(`/v1/catalogues/${id}`),
    refetchInterval: (query) => {
      const d = query.state.data;
      if (!d) return false;
      return d.jobs.some((j) => !TERMINAL.includes(j.status)) ? 3000 : false;
    },
  });

  const completedCount = data?.jobs.filter((j) => j.status === 'COMPLETED').length ?? 0;
  const total = data?.jobs.length ?? 0;

  return (
    <div className="av-main-inner">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 }}>
        <Link href="/dashboard" className="av-btn av-btn-ghost" style={{ textDecoration: 'none', padding: '6px 12px', fontSize: 13 }}>
          ← Back
        </Link>
        <div>
          <h1 style={{ fontWeight: 700, fontSize: 22, letterSpacing: '-0.01em', margin: '0 0 4px' }}>
            Catalogue <span style={{ color: 'var(--mute)', fontWeight: 500, fontSize: 16, fontFamily: 'var(--font-mono)' }}>#{id.slice(0, 8)}</span>
          </h1>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--mute)' }}>
            {isLoading ? 'Loading…' : `${completedCount} of ${total} image${total !== 1 ? 's' : ''} ready`}
          </p>
        </div>
      </div>

      {isLoading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '64px 0' }}>
          <SpinnerIcon />
        </div>
      )}

      {data && (
        <div className="av-cdet-grid">
          {data.jobs.map((job) => (
            <ImageCard key={job.id} job={job} catalogueId={id} />
          ))}
        </div>
      )}
    </div>
  );
}
