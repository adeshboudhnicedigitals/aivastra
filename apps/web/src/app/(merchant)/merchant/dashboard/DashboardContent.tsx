'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { MerchantData } from '../../lib';

interface JobRow {
  id: string;
  status: string;
  creditsCharged: number;
  createdAt: string;
}

const card: React.CSSProperties = {
  background: 'var(--c-white)',
  borderRadius: 14,
  border: '1px solid var(--c-merchant-border)',
  padding: '24px',
  boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
};

const statLabel: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--c-merchant-text-placeholder)',
  textTransform: 'uppercase',
  letterSpacing: '0.07em',
  margin: '0 0 10px',
};

export function DashboardContent({ data }: { data: MerchantData }) {
  const [jobCount, setJobCount] = useState(0);
  const [activeJobs, setActiveJobs] = useState(0);
  const [recentJobs, setRecentJobs] = useState<JobRow[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch('/api/merchant/jobs')
      .then((r) => (r.ok ? r.json() : { jobs: [] }))
      .then((d: { jobs: JobRow[] }) => {
        const jobs = d.jobs ?? [];
        setJobCount(jobs.length);
        setActiveJobs(
          jobs.filter((j) =>
            ['QUEUED', 'PREPROCESSING', 'GENERATING', 'UPLOADING'].includes(j.status),
          ).length,
        );
        setRecentJobs(jobs.slice(0, 5));
      })
      .catch(() => {});
  }, []);

  const embedCode = `<script>
  window.AIVASTRA_WIDGET = { widget_key: "${data.widgetKey}" };
</script>
<script src="https://app.aivastra.com/widget/loader.js"></script>`;

  function copy(text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <>
      {/* ── Page header ── */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--c-text)', margin: '0 0 4px' }}>
          Welcome back, {data.contactName} 👋
        </h1>
        <p style={{ fontSize: 14, color: 'var(--c-merchant-text-placeholder)', margin: 0 }}>
          Here&apos;s an overview of your try-on widget activity.
        </p>
      </div>

      {/* ── Stats ── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 16,
          marginBottom: 24,
        }}
      >
        {[
          {
            label: 'Total Try-Ons',
            value: jobCount,
            sub: 'All time',
            icon: '🎯',
            color: 'var(--c-merchant-accent)',
          },
          {
            label: 'Active Jobs',
            value: activeJobs,
            sub: 'Running now',
            icon: '⚡',
            color: 'var(--c-merchant-warning)',
          },
          {
            label: 'Credits Remaining',
            value: data.creditBalance ?? 0,
            sub: '10 credits / try-on',
            icon: '💳',
            color: 'var(--c-merchant-success)',
          },
          {
            label: 'Widget Status',
            value: data.isActive ? 'Active' : 'Inactive',
            sub: `AI Model ${data.isActive ? 'Online' : 'Offline'}`,
            icon: data.isActive ? '✅' : '⚠️',
            color: data.isActive ? 'var(--c-merchant-success)' : 'var(--c-merchant-danger)',
          },
        ].map(({ label, value, sub, icon, color }) => (
          <div key={label} style={card}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                marginBottom: 14,
              }}
            >
              <p style={statLabel}>{label}</p>
              <span style={{ fontSize: 20 }}>{icon}</span>
            </div>
            <div
              style={{
                fontSize: typeof value === 'string' ? 20 : 28,
                fontWeight: 700,
                color,
                lineHeight: 1,
                marginBottom: 8,
              }}
            >
              {value}
            </div>
            <p style={{ fontSize: 12, color: 'var(--c-merchant-text-placeholder)', margin: 0 }}>
              {sub}
            </p>
          </div>
        ))}
      </div>

      {/* ── Two-column ── */}
      <div
        style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20, alignItems: 'start' }}
      >
        {/* Left */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Installation card */}
          <div style={card}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 16,
              }}
            >
              <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--c-text)', margin: 0 }}>
                Installation &amp; Widget Configuration
              </h3>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'var(--c-merchant-accent)',
                  background: 'var(--c-merchant-accent-tint)',
                  padding: '3px 10px',
                  borderRadius: 20,
                }}
              >
                v2.0 Stable
              </span>
            </div>
            <p
              style={{
                fontSize: 13,
                color: 'var(--c-merchant-text-placeholder)',
                margin: '0 0 14px',
                lineHeight: 1.6,
              }}
            >
              Paste this before the{' '}
              <code
                style={{
                  background: 'var(--c-merchant-hover)',
                  padding: '1px 6px',
                  borderRadius: 4,
                  fontSize: 12,
                  color: 'var(--c-merchant-text-secondary)',
                }}
              >
                &lt;/body&gt;
              </code>{' '}
              tag on your website.
            </p>
            <pre
              style={{
                background: 'var(--c-merchant-code-bg)',
                border: '1px solid var(--c-merchant-border)',
                borderRadius: 10,
                padding: '14px 18px',
                fontSize: 12.5,
                fontFamily: 'monospace',
                color: 'var(--c-merchant-text-secondary)',
                overflow: 'auto',
                margin: '0 0 14px',
                lineHeight: 1.7,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {embedCode}
            </pre>
            <button
              type="button"
              onClick={() => copy(embedCode)}
              style={{
                padding: '9px 20px',
                borderRadius: 8,
                border: 'none',
                background: 'var(--c-merchant-accent)',
                color: 'var(--c-white)',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {copied ? '✓ Copied!' : 'Copy Code'}
            </button>
          </div>

          {/* Quick links */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            {[
              {
                emoji: '📄',
                label: 'Documentation',
                desc: 'Integration guides & API reference',
                href: '/merchant/documentation',
              },
              {
                emoji: '🔑',
                label: 'API Keys',
                desc: 'View your widget embed code',
                href: '/merchant/api-keys',
              },
            ].map(({ emoji, label, desc, href }) => (
              <Link
                key={href}
                href={href}
                style={{
                  ...card,
                  textDecoration: 'none',
                  display: 'block',
                  transition: 'box-shadow 0.15s',
                }}
              >
                <p style={{ fontSize: 20, margin: '0 0 10px' }}>{emoji}</p>
                <p
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: 'var(--c-text)',
                    margin: '0 0 4px',
                  }}
                >
                  {label}
                </p>
                <p
                  style={{
                    fontSize: 12,
                    color: 'var(--c-merchant-text-placeholder)',
                    margin: 0,
                    lineHeight: 1.5,
                  }}
                >
                  {desc}
                </p>
              </Link>
            ))}
          </div>
        </div>

        {/* Right */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Service Details */}
          <div style={card}>
            <h3
              style={{ fontSize: 15, fontWeight: 600, color: 'var(--c-text)', margin: '0 0 18px' }}
            >
              Service Details
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {[
                {
                  label: 'Widget Key',
                  value: (
                    <code
                      style={{
                        fontSize: 11,
                        color: 'var(--c-merchant-text-muted)',
                        wordBreak: 'break-all',
                        lineHeight: 1.6,
                      }}
                    >
                      {data.widgetKey}
                    </code>
                  ),
                },
                {
                  label: 'Status',
                  value: (
                    <span
                      style={{
                        display: 'inline-block',
                        fontSize: 12,
                        fontWeight: 600,
                        padding: '3px 12px',
                        borderRadius: 20,
                        color: data.isActive
                          ? 'var(--c-merchant-success)'
                          : 'var(--c-merchant-danger)',
                        background: data.isActive
                          ? 'var(--c-merchant-success-tint)'
                          : 'var(--c-merchant-danger-tint)',
                      }}
                    >
                      {data.isActive ? 'Active' : 'Inactive'}
                    </span>
                  ),
                },
                {
                  label: 'Domain',
                  value: (
                    <span style={{ fontSize: 13, color: 'var(--c-merchant-text-secondary)' }}>
                      {data.websiteUrl || '—'}
                    </span>
                  ),
                },
                {
                  label: 'Plan',
                  value: (
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: 'var(--c-merchant-accent)',
                        background: 'var(--c-merchant-accent-tint)',
                        padding: '3px 10px',
                        borderRadius: 20,
                      }}
                    >
                      Free Trial
                    </span>
                  ),
                },
              ].map(({ label, value }) => (
                <div key={label}>
                  <p style={{ ...statLabel, marginBottom: 5 }}>{label}</p>
                  {value}
                </div>
              ))}
            </div>
          </div>

          {/* Upgrade CTA */}
          <Link
            href="/merchant/pricing"
            style={{
              display: 'block',
              background: 'linear-gradient(135deg,#7c5cfc,#c44dfa)',
              borderRadius: 14,
              padding: '18px 22px',
              textDecoration: 'none',
              boxShadow: '0 4px 16px rgba(124,92,252,0.25)',
            }}
          >
            <p
              style={{ fontSize: 14, fontWeight: 700, color: 'var(--c-white)', margin: '0 0 3px' }}
            >
              Upgrade to Pro Plan
            </p>
            <p style={{ fontSize: 12, color: 'var(--c-white)', margin: 0 }}>
              More credits &amp; priority support →
            </p>
          </Link>

          {/* Live Feed */}
          <div style={card}>
            <h3
              style={{ fontSize: 15, fontWeight: 600, color: 'var(--c-text)', margin: '0 0 14px' }}
            >
              Live Feed
            </h3>
            {recentJobs.length === 0 ? (
              <p
                style={{
                  fontSize: 13,
                  color: 'var(--c-merchant-text-placeholder)',
                  margin: 0,
                  textAlign: 'center',
                  padding: '12px 0',
                }}
              >
                No recent activity.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {recentJobs.map((j) => (
                  <div key={j.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        flexShrink: 0,
                        background:
                          j.status === 'COMPLETED'
                            ? 'var(--c-merchant-success)'
                            : j.status === 'FAILED'
                              ? 'var(--c-merchant-danger)'
                              : 'var(--c-merchant-accent)',
                      }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p
                        style={{
                          fontSize: 12,
                          fontWeight: 500,
                          color: 'var(--c-merchant-text-secondary)',
                          margin: 0,
                        }}
                      >
                        {j.status === 'COMPLETED'
                          ? 'Successful Try-On'
                          : j.status === 'FAILED'
                            ? 'Failed Try-On'
                            : 'Processing…'}
                      </p>
                      <p
                        style={{
                          fontSize: 11,
                          color: 'var(--c-merchant-text-placeholder)',
                          margin: 0,
                        }}
                      >
                        {new Date(j.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <span
                      style={{
                        fontSize: 11,
                        color: 'var(--c-merchant-text-placeholder)',
                        flexShrink: 0,
                      }}
                    >
                      {j.creditsCharged} cr
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
