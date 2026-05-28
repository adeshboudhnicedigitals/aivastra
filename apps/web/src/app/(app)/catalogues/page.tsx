'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import {
  ChevronDown,
  DownloadIcon,
  GridIcon,
  SearchIcon,
  SparkleIcon,
  SpinnerIcon,
} from '@/components/icons';
import { BG_TINTS, C } from '@/components/tokens';
import { TopBar } from '@/components/topbar';
import { GradBtn } from '@/components/ui/grad-btn';
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

function Cover({ jobs }: { jobs: JobSummary[] }) {
  const completed = jobs.find((j) => j.status === 'COMPLETED');
  const hasActive = jobs.some((j) => !TERMINAL.includes(j.status));
  const allFailed = jobs.length > 0 && jobs.every((j) => j.status === 'FAILED');

  const { data: result } = useQuery<{ url: string }>({
    queryKey: ['job-result', completed?.id],
    queryFn: () => api.get(`/v1/jobs/${completed!.id}/result`),
    enabled: !!completed,
    staleTime: 4 * 60 * 1000,
  });

  if (completed && result?.url) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img src={result.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
    );
  }
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        color: C.mid,
      }}
    >
      {allFailed ? (
        <span style={{ fontSize: 13 }}>Failed</span>
      ) : (
        <>
          <SpinnerIcon />
          <span style={{ fontSize: 13 }}>{hasActive ? 'Generating…' : 'Pending'}</span>
        </>
      )}
    </div>
  );
}

function groupByDate(items: Catalogue[]): Record<string, Catalogue[]> {
  return items.reduce<Record<string, Catalogue[]>>((acc, cat) => {
    const label = new Date(cat.createdAt).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    (acc[label] = acc[label] || []).push(cat);
    return acc;
  }, {});
}

export default function CataloguesPage(): React.ReactElement {
  const [search, setSearch] = useState('');

  const { data: catalogues, isLoading } = useQuery<Catalogue[]>({
    queryKey: ['catalogues'],
    queryFn: () => api.get('/v1/catalogues'),
    refetchInterval: (query) => {
      const d = query.state.data;
      if (!d) return false;
      return d.some((c) => c.jobs.some((j) => !TERMINAL.includes(j.status))) ? 3000 : false;
    },
  });

  const filtered = (catalogues ?? []).filter((c) =>
    c.catalogueId.toLowerCase().includes(search.toLowerCase()),
  );
  const groups = groupByDate(filtered);

  return (
    <>
      <TopBar
        title="Your Catalogues"
        subtitle="View, manage, and download your previously generated catalogue images."
        right={
          <Link href="/studio" style={{ textDecoration: 'none' }}>
            <GradBtn style={{ gap: 8 }}>
              <SparkleIcon /> Create Catalogue
            </GradBtn>
          </Link>
        }
      />
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 28px' }}>
        <div
          style={{
            display: 'flex',
            gap: 12,
            alignItems: 'center',
            marginBottom: 20,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ position: 'relative', flex: 1, minWidth: 200, maxWidth: 320 }}>
            <span
              style={{
                position: 'absolute',
                left: 10,
                top: '50%',
                transform: 'translateY(-50%)',
                color: C.mid,
              }}
            >
              <SearchIcon />
            </span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search Catalogues"
              style={{
                width: '100%',
                paddingLeft: 34,
                height: 38,
                borderRadius: 8,
                border: `1px solid ${C.border2}`,
                fontFamily: 'inherit',
                fontSize: 13,
                outline: 'none',
                background: C.white,
              }}
            />
          </div>
          {['All Segments', 'All Platforms', 'Date'].map((f) => (
            <button
              key={f}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 14px',
                borderRadius: 8,
                border: `1px solid ${C.border2}`,
                background: C.white,
                fontFamily: 'inherit',
                fontSize: 13,
                cursor: 'pointer',
                color: C.text,
              }}
            >
              {f} <ChevronDown />
            </button>
          ))}
        </div>

        {isLoading && (
          <div
            style={{ display: 'flex', justifyContent: 'center', padding: '64px 0', color: C.mid }}
          >
            <SpinnerIcon />
          </div>
        )}

        {!isLoading && filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: '64px 24px', color: C.mid }}>
            <p style={{ fontWeight: 700, fontSize: 18, color: C.text, marginBottom: 8 }}>
              No catalogues yet
            </p>
            <p style={{ fontSize: 14, marginBottom: 24 }}>
              Generate your first AI catalogue to get started.
            </p>
            <Link href="/studio" style={{ textDecoration: 'none', display: 'inline-block' }}>
              <GradBtn>Get started</GradBtn>
            </Link>
          </div>
        )}

        {Object.entries(groups).map(([date, items]) => (
          <div key={date} style={{ marginBottom: 28 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: C.mid,
                marginBottom: 16,
                paddingBottom: 8,
                borderBottom: `1px solid ${C.border}`,
              }}
            >
              {date}
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
                gap: 16,
              }}
            >
              {items.map((cat, i) => {
                const completedCount = cat.jobs.filter((j) => j.status === 'COMPLETED').length;
                return (
                  <Link
                    key={cat.catalogueId}
                    href={`/catalogues/${cat.catalogueId}`}
                    style={{ textDecoration: 'none' }}
                  >
                    <div
                      style={{
                        background: C.white,
                        border: `1px solid ${C.border}`,
                        borderRadius: 12,
                        overflow: 'hidden',
                        cursor: 'pointer',
                        transition: 'box-shadow .15s',
                      }}
                      onMouseOver={(e) => {
                        e.currentTarget.style.boxShadow = '0 4px 20px rgba(0,0,0,0.08)';
                      }}
                      onMouseOut={(e) => {
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                    >
                      <div
                        style={{
                          height: 180,
                          background: BG_TINTS[i % BG_TINTS.length],
                          position: 'relative',
                          overflow: 'hidden',
                        }}
                      >
                        <Cover jobs={cat.jobs} />
                      </div>
                      <div
                        style={{
                          padding: '12px 14px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                        }}
                      >
                        <span style={{ color: C.mid, display: 'flex' }}>
                          <GridIcon />
                        </span>
                        <span style={{ fontSize: 13, color: C.mid }}>{cat.jobs.length}</span>
                        <span style={{ fontSize: 13, fontWeight: 500, color: C.text }}>
                          #{cat.catalogueId.slice(0, 8)}
                        </span>
                        <span style={{ fontSize: 12, color: C.mid, marginLeft: 'auto' }}>
                          {completedCount}/{cat.jobs.length}
                        </span>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
