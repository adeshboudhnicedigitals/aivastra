'use client';
import { useEffect, useState } from 'react';

interface Job {
  id: string;
  status: string;
  creditsCharged: number;
  createdAt: string;
  completedAt: string | null;
}

const STATUS: Record<string, { bg: string; color: string; label: string }> = {
  COMPLETED: {
    bg: 'var(--c-merchant-success-tint)',
    color: 'var(--c-merchant-success)',
    label: 'Completed',
  },
  FAILED: {
    bg: 'var(--c-merchant-danger-tint)',
    color: 'var(--c-merchant-danger)',
    label: 'Failed',
  },
  QUEUED: {
    bg: 'var(--c-merchant-accent-tint)',
    color: 'var(--c-merchant-accent)',
    label: 'Queued',
  },
  GENERATING: {
    bg: 'var(--c-merchant-warning-tint)',
    color: 'var(--c-merchant-warning)',
    label: 'Generating',
  },
  PREPROCESSING: {
    bg: 'var(--c-merchant-warning-tint)',
    color: 'var(--c-merchant-warning)',
    label: 'Preparing',
  },
  UPLOADING: {
    bg: 'var(--c-merchant-warning-tint)',
    color: 'var(--c-merchant-warning)',
    label: 'Uploading',
  },
  CANCELLED: {
    bg: 'var(--c-merchant-muted-tint)',
    color: 'var(--c-merchant-text-placeholder)',
    label: 'Cancelled',
  },
};

function fmt(d: string) {
  return new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function TryOnResultsContent() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch('/api/merchant/jobs')
      .then((r) => {
        if (!r.ok) throw new Error('failed');
        return r.json();
      })
      .then((d: { jobs: Job[] }) => setJobs(d.jobs ?? []))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  const th: React.CSSProperties = {
    textAlign: 'left',
    padding: '12px 16px',
    fontSize: 11,
    fontWeight: 700,
    color: 'var(--c-merchant-text-placeholder)',
    textTransform: 'uppercase',
    letterSpacing: '0.07em',
    borderBottom: '1px solid var(--c-merchant-border)',
    whiteSpace: 'nowrap',
    background: 'var(--c-merchant-code-bg)',
  };

  const td: React.CSSProperties = {
    padding: '14px 16px',
    fontSize: 13,
    color: 'var(--c-merchant-text-secondary)',
    borderBottom: '1px solid var(--c-merchant-hover)',
    verticalAlign: 'middle',
  };

  return (
    <>
      <div
        style={{
          marginBottom: 28,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--c-text)', margin: '0 0 4px' }}>
            Try-On Results
          </h1>
          <p style={{ fontSize: 14, color: 'var(--c-merchant-text-placeholder)', margin: 0 }}>
            {loading ? 'Loading…' : `${jobs.length} result${jobs.length !== 1 ? 's' : ''}`}
          </p>
        </div>
      </div>

      <div
        style={{
          background: 'var(--c-white)',
          borderRadius: 14,
          border: '1px solid var(--c-merchant-border)',
          overflow: 'hidden',
          boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['#', 'Job ID', 'Status', 'Duration', 'Credits', 'Created', 'Completed'].map((h) => (
                <th key={h} style={th}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={7}
                  style={{
                    ...td,
                    textAlign: 'center',
                    color: 'var(--c-merchant-text-placeholder)',
                    padding: '48px 16px',
                  }}
                >
                  Loading…
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td colSpan={7} style={{ ...td, textAlign: 'center', padding: '56px 16px' }}>
                  <p
                    style={{
                      fontSize: 15,
                      color: 'var(--c-merchant-danger)',
                      fontWeight: 600,
                      margin: '0 0 6px',
                    }}
                  >
                    Couldn&apos;t load results
                  </p>
                  <p
                    style={{ fontSize: 13, color: 'var(--c-merchant-text-placeholder)', margin: 0 }}
                  >
                    Please refresh the page or try again later.
                  </p>
                </td>
              </tr>
            ) : jobs.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ ...td, textAlign: 'center', padding: '56px 16px' }}>
                  <p
                    style={{
                      fontSize: 15,
                      color: 'var(--c-merchant-text-secondary)',
                      fontWeight: 600,
                      margin: '0 0 6px',
                    }}
                  >
                    No records found
                  </p>
                  <p
                    style={{ fontSize: 13, color: 'var(--c-merchant-text-placeholder)', margin: 0 }}
                  >
                    Try-on results will appear here once jobs are processed.
                  </p>
                </td>
              </tr>
            ) : (
              jobs.map((j, i) => {
                const s = STATUS[j.status] ?? {
                  bg: 'var(--c-merchant-hover)',
                  color: 'var(--c-merchant-text-placeholder)',
                  label: j.status,
                };
                const diffMs = j.completedAt
                  ? new Date(j.completedAt).getTime() - new Date(j.createdAt).getTime()
                  : null;
                const diffStr = diffMs != null ? `${(diffMs / 1000).toFixed(1)}s` : '—';

                return (
                  <tr key={j.id}>
                    <td
                      style={{
                        ...td,
                        color: 'var(--c-merchant-text-placeholder)',
                        fontWeight: 500,
                      }}
                    >
                      {i + 1}
                    </td>
                    <td
                      style={{
                        ...td,
                        fontFamily: 'monospace',
                        fontSize: 12,
                        color: 'var(--c-merchant-text-muted)',
                      }}
                    >
                      {j.id.slice(0, 8)}…
                    </td>
                    <td style={td}>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '3px 10px',
                          borderRadius: 20,
                          fontSize: 12,
                          fontWeight: 600,
                          background: s.bg,
                          color: s.color,
                        }}
                      >
                        {s.label}
                      </span>
                    </td>
                    <td style={{ ...td, color: 'var(--c-merchant-text-placeholder)' }}>
                      {diffStr}
                    </td>
                    <td style={td}>{j.creditsCharged}</td>
                    <td
                      style={{ ...td, color: 'var(--c-merchant-text-placeholder)', fontSize: 12 }}
                    >
                      {fmt(j.createdAt)}
                    </td>
                    <td
                      style={{ ...td, color: 'var(--c-merchant-text-placeholder)', fontSize: 12 }}
                    >
                      {j.completedAt ? fmt(j.completedAt) : '—'}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
