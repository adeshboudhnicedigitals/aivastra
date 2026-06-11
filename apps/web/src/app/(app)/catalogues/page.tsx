'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarDaysIcon,
  CheckSquareIcon,
  ChevronDown,
  DownloadIcon,
  ImagesIcon,
  MinusSquareIcon,
  SearchIcon,
  ShoppingBagIcon,
  SparkleIcon,
  SpinnerIcon,
  SquareIcon,
  UserRoundIcon,
  XIcon,
} from '@/components/icons';
import { C } from '@/components/tokens';
import { TopBar } from '@/components/topbar';
import { GradBtn } from '@/components/ui/grad-btn';
import { Tooltip } from '@/components/ui/tooltip';
import { useJobStream } from '@/hooks/use-job-stream';
import { api } from '@/lib/api';

// ─── types ────────────────────────────────────────────────────────────────────

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
  genderSlug: string | null;
  coverUrl: string | null;
  coverThumbUrl: string | null;
}

// ─── constants (outside component — stable references) ────────────────────────

const TERMINAL = ['COMPLETED', 'FAILED', 'CANCELLED'];
const GENDERS = ['All Segments', 'Women', 'Men', 'Boy', 'Girl'];
const GENDER_MAP: Record<string, string> = {
  Women: 'women',
  Men: 'men',
  Boy: 'boys',
  Girl: 'girls',
};

// ─── concurrency pool (pure utility) ─────────────────────────────────────────

async function concurrentPool<T>(
  fns: Array<() => Promise<T>>,
  concurrency: number,
): Promise<PromiseSettledResult<T>[]> {
  // idx++ is captured synchronously before each await — safe in single-threaded JS
  const results: PromiseSettledResult<T>[] = [];
  let i = 0;
  async function worker() {
    while (i < fns.length) {
      const idx = i++;
      const fn = fns[idx];
      if (!fn) continue;
      try {
        results[idx] = { status: 'fulfilled', value: await fn() };
      } catch (reason) {
        results[idx] = { status: 'rejected', reason };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, fns.length) }, worker));
  return results;
}

// ─── catalogue cover ──────────────────────────────────────────────────────────

