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

const TERMINAL = ['COMPLETED', 'FAILED', 'CANCELLED'];

const SpinnerIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="av-spin">
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
const FailIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
  </svg>
);

function CatalogueCard({ job }: { job: Job }) {
  const isCompleted = job.status === 'COMPLETED';
  const isFailed = job.status === 'FAILED';
  const isActive = !TERMINAL.includes(job.status);

  const { data: result } = useQuery<{ url: string }>({
    queryKey: ['job-result', job.id],
    queryFn: () => api.get(`/v1/jobs/${job.id}/result`),
    enabled: isCompleted,
    staleTime: 4 * 60 * 1000, // presign valid 5 min, refresh at 4
  });

  return (
    <Link href={`/jobs/${job.id}`} className="av-cat-card" style={{ textDecoration: 'none' }}>
      <div className="av-cat-img">
        {isCompleted && result?.url ? (
          <img src={result.url} alt={`Catalogue ${job.id.slice(0, 8)}`} />
        ) : isFailed ? (
          <div className="av-cat-placeholder av-cat-failed">
            <FailIcon />
            <span>Failed</span>
          </div>
        ) : (
          <div className="av-cat-placeholder av-cat-generating">
            <SpinnerIcon />
            <span>{job.status.toLowerCase().replace('_', ' ')}</span>
          </div>
        )}
        {isActive && <div className="av-cat-pulse" />}
      </div>
      <div className="av-cat-meta">
        <span className="av-cat-id">#{job.id.slice(0, 8)}</span>
        <span className="av-cat-date">{new Date(job.createdAt).toLocaleDateString()}</span>
      </div>
    </Link>
  );
}

export default function DashboardPage() {
  const { data: jobs, isLoading } = useQuery<Job[]>({
    queryKey: ['jobs'],
    queryFn: () => api.get('/v1/jobs'),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return false;
      const hasActive = data.some((j) => !TERMINAL.includes(j.status));
      return hasActive ? 3000 : false;
    },
  });

  return (
    <div className="av-main-inner">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontWeight: 700, fontSize: 26, letterSpacing: '-0.01em', margin: '0 0 6px' }}>Your Catalogues</h1>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--mute)' }}>
            {jobs ? `${jobs.filter((j) => j.status === 'COMPLETED').length} generated` : 'Loading…'}
          </p>
        </div>
        <Link href="/tryon" className="av-btn av-btn-primary" style={{ textDecoration: 'none' }}>
          <WandIcon /> New Catalogue
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
          <p style={{ fontWeight: 700, fontSize: 18, margin: '0 0 8px' }}>No catalogues yet</p>
          <p style={{ fontSize: 14, color: 'var(--mute)', margin: '0 0 24px' }}>Generate your first AI catalogue to get started.</p>
          <Link href="/tryon" className="av-btn av-btn-primary" style={{ textDecoration: 'none', display: 'inline-flex' }}>
            Get started →
          </Link>
        </div>
      )}

      {jobs && jobs.length > 0 && (
        <div className="av-cat-grid">
          {jobs.map((job) => <CatalogueCard key={job.id} job={job} />)}
        </div>
      )}
    </div>
  );
}
