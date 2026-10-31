'use client';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { LogoAuth } from '@/components/logo';
import { C, grad } from '@/components/tokens';
import { downloadErrorMessage } from '@/lib/errors';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

type Item = { jobId: string; url: string };
type Phase = 'loading' | 'ready' | 'downloading' | 'error';

const SAVE_GAP_MS = 600;

function extensionFor(mime: string): string {
  switch (mime) {
    case 'image/webp':
      return 'webp';
    case 'image/png':
      return 'png';
    default:
      return 'jpg';
  }
}

function KioskDownloadInner(): React.ReactElement {
  const searchParams = useSearchParams();
  const jobIds = searchParams.get('jobs') ?? '';

  const [phase, setPhase] = useState<Phase>('loading');
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState('');
  const [downloaded, setDownloaded] = useState(0);

  useEffect(() => {
    if (!jobIds) {
      setError('This link is missing its images. Please scan the QR code again.');
      setPhase('error');
      return;
    }
    const controller = new AbortController();
    fetch(`${API_URL}/v1/kiosk-download/batch?jobIds=${encodeURIComponent(jobIds)}`, {
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error(downloadErrorMessage(res.status));
        return res.json() as Promise<{ items: Item[] }>;
      })
      .then((body) => {
        if (body.items.length === 0) {
          setError('These images have expired. Please try on again for a fresh link.');
          setPhase('error');
          return;
        }
        setItems(body.items);
        setPhase('ready');
      })
      .catch((e) => {
        if (controller.signal.aborted) return;
        setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
        setPhase('error');
      });
    return () => controller.abort();
  }, [jobIds]);

  // One file per image, saved sequentially: the originals keep their real format, and a
  // pause between saves keeps browsers from collapsing the burst into a single download.
  async function downloadAll() {
    setPhase('downloading');
    setDownloaded(0);
    let saved = 0;
    for (const [idx, item] of items.entries()) {
      try {
        // no-store: the <img> thumbnails already cached this URL without an Origin header, so
        // R2's response has no CORS headers and a default fetch() reuses it and fails.
        const res = await fetch(item.url, { cache: 'no-store' });
        if (!res.ok) throw new Error(downloadErrorMessage(res.status));
        const blob = await res.blob();

        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = `aivastra-tryon-${idx + 1}.${extensionFor(blob.type)}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);

        saved += 1;
        setDownloaded(saved);
        await new Promise((resolve) => setTimeout(resolve, SAVE_GAP_MS));
      } catch {
        // A single failed image shouldn't block the rest; only report if none saved.
      }
    }

    if (saved === 0) {
      setError('Could not download the images. Please try again.');
      setPhase('error');
      return;
    }
    setPhase('ready');
  }

  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 24,
        padding: 24,
        background: C.bg,
        color: C.text,
        textAlign: 'center',
      }}
    >
      <LogoAuth />
      <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Your try-on images</h1>

      {phase === 'loading' && <p style={{ color: C.mid, margin: 0 }}>Loading your images…</p>}

      {phase === 'error' && <p style={{ color: C.danger, maxWidth: 320, margin: 0 }}>{error}</p>}

      {(phase === 'ready' || phase === 'downloading') && items.length > 0 && (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))',
              gap: 12,
              maxWidth: 420,
              width: '100%',
            }}
          >
            {items.map((item) => (
              // eslint-disable-next-line @next/next/no-img-element
              // biome-ignore lint/performance/noImgElement: remote presigned thumbnail, not a Next-optimizable local asset
              <img
                key={item.jobId}
                src={item.url}
                alt="Try-on result"
                style={{
                  width: '100%',
                  aspectRatio: '3 / 4',
                  objectFit: 'cover',
                  borderRadius: 12,
                  border: `1px solid ${C.border}`,
                }}
              />
            ))}
          </div>

          <p style={{ color: C.mid, fontSize: 13, margin: 0 }}>
            {items.length} image{items.length === 1 ? '' : 's'} ready to download
          </p>

          <button
            type="button"
            onClick={downloadAll}
            disabled={phase === 'downloading'}
            style={{
              padding: '14px 28px',
              borderRadius: 999,
              border: 'none',
              background: grad,
              color: C.white,
              fontWeight: 600,
              fontSize: 16,
              cursor: phase === 'downloading' ? 'not-allowed' : 'pointer',
              opacity: phase === 'downloading' ? 0.7 : 1,
            }}
          >
            {phase === 'downloading'
              ? `Downloading… ${downloaded}/${items.length}`
              : 'Download all'}
          </button>
        </>
      )}
    </div>
  );
}

export default function KioskDownloadPage(): React.ReactElement {
  return (
    <Suspense fallback={<div style={{ minHeight: '100dvh', background: C.bg }} />}>
      <KioskDownloadInner />
    </Suspense>
  );
}
