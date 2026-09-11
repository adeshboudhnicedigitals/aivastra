'use client';

import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import { C } from '@/components/tokens';
import { api } from '@/lib/api';

export type CatalogueResponse = Array<{
  catalogueId: string;
  jobs: Array<{ id: string; status: string; createdAt: string }>;
}>;

/**
 * Fires `onEnter` once when the ref'd element first enters the viewport
 * (plus a 200px lookahead margin), then disconnects — used below to defer a
 * thumbnail's network request until its tile is actually about to be seen,
 * rather than firing every tile's request the instant the grid mounts.
 */
function useInView<T extends Element>(): [(node: T | null) => void, boolean] {
  const [inView, setInView] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);

  // A callback ref rather than a RefObject — this same ref is attached to a
  // <div> in one render branch and an <img> in the other below, and a
  // RefObject<T> is invariant in T so TS rejects sharing one across two
  // different element types. A callback ref's parameter position is
  // contravariant, so `(node: Element | null) => void` is assignable to
  // both `Ref<HTMLDivElement>` and `Ref<HTMLImageElement>`.
  const setRef = useCallback(
    (node: T | null) => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      if (!node || inView) return;
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            setInView(true);
            observer.disconnect();
          }
        },
        { rootMargin: '200px' },
      );
      observer.observe(node);
      observerRef.current = observer;
    },
    [inView],
  );

  useEffect(() => () => observerRef.current?.disconnect(), []);

  return [setRef, inView];
}

// Shared by CataloguePickerModal (picking a source from past catalogue jobs)
// and SourcePanel (previewing an already-selected existing-job source).
//
// `/v1/catalogues` only carries one cover thumbnail per catalogue (correct for
// the catalogue grid, which shows one card per catalogue) — a catalogue with
// several completed pose jobs has no per-job thumbnail there. Fetch each job's
// own thumbnail directly, same as the catalogue detail page's ImageCard, so
// every option in this picker shows its own generated image instead of all
// jobs from one catalogue displaying that catalogue's single cover photo.
//
// The fetch itself is deferred until the tile scrolls into view (useInView)
// rather than firing on mount — one request per rendered tile, unbatched, was
// what turned a long-history account opening this grid into a burst that blew
// through the API's per-IP rate limit before the user touched anything (see
// docs/progress.md, "catalog-video rate-limit incident"). Paired with
// CataloguePickerModal's pagination, not a replacement for it — that bounds
// the total possible burst size, this bounds how much of it fires at once.
export function JobThumbnail({ jobId, alt }: { jobId: string; alt: string }): React.ReactElement {
  const [ref, inView] = useInView<Element>();
  const { data, isFetched } = useQuery<{ url: string }>({
    queryKey: ['job-thumb', jobId],
    queryFn: () => api.get(`/v1/jobs/${jobId}/thumbnail`),
    staleTime: 55 * 60 * 1000,
    enabled: inView,
  });

  if (!data?.url) {
    return (
      <div
        ref={ref}
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {isFetched && <span style={{ color: C.mid, fontSize: 12 }}>Image unavailable</span>}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    // biome-ignore lint/performance/noImgElement: presigned R2 URL
    <img
      ref={ref}
      src={data.url}
      alt={alt}
      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
    />
  );
}
