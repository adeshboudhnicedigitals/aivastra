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
const SparkleIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
    <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z"/>
  </svg>
);
const SearchIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
  </svg>
);

const BG_COLORS = ['#f5f0e8','#e8f0f5','#f0e8f5','#e8f5ee','#f5e8e8','#eef5e8'];

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
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={result.url} alt={`Catalogue ${catalogueId.slice(0, 8)}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />;
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

function CatalogueCard({ catalogue, idx }: { catalogue: Catalogue; idx: number }) {
  const { catalogueId, jobs } = catalogue;
  const hasActive = jobs.some((j) => !TERMINAL.includes(j.status));
  const completedCount = jobs.filter((j) => j.status === 'COMPLETED').length;
  const dateStr = new Date(catalogue.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <Link href={`/catalogues/${catalogueId}`} style={{ textDecoration: 'none' }}>
      <div
        style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden', cursor: 'pointer', transition: 'box-shadow .15s' }}
        onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 4px 20px rgba(0,0,0,0.08)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'none'; }}
      >
        <div style={{ height: 180, background: BG_COLORS[idx % BG_COLORS.length], position: 'relative', overflow: 'hidden' }}>
          <CoverImage catalogueId={catalogueId} jobs={jobs} />
          {hasActive && <div className="av-cat-pulse" />}
          {jobs.length > 1 && (
            <div className="av-cat-count">{completedCount}/{jobs.length}</div>
          )}
        </div>
        <div style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: 'var(--mute)', display: 'flex' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
          </span>
          <span style={{ fontSize: 13, color: 'var(--mute)' }}>{jobs.length}</span>
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>#{catalogueId.slice(0, 8)}</span>
          <span style={{ fontSize: 12, color: 'var(--mute)', marginLeft: 'auto' }}>{dateStr}</span>
        </div>
      </div>
    </Link>
  );
}

function groupByDate(catalogues: Catalogue[]): Record<string, Catalogue[]> {
  return catalogues.reduce<Record<string, Catalogue[]>>((acc, cat) => {
    const d = new Date(cat.createdAt);
    const label = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
    (acc[label] = acc[label] || []).push(cat);
    return acc;
  }, {});
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

  const groups = catalogues ? groupByDate(catalogues) : {};

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      {/* TopBar */}
      <div className="av-topbar">
        <div>
          <div className="av-topbar-title">Your Catalogues</div>
          <div className="av-topbar-sub">View, manage, and download your previously generated catalogue images.</div>
        </div>
        <Link href="/tryon" className="av-btn-grad" style={{ gap: 8, textDecoration: 'none' }}>
          <SparkleIcon /> Create Catalogue
        </Link>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 28px' }}>
        {/* Search bar */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ position: 'relative', maxWidth: 320 }}>
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--mute)', display: 'flex' }}>
              <SearchIcon />
            </span>
            <input
              placeholder="Search Catalogues"
              style={{
                width: '100%', paddingLeft: 34, height: 38, borderRadius: 8,
                border: '1px solid var(--line)', fontFamily: 'inherit', fontSize: 13,
                outline: 'none', background: 'var(--surface)',
              }}
            />
          </div>
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

        {/* Date-grouped grid */}
        {Object.entries(groups).map(([date, items]) => (
          <div key={date} className="av-cat-date-group">
            <div className="av-cat-date-label">{date}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
              {items.map((cat, i) => <CatalogueCard key={cat.catalogueId} catalogue={cat} idx={i} />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
