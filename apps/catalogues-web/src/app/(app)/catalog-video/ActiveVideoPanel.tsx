'use client';

import { AlertCircle } from 'lucide-react';
import { C } from '@/components/tokens';
import { PENDING_STATUSES, useCatalogVideos } from '@/hooks/use-catalog-videos';

const CARD_STYLE: React.CSSProperties = {
  width: '100%',
  height: '100%',
  minHeight: 360,
  borderRadius: 20,
  background: C.card,
  boxShadow: `inset 0 0 0 1.5px ${C.border2}, 0 4px 15px rgba(0,0,0,0.08)`,
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 16,
  padding: 32,
  textAlign: 'center',
};

function statusLabel(status: string): string {
  switch (status) {
    case 'QUEUED':
      return 'Queued…';
    case 'PREPROCESSING':
      return 'Preparing…';
    case 'GENERATING':
      return 'Generating your video…';
    case 'UPLOADING':
      return 'Finishing up…';
    default:
      return 'Working…';
  }
}

// Occupies Motion Studio's left-hand slot in place of SourcePanel for the full
// lifecycle of the job just submitted — queued/generating spinner, then
// either the finished video player or a failure state. Pure video/progress
// display only: the input image, settings, Download and "Generate again"
// live in ActiveSettingsPanel (right column) instead.
export function ActiveVideoPanel({ jobId }: { jobId: string }): React.ReactElement {
  const { data: items } = useCatalogVideos();
  const item = items?.find((i) => i.id === jobId);

  // Not in the list yet — either the very first fetch hasn't landed, or the
  // cache invalidation fired before the row existed server-side. Same visual
  // as a QUEUED job; the poll/SSE invalidation in useCatalogVideos resolves
  // this the moment the row appears.
  if (!item || PENDING_STATUSES.has(item.status)) {
    return (
      <div style={CARD_STYLE}>
        <div
          className="av-spin"
          style={{
            width: 36,
            height: 36,
            border: `3px solid ${C.border2}`,
            borderTopColor: C.pink,
            borderRadius: '50%',
          }}
        />
        <div>
          <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: C.text }}>
            {item ? statusLabel(item.status) : 'Starting your video…'}
          </p>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: C.mid, maxWidth: 320 }}>
            This can take a few minutes, especially at higher quality or duration. You can leave
            this page — it'll keep generating in the background.
          </p>
        </div>
      </div>
    );
  }

  if (item.status === 'FAILED' || !item.videoUrl) {
    return (
      <div style={CARD_STYLE}>
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: '50%',
            background: 'rgba(214,59,76,0.1)',
            display: 'grid',
            placeItems: 'center',
            color: '#D63B4C',
          }}
        >
          <AlertCircle size={22} />
        </div>
        <div>
          <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: C.text }}>
            Video generation failed
          </p>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: C.mid, maxWidth: 320 }}>
            Your credits for this job were refunded automatically. Use "Generate again" on the right
            to retry.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...CARD_STYLE, padding: 16 }}>
      <video
        src={item.videoUrl}
        poster={item.thumbnailUrl ?? undefined}
        controls
        autoPlay
        style={{
          width: '100%',
          height: '100%',
          borderRadius: 12,
          background: '#000',
          objectFit: 'contain',
        }}
      >
        <track kind="captions" />
      </video>
    </div>
  );
}
