'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface Job {
  id: string;
  status: string;
  createdAt: string;
  creditsCharged: number;
}

const STATUS_COLOR: Record<string, string> = {
  QUEUED: 'var(--amber)',
  PREPROCESSING: 'var(--amber)',
  GENERATING: 'var(--amber)',
  UPLOADING: 'var(--amber)',
  COMPLETED: 'var(--mint)',
  FAILED: 'var(--peach)',
  CANCELLED: 'var(--mute)',
};

const SpinnerIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="av-spin">
    <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
  </svg>
);

const WandIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 4V2"/><path d="M15 16v-2"/><path d="M8 9h2"/><path d="M20 9h2"/>
    <path d="M17.8 11.8L19 13"/><path d="M15 9h0"/><path d="M17.8 6.2L19 5"/>
    <path d="M3 21l9-9"/><path d="M12.2 6.2L11 5"/>
  </svg>
);

export default function DashboardPage() {
  const { data: jobs, isLoading } = useQuery<Job[]>({
    queryKey: ['jobs'],
    queryFn: () => api.get('/v1/jobs'),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return false;
      const hasActive = data.some((j) => !['COMPLETED', 'FAILED', 'CANCELLED'].includes(j.status));
      return hasActive ? 3000 : false;
    },
  });

  return (
    <div className="av-main-inner">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontWeight: 700, fontSize: 26, letterSpacing: '-0.01em', margin: '0 0 6px' }}>Your Catalogues</h1>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--mute)' }}>Track your virtual try-on jobs</p>
        </div>
        <Link href="/tryon" className="av-btn av-btn-primary" style={{ textDecoration: 'none' }}>
          <WandIcon /> New Try-On
        </Link>
      </div>

      {isLoading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '64px 0' }}>
          <SpinnerIcon />
        </div>
      )}

      {!isLoading && (!jobs || jobs.length === 0) && (
        <div className="av-card" style={{ textAlign: 'center', padding: '64px 24px' }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, background: 'var(--surface-2)', border: '1px solid var(--line)', display: 'grid', placeItems: 'center', margin: '0 auto 16px', color: 'var(--mute)' }}>
            <WandIcon />
          </div>
          <p style={{ fontWeight: 700, fontSize: 18, margin: '0 0 8px' }}>No try-ons yet</p>
          <p style={{ fontSize: 14, color: 'var(--mute)', margin: '0 0 24px' }}>Create your first virtual try-on to get started.</p>
          <Link href="/tryon" className="av-btn av-btn-primary" style={{ textDecoration: 'none', display: 'inline-flex' }}>
            Get started →
          </Link>
        </div>
      )}

      {jobs && jobs.length > 0 && (
        <div className="av-card" style={{ padding: 0 }}>
          {jobs.map((job, i) => (
            <Link
              key={job.id}
              href={`/jobs/${job.id}`}
              style={{
                display: 'flex', alignItems: 'center', gap: 16,
                padding: '16px 24px',
                borderBottom: i < jobs.length - 1 ? '1px solid var(--line)' : 'none',
                textDecoration: 'none',
                transition: 'background .15s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-2)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              {/* Status dot */}
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLOR[job.status] ?? 'var(--mute)', flexShrink: 0, boxShadow: job.status === 'COMPLETED' ? '0 0 6px var(--mint)' : 'none' }} />

              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontWeight: 600, fontSize: 14, margin: 0, color: 'var(--ink)' }}>
                  Try-on #{job.id.slice(0, 8)}
                </p>
                <p style={{ fontSize: 12, color: 'var(--mute)', margin: '2px 0 0' }}>
                  {new Date(job.createdAt).toLocaleString()}
                </p>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{
                  padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 600,
                  background: job.status === 'COMPLETED' ? 'var(--mint-soft)' : job.status === 'FAILED' ? 'rgba(245,92,122,0.10)' : 'rgba(246,181,83,0.10)',
                  color: job.status === 'COMPLETED' ? 'var(--mint)' : job.status === 'FAILED' ? 'var(--peach)' : 'var(--amber)',
                }}>
                  {job.status}
                </span>
                <span style={{ fontSize: 12, color: 'var(--mute)', fontVariantNumeric: 'tabular-nums' }}>{job.creditsCharged}c</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
