'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface JobSummary {
  id: string;
  status: string;
  createdAt: string;
  creditsCharged: number;
}

interface Catalogue {
  catalogueId: string;
  jobs: JobSummary[];
  createdAt: string;
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

function CoverImage({ catalogueId, jobs }: { catalogueId: string; jobs: JobSummary[] }) {
  const completedJob = jobs.find((j) => j.status === 'COMPLETED');
  const hasActive = jobs.some((j) => !TERMINAL.includes(j.status));
  const allFailed = jobs.every((j) => j.status === 'FAILED');

  const { data: result } = useQuery<{ url: string }>({
    queryKey: ['job-result', completedJob?.id],
    queryFn: () => api.get(`/v1/jobs/${completedJob!.id}/result`),
    enabled: !!completedJob,
    staleTime: 4 * 60 * 1000,
  });

  if (completedJob && result?.url) {
    return <img src={result.url} alt={`Catalogue ${catalogueId.slice(0, 8)}`} />;
  }
  if (allFailed) {
    return (
      <div className="av-cat-placeholder av-cat-failed">
        <FailIcon /><span>Failed</span>
      </div>
    );
  }
  return (
    <div className="av-cat-placeholder av-cat-generating">
      <SpinnerIcon />
      <span>{hasActive ? 'Generating…' : jobs[0]?.status?.toLowerCase().replace('_', ' ')}</span>
    </div>
  );
}

function CatalogueCard({ catalogue }: { catalogue: Catalogue }) {
  const { catalogueId, jobs } = catalogue;
  const hasActive = jobs.some((j) => !TERMINAL.includes(j.status));
  const completedCount = jobs.filter((j) => j.status === 'COMPLETED').length;

  return (
    <Link href={`/catalogues/${catalogueId}`} className="av-cat-card" style={{ textDecoration: 'none' }}>
      <div className="av-cat-img">
        <CoverImage catalogueId={catalogueId} jobs={jobs} />
        {hasActive && <div className="av-cat-pulse" />}
        {jobs.length > 1 && (
          <div className="av-cat-count">{completedCount}/{jobs.length}</div>
        )}
      </div>
      <div className="av-cat-meta">
        <span className="av-cat-id">#{catalogueId.slice(0, 8)}</span>
        <span className="av-cat-date">{new Date(catalogue.createdAt).toLocaleDateString()}</span>
      </div>
    </Link>
  );
}

export default function DashboardPage(): React.ReactElement {
  const { data: catalogues, isLoading } = useQuery<Catalogue[]>({
    queryKey: ['catalogues'],
    queryFn: () => api.get('/v1/catalogues'),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return false;
      const hasActive = data.some((c) => c.jobs.some((j) => !TERMINAL.includes(j.status)));
      return hasActive ? 3000 : false;
    },
  });

  const totalCompleted = catalogues?.reduce((acc, c) => acc + c.jobs.filter((j) => j.status === 'COMPLETED').length, 0) ?? 0;

  return (
    <div className="av-main-inner">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontWeight: 700, fontSize: 26, letterSpacing: '-0.01em', margin: '0 0 6px' }}>Your Catalogues</h1>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--mute)' }}>
            {catalogues ? `${totalCompleted} image${totalCompleted !== 1 ? 's' : ''} generated` : 'Loading…'}
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

      {!isLoading && (!catalogues || catalogues.length === 0) && (
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

      {catalogues && catalogues.length > 0 && (
        <div className="av-cat-grid">
          {catalogues.map((cat) => <CatalogueCard key={cat.catalogueId} catalogue={cat} />)}
        </div>
      )}
    </div>
  );
}
