'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useJobStream } from '@/hooks/use-job-stream';
import { api } from '@/lib/api';
import { isSupportedImageBytes } from '@/lib/image-validation';

// Everything the Fabric to Garment page needs: upload the flat fabric photo,
// pick a garment-type preset, submit the job, then watch it through to a
// result via the shared SSE stream (same jobId-filtered pattern
// saree/page.tsx uses — this page has no job list of its own to poll).
export function useFabricToGarment() {
  const qc = useQueryClient();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [r2Key, setR2Key] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);

  const [presetId, setPresetId] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pendingJobId, setPendingJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  // Abort any in-flight upload on unmount.
  useEffect(() => {
    return () => uploadAbortRef.current?.abort();
  }, []);

  // Revoke the previous preview's blob URL whenever `previewUrl` changes away
  // from it — a new upload, clearing on submit, or unmount.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useJobStream(
    useCallback(
      (evt) => {
        if (!pendingJobId || evt.jobId !== pendingJobId) return;
        setJobStatus(evt.status);
        if (evt.status === 'COMPLETED') {
          setPendingJobId(null);
          api
            .get<{ url: string }>(`/v1/jobs/${pendingJobId}/result`)
            .then(({ url }) => setResultUrl(url))
            .catch(() => setSubmitError('Generation failed. Please try again.'))
            .finally(() => setSubmitting(false));
        } else if (evt.status === 'FAILED') {
          setPendingJobId(null);
          setSubmitError('Generation failed. Please try again.');
          setSubmitting(false);
        }
      },
      [pendingJobId],
    ),
  );

  async function handleUpload(nextFile: File) {
    if (uploading) return;
    if (nextFile.size > 20 * 1024 * 1024) {
      setUploadError('File exceeds 20 MB. Please choose a smaller image.');
      return;
    }
    if (!(await isSupportedImageBytes(nextFile))) {
      setUploadError('Unsupported file type. Please upload a JPEG, PNG, or WebP image.');
      return;
    }
    setUploadError(null);
    setResultUrl(null);
    setSubmitError(null);
    setUploading(true);
    setUploadProgress(0);
    const abort = new AbortController();
    uploadAbortRef.current = abort;
    const nextPreviewUrl = URL.createObjectURL(nextFile);
    try {
      const { uploadUrl, r2Key: key } = await api.post<{
        uploadUrl: string;
        r2Key: string;
        expiresIn: number;
      }>('/v1/uploads/presign', { contentType: nextFile.type, contentLength: nextFile.size });
      await api.uploadToR2WithProgress(uploadUrl, nextFile, setUploadProgress, abort.signal);
      setPreviewUrl(nextPreviewUrl);
      setR2Key(key);
    } catch (e) {
      URL.revokeObjectURL(nextPreviewUrl);
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

  function removeFile() {
    setPreviewUrl(null);
    setR2Key(null);
  }

  async function submit() {
    if (!r2Key || !presetId || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    setResultUrl(null);
    try {
      const { jobId } = await api.post<{ jobId: string }>('/v1/jobs/fabric-to-garment', {
        productImageKey: r2Key,
        fabricGarmentTypeId: presetId,
      });
      // Credits were deducted server-side.
      qc.invalidateQueries({ queryKey: ['credits'] });
      setJobStatus('QUEUED');
      setPendingJobId(jobId);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to start generation');
      setSubmitting(false);
    }
  }

  function generateAnother() {
    removeFile();
    setPresetId(null);
    setResultUrl(null);
    setSubmitError(null);
    setJobStatus(null);
  }

  return {
    previewUrl,
    uploading,
    uploadProgress,
    uploadError,
    handleUpload,
    removeFile,
    presetId,
    setPresetId,
    submitting,
    submitError,
    generating: submitting || pendingJobId !== null,
    jobStatus,
    resultUrl,
    submit,
    canSubmit: !!r2Key && !!presetId && !submitting,
    generateAnother,
  };
}
