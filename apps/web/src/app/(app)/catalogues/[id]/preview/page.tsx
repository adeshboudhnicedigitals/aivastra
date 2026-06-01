'use client';
import { useQueries, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { use, useEffect, useRef, useState } from 'react';
import { ArrowLeft, MonitorIcon, SmartphoneIcon, SpinnerIcon } from '@/components/icons';
import { C } from '@/components/tokens';
import { TopBar } from '@/components/topbar';
import { api } from '@/lib/api';
import {
  AmazonDesktopTemplate,
  AmazonMobileTemplate,
  aspectToCss,
  BrowserShell,
  PhoneShell,
} from './templates';

interface Job {
  id: string;
  status: string;
  createdAt: string;
  creditsCharged: number;
}
interface CatalogueDetail {
  catalogueId: string;
  jobs: Job[];
  aspectRatio: string | null;
}

type ViewMode = 'web' | 'mobile';

export default function PreviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): React.ReactElement {
  const { id } = use(params);
  const [viewMode, setViewMode] = useState<ViewMode>('web');
  const [activeIndex, setActiveIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: catalogue, isLoading } = useQuery<CatalogueDetail>({
    queryKey: ['catalogue', id],
    queryFn: () => api.get(`/v1/catalogues/${id}`),
  });

  const completedJobs = (catalogue?.jobs ?? []).filter((j) => j.status === 'COMPLETED');

  // Fetch a FRESH presigned URL per completed job on mount — the 300s TTL means
  // we must never reuse a URL passed in via navigation state.
  const resultQueries = useQueries({
    queries: completedJobs.map((job) => ({
      queryKey: ['job-result', job.id],
      queryFn: () => api.get<{ url: string }>(`/v1/jobs/${job.id}/result`),
      staleTime: 4 * 60 * 1000,
    })),
  });

  // One slot per completed job; value is the URL or undefined while still loading.
  // Length is stable so the gallery layout never shifts.
  const imageSlots = resultQueries.map((q) => q.data?.url);
  const cssRatio = aspectToCss(catalogue?.aspectRatio);
  const hasImages = completedJobs.length > 0;
  const clampedIndex = Math.min(activeIndex, Math.max(0, imageSlots.length - 1));

  // Reset inner scroll to top whenever the device view switches.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [viewMode]);

  // Keep activeIndex valid if the gallery shrinks (e.g. a job is deleted elsewhere).
  useEffect(() => {
    if (activeIndex > 0 && activeIndex >= completedJobs.length) setActiveIndex(0);
  }, [completedJobs.length, activeIndex]);

  return (
    <>
      <TopBar
        lead={
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Link
              href={`/catalogues/${id}`}
              style={{ color: C.mid, display: 'flex', textDecoration: 'none' }}
              aria-label="Back to catalogue"
            >
              <ArrowLeft />
            </Link>
            <div>
              <div style={{ fontWeight: 700, fontSize: 18, color: C.text }}>
                Live Platform Preview
              </div>
              <div style={{ fontSize: 12, color: C.mid }}>
                See how your generated catalogue images appear on a real ecommerce platform.
              </div>
            </div>
          </div>
        }
        right={
          <div
            style={{
              display: 'flex',
              gap: 4,
              padding: 4,
              borderRadius: 12,
              border: `1px solid ${C.border}`,
              background: '#fff',
            }}
          >
            {(['web', 'mobile'] as const).map((mode) => {
              const isActive = viewMode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setViewMode(mode)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '0 16px',
                    height: 36,
                    borderRadius: 8,
                    border: 'none',
                    cursor: 'pointer',
                    background: isActive ? C.pink : 'transparent',
                    color: isActive ? '#fff' : C.mid,
                    fontFamily: 'inherit',
                    fontSize: 14,
                    fontWeight: 500,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {mode === 'web' ? <MonitorIcon size={16} /> : <SmartphoneIcon size={16} />}
                  {mode === 'web' ? 'Web View' : 'Mobile View'}
                </button>
              );
            })}
          </div>
        }
      />

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          background: '#fafafa',
          padding: '32px 28px',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'flex-start',
        }}
      >
        {isLoading && (
          <div
            style={{ display: 'flex', justifyContent: 'center', padding: '64px 0', color: C.mid }}
          >
            <SpinnerIcon />
          </div>
        )}

        {!isLoading && !hasImages && (
          <div style={{ textAlign: 'center', padding: '64px 24px', color: C.mid }}>
            <p style={{ fontWeight: 700, fontSize: 18, color: C.text, marginBottom: 8 }}>
              Nothing to preview yet
            </p>
            <p style={{ fontSize: 14, marginBottom: 24 }}>
              This catalogue has no completed images. Once generation finishes, you can preview them
              here.
            </p>
            <Link
              href={`/catalogues/${id}`}
              style={{ fontSize: 14, color: C.pink, textDecoration: 'none', fontWeight: 600 }}
            >
              ← Back to catalogue
            </Link>
          </div>
        )}

        {!isLoading &&
          hasImages &&
          (viewMode === 'web' ? (
            <BrowserShell scrollRef={scrollRef}>
              <AmazonDesktopTemplate
                images={imageSlots}
                activeIndex={clampedIndex}
                onActiveChange={setActiveIndex}
                ratio={cssRatio}
              />
            </BrowserShell>
          ) : (
            <PhoneShell scrollRef={scrollRef}>
              <AmazonMobileTemplate
                images={imageSlots}
                activeIndex={clampedIndex}
                onActiveChange={setActiveIndex}
                ratio={cssRatio}
              />
            </PhoneShell>
          ))}
      </div>
    </>
  );
}
