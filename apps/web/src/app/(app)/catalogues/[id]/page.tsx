'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import {
  ArrowLeft,
  DownloadIcon,
  FullscreenIcon,
  ImageDownIcon,
  MonitorPlayIcon,
  SpinnerIcon,
  TrashIcon,
  XIcon,
} from '@/components/icons';
import { C } from '@/components/tokens';
import { TopBar } from '@/components/topbar';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Tooltip } from '@/components/ui/tooltip';
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
  const [deleting, setDeleting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const qc = useQueryClient();

  const { data: result } = useQuery<{ url: string }>({
    queryKey: ['job-result', job.id],
    queryFn: () => api.get(`/v1/jobs/${job.id}/result`),
    enabled: isCompleted,
    staleTime: 4 * 60 * 1000,
  });

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.del(`/v1/jobs/${job.id}`);
      qc.setQueryData<CatalogueDetail>(['catalogue', catalogueId], (old) =>
        old ? { ...old, jobs: old.jobs.filter((j) => j.id !== job.id) } : old,
      );
      qc.invalidateQueries({ queryKey: ['catalogues'] });
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Failed to delete image.');
      setDeleting(false);
    }
  }

  return (
    <>
      <div style={{ width: '100%', height: 316, display: 'flex', flexDirection: 'column', gap: 5 }}>
        <Tooltip
          tip={
            !(isCompleted && result?.url)
              ? isFailed
                ? 'Generation failed'
                : 'Image is still generating…'
              : undefined
          }
          position="top"
        >
          <button
            type="button"
            disabled={!(isCompleted && result?.url)}
            style={{
              flex: 1,
              background: tint,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative',
              borderRadius: 8,
              overflow: 'hidden',
              cursor: isCompleted && result?.url ? 'pointer' : 'default',
              border: 'none',
              padding: 0,
            }}
            onClick={() => {
              if (isCompleted && result?.url) onZoom(result.url);
            }}
          >
            {isCompleted && result?.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              // biome-ignore lint/performance/noImgElement: presigned R2 URL, Next/Image incompatible
              <img
                src={result.url}
                alt={`#${job.id.slice(0, 8)}`}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  objectPosition: 'center',
                }}
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
          </button>
        </Tooltip>
        <div
          style={{
            height: 28,
            padding: '0 4px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 500, color: C.text }}>
            #{job.id.slice(0, 8)}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {TERMINAL.includes(job.status) && (
              <button
                type="button"
                onClick={() => {
                  setDeleteError(null);
                  setConfirmOpen(true);
                }}
                disabled={deleting}
                aria-label="Delete image"
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: C.pink,
                  display: 'flex',
                  padding: 2,
                  opacity: deleting ? 0.5 : 1,
                }}
                title="Delete"
              >
                {deleting ? <SpinnerIcon size={14} /> : <TrashIcon />}
              </button>
            )}
            {isCompleted && result?.url && (
              <>
                <button
                  type="button"
                  onClick={() => onZoom(result.url)}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 8,
                    background: '#EEEEEE',
                    backdropFilter: 'blur(10px)',
                    border: 'none',
                    cursor: 'pointer',
                    color: C.mid,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 0,
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
                    width: 28,
                    height: 28,
                    borderRadius: 8,
                    background: 'linear-gradient(90deg, #F55C7A 0%, #F6B553 100%)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: C.white,
                  }}
                >
                  <DownloadIcon size={16} />
                </a>
              </>
            )}
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={confirmOpen}
        title="Delete this image?"
        message="This cannot be undone."
        confirmLabel="Delete"
        danger
        busy={deleting}
        error={deleteError}
        onConfirm={handleDelete}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}

