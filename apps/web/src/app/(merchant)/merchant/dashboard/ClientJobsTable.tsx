'use client';
import { useEffect, useState } from 'react';
import { C } from '@/components/tokens';

interface JobRow {
  id: string;
  status: string;
  creditsCharged: number;
  createdAt: string;
  completedAt: string | null;
}

export function ClientJobsTable({ token }: { token: string }) {
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
    fetch(`${API_URL}/v1/merchant/jobs`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((d: { jobs: JobRow[] }) => setJobs(d.jobs ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  const formatDate = (d: string) => new Date(d).toLocaleDateString();

  if (loading) return <p style={{ color: 'var(--c-mid)', fontSize: 13 }}>Loading…</p>;
  if (!jobs.length) return <p style={{ color: 'var(--c-mid)', fontSize: 13 }}>No jobs yet.</p>;

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th
            style={{
              textAlign: 'left',
              padding: '8px 12px',
              borderBottom: '1px solid var(--c-border)',
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--c-mid)',
              textTransform: 'uppercase',
            }}
          >
            Date
          </th>
          <th
            style={{
              textAlign: 'left',
              padding: '8px 12px',
              borderBottom: '1px solid var(--c-border)',
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--c-mid)',
              textTransform: 'uppercase',
            }}
          >
            Status
          </th>
          <th
            style={{
              textAlign: 'left',
              padding: '8px 12px',
              borderBottom: '1px solid var(--c-border)',
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--c-mid)',
              textTransform: 'uppercase',
            }}
          >
            Credits Used
          </th>
        </tr>
      </thead>
      <tbody>
        {jobs.map((j) => (
          <tr key={j.id}>
            <td
              style={{
                padding: '10px 12px',
                borderBottom: '1px solid var(--c-border)',
                fontSize: 13,
                color: 'var(--c-text)',
              }}
            >
              {formatDate(j.createdAt)}
            </td>
            <td
              style={{
                padding: '10px 12px',
                borderBottom: '1px solid var(--c-border)',
                fontSize: 13,
              }}
            >
              <span
                style={{
                  display: 'inline-block',
                  padding: '2px 8px',
                  borderRadius: 10,
                  fontSize: 11,
                  fontWeight: 600,
                  background:
                    j.status === 'COMPLETED'
                      ? 'rgba(0,180,100,0.08)'
                      : j.status === 'FAILED'
                        ? 'rgba(210,36,74,0.08)'
                        : 'rgba(100,100,240,0.08)',
                  color:
                    j.status === 'COMPLETED'
                      ? '#00a860'
                      : j.status === 'FAILED'
                        ? '#D0244A'
                        : '#6464f0',
                }}
              >
                {j.status}
              </span>
            </td>
            <td
              style={{
                padding: '10px 12px',
                borderBottom: '1px solid var(--c-border)',
                fontSize: 13,
                color: 'var(--c-text)',
              }}
            >
              {j.creditsCharged}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