function Cover({
  jobs,
  coverUrl,
  coverThumbUrl,
}: {
  jobs: JobSummary[];
  coverUrl: string | null;
  coverThumbUrl: string | null;
}) {
  const hasActive = jobs.some((j) => !TERMINAL.includes(j.status));
  const allFailed = jobs.length > 0 && jobs.every((j) => j.status === 'FAILED');

  const displayUrl = coverThumbUrl ?? coverUrl;
  if (displayUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={displayUrl}
        alt=""
        style={{ width: '100%', height: '100%', objectFit: 'contain', objectPosition: 'center' }}
      />
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

// ─── date grouping ────────────────────────────────────────────────────────────

function groupByDate(items: Catalogue[]): Record<string, Catalogue[]> {
  return items.reduce<Record<string, Catalogue[]>>((acc, cat) => {
    const label = new Date(cat.createdAt).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    if (!acc[label]) acc[label] = [];
    acc[label].push(cat);
    return acc;
  }, {});
}

// ─── date label helper ────────────────────────────────────────────────────────

function dateLabel(filter: string, from: string, to: string): string {
  if (filter !== 'Custom Range' || (!from && !to)) return filter;
  const fmt = (s: string) =>
    new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  if (from && to) return `${fmt(from)} – ${fmt(to)}`;
  if (from) return `From ${fmt(from)}`;
  return `Until ${fmt(to)}`;
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function CataloguesPage(): React.ReactElement {
  // filter state
  const [search, setSearch] = useState('');
  const [genderFilter, setGenderFilter] = useState('All Segments');
  const [showGenderDropdown, setShowGenderDropdown] = useState(false);
  const [platformFilter, setPlatformFilter] = useState('All Platforms');
  const [showPlatformDropdown, setShowPlatformDropdown] = useState(false);
  const [dateFilter, setDateFilter] = useState('Date');
  const [showDateDropdown, setShowDateDropdown] = useState(false);
  const [dateSubPanel, setDateSubPanel] = useState<'presets' | 'custom'>('presets');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  // draft values — uncommitted until user clicks Apply
  const [pendingFrom, setPendingFrom] = useState('');
  const [pendingTo, setPendingTo] = useState('');

  // selection state
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // download state
  const [downloading, setDownloading] = useState(false);
  const [zipProgress, setZipProgress] = useState<number | null>(null);
  const [toast, setToast] = useState<{
    message: string;
    type: 'success' | 'warning' | 'error';
  } | null>(null);

  // refs
  const genderRef = useRef<HTMLDivElement>(null);
  const platformRef = useRef<HTMLDivElement>(null);
  const dateRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const filteredRef = useRef<Catalogue[]>([]);
  const downloadingRef = useRef(false);

  const qc = useQueryClient();

  // query
  const { data: catalogues, isLoading } = useQuery<Catalogue[]>({
    queryKey: ['catalogues'],
    queryFn: () => api.get('/v1/catalogues'),
    // Long-interval fallback in case SSE drops. Real-time updates come from useJobStream below.
    refetchInterval: 5 * 60 * 1000,
  });

  useJobStream(
    useCallback(
      (evt) => {
        qc.setQueryData<Catalogue[]>(['catalogues'], (old) => {
          if (!old) return old;
          const updated = old.map((cat) => {
            const jobIdx = cat.jobs.findIndex((j) => j.id === evt.jobId);
            if (jobIdx === -1) return cat;
            const prevStatus = cat.jobs[jobIdx]?.status;
            const updatedJobs = cat.jobs.map((j) =>
              j.id === evt.jobId ? { ...j, status: evt.status } : j,
            );
            const justCompleted = evt.status === 'COMPLETED' && prevStatus !== 'COMPLETED';
            if (justCompleted) {
              // Refetch to get the server-presigned coverUrl for this catalogue
              setTimeout(() => qc.invalidateQueries({ queryKey: ['catalogues'] }), 0);
            }
            return { ...cat, jobs: updatedJobs };
          });
          return updated;
        });
        // Also keep the detail view in sync if it's mounted
        qc.setQueryData<{ catalogueId: string; jobs: { id: string; status: string }[] }>(
          ['catalogue'],
          (old) => {
            if (!old) return old;
            return {
              ...old,
              jobs: old.jobs.map((j) => (j.id === evt.jobId ? { ...j, status: evt.status } : j)),
            };
          },
        );
      },
      [qc],
    ),
  );

  // ── derived state ────────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    return (catalogues ?? []).filter((c) => {
      if (!c.catalogueId.toLowerCase().includes(search.toLowerCase())) return false;

      if (genderFilter !== 'All Segments') {
        const expected = GENDER_MAP[genderFilter];
        if (c.genderSlug !== expected) return false;
      }

      const created = new Date(c.createdAt);
      const now = new Date();

      if (dateFilter === 'Today') {
        return (
          created.getFullYear() === now.getFullYear() &&
          created.getMonth() === now.getMonth() &&
          created.getDate() === now.getDate()
        );
      }
      if (dateFilter === 'Last 7 Days') {
        const cutoff = new Date(now);
        cutoff.setDate(cutoff.getDate() - 7);
        return created >= cutoff;
      }
      if (dateFilter === 'Last 15 Days') {
        const cutoff = new Date(now);
        cutoff.setDate(cutoff.getDate() - 15);
        return created >= cutoff;
      }
      if (dateFilter === 'Last 30 Days') {
        const cutoff = new Date(now);
        cutoff.setDate(cutoff.getDate() - 30);
        return created >= cutoff;
      }
      if (dateFilter === 'Custom Range') {
        if (customFrom) {
          const from = new Date(customFrom);
          from.setHours(0, 0, 0, 0);
          if (created < from) return false;
        }
        if (customTo) {
          const to = new Date(customTo);
          to.setHours(23, 59, 59, 999);
          if (created > to) return false;
        }
      }

      return true;
    });
  }, [catalogues, search, genderFilter, dateFilter, customFrom, customTo]);

  // downloadable = selected catalogues that have at least one COMPLETED job
  const downloadableCatalogues = useMemo(
    () =>
      (catalogues ?? []).filter(
        (c) => selected.has(c.catalogueId) && c.jobs.some((j) => j.status === 'COMPLETED'),
      ),
    [catalogues, selected],
  );

  const isSelectionMode = selected.size > 0;
  const canDownload = downloadableCatalogues.length > 0 && !downloading;
  const allVisibleSelected =
    filtered.length > 0 && filtered.every((c) => selected.has(c.catalogueId));
  const someVisibleSelected = filtered.some((c) => selected.has(c.catalogueId));
  const isPartial = someVisibleSelected && !allVisibleSelected;

  const groups = groupByDate(filtered);

  // ── sync refs ────────────────────────────────────────────────────────────────

  filteredRef.current = filtered;
  downloadingRef.current = downloading;

  // ── effects ──────────────────────────────────────────────────────────────────

  // click-outside to close dropdowns
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (genderRef.current && !genderRef.current.contains(e.target as Node))
        setShowGenderDropdown(false);
      if (platformRef.current && !platformRef.current.contains(e.target as Node))
        setShowPlatformDropdown(false);
      if (dateRef.current && !dateRef.current.contains(e.target as Node)) {
        setShowDateDropdown(false);
        setDateSubPanel('presets');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // keyboard: Escape = clear selection, Ctrl/Cmd+A = select all visible
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (document.activeElement as HTMLElement | null)?.tagName ?? '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (downloadingRef.current) return;

      if (e.key === 'Escape') {
        setSelected(new Set());
        setLastSelectedId(null);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
        e.preventDefault();
        setSelected((prev) => new Set([...prev, ...filteredRef.current.map((c) => c.catalogueId)]));
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []); // stable: reads current values via refs

  // abort on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // auto-dismiss toast
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // ── selection handlers ───────────────────────────────────────────────────────

  function toggleCard(catalogueId: string, shiftKey: boolean) {
    if (shiftKey && lastSelectedId !== null) {
      const visibleIds = filteredRef.current.map((c) => c.catalogueId);
      const lastIdx = visibleIds.indexOf(lastSelectedId);
      const currentIdx = visibleIds.indexOf(catalogueId);
      if (lastIdx !== -1 && currentIdx !== -1) {
        const from = Math.min(lastIdx, currentIdx);
        const to = Math.max(lastIdx, currentIdx);
        const range = visibleIds.slice(from, to + 1);
        setSelected((prev) => new Set([...prev, ...range]));
        setLastSelectedId(catalogueId);
        return;
      }
    }
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(catalogueId)) next.delete(catalogueId);
      else next.add(catalogueId);
      return next;
    });
    setLastSelectedId(catalogueId);
  }

  function handleSelectAll() {
    if (allVisibleSelected) {
      // deselect all visible (additive cross-filter: only removes visible items)
      setSelected((prev) => {
        const next = new Set(prev);
        for (const c of filtered) next.delete(c.catalogueId);
        return next;
      });
    } else {
      // add all visible (additive: keeps cross-filter selections)
      setSelected((prev) => new Set([...prev, ...filtered.map((c) => c.catalogueId)]));
    }
  }

  function clearSelection() {
    setSelected(new Set());
    setLastSelectedId(null);
  }

  // ── download ─────────────────────────────────────────────────────────────────

  async function handleDownload() {
    if (!canDownload) return;

    const abort = new AbortController();
    abortRef.current = abort;

    // Freeze snapshot at click time — state/query mutations during download don't affect the ZIP
    const snapshotCatalogues = [...downloadableCatalogues];

    setDownloading(true);
    setZipProgress(0);
    setToast(null);

    try {
      // Phase 1: fetch presigned URLs (fast API calls — no abort signal needed)
      const completedJobs = snapshotCatalogues.flatMap((cat) =>
        cat.jobs
          .filter((j) => j.status === 'COMPLETED')
          .map((j) => ({ catalogueId: cat.catalogueId, jobId: j.id })),
      );

      const urlResults = await Promise.allSettled(
        completedJobs.map(({ catalogueId, jobId }) =>
          api
            .get<{ url: string; expiresIn: number }>(`/v1/jobs/${jobId}/result`)
            .then((res) => ({ catalogueId, url: res.url, jobId })),
        ),
      );

      if (abort.signal.aborted) return;

      const validEntries = urlResults
        .filter(
          (r): r is PromiseFulfilledResult<{ catalogueId: string; url: string; jobId: string }> =>
            r.status === 'fulfilled',
        )
        .map((r) => r.value);

      if (validEntries.length === 0) {
        setToast({ message: 'No images could be retrieved.', type: 'error' });
        return;
      }

      // Phase 2: blob fetches with concurrency=5 + abort signal
      const total = validEntries.length;
      let done = 0;

      const blobResults = await concurrentPool(
        validEntries.map(({ catalogueId, url }) => async () => {
          const res = await fetch(url, { signal: abort.signal });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const blob = await res.blob();
          done++;
          if (!abort.signal.aborted) {
            setZipProgress(Math.max(5, (done / total) * 70));
          }
          return { catalogueId, blob };
        }),
        5,
      );

      if (abort.signal.aborted) return;

      const succeeded = blobResults
        .filter(
          (r): r is PromiseFulfilledResult<{ catalogueId: string; blob: Blob }> =>
            r.status === 'fulfilled',
        )
        .map((r) => r.value);

      if (succeeded.length === 0) {
        setToast({ message: 'Selected catalogues have no downloadable images.', type: 'error' });
        return;
      }

      // Phase 3: build ZIP — UUIDs are filesystem-safe, no sanitization needed
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();

      const byCat = new Map<string, Array<{ blob: Blob }>>();
      for (const item of succeeded) {
        const existing = byCat.get(item.catalogueId);
        if (!existing) {
          byCat.set(item.catalogueId, [{ blob: item.blob }]);
        } else {
          existing.push({ blob: item.blob });
        }
      }

      for (const [catalogueId, items] of byCat.entries()) {
        const folder = zip.folder(catalogueId.slice(0, 8));
        items.forEach((item, idx) => {
          folder?.file(`image-${idx + 1}.jpg`, item.blob);
        });
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' }, (meta: { percent: number }) => {
        if (!abort.signal.aborted) {
          setZipProgress(70 + meta.percent * 0.3);
        }
      });

      if (abort.signal.aborted) return;

      // Trigger download — delay revoke for Firefox compatibility
      const date = new Date().toISOString().slice(0, 10);
      const objectUrl = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = `aivastra-catalogues-${date}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(objectUrl), 100);

      // Toast
      const totalImages = succeeded.length;
      const totalCats = byCat.size;
      const skipped = total - succeeded.length;
      if (skipped > 0) {
        setToast({
          message: `Downloaded ${totalImages} of ${total} images from ${totalCats} catalogue${totalCats !== 1 ? 's' : ''}. ${skipped} could not be retrieved.`,
          type: 'warning',
        });
      } else {
        setToast({
          message: `Downloaded ${totalImages} image${totalImages !== 1 ? 's' : ''} from ${totalCats} catalogue${totalCats !== 1 ? 's' : ''}.`,
          type: 'success',
        });
      }
    } catch (err) {
      // Abort is intentional cancellation — silently exit, no toast
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setToast({ message: 'Download failed. Please try again.', type: 'error' });
    } finally {
      setDownloading(false);
      setZipProgress(null);
      abortRef.current = null;
    }
  }

  // ── render ───────────────────────────────────────────────────────────────────

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

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 28px' }}>
        {/* ── sticky toolbar ── */}
        <div
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 20,
            background: 'rgba(255,255,255,0.97)',
            boxShadow: '0 1px 0 #EEEEEE',
            margin: '0 -28px',
            padding: '16px 28px',
          }}
        >
          <div
            style={{
              display: 'flex',
              width: '100%',
              height: 40,
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            {/* search — always visible */}
            <div style={{ position: 'relative', width: 240 }}>
              <span
                style={{
                  position: 'absolute',
                  left: 12,
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
                  height: 40,
                  padding: '10px 12px 10px 36px',
                  borderRadius: 8,
                  border: '1px solid #EEEEEE',
                  fontFamily: 'inherit',
                  fontSize: 13,
                  outline: 'none',
                  background: '#F9F9F9',
                }}
              />
            </div>

            {/* right side — transforms in selection mode */}
            {isSelectionMode ? (
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                {/* selection count + clear */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    height: 40,
                    padding: '0 12px',
                    borderRadius: 8,
                    border: '1px solid #EEEEEE',
                    background: '#FEFEFE',
                    fontSize: 13,
                    fontWeight: 500,
                    color: C.text,
                  }}
                >
                  <span>{selected.size} selected</span>
                  <Tooltip tip={downloading ? 'Download in progress' : undefined} position="top">
                    <button
                      type="button"
                      onClick={clearSelection}
                      disabled={downloading}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 18,
                        height: 18,
                        borderRadius: 4,
                        border: 'none',
                        background: 'none',
                        cursor: downloading ? 'not-allowed' : 'pointer',
                        color: C.mid,
                        padding: 0,
                      }}
                    >
                      <XIcon size={14} />
                    </button>
                  </Tooltip>
                </div>

                {/* select-all (indeterminate-aware) */}
                <Tooltip
                  tip={
                    downloading
                      ? 'Download in progress'
                      : filtered.length === 0
                        ? 'No catalogues to select'
                        : undefined
                  }
                  position="top"
                >
                  <button
                    type="button"
                    onClick={handleSelectAll}
                    disabled={downloading || filtered.length === 0}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '0 14px',
                      height: 40,
                      borderRadius: 8,
                      border: '1px solid #EEEEEE',
                      background: '#FEFEFE',
                      fontFamily: 'inherit',
                      fontSize: 13,
                      fontWeight: 500,
                      cursor: downloading || filtered.length === 0 ? 'not-allowed' : 'pointer',
                      color: C.mid,
                      opacity: downloading ? 0.5 : 1,
                    }}
                  >
                    {allVisibleSelected ? (
                      <CheckSquareIcon size={16} />
                    ) : isPartial ? (
                      <MinusSquareIcon size={16} />
                    ) : (
                      <SquareIcon size={16} />
                    )}
                    {allVisibleSelected ? 'Deselect All' : 'Select All'}
                  </button>
                </Tooltip>

                {/* download button */}
                <Tooltip
                  tip={
                    downloading
                      ? 'Download in progress'
                      : !canDownload
                        ? 'Select completed catalogues to download'
                        : undefined
                  }
                  position="top"
                >
                  <button
                    type="button"
                    onClick={handleDownload}
                    disabled={!canDownload}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      height: 40,
                      padding: '0 16px',
                      borderRadius: 12,
                      background: canDownload ? '#141414' : '#141414',
                      opacity: canDownload ? 1 : 0.4,
                      border: 'none',
                      cursor: canDownload ? 'pointer' : 'not-allowed',
                      color: '#FFFFFF',
                      fontSize: 13,
                      fontWeight: 500,
                      fontFamily: 'inherit',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {downloading ? <SpinnerIcon size={16} /> : <DownloadIcon size={16} />}
                    {downloading
                      ? zipProgress !== null
                        ? `${Math.round(zipProgress)}%`
                        : 'Preparing…'
                      : `Download (${downloadableCatalogues.length})`}
                  </button>
                </Tooltip>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 12 }}>
                {/* gender filter */}
                <div style={{ position: 'relative' }} ref={genderRef}>
                  <button
                    onClick={() => setShowGenderDropdown(!showGenderDropdown)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 10,
                      padding: 10,
                      width: 162,
                      height: 40,
                      borderRadius: 8,
                      border: '1px solid #EEEEEE',
                      background: '#FEFEFE',
                      fontFamily: 'inherit',
                      fontSize: 13,
                      fontWeight: 500,
                      cursor: 'pointer',
                      color: C.mid,
                      boxSizing: 'border-box',
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <UserRoundIcon size={16} />
                      {genderFilter}
                    </span>
                    <span style={{ display: 'flex' }}>
                      <ChevronDown size={16} />
                    </span>
                  </button>
                  {showGenderDropdown && (
                    <div
                      style={{
                        position: 'absolute',
                        top: 44,
                        left: 0,
                        width: 162,
                        background: '#FEFEFE',
                        border: '1px solid #EEEEEE',
                        borderRadius: 8,
                        boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
                        zIndex: 30,
                        overflow: 'hidden',
                      }}
                    >
                      {GENDERS.map((g) => (
                        <div
                          key={g}
                          onClick={() => {
                            setGenderFilter(g);
                            setShowGenderDropdown(false);
                          }}
                          style={{
                            padding: '10px 12px',
                            fontSize: 13,
                            fontWeight: 500,
                            color: genderFilter === g ? C.pink : C.mid,
                            cursor: 'pointer',
                            background:
                              genderFilter === g ? 'rgba(245,92,122,0.06)' : 'transparent',
                          }}
                        >
                          {g}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* platform filter */}
                <div style={{ position: 'relative' }} ref={platformRef}>
                  <button
                    onClick={() => setShowPlatformDropdown(!showPlatformDropdown)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 10,
                      padding: 10,
                      width: 158,
                      height: 40,
                      borderRadius: 8,
                      border: '1px solid #EEEEEE',
                      background: '#FEFEFE',
                      fontFamily: 'inherit',
                      fontSize: 13,
                      fontWeight: 500,
                      cursor: 'pointer',
                      color: C.mid,
                      boxSizing: 'border-box',
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <ShoppingBagIcon size={16} />
                      {platformFilter}
                    </span>
                    <span style={{ display: 'flex' }}>
                      <ChevronDown size={16} />
                    </span>
                  </button>
                  {showPlatformDropdown && (
                    <div
                      style={{
                        position: 'absolute',
                        top: 44,
                        left: 0,
                        width: 158,
                        background: '#FEFEFE',
                        border: '1px solid #EEEEEE',
                        borderRadius: 8,
                        boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
                        zIndex: 30,
                        overflow: 'hidden',
                      }}
                    >
                      {['All Platforms', 'Amazon', 'Myntra', 'Flipkart', 'Meesho', 'Shopify'].map(
                        (p) => (
                          <div
                            key={p}
                            onClick={() => {
                              setPlatformFilter(p);
                              setShowPlatformDropdown(false);
                            }}
                            style={{
                              padding: '10px 12px',
                              fontSize: 13,
                              fontWeight: 500,
                              color: platformFilter === p ? C.pink : C.mid,
                              cursor: 'pointer',
                              background:
                                platformFilter === p ? 'rgba(245,92,122,0.06)' : 'transparent',
                            }}
                          >
                            {p}
                          </div>
                        ),
                      )}
                    </div>
                  )}
                </div>

                {/* date filter */}
                <div style={{ position: 'relative' }} ref={dateRef}>
                  <button
                    onClick={() => {
                      if (!showDateDropdown) {
                        setDateSubPanel('presets');
                      }
                      setShowDateDropdown(!showDateDropdown);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 10,
                      padding: 10,
                      height: 40,
                      borderRadius: 8,
                      border: `1px solid ${dateFilter !== 'Date' ? C.pink : '#EEEEEE'}`,
                      background: dateFilter !== 'Date' ? 'rgba(245,92,122,0.04)' : '#FEFEFE',
                      fontFamily: 'inherit',
                      fontSize: 13,
                      fontWeight: 500,
                      cursor: 'pointer',
                      color: dateFilter !== 'Date' ? C.pink : C.mid,
                      boxSizing: 'border-box',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <CalendarDaysIcon size={16} />
                      {dateLabel(dateFilter, customFrom, customTo)}
                    </span>
                    <span style={{ display: 'flex' }}>
                      <ChevronDown size={16} />
                    </span>
                  </button>

                  {showDateDropdown && (
                    <div
                      style={{
                        position: 'absolute',
                        top: 44,
                        left: 0,
                        width: 220,
                        background: '#FEFEFE',
                        border: '1px solid #EEEEEE',
                        borderRadius: 8,
                        boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
                        zIndex: 30,
                        overflow: 'hidden',
                      }}
                    >
                      {dateSubPanel === 'presets' ? (
                        <>
                          {['Today', 'Last 7 Days', 'Last 15 Days', 'Last 30 Days'].map((d) => (
                            <div
                              key={d}
                              onClick={() => {
                                setDateFilter(d);
                                setCustomFrom('');
                                setCustomTo('');
                                setShowDateDropdown(false);
                                setDateSubPanel('presets');
                              }}
                              style={{
                                padding: '10px 12px',
                                fontSize: 13,
                                fontWeight: 500,
                                color: dateFilter === d ? C.pink : C.mid,
                                cursor: 'pointer',
                                background:
                                  dateFilter === d ? 'rgba(245,92,122,0.06)' : 'transparent',
                              }}
                            >
                              {d}
                            </div>
                          ))}
                          {/* Custom Range — opens sub-panel, does not close dropdown */}
                          <div
                            onClick={() => {
                              setPendingFrom(customFrom);
                              setPendingTo(customTo);
                              setDateSubPanel('custom');
                            }}
                            style={{
                              padding: '10px 12px',
                              fontSize: 13,
                              fontWeight: 500,
                              color: dateFilter === 'Custom Range' ? C.pink : C.mid,
                              cursor: 'pointer',
                              background:
                                dateFilter === 'Custom Range'
                                  ? 'rgba(245,92,122,0.06)'
                                  : 'transparent',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                            }}
                          >
                            Custom Range
                            <svg
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              aria-hidden="true"
                            >
                              <path d="M9 18l6-6-6-6" />
                            </svg>
                          </div>
                          {/* Clear active filter */}
                          {dateFilter !== 'Date' && (
                            <div
                              onClick={() => {
                                setDateFilter('Date');
                                setCustomFrom('');
                                setCustomTo('');
                                setShowDateDropdown(false);
                              }}
                              style={{
                                padding: '10px 12px',
                                fontSize: 12,
                                fontWeight: 500,
                                color: C.light,
                                cursor: 'pointer',
                                borderTop: `1px solid #F4F4F4`,
                              }}
                            >
                              Clear filter
                            </div>
                          )}
                        </>
                      ) : (
                        /* custom range sub-panel */
                        <div style={{ padding: 12 }}>
                          {/* back header */}
                          <button
                            type="button"
                            onClick={() => setDateSubPanel('presets')}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                              background: 'none',
                              border: 'none',
                              padding: '0 0 10px',
                              cursor: 'pointer',
                              fontSize: 12,
                              fontWeight: 600,
                              color: C.mid,
                              fontFamily: 'inherit',
                              width: '100%',
                              borderBottom: `1px solid #F4F4F4`,
                              marginBottom: 12,
                            }}
                          >
                            <svg
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              aria-hidden="true"
                            >
                              <path d="M15 18l-6-6 6-6" />
                            </svg>
                            Custom Range
                          </button>

                          {/* From */}
                          <label
                            style={{
                              display: 'block',
                              fontSize: 11,
                              fontWeight: 600,
                              color: C.light,
                              marginBottom: 4,
                              letterSpacing: '0.04em',
                              textTransform: 'uppercase',
                            }}
                          >
                            From
                          </label>
                          <input
                            type="date"
                            value={pendingFrom}
                            max={pendingTo || undefined}
                            onChange={(e) => setPendingFrom(e.target.value)}
                            style={{
                              width: '100%',
                              height: 34,
                              padding: '0 8px',
                              borderRadius: 6,
                              border: '1px solid #EEEEEE',
                              fontFamily: 'inherit',
                              fontSize: 13,
                              color: C.text,
                              background: '#F9F9F9',
                              outline: 'none',
                              boxSizing: 'border-box',
                              marginBottom: 10,
                            }}
                          />

                          {/* To */}
                          <label
                            style={{
                              display: 'block',
                              fontSize: 11,
                              fontWeight: 600,
                              color: C.light,
                              marginBottom: 4,
                              letterSpacing: '0.04em',
                              textTransform: 'uppercase',
                            }}
                          >
                            To
                          </label>
                          <input
                            type="date"
                            value={pendingTo}
                            min={pendingFrom || undefined}
                            onChange={(e) => setPendingTo(e.target.value)}
                            style={{
                              width: '100%',
                              height: 34,
                              padding: '0 8px',
                              borderRadius: 6,
                              border: '1px solid #EEEEEE',
                              fontFamily: 'inherit',
                              fontSize: 13,
                              color: C.text,
                              background: '#F9F9F9',
                              outline: 'none',
                              boxSizing: 'border-box',
                              marginBottom: 14,
                            }}
                          />

                          {/* actions */}
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button
                              type="button"
                              onClick={() => {
                                setPendingFrom('');
                                setPendingTo('');
                              }}
                              style={{
                                flex: 1,
                                height: 32,
                                borderRadius: 6,
                                border: '1px solid #EEEEEE',
                                background: 'none',
                                fontFamily: 'inherit',
                                fontSize: 12,
                                fontWeight: 500,
                                color: C.mid,
                                cursor: 'pointer',
                              }}
                            >
                              Clear
                            </button>
                            <Tooltip
                              tip={
                                !pendingFrom && !pendingTo ? 'Select at least one date' : undefined
                              }
                              position="top"
                            >
                              <button
                                type="button"
                                disabled={!pendingFrom && !pendingTo}
                                onClick={() => {
                                  setDateFilter('Custom Range');
                                  setCustomFrom(pendingFrom);
                                  setCustomTo(pendingTo);
                                  setShowDateDropdown(false);
                                  setDateSubPanel('presets');
                                }}
                                style={{
                                  flex: 2,
                                  height: 32,
                                  borderRadius: 6,
                                  border: 'none',
                                  background: pendingFrom || pendingTo ? '#141414' : '#EEEEEE',
                                  fontFamily: 'inherit',
                                  fontSize: 12,
                                  fontWeight: 600,
                                  color: pendingFrom || pendingTo ? '#fff' : C.light,
                                  cursor: pendingFrom || pendingTo ? 'pointer' : 'not-allowed',
                                }}
                              >
                                Apply
                              </button>
                            </Tooltip>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* select all (normal mode) */}
                <Tooltip
                  tip={filtered.length === 0 ? 'No catalogues to select' : undefined}
                  position="top"
                >
                  <button
                    type="button"
                    onClick={handleSelectAll}
                    disabled={filtered.length === 0}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      padding: 10,
                      width: 118,
                      height: 40,
                      borderRadius: 8,
                      border: '1px solid #EEEEEE',
                      background: '#FEFEFE',
                      fontFamily: 'inherit',
                      fontSize: 13,
                      fontWeight: 500,
                      cursor: filtered.length === 0 ? 'not-allowed' : 'pointer',
                      color: C.mid,
                      opacity: filtered.length === 0 ? 0.4 : 1,
                      boxSizing: 'border-box',
                    }}
                  >
                    <SquareIcon size={16} />
                    Select All
                  </button>
                </Tooltip>

                {/* download (inactive in normal mode) */}
                <Tooltip tip="Select images to download" position="top">
                  <button
                    type="button"
                    disabled
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 56,
                      height: 40,
                      padding: '12px 20px',
                      borderRadius: 12,
                      background: '#141414',
                      opacity: 0.4,
                      border: 'none',
                      cursor: 'not-allowed',
                      color: '#FFFFFF',
                      boxSizing: 'border-box',
                    }}
                  >
                    <DownloadIcon size={16} />
                  </button>
                </Tooltip>
              </div>
            )}
          </div>

          {/* download progress bar */}
          {zipProgress !== null && (
            <div
              style={{
                height: 3,
                background: '#EEEEEE',
                borderRadius: 2,
                overflow: 'hidden',
                marginTop: 10,
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${zipProgress}%`,
                  background: 'linear-gradient(90deg, var(--c-pink), var(--c-amber))',
                  transition: 'width 200ms ease',
                  borderRadius: 2,
                }}
              />
            </div>
          )}
        </div>
        {/* ── end sticky toolbar ── */}

        <div style={{ paddingTop: 20 }}>
          {isLoading && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                padding: '64px 0',
                color: C.mid,
              }}
            >
              <SpinnerIcon />
            </div>
          )}

          {!isLoading && filtered.length === 0 && (
            <div style={{ textAlign: 'center', padding: '64px 24px', color: C.mid }}>
              {dateFilter !== 'Date' || genderFilter !== 'All Segments' || search ? (
                <>
                  <p style={{ fontWeight: 700, fontSize: 18, color: C.text, marginBottom: 8 }}>
                    No catalogues match your filters
                  </p>
                  <p style={{ fontSize: 14 }}>Try adjusting the filters or search term.</p>
                </>
              ) : (
                <>
                  <p style={{ fontWeight: 700, fontSize: 18, color: C.text, marginBottom: 8 }}>
                    No catalogues yet
                  </p>
                  <p style={{ fontSize: 14, marginBottom: 24 }}>
                    Generate your first AI catalogue to get started.
                  </p>
                  <Link href="/studio" style={{ textDecoration: 'none', display: 'inline-block' }}>
                    <GradBtn>Get started</GradBtn>
                  </Link>
                </>
              )}
            </div>
          )}

          {Object.entries(groups).map(([date, items]) => (
            <div key={date} style={{ marginBottom: 28 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  height: 20,
                  marginBottom: 16,
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 600, color: C.mid, whiteSpace: 'nowrap' }}>
                  {date}
                </span>
                <div style={{ flex: 1, height: 1, background: C.border }} />
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, 370px)',
                  gap: 8,
                  width: '100%',
                }}
              >
                {items.map((cat) => {
                  const isSelected = selected.has(cat.catalogueId);
                  const showCheckbox = isSelectionMode || hoveredId === cat.catalogueId;

                  const cardContent = (
                    <div
                      key={cat.catalogueId}
                      style={{
                        width: 370,
                        height: 376,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                        pointerEvents: downloading ? 'none' : 'auto',
                      }}
                    >
                      {/* image area */}
                      <div
                        style={{
                          flex: 1,
                          background: C.lighter,
                          position: 'relative',
                          overflow: 'hidden',
                          borderRadius: 8,
                          cursor: 'pointer',
                          border: isSelected ? `2px solid ${C.pink}` : '2px solid transparent',
                          boxSizing: 'border-box',
                        }}
                        onMouseEnter={() => {
                          setHoveredId(cat.catalogueId);
                          qc.prefetchQuery({
                            queryKey: ['catalogue', cat.catalogueId],
                            queryFn: () => api.get(`/v1/catalogues/${cat.catalogueId}`),
                          });
                        }}
                        onMouseLeave={() => setHoveredId(null)}
                        onMouseOver={(e) => {
                          if (!isSelectionMode) {
                            e.currentTarget.style.boxShadow = '0 4px 24px rgba(0,0,0,0.12)';
                            const child = e.currentTarget.querySelector(
                              '[data-scale]',
                            ) as HTMLElement | null;
                            if (child) child.style.transform = 'scale(1.05)';
                          }
                        }}
                        onMouseOut={(e) => {
                          if (!isSelectionMode) {
                            e.currentTarget.style.boxShadow = 'none';
                            const child = e.currentTarget.querySelector(
                              '[data-scale]',
                            ) as HTMLElement | null;
                            if (child) child.style.transform = 'scale(1)';
                          }
                        }}
                      >
                        {/* checkbox */}
                        {showCheckbox && (
                          <div
                            onClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              toggleCard(cat.catalogueId, e.shiftKey);
                            }}
                            style={{
                              position: 'absolute',
                              top: 8,
                              left: 8,
                              zIndex: 5,
                              width: 20,
                              height: 20,
                              borderRadius: 5,
                              background: isSelected ? C.pink : 'rgba(255,255,255,0.92)',
                              border: `2px solid ${isSelected ? C.pink : 'rgba(0,0,0,0.18)'}`,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              cursor: 'pointer',
                              boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
                              flexShrink: 0,
                            }}
                          >
                            {isSelected && (
                              <svg
                                width="10"
                                height="8"
                                viewBox="0 0 10 8"
                                fill="none"
                                aria-hidden="true"
                              >
                                <path
                                  d="M1 4l2.5 2.5L9 1"
                                  stroke="white"
                                  strokeWidth="1.5"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                            )}
                          </div>
                        )}

                        {/* selection tint */}
                        {isSelected && (
                          <div
                            style={{
                              position: 'absolute',
                              inset: 0,
                              background: 'rgba(245,92,122,0.07)',
                              zIndex: 1,
                              pointerEvents: 'none',
                            }}
                          />
                        )}

                        <div
                          data-scale=""
                          style={{ width: '100%', height: '100%', transition: 'transform .3s' }}
                        >
                          <Cover
                            jobs={cat.jobs}
                            coverUrl={cat.coverUrl}
                            coverThumbUrl={cat.coverThumbUrl}
                          />
                        </div>
                      </div>

                      {/* metadata row */}
                      <div
                        style={{
                          height: 16,
                          padding: '0 14px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                        }}
                      >
                        <span style={{ color: C.mid, display: 'flex' }}>
                          <ImagesIcon size={16} />
                        </span>
                        <span style={{ fontSize: 13, color: C.mid }}>{cat.jobs.length}</span>
                        <span style={{ fontSize: 13, fontWeight: 500, color: C.text }}>
                          #{cat.catalogueId.slice(0, 8)}
                        </span>
                      </div>
                    </div>
                  );

                  return isSelectionMode ? (
                    <button
                      key={cat.catalogueId}
                      type="button"
                      onClick={(e) => toggleCard(cat.catalogueId, e.shiftKey)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') toggleCard(cat.catalogueId, false);
                      }}
                      style={{
                        cursor: 'pointer',
                        outline: 'none',
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        display: 'block',
                        textAlign: 'left',
                      }}
                    >
                      {cardContent}
                    </button>
                  ) : (
                    <Link
                      key={cat.catalogueId}
                      href={`/catalogues/${cat.catalogueId}`}
                      style={{ textDecoration: 'none' }}
                    >
                      {cardContent}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── toast ── */}
      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: 28,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 1000,
            background:
              toast.type === 'success' ? '#141414' : toast.type === 'warning' ? '#8B5C00' : C.pink,
            color: '#fff',
            padding: '10px 20px',
            borderRadius: 10,
            fontSize: 13,
            fontWeight: 500,
            boxShadow: '0 4px 24px rgba(0,0,0,0.18)',
            maxWidth: 480,
            textAlign: 'center',
            whiteSpace: 'pre-wrap',
          }}
        >
          {toast.message}
        </div>
      )}
    </>
  );
}
