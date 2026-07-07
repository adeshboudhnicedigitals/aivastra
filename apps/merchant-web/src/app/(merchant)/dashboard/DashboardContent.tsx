'use client';

import { ArrowRight, Check, Copy } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { MerchantData } from '../../lib';

type JobRow = {
  id: string;
  status: string;
  creditsCharged: number;
  createdAt: string;
};

export function DashboardContent({ data }: { data: MerchantData }) {
  const [recentJobs, setRecentJobs] = useState<JobRow[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch('/api/merchant/jobs')
      .then((res) => (res.ok ? res.json() : { jobs: [] }))
      .then((body: { jobs?: JobRow[] }) => setRecentJobs((body.jobs ?? []).slice(0, 5)))
      .catch(() => {});
  }, []);

  const embedCode = `<script>
  window.AIVASTRA_WIDGET = { widget_key: "${data.widgetKey}" };
</script>
<script src="https://app.aivastra.com/widget/loader.js"></script>`;

  function copySnippet() {
    navigator.clipboard.writeText(embedCode).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  }

  const stats = [
    {
      label: 'Widget Status',
      value: data.isActive ? 'Active' : 'Inactive',
      sub: 'Admin managed',
      badge: data.isActive ? 'success' : 'default',
    },
    {
      label: 'Kiosk Access',
      value: data.kioskEnabled ? 'Enabled' : 'Disabled',
      sub: `${data.maxKioskDevices} device limit`,
      badge: data.kioskEnabled ? 'primary' : 'default',
    },
    {
      label: 'Linked Studio',
      value: data.userId ? 'Linked' : 'Not linked',
      sub: 'Controls catalogue imports',
      badge: data.userId ? 'primary' : 'default',
    },
    {
      label: 'Credit Balance',
      value: String(data.creditBalance ?? 0),
      sub: 'Merchant balance',
      badge: (data.creditBalance ?? 0) > 0 ? 'success' : 'warning',
    },
  ] as const;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-8)' }}>
      {/* Header */}
      <div>
        <h1
          style={{
            fontSize: '1.5rem',
            fontWeight: 600,
            color: 'hsl(var(--text-primary))',
            letterSpacing: '-0.02em',
            margin: '0 0 var(--space-2)',
          }}
        >
          Welcome back, {data.contactName}
        </h1>
        <p style={{ fontSize: '0.875rem', color: 'hsl(var(--text-secondary))', margin: 0 }}>
          Manage your widget embeds, monitor kiosk devices, and curate your private catalog.
        </p>
      </div>

      {/* Metrics Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: 'var(--space-4)',
        }}
      >
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardContent style={{ padding: 'var(--space-5)' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  marginBottom: 'var(--space-3)',
                }}
              >
                <div
                  style={{
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: 'hsl(var(--text-secondary))',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                  }}
                >
                  {stat.label}
                </div>
                <Badge variant={stat.badge}>{stat.value}</Badge>
              </div>
              <div style={{ fontSize: '0.8125rem', color: 'hsl(var(--text-tertiary))' }}>
                {stat.sub}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Main Bento Layout */}
      <div className="grid-responsive-2">
        {/* Embed Snippet */}
        <Card>
          <CardHeader
            style={{
              display: 'flex',
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
            }}
          >
            <div>
              <CardTitle>Embed Snippet</CardTitle>
              <CardDescription>
                Copy and paste this code into your website's &lt;head&gt; tag.
              </CardDescription>
            </div>
            <Button variant="secondary" size="sm" onClick={copySnippet}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </CardHeader>
          <CardContent>
            <pre
              style={{
                margin: 0,
                padding: 'var(--space-4)',
                borderRadius: 'var(--radius-md)',
                background: 'hsl(var(--bg-surface-hover))',
                border: '1px solid hsl(var(--border-default))',
                fontSize: '0.8125rem',
                lineHeight: 1.6,
                color: 'hsl(var(--text-primary))',
                overflowX: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              }}
            >
              {embedCode}
            </pre>
          </CardContent>
        </Card>

        {/* Quick Links */}
        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>Navigate to your most important workflows.</CardDescription>
          </CardHeader>
          <CardContent style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {[
              {
                href: '/catalog',
                title: 'Kiosk Catalog',
                body: 'Upload private items or classify imports.',
              },
              {
                href: '/catalogues',
                title: 'My Catalogues',
                body: 'Publish completed studio jobs.',
              },
              {
                href: '/kiosk-devices',
                title: 'Kiosk Devices',
                body: 'Monitor statuses and issue pairing codes.',
              },
            ].map((item) => (
              <Link key={item.href} href={item.href} className="quick-action-link focus-ring">
                <div>
                  <div
                    style={{
                      fontSize: '0.875rem',
                      fontWeight: 600,
                      color: 'hsl(var(--text-primary))',
                      marginBottom: 2,
                    }}
                  >
                    {item.title}
                  </div>
                  <div style={{ fontSize: '0.8125rem', color: 'hsl(var(--text-secondary))' }}>
                    {item.body}
                  </div>
                </div>
                <ArrowRight size={16} color="hsl(var(--text-tertiary))" />
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity Table */}
      <Card>
        <CardHeader
          style={{
            display: 'flex',
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <CardTitle>Recent Widget Jobs</CardTitle>
            <CardDescription>Your latest generation requests from the widget.</CardDescription>
          </div>
          <Badge variant="default">{recentJobs.length} records</Badge>
        </CardHeader>
        <CardContent style={{ padding: 0 }}>
          {recentJobs.length === 0 ? (
            <div
              style={{
                padding: 'var(--space-8)',
                textAlign: 'center',
                color: 'hsl(var(--text-secondary))',
                fontSize: '0.875rem',
              }}
            >
              No jobs have been processed yet.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job ID</TableHead>
                  <TableHead>Date & Time</TableHead>
                  <TableHead>Cost</TableHead>
                  <TableHead style={{ textAlign: 'right' }}>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentJobs.map((job) => (
                  <TableRow key={job.id}>
                    <TableCell style={{ fontWeight: 500, fontFamily: 'monospace' }}>
                      {job.id.slice(0, 8)}
                    </TableCell>
                    <TableCell style={{ color: 'hsl(var(--text-secondary))' }}>
                      {new Date(job.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell>{job.creditsCharged} credits</TableCell>
                    <TableCell style={{ textAlign: 'right' }}>
                      <Badge
                        variant={
                          job.status.toLowerCase() === 'completed'
                            ? 'success'
                            : job.status.toLowerCase() === 'failed'
                              ? 'danger'
                              : 'primary'
                        }
                      >
                        {job.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
