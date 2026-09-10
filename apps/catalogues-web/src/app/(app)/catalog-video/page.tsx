'use client';

import type { PixverseQuality } from '@aivastra/types';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { C } from '@/components/tokens';
import { TopBar } from '@/components/topbar';
import { api } from '@/lib/api';
import { isSupportedImageBytes } from '@/lib/image-validation';

import { CataloguePickerModal } from './CataloguePickerModal';
import { ConfigPanel } from './ConfigPanel';
import { SourcePanel } from './SourcePanel';
import type { ImageSource } from './types';

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

  async function handleGenerate(choice: {
    sampleVideoId: string;
    duration: number;
    quality: PixverseQuality;
  }) {
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
          padding: 20px 24px;
          background: ${C.bg};
          box-sizing: border-box;
        }

        /* Source (left) + config (right), same split as Studio's
           studio-left-column / studio-right-column. Exact height (not
           min-height) fills the viewport under the 76px TopBar and this
           section's own padding, and no further — nothing below it on this
           page any more, so the columns should stand exactly as tall as the
           screen rather than being able to grow past it. */
        .cat-video-two-col {
          display: flex;
          gap: 20px;
          height: calc(100vh - 76px - 40px);
        }
        .cat-video-source-col,
        .cat-video-result-col {
          flex: 1 1 0;
          min-width: 0;
          display: flex;
        }

        @media (max-width: 1023px) {
          .cat-video-main {
            padding: 16px 20px;
          }
          .cat-video-two-col {
            flex-direction: column;
            height: auto;
          }
          .cat-video-source-col,
          .cat-video-result-col {
            height: calc(100vh - 76px - 32px);
          }
        }

        @media (max-width: 639px) {
          .cat-video-main {
            padding: 12px 16px;
          }
          .cat-video-source-col,
          .cat-video-result-col {
            height: calc(100vh - 76px - 24px);
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