export default function CataloguePage({
  params,
}: {
  params: Promise<{ id: string }>;
}): React.ReactElement {
  const { id } = use(params);
  const qc = useQueryClient();
  const [zoom, setZoom] = useState<string | null>(null);
  const [zoomVisible, setZoomVisible] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadErr, setDownloadErr] = useState<string | null>(null);

  useEffect(() => {
    if (zoom) {
      requestAnimationFrame(() => setZoomVisible(true));
    } else {
      setZoomVisible(false);
    }
  }, [zoom]);

  useEffect(() => {
    if (!downloadErr) return;
    const t = setTimeout(() => setDownloadErr(null), 3500);
    return () => clearTimeout(t);
  }, [downloadErr]);

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

  async function handleDownloadAll() {
    if (!data || downloading) return;
    const completed = data.jobs.filter((j) => j.status === 'COMPLETED');
    if (completed.length === 0) return;
    setDownloading(true);
    setDownloadErr(null);
    let failures = 0;
    for (const job of completed) {
      try {
        const { url } = await qc.fetchQuery<{ url: string }>({
          queryKey: ['job-result', job.id],
          queryFn: () => api.get(`/v1/jobs/${job.id}/result`),
          staleTime: 4 * 60 * 1000,
        });
        const res = await fetch(url);
        if (!res.ok) throw new Error('fetch failed');
        const blob = await res.blob();
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = `aivastra-${job.id.slice(0, 8)}.jpg`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(objectUrl);
      } catch {
        failures += 1;
      }
    }
    setDownloading(false);
    if (failures > 0) {
      setDownloadErr(
        `${failures} of ${completed.length} image${completed.length !== 1 ? 's' : ''} failed to download.`,
      );
    }
  }

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
          <div style={{ display: 'flex', gap: 12 }}>
            <Link
              href={`/catalogues/${id}/preview`}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                padding: '12px 20px',
                height: 44,
                width: 133,
                borderRadius: 8,
                border: '1px solid #EEEEEE',
                background: '#F9F9F9',
                color: '#626262',
                fontFamily: 'inherit',
                fontSize: 16,
                fontWeight: 500,
                lineHeight: '20px',
                cursor: 'pointer',
                boxSizing: 'border-box',
                textDecoration: 'none',
              }}
            >
              <MonitorPlayIcon size={20} /> Preview
            </Link>
            <button
              type="button"
              onClick={handleDownloadAll}
              disabled={downloading || completedCount === 0}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                padding: '12px 20px',
                height: 44,
                width: 177,
                borderRadius: 8,
                border: 'none',
                background: '#141414',
                color: '#FEFEFE',
                fontFamily: 'inherit',
                fontSize: 16,
                fontWeight: 600,
                lineHeight: '20px',
                cursor: downloading || completedCount === 0 ? 'not-allowed' : 'pointer',
                opacity: downloading || completedCount === 0 ? 0.5 : 1,
                boxSizing: 'border-box',
              }}
            >
              {downloading ? (
                <>
                  <SpinnerIcon size={18} /> Downloading…
                </>
              ) : (
                <>
                  Download All <ImageDownIcon size={20} />
                </>
              )}
            </button>
          </div>
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
              gridTemplateColumns: 'repeat(auto-fill, 369.33px)',
              gap: 16,
              width: '100%',
            }}
          >
            {data.jobs.map((job) => (
              <ImageCard key={job.id} job={job} catalogueId={id} tint="#f5f5f5" onZoom={setZoom} />
            ))}
          </div>
        )}
      </div>

      {zoom && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setZoom(null)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setZoom(null);
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
          {/* biome-ignore lint/performance/noImgElement: presigned R2 URL, Next/Image incompatible */}
          <img
            src={zoom}
            alt=""
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              objectFit: 'contain',
              borderRadius: 8,
              transform: zoomVisible ? 'translateX(0)' : 'translateX(100%)',
              transition: 'transform 300ms ease-out',
              pointerEvents: 'none',
            }}
          />
        </div>
      )}

      {downloadErr && (
        <div
          style={{
            position: 'fixed',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            background: C.dark,
            color: C.white,
            padding: '10px 20px',
            borderRadius: 8,
            fontSize: 13,
            zIndex: 1200,
            boxShadow: '0 6px 24px rgba(0,0,0,0.2)',
          }}
        >
          {downloadErr}
        </div>
      )}
    </>
  );
}
