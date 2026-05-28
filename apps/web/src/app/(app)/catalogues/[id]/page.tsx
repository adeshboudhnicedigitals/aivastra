'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { use, useState } from 'react';
import {
  ArrowLeft,
  DownloadIcon,
  FullscreenIcon,
  SpinnerIcon,
  TrashIcon,
  XIcon,
} from '@/components/icons';
import { BG_TINTS, C, grad } from '@/components/tokens';
import { TopBar } from '@/components/topbar';
import { DarkBtn } from '@/components/ui/dark-btn';
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

function ImageCard({
  job,
  catalogueId,
  tint,
  onZoom,
}: {
  job: Job;
  catalogueId: string;
  tint: string;
  onZoom: (url: string) => void;
}) {
  const isCompleted = job.status === 'COMPLETED';
  const isFailed = job.status === 'FAILED';
  const isActive = !TERMINAL.includes(job.status);
  const [deleting, setDeleting] = useState(false);
  const qc = useQueryClient();

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
      qc.setQueryData<CatalogueDetail>(['catalogue', catalogueId], (old) =>
        old ? { ...old, jobs: old.jobs.filter((j) => j.id !== job.id) } : old,
      );
      qc.invalidateQueries({ queryKey: ['catalogues'] });
    } catch {
      alert('Failed to delete image.');
      setDeleting(false);
    }
  }

  return (
    <div
      style={{
        background: C.white,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          height: 320,
          background: tint,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
        }}
      >
        {isCompleted && result?.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={result.url}
            alt={`#${job.id.slice(0, 8)}`}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : isFailed ? (
          <span style={{ color: C.mid, fontSize: 13 }}>Failed</span>
        ) : (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 8,
              color: C.mid,
            }}
          >
            <SpinnerIcon />
            <span style={{ fontSize: 13 }}>{job.status.toLowerCase().replace('_', ' ')}</span>
          </div>
        )}
        {isCompleted && result?.url && (
          <div style={{ position: 'absolute', top: 10, right: 10, display: 'flex', gap: 6 }}>
            <button
              onClick={() => onZoom(result.url)}
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                border: `1px solid ${C.border}`,
                background: 'rgba(255,255,255,0.9)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <FullscreenIcon />
            </button>
            <a
              href={result.url}
              download={`aivastra-${job.id.slice(0, 8)}.jpg`}
              target="_blank"
              rel="noreferrer"
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                border: 'none',
                background: grad,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: C.white,
              }}
            >
              <DownloadIcon />
            </a>
          </div>
        )}
      </div>
      <div
        style={{
          padding: '12px 14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 500, color: C.text }}>#{job.id.slice(0, 8)}</span>
        {TERMINAL.includes(job.status) && (
          <button
            onClick={handleDelete}
            disabled={deleting}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: C.pink,
              display: 'flex',
              padding: 4,
              opacity: deleting ? 0.5 : 1,
            }}
            title="Delete"
          >
            {deleting ? <SpinnerIcon size={14} /> : <TrashIcon />}
          </button>
        )}
      </div>
    </div>
  );
}

export default function CataloguePage({
  params,
}: {
  params: Promise<{ id: string }>;
}): React.ReactElement {
  const { id } = use(params);
  const [zoom, setZoom] = useState<string | null>(null);

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
    <>
      <TopBar
        lead={
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Link
              href="/catalogues"
              style={{ color: C.mid, display: 'flex', textDecoration: 'none' }}
            >
              <ArrowLeft />
            </Link>
            <div>
              <div style={{ fontWeight: 700, fontSize: 18, color: C.text }}>
                Catalogue{' '}
                <span style={{ color: C.mid, fontWeight: 500, fontSize: 14 }}>
                  #{id.slice(0, 8)}
                </span>
              </div>
              <div style={{ fontSize: 12, color: C.mid }}>
                {isLoading
                  ? 'Loading…'
                  : `${completedCount} of ${total} image${total !== 1 ? 's' : ''} ready`}
              </div>
            </div>
          </div>
        }
        right={
          <DarkBtn style={{ gap: 8 }}>
            <DownloadIcon /> Download All
          </DarkBtn>
        }
      />
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
        {isLoading && (
          <div
            style={{ display: 'flex', justifyContent: 'center', padding: '64px 0', color: C.mid }}
          >
            <SpinnerIcon />
          </div>
        )}
        {data && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
              gap: 20,
            }}
          >
            {data.jobs.map((job, i) => (
              <ImageCard
                key={job.id}
                job={job}
                catalogueId={id}
                tint={BG_TINTS[i % BG_TINTS.length]!}
                onZoom={setZoom}
              />
            ))}
          </div>
        )}
      </div>

      {zoom && (
        <div
          onClick={() => setZoom(null)}
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
            onClick={() => setZoom(null)}
            style={{
              position: 'absolute',
              top: 20,
              right: 20,
              width: 40,
              height: 40,
              borderRadius: '50%',
              background: 'rgba(255,255,255,0.15)',
              border: 'none',
              color: C.white,
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
            src={zoom}
            alt=""
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 8 }}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
