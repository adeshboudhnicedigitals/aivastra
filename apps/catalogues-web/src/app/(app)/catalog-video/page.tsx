'use client';

import type { PixverseQuality } from '@aivastra/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Film } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { C } from '@/components/tokens';
import { TopBar } from '@/components/topbar';
import { useJobStream } from '@/hooks/use-job-stream';
import { api } from '@/lib/api';
import { isSupportedImageBytes } from '@/lib/image-validation';

import { CataloguePickerModal } from './CataloguePickerModal';
import { ConfigPanel } from './ConfigPanel';
import { SourcePanel } from './SourcePanel';
import type { ImageSource } from './types';

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

/** The dispatcher's raw statuses are internal pipeline stages — collapse the three
 *  in-flight ones into a single "Generating" so the pill reads as progress. */
function statusLabel(status: string): string {
  switch (status) {
    case 'QUEUED':
      return 'Queued';
    case 'PREPROCESSING':
    case 'GENERATING':
    case 'UPLOADING':
      return 'Generating';
    case 'COMPLETED':
      return 'Ready';
    case 'FAILED':
      return 'Failed';
    case 'CANCELLED':
      return 'Cancelled';
    default:
      return status;
  }
}

export default function CatalogVideoPage(): React.ReactElement {
  const qc = useQueryClient();
  const [source, setSource] = useState<ImageSource | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

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

  // Abort any in-flight upload on unmount.
  useEffect(() => {
    return () => uploadAbortRef.current?.abort();
  }, []);

  // Revoke the previous upload's blob URL whenever `source` changes away
  // from it (a new upload, switching to a catalogue image, clearing on
  // submit, or unmount) — never the currently active one. Same pattern
  // CatalogVideoWizard used to own before `source` moved up to this page.
  // Also clear any stale submit error here: it's scoped to the source that
  // was active when the submit failed, and letting it survive a source
  // change would misleadingly reappear under a different image once the
  // user steps forward to Review again.
  useEffect(() => {
    setSubmitError(null);
    return () => {
      if (source?.kind === 'upload') URL.revokeObjectURL(source.previewUrl);
    };
  }, [source]);

  async function handleUpload(file: File) {
    if (uploading) return;
    if (file.size > 10 * 1024 * 1024) {
      setUploadError('File exceeds 10 MB. Please choose a smaller image.');
      return;
    }
    if (!(await isSupportedImageBytes(file))) {
      setUploadError('Unsupported file type. Please upload a JPEG, PNG, or WebP image.');
      return;
    }
    setUploadError(null);
    setUploading(true);
    setUploadProgress(0);
    const abort = new AbortController();
    uploadAbortRef.current = abort;
    const previewUrl = URL.createObjectURL(file);
    try {
      const { uploadUrl, r2Key } = await api.post<{
        uploadUrl: string;
        r2Key: string;
        expiresIn: number;
      }>('/v1/uploads/presign', { contentType: file.type, contentLength: file.size });
      await api.uploadToR2WithProgress(uploadUrl, file, setUploadProgress, abort.signal);
      setSource({ kind: 'upload', r2Key, previewUrl });
    } catch (e) {
      URL.revokeObjectURL(previewUrl);
      if (e instanceof DOMException && e.name === 'AbortError') return;
      const msg = e instanceof Error ? e.message : '';
      setUploadError(
        msg.includes('403')
          ? 'Upload session expired. Please re-upload your image and try again.'
          : `Upload failed: ${msg}`,
      );
    } finally {
      setUploading(false);
    }
  }

  async function handleGenerate(
    choice: { sampleVideoId: string } | { duration: number; quality: PixverseQuality },
  ) {
    if (!source || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await api.post('/v1/jobs/catalog-video', {
        ...(source.kind === 'existing'
          ? { sourceJobId: source.jobId }
          : { sourceImageKey: source.r2Key }),
        ...choice,
      });
      await qc.invalidateQueries({ queryKey: ['catalog-videos'] });
      // Credits were deducted server-side — refresh the shared ['credits']
      // balance so it doesn't keep showing a stale, too-high number (e.g. to
      // the user menu, or if the user immediately configures another video).
      qc.invalidateQueries({ queryKey: ['credits'] });
      // Back to the empty state on both panels — nothing left to configure
      // once the job is queued.
      setSource(null);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to start video generation');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <style>{`
        .cat-video-main {
          flex: 1;
          min-height: 0;
          overflow-y: auto;
          padding: 20px 24px 32px;
          background: ${C.bg};
          box-sizing: border-box;
        }

        .cat-video-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 20px;
        }

        .cat-video-title {
          margin: 0;
          color: ${C.text};
          font-size: 20px;
        }

        .cat-video-subtitle {
          margin: 5px 0 0;
          color: ${C.mid};
          font-size: 13px;
        }

        .cat-video-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
          gap: 16px;
        }

        /* Main creation surface: source (left) + config (right), same split
           as Studio's studio-left-column / studio-right-column. min-height
           fills the full viewport under the 76px TopBar (minus this
           section's own share of .cat-video-main's padding) so both columns
           stand as tall as the screen — "Your Videos" below is reachable by
           scrolling further, not squeezed into the same screen. */
        .cat-video-two-col {
          display: flex;
          gap: 20px;
          margin-bottom: 28px;
          min-height: calc(100vh - 76px - 20px - 32px);
        }
        .cat-video-source-col,
        .cat-video-result-col {
          flex: 1 1 0;
          min-width: 0;
          display: flex;
        }

        @media (max-width: 1023px) {
          .cat-video-main {
            padding: 16px 20px 24px;
          }
          .cat-video-grid {
            grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
            gap: 12px;
          }
          .cat-video-two-col {
            flex-direction: column;
            min-height: calc(100vh - 76px - 16px - 24px);
          }
        }

        @media (max-width: 639px) {
          .cat-video-main {
            padding: 12px 16px 20px;
          }
          .cat-video-two-col {
            min-height: calc(100vh - 76px - 12px - 20px);
          }
          .cat-video-header {
            flex-direction: column;
            align-items: center;
            text-align: center;
            gap: 12px;
          }
          .cat-video-title {
            font-size: 18px;
          }
          .cat-video-subtitle {
            font-size: 12px;
          }
          .cat-video-grid {
            grid-template-columns: repeat(2, 1fr);
            gap: 10px;
          }
        }
      `}</style>
      <TopBar
        title="Motion Studio"
        subtitle="Animate a catalogue photo into a motion-ready product video"
      />
      <main className="cat-video-main">
        <div className="cat-video-two-col">
          <div className="cat-video-source-col">
            <SourcePanel
              source={source}
              onFile={handleUpload}
              onBrowseCatalogues={() => setPickerOpen(true)}
              onRemove={() => setSource(null)}
              uploading={uploading}
              progress={uploadProgress}
              error={uploadError}
            />
          </div>
          <div className="cat-video-result-col">
            <ConfigPanel
              source={source}
              submitting={submitting}
              submitError={submitError}
              onSubmit={handleGenerate}
            />
          </div>
        </div>

        <div className="cat-video-header">
          <div>
            <h1 className="cat-video-title">Your Videos</h1>
            <p className="cat-video-subtitle">Your generated product videos</p>
          </div>
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
          </div>
        ) : (
          <div className="cat-video-grid">
            {items.map((item) => {
              const color = statusColor(item.status);
              return (
                <article
                  key={item.id}
                  className="prod-card"
                  style={{
                    overflow: 'hidden',
                    border: `1px solid ${C.border}`,
                    borderRadius: 14,
                    background: C.card,
                  }}
                >
                  <div
                    className="prod-card-img"
                    style={{
                      position: 'relative',
                      aspectRatio: '9 / 16',
                      background: C.lighter,
                      display: 'grid',
                      placeItems: 'center',
                    }}
                  >
                    {item.status === 'COMPLETED' && item.videoUrl ? (
                      // biome-ignore lint/a11y/useMediaCaption: silent garment-preview clip, no dialogue/narration
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
                      padding: '10px 14px',
                    }}
                  >
                    <span
                      style={{
                        color,
                        background: `color-mix(in srgb, ${color} 12%, transparent)`,
                        borderRadius: 20,
                        padding: '2px 7px',
                        fontSize: 11,
                        fontWeight: 600,
                      }}
                    >
                      {statusLabel(item.status)}
                    </span>
                    <time style={{ color: C.light, fontSize: 12 }} dateTime={item.createdAt}>
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

      {pickerOpen && (
        <CataloguePickerModal
          onClose={() => setPickerOpen(false)}
          onSelect={(jobId) => {
            setPickerOpen(false);
            setSource({ kind: 'existing', jobId });
          }}
        />
      )}
    </>
  );
}
