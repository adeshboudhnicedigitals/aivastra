'use client';

import { useQuery } from '@tanstack/react-query';

import { C } from '@/components/tokens';
import { api } from '@/lib/api';

export type CatalogueResponse = Array<{
  catalogueId: string;
  jobs: Array<{ id: string; status: string }>;
}>;

// Shared by CataloguePickerModal (picking a source from past catalogue jobs),
// SourcePanel (previewing an already-selected existing-job source), and
// ConfigPanel (the Review step's source thumbnail).
//
// `/v1/catalogues` only carries one cover thumbnail per catalogue (correct for
// the catalogue grid, which shows one card per catalogue) — a catalogue with
// several completed pose jobs has no per-job thumbnail there. Fetch each job's
// own thumbnail directly, same as the catalogue detail page's ImageCard, so
// every option in this picker shows its own generated image instead of all
// jobs from one catalogue displaying that catalogue's single cover photo.
export function JobThumbnail({ jobId, alt }: { jobId: string; alt: string }): React.ReactElement {
  const { data } = useQuery<{ url: string }>({
    queryKey: ['job-thumb', jobId],
    queryFn: () => api.get(`/v1/jobs/${jobId}/thumbnail`),
    staleTime: 55 * 60 * 1000,
  });

  if (!data?.url) {
    return <span style={{ color: C.mid, fontSize: 12 }}>Image unavailable</span>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    // biome-ignore lint/performance/noImgElement: presigned R2 URL
    <img src={data.url} alt={alt} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
  );
}
