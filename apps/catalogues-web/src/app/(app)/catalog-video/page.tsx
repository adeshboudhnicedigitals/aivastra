'use client';

import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Film, Plus } from 'lucide-react';

import { C } from '@/components/tokens';
import { TopBar } from '@/components/topbar';
import { GradBtn } from '@/components/ui/grad-btn';
import { useJobStream } from '@/hooks/use-job-stream';
import { api } from '@/lib/api';

import { CatalogVideoWizard } from './CatalogVideoWizard';

interface CatalogVideoItem {
  id: string;
  status: string;
  createdAt: string;
  sampleVideoId: string | null;
  videoUrl: string | null;
  thumbnailUrl: string | null;
}

function statusColor(status: string): string {
  if (status === 'COMPLETED') return C.mint;
  if (status === 'FAILED' || status === 'CANCELLED') return C.pink;
  return C.amber;
}

export default function CatalogVideoPage(): React.ReactElement {
  const qc = useQueryClient();
  const [wizardOpen, setWizardOpen] = useState(false);

  const { data: items, isLoading } = useQuery<CatalogVideoItem[]>({
    queryKey: ['catalog-videos'],
    queryFn: () => api.get('/v1/catalog-videos'),
    refetchInterval: 5 * 60 * 1000,
  });

  useJobStream(
    useCallback(
      (event) => {
        qc.setQueryData<CatalogVideoItem[]>(['catalog-videos'], (old) => {
          if (!old) return old;
          return old.map((item) =>
            item.id === event.jobId ? { ...item, status: event.status } : item,
          );
        });
        if (event.status === 'COMPLETED') {
          void qc.invalidateQueries({ queryKey: ['catalog-videos'] });
        }
      },
      [qc],
    ),
  );

  return (
    <>
      <TopBar
        title="Catalog Video"
        subtitle="Create motion-ready product video from your catalogue images"
      />
      <main
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: '20px 24px 32px',
          background: C.bg,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            marginBottom: 20,
          }}
        >
          <div>
            <h1 style={{ margin: 0, color: C.text, fontSize: 20 }}>Catalog Videos</h1>
            <p style={{ margin: '5px 0 0', color: C.mid, fontSize: 13 }}>
              Your generated product videos
            </p>
          </div>
          <GradBtn onClick={() => setWizardOpen(true)}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
              <Plus size={15} />
              New catalog video
            </span>
          </GradBtn>
        </div>

        {isLoading ? (
          <p style={{ color: C.mid, fontSize: 13 }}>Loading videos...</p>
        ) : !items || items.length === 0 ? (
          <div
            style={{
              minHeight: 280,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              border: `1px dashed ${C.border}`,
              borderRadius: 8,
              color: C.mid,
            }}
          >
            <Film size={28} strokeWidth={1.5} />
            <span style={{ fontSize: 13 }}>No catalog videos yet.</span>
            <GradBtn onClick={() => setWizardOpen(true)}>Create video</GradBtn>
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
              gap: 16,
            }}
          >
            {items.map((item) => {
              const color = statusColor(item.status);
              return (
                <article
                  key={item.id}
                  style={{
                    overflow: 'hidden',
                    border: `1px solid ${C.border}`,
                    borderRadius: 8,
                    background: C.card,
                  }}
                >
                  <div
                    style={{
                      position: 'relative',
                      aspectRatio: '9 / 16',
                      background: C.lighter,
                      display: 'grid',
                      placeItems: 'center',
                    }}
                  >
                    {item.status === 'COMPLETED' && item.videoUrl ? (
                      <video
                        src={item.videoUrl}
                        poster={item.thumbnailUrl ?? undefined}
                        controls
                        preload="metadata"
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : item.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      // biome-ignore lint/performance/noImgElement: presigned R2 URL
                      <img
                        src={item.thumbnailUrl}
                        alt="Catalog video preview"
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      <Film size={24} color={C.mid} strokeWidth={1.5} />
                    )}
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                      padding: '10px 12px',
                    }}
                  >
                    <span
                      style={{
                        color,
                        background: `color-mix(in srgb, ${color} 13%, transparent)`,
                        borderRadius: 999,
                        padding: '3px 8px',
                        fontSize: 11,
                        fontWeight: 600,
                      }}
                    >
                      {item.status}
                    </span>
                    <time style={{ color: C.light, fontSize: 11 }} dateTime={item.createdAt}>
                      {new Date(item.createdAt).toLocaleDateString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                      })}
                    </time>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>

      {wizardOpen && (
        <CatalogVideoWizard
          onClose={() => setWizardOpen(false)}
          onCreated={() => setWizardOpen(false)}
        />
      )}
    </>
  );
}
