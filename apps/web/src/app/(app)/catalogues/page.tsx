'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState, useRef, useEffect } from 'react';
import {
  ChevronDown,
  DownloadIcon,
  ImagesIcon,
  SearchIcon,
  SparkleIcon,
  SpinnerIcon,
  UserRoundIcon,
  ShoppingBagIcon,
  CalendarDaysIcon,
  SquareIcon,
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
  const [genderFilter, setGenderFilter] = useState('All Segments');
  const [showGenderDropdown, setShowGenderDropdown] = useState(false);
  const [platformFilter, setPlatformFilter] = useState('All Platforms');
  const [showPlatformDropdown, setShowPlatformDropdown] = useState(false);
  const [dateFilter, setDateFilter] = useState('Date');
  const [showDateDropdown, setShowDateDropdown] = useState(false);
  const genderRef = useRef<HTMLDivElement>(null);
  const platformRef = useRef<HTMLDivElement>(null);
  const dateRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (genderRef.current && !genderRef.current.contains(e.target as Node)) {
        setShowGenderDropdown(false);
      }
      if (platformRef.current && !platformRef.current.contains(e.target as Node)) {
        setShowPlatformDropdown(false);
      }
      if (dateRef.current && !dateRef.current.contains(e.target as Node)) {
        setShowDateDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const GENDERS = ['All Segments', 'Women', 'Men', 'Boy', 'Girl'];

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
        <div style={{ display: 'flex', width: '100%', height: 40, justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ position: 'relative', width: 240 }}>
            <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: C.mid }}><SearchIcon /></span>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search Catalogues" style={{ width: '100%', height: 40, padding: '10px 12px 10px 36px', borderRadius: 8, border: '1px solid #EEEEEE', fontFamily: 'inherit', fontSize: 13, outline: 'none', background: '#F9F9F9' }} />
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ position: 'relative' }} ref={genderRef}>
              <button
                onClick={() => setShowGenderDropdown(!showGenderDropdown)}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: 10, width: 162, height: 40, borderRadius: 8, border: '1px solid #EEEEEE', background: '#FEFEFE', fontFamily: 'inherit', fontSize: 13, fontWeight: 500, lineHeight: '20px', cursor: 'pointer', color: C.mid, boxSizing: 'border-box' }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}><UserRoundIcon size={16} />{genderFilter}</span>
                <span style={{ display: 'flex' }}><ChevronDown size={16} /></span>
              </button>
              {showGenderDropdown && (
                <div style={{ position: 'absolute', top: 44, left: 0, width: 162, background: '#FEFEFE', border: '1px solid #EEEEEE', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.08)', zIndex: 10, overflow: 'hidden' }}>
                  {GENDERS.map((g) => (
                    <div
                      key={g}
                      onClick={() => { setGenderFilter(g); setShowGenderDropdown(false); }}
                      style={{ padding: '10px 12px', fontSize: 13, fontWeight: 500, color: genderFilter === g ? C.pink : C.mid, cursor: 'pointer', background: genderFilter === g ? 'rgba(245,92,122,0.06)' : 'transparent' }}
                    >
                      {g}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div style={{ position: 'relative' }} ref={platformRef}>
              <button
                onClick={() => setShowPlatformDropdown(!showPlatformDropdown)}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: 10, width: 158, height: 40, borderRadius: 8, border: '1px solid #EEEEEE', background: '#FEFEFE', fontFamily: 'inherit', fontSize: 13, fontWeight: 500, lineHeight: '20px', cursor: 'pointer', color: C.mid, boxSizing: 'border-box' }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}><ShoppingBagIcon size={16} />{platformFilter}</span>
                <span style={{ display: 'flex' }}><ChevronDown size={16} /></span>
              </button>
              {showPlatformDropdown && (
                <div style={{ position: 'absolute', top: 44, left: 0, width: 158, background: '#FEFEFE', border: '1px solid #EEEEEE', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.08)', zIndex: 10, overflow: 'hidden' }}>
                  {['All Platforms', 'Amazon', 'Myntra', 'Flipkart', 'Meesho', 'Shopify'].map((p) => (
                    <div
                      key={p}
                      onClick={() => { setPlatformFilter(p); setShowPlatformDropdown(false); }}
                      style={{ padding: '10px 12px', fontSize: 13, fontWeight: 500, color: platformFilter === p ? C.pink : C.mid, cursor: 'pointer', background: platformFilter === p ? 'rgba(245,92,122,0.06)' : 'transparent' }}
                    >
                      {p}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div style={{ position: 'relative' }} ref={dateRef}>
              <button
                onClick={() => setShowDateDropdown(!showDateDropdown)}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: 10, height: 40, borderRadius: 8, border: '1px solid #EEEEEE', background: '#FEFEFE', fontFamily: 'inherit', fontSize: 13, fontWeight: 500, lineHeight: '20px', cursor: 'pointer', color: C.mid, boxSizing: 'border-box', whiteSpace: 'nowrap' }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}><CalendarDaysIcon size={16} />{dateFilter}</span>
                <span style={{ display: 'flex' }}><ChevronDown size={16} /></span>
              </button>
              {showDateDropdown && (
                <div style={{ position: 'absolute', top: 44, left: 0, width: 160, background: '#FEFEFE', border: '1px solid #EEEEEE', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.08)', zIndex: 10, overflow: 'hidden' }}>
                  {['Today', 'Last 7 Days', 'Last 15 Days', 'Last 30 Days', 'Custom Range'].map((d) => (
                    <div
                      key={d}
                      onClick={() => { setDateFilter(d); setShowDateDropdown(false); }}
                      style={{ padding: '10px 12px', fontSize: 13, fontWeight: 500, color: dateFilter === d ? C.pink : C.mid, cursor: 'pointer', background: dateFilter === d ? 'rgba(245,92,122,0.06)' : 'transparent' }}
                    >
                      {d}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <button style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 10, width: 108, height: 40, borderRadius: 8, border: '1px solid #EEEEEE', background: '#FEFEFE', fontFamily: 'inherit', fontSize: 13, fontWeight: 500, lineHeight: '20px', cursor: 'pointer', color: C.mid, boxSizing: 'border-box' }}>
              <SquareIcon size={16} />Select All
            </button>
            <button style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 56, height: 40, padding: '12px 20px', borderRadius: 12, background: '#141414', opacity: 0.6, border: 'none', cursor: 'pointer', color: '#FFFFFF', boxSizing: 'border-box' }}>
              <DownloadIcon size={16} />
            </button>
          </div>
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', height: 20, marginBottom: 16 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: C.mid, whiteSpace: 'nowrap' }}>{date}</span>
              <div style={{ flex: 1, height: 1, background: C.border }} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, 370px)', gap: 8, width: '100%' }}>
              {items.map((cat, i) => {
                return (
                  <Link key={cat.catalogueId} href={`/catalogues/${cat.catalogueId}`} style={{ textDecoration: 'none' }}>
                    <div style={{ width: 370, height: 376, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div
                        style={{ flex: 1, background: BG_TINTS[i % BG_TINTS.length], position: 'relative', overflow: 'hidden', borderRadius: 8, cursor: 'pointer' }}
                        onMouseOver={(e) => {
                          e.currentTarget.style.boxShadow = '0 4px 24px rgba(0,0,0,0.12)';
                          (e.currentTarget.firstElementChild as HTMLElement).style.transform = 'scale(1.05)';
                        }}
                        onMouseOut={(e) => {
                          e.currentTarget.style.boxShadow = 'none';
                          (e.currentTarget.firstElementChild as HTMLElement).style.transform = 'scale(1)';
                        }}
                      >
                        <div style={{ width: '100%', height: '100%', transition: 'transform .3s' }}>
                          <Cover jobs={cat.jobs} />
                        </div>
                      </div>
                      <div style={{ height: 16, padding: '0 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ color: C.mid, display: 'flex' }}><ImagesIcon size={16} /></span>
                        <span style={{ fontSize: 13, color: C.mid }}>{cat.jobs.length}</span>
                        <span style={{ fontSize: 13, fontWeight: 500, color: C.text }}>#{cat.catalogueId.slice(0, 8)}</span>
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
