'use client';
import type { AdminHeldJobsReleaseResponse, AdminHeldJobsResponse } from '@aivastra/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useHq } from '@/components/hq/hq-session';
import { EmptyBox, ErrorBox, NoAccess, PageHead, td, th } from '@/components/hq/list-parts';
import { btn, Skeleton } from '@/components/hq/ui';
import { C, M } from '@/components/tokens';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { hqFetch } from '@/lib/hq-api';

// A copy of admin-web's Held batches page. Same /admin/held-jobs routes (held_jobs.manage).

const when = (v: string) =>
  new Date(v).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

export default function HeldBatchesPage() {
  const { can } = useHq();
  if (!can('held_jobs.manage')) return <NoAccess what="held batches" />;
  return <Held />;
}

function Held() {
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ['hq', 'held-jobs'],
    queryFn: () => hqFetch<AdminHeldJobsResponse>('/admin/held-jobs'),
  });
  const release = useMutation({
    mutationFn: () =>
      hqFetch<AdminHeldJobsReleaseResponse>('/admin/held-jobs/release', { method: 'POST' }),
    onSuccess: ({ released, remaining }) => {
      setConfirming(false);
      setError(null);
      const jobs = `${released} job${released === 1 ? '' : 's'}`;
      setResult(
        remaining > 0
          ? `Released ${jobs}. ${remaining} still held, so release again.`
          : `Released ${jobs} to the GPU queue.`,
      );
      void qc.invalidateQueries({ queryKey: ['hq', 'held-jobs'] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Release failed.'),
  });

  const total = q.data?.total ?? 0;

  return (
    <div>
      <PageHead
        title="Held batches"
        lede="Bulk flat-image uploads waiting for GPU time. Releasing sends every merchant's backlog to the low-priority queue at once."
      />
      <div style={{ marginBottom: 16 }}>
        <button
          type="button"
          style={{ ...btn.primary, opacity: total === 0 ? 0.5 : 1 }}
          disabled={total === 0 || release.isPending}
          onClick={() => {
            setError(null);
            setResult(null);
            setConfirming(true);
          }}
        >
          Release all ({total})
        </button>
        <div aria-live="polite" style={{ marginTop: 8, fontSize: 14, color: C.mid }}>
          {result}
        </div>
      </div>

      {q.isError ? (
        <ErrorBox what="held batches" error={q.error} onRetry={() => void q.refetch()} />
      ) : q.isPending ? (
        <div style={{ display: 'grid', gap: 10 }} aria-busy="true">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} h={48} />
          ))}
        </div>
      ) : total === 0 ? (
        <EmptyBox>Nothing is held right now.</EmptyBox>
      ) : (
        <div className="hq-card" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <caption className="sr-only">Held batches by merchant</caption>
            <thead>
              <tr style={{ color: C.mid, fontSize: 12 }}>
                <th scope="col" style={th}>
                  Merchant
                </th>
                <th scope="col" style={{ ...th, textAlign: 'right' }}>
                  Held images
                </th>
                <th scope="col" style={th}>
                  Oldest upload
                </th>
              </tr>
            </thead>
            <tbody>
              {q.data?.byUser.map((row) => (
                <tr key={row.userId ?? 'unknown'} style={{ borderTop: `1px solid ${C.border}` }}>
                  <td style={{ ...td, overflowWrap: 'anywhere' }}>{row.email ?? '(unknown)'}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{row.count.toLocaleString('en-IN')}</td>
                  <td style={td}>{when(row.oldestCreatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={confirming}
        title={`Release ${total} held image${total === 1 ? '' : 's'}?`}
        body="Every merchant's backlog goes to the low-priority GPU queue at once. This uses GPU time and cannot be undone."
        confirmLabel="Release all"
        busy={release.isPending}
        error={error}
        onConfirm={() => release.mutate()}
        onCancel={() => setConfirming(false)}
      />
      {error && !confirming && (
        <div role="alert" style={{ color: M.danger, marginTop: 10, fontSize: 14 }}>
          {error}
        </div>
      )}
    </div>
  );
}
