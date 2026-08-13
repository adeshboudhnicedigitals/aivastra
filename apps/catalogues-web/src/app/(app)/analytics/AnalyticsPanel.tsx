'use client';

import { useQuery } from '@tanstack/react-query';
import { BarChart3, ImageIcon } from 'lucide-react';
import { C } from '@/components/tokens';
import { getMerchantAnalytics } from './api';

// "not a merchant account" / "merchant account inactive" — thrown by requireMerchant
// (apps/api/src/plugins/portal-auth.ts) when the logged-in user has no merchants row.
// Same pattern as developers/KeysPanel.tsx and developers/UsagePanel.tsx.
function isMerchantGateError(err: unknown): boolean {
  return err instanceof Error && /merchant account/i.test(err.message);
}

const fmtDate = (s: string) =>
  new Date(s).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

function StatCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        padding: '20px 22px',
        flex: '1 1 160px',
        minWidth: 160,
      }}
    >
      <p
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: C.mid,
          margin: '0 0 8px',
          textTransform: 'uppercase',
          letterSpacing: '0.4px',
        }}
      >
        {label}
      </p>
      <p style={{ fontSize: 28, fontWeight: 700, color: accent ?? C.text, margin: 0 }}>{value}</p>
    </div>
  );
}

export function AnalyticsPanel() {
  const query = useQuery({ queryKey: ['merchant-analytics'], queryFn: getMerchantAnalytics });
  const merchantGated = isMerchantGateError(query.error);

  if (merchantGated) {
    return (
      <div
        style={{
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          padding: '48px 24px',
          textAlign: 'center',
          color: C.light,
          fontSize: 14,
        }}
      >
        This account isn't enabled as a merchant yet. Contact support to get analytics access
        activated.
      </div>
    );
  }

  if (query.isLoading) {
    return (
      <div style={{ padding: '48px 0', textAlign: 'center', color: C.light, fontSize: 14 }}>
        Loading analytics...
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <div style={{ padding: '48px 0', textAlign: 'center', color: C.pink, fontSize: 14 }}>
        {(query.error as Error)?.message ?? 'Failed to load analytics'}
      </div>
    );
  }

  const { totalJobs, completedJobs, failedJobs, successRate, totalCreditsCharged, recentOutputs } =
    query.data;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
        <StatCard label="Total Jobs" value={String(totalJobs)} />
        <StatCard label="Completed" value={String(completedJobs)} accent={C.mint} />
        <StatCard
          label="Failed"
          value={String(failedJobs)}
          accent={failedJobs > 0 ? C.pink : undefined}
        />
        <StatCard
          label="Success Rate"
          value={successRate === null ? '—' : `${Math.round(successRate * 100)}%`}
        />
        <StatCard label="Credits Spent" value={String(totalCreditsCharged)} />
      </div>

      <div
        style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          padding: 24,
        }}
      >
        <div style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: C.text, margin: 0 }}>
            Recent Outputs
          </h3>
          <p style={{ fontSize: 13, color: C.mid, margin: '4px 0 0' }}>
            Your most recently completed generations.
          </p>
        </div>

        {recentOutputs.length === 0 ? (
          <div
            style={{
              padding: '40px 0',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <div style={{ color: C.pink, opacity: 0.8 }}>
              <ImageIcon size={36} />
            </div>
            <p style={{ fontSize: 14, color: C.light, margin: 0 }}>
              No completed generations yet. Outputs will show up here once your first job finishes.
            </p>
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
              gap: 14,
            }}
          >
            {recentOutputs.map((o) => (
              <div key={o.jobId} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div
                  style={{
                    aspectRatio: '1',
                    borderRadius: 10,
                    overflow: 'hidden',
                    border: `1px solid ${C.border}`,
                    background: C.field,
                  }}
                >
                  {/* biome-ignore lint/performance/noImgElement: presigned URL, no next/image benefit for a short-lived signed image */}
                  <img
                    src={o.thumbnailUrl}
                    alt=""
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                </div>
                <span style={{ fontSize: 11.5, color: C.mid }}>{fmtDate(o.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {totalJobs === 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            color: C.mid,
            fontSize: 13,
          }}
        >
          <BarChart3 size={16} />
          Stats will fill in once you start generating.
        </div>
      )}
    </div>
  );
}
