'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type CatalogueJob = {
  jobId: string;
  catalogueId: string;
  label: string;
  thumbnailUrl: string | null;
  createdAt: string;
  imported: boolean;
};

type CatalogueGroup = {
  catalogueId: string;
  label: string;
  createdAt: string;
  jobs: CatalogueJob[];
};

export function CataloguesContent() {
  const [catalogues, setCatalogues] = useState<CatalogueGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [publishing, setPublishing] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/merchant/catalogues', { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load catalogues');
      const data = (await res.json()) as { catalogues?: CatalogueGroup[] };
      setCatalogues(data.catalogues ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load catalogues');
    } finally {
      setLoading(false);
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: load only closes over stable setState setters; run once on mount
  useEffect(() => {
    void load();
  }, []);

  async function publish(jobId: string) {
    setPublishing(jobId);
    try {
      const res = await fetch('/api/merchant/catalog/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(body.error?.message ?? 'Failed to publish');
      }
      setCatalogues((prev) =>
        prev.map((group) => ({
          ...group,
          jobs: group.jobs.map((job) => (job.jobId === jobId ? { ...job, imported: true } : job)),
        })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to publish');
    } finally {
      setPublishing(null);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
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
          My Catalogues
        </h1>
        <p style={{ fontSize: '0.875rem', color: 'hsl(var(--text-secondary))', margin: 0 }}>
          Publish completed studio outputs to your kiosk catalog.
        </p>
      </div>

      {error && (
        <div
          style={{
            padding: 'var(--space-4)',
            borderRadius: 'var(--radius-md)',
            background: 'hsl(var(--danger-subtle))',
            color: 'hsl(var(--danger-base))',
            fontSize: '0.875rem',
            fontWeight: 500,
          }}
        >
          {error}
        </div>
      )}

      {loading ? (
        <Card>
          <CardContent
            style={{
              padding: 'var(--space-8)',
              textAlign: 'center',
              color: 'hsl(var(--text-secondary))',
            }}
          >
            Loading catalogues...
          </CardContent>
        </Card>
      ) : catalogues.length === 0 ? (
        <Card>
          <CardContent style={{ padding: 'var(--space-8)', textAlign: 'center' }}>
            <h3
              style={{
                fontSize: '1rem',
                fontWeight: 600,
                color: 'hsl(var(--text-primary))',
                marginBottom: 'var(--space-2)',
              }}
            >
              No linked studio catalogues
            </h3>
            <p
              style={{
                fontSize: '0.875rem',
                color: 'hsl(var(--text-secondary))',
                margin: 0,
                maxWidth: 400,
                marginInline: 'auto',
              }}
            >
              When your merchant account is linked to a studio user, completed outputs appear here
              for one-click publishing.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
          {catalogues.map((group) => (
            <Card key={group.catalogueId}>
              <CardHeader>
                <CardTitle>{group.label}</CardTitle>
                <CardDescription>
                  {new Date(group.createdAt).toLocaleDateString()} &middot; {group.jobs.length}{' '}
                  completed result{group.jobs.length === 1 ? '' : 's'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                    gap: 'var(--space-4)',
                  }}
                >
                  {group.jobs.map((job) => (
                    <div
                      key={job.jobId}
                      style={{
                        border: '1px solid hsl(var(--border-default))',
                        borderRadius: 'var(--radius-lg)',
                        overflow: 'hidden',
                        background: 'hsl(var(--bg-base))',
                        display: 'flex',
                        flexDirection: 'column',
                      }}
                    >
                      <div
                        style={{
                          aspectRatio: '3 / 4',
                          background: 'hsl(var(--bg-surface-hover))',
                          position: 'relative',
                        }}
                      >
                        {job.thumbnailUrl ? (
                          // biome-ignore lint/performance/noImgElement: presigned R2 URL
                          <img
                            src={job.thumbnailUrl}
                            alt={job.label}
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                        ) : null}
                        {job.imported && (
                          <div style={{ position: 'absolute', top: 8, right: 8 }}>
                            <Badge variant="success">Published</Badge>
                          </div>
                        )}
                      </div>
                      <div
                        style={{
                          padding: 'var(--space-4)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 'var(--space-4)',
                          flex: 1,
                        }}
                      >
                        <div>
                          <div
                            style={{
                              fontSize: '0.875rem',
                              fontWeight: 600,
                              color: 'hsl(var(--text-primary))',
                            }}
                          >
                            {job.label}
                          </div>
                          <div
                            style={{
                              fontSize: '0.75rem',
                              color: 'hsl(var(--text-tertiary))',
                              marginTop: 4,
                              fontFamily: 'monospace',
                            }}
                          >
                            Job {job.jobId.slice(0, 8)}
                          </div>
                        </div>
                        <div style={{ marginTop: 'auto' }}>
                          <Button
                            variant={job.imported ? 'secondary' : 'primary'}
                            size="sm"
                            style={{ width: '100%' }}
                            disabled={job.imported || publishing === job.jobId}
                            onClick={() => void publish(job.jobId)}
                          >
                            {job.imported
                              ? 'Published'
                              : publishing === job.jobId
                                ? 'Publishing...'
                                : 'Publish to kiosk'}
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
