import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useJobStream } from '@/hooks/use-job-stream';
import { api } from '@/lib/api';
import { downloadErrorMessage } from '@/lib/errors';

export type TryonCategory = { id: string; name: string; slug: string };
export type TryonCategoriesResponse = {
  categories: TryonCategory[];
  personSampleUrl: string | null;
  garmentSampleUrl: string | null;
  creditsCost: number;
};
export type GarmentCatalogImage = {
  jobId: string;
  thumbnailUrl: string | null;
  garmentTypeName: string;
  tryonCategoryName: string;
};

const DEFAULT_CREDITS_COST = 5;

export function useTryOnData() {
  const [personFile, setPersonFile] = useState<File | null>(null);
  const [personPreview, setPersonPreview] = useState<string | null>(null);
  const [personProgress, setPersonProgress] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultJobId, setResultJobId] = useState<string | null>(null);
  const [downloadingResult, setDownloadingResult] = useState(false);
  const [sharingResult, setSharingResult] = useState(false);
  const [resultActionFeedback, setResultActionFeedback] = useState<{
    tone: 'success' | 'error';
    message: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingJobId, setPendingJobId] = useState<string | null>(null);
  const [selectedGarmentJob, setSelectedGarmentJob] = useState<{
    jobId: string;
    thumbnailUrl: string | null;
    garmentTypeName: string;
  } | null>(null);
  const [showGarmentPicker, setShowGarmentPicker] = useState(false);
  const previewPanelRef = useRef<HTMLDivElement>(null);
  const [isPreviewFullscreen, setIsPreviewFullscreen] = useState(false);

  // Contact form
  const [showContact, setShowContact] = useState(false);
  const [contactSource, setContactSource] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactMessage, setContactMessage] = useState('');
  const [contactSubmitting, setContactSubmitting] = useState(false);
  const [contactDone, setContactDone] = useState(false);

  useEffect(() => {
    const syncFullscreen = () => {
      setIsPreviewFullscreen(document.fullscreenElement === previewPanelRef.current);
    };
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  }, []);

  const togglePreviewFullscreen = async () => {
    const previewPanel = previewPanelRef.current;
    if (!previewPanel) return;

    try {
      if (document.fullscreenElement === previewPanel) {
        await document.exitFullscreen();
      } else {
        await previewPanel.requestFullscreen();
      }
    } catch {
      setError('Full screen is not available in this browser.');
    }
  };

  const handleContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setContactSubmitting(true);
    try {
      await api.post('/v1/contact', {
        name: contactName,
        email: contactEmail,
        phone: contactPhone,
        source: contactSource || undefined,
        message: contactMessage || undefined,
      });
      setContactDone(true);
    } catch {
      // silently stay open — user can retry
    } finally {
      setContactSubmitting(false);
    }
  };

  const { data: tryonData } = useQuery<TryonCategoriesResponse>({
    queryKey: ['tryon-categories'],
    queryFn: () => api.get('/v1/tryon/categories'),
    staleTime: 5 * 60 * 1000,
  });
  const personSampleUrl = tryonData?.personSampleUrl ?? null;
  const creditsCost = tryonData?.creditsCost ?? DEFAULT_CREDITS_COST;

  useJobStream(
    useCallback(
      (evt) => {
        if (!pendingJobId || evt.jobId !== pendingJobId) return;
        if (evt.status === 'COMPLETED') {
          setResultJobId(pendingJobId);
          setPendingJobId(null);
          api
            .get<{ url: string }>(`/v1/jobs/${pendingJobId}/result`)
            .then(({ url }) => setResultUrl(url))
            .catch(() => setError('Generation failed. Please try again or contact support.'))
            .finally(() => {
              setGenerating(false);
              setPersonProgress(0);
            });
        } else if (evt.status === 'FAILED') {
          setPendingJobId(null);
          setError('Generation failed. Please try again or contact support.');
          setGenerating(false);
          setPersonProgress(0);
        }
      },
      [pendingJobId],
    ),
  );

  const { data: credits } = useQuery<{ balance: number }>({
    queryKey: ['credits'],
    queryFn: () => api.get('/v1/credits'),
  });
  const { data: me } = useQuery<{ email: string; displayName?: string; phone?: string | null }>({
    queryKey: ['me'],
    queryFn: () => api.get('/v1/me'),
    staleTime: Infinity,
  });

  const openContact = (source: string) => {
    setContactSource(source);
    setContactName(me?.displayName ?? '');
    setContactEmail(me?.email ?? '');
    const rawPhone = (me?.phone ?? '').replace(/\D/g, '').slice(0, 10);
    setContactPhone(
      rawPhone.length > 5 ? `${rawPhone.slice(0, 5)} ${rawPhone.slice(5)}` : rawPhone,
    );
    setContactMessage('');
    setContactDone(false);
    setShowContact(true);
  };

  const pickFile = (file: File, setFile: (f: File) => void, setPreview: (s: string) => void) => {
    setFile(file);
    const reader = new FileReader();
    reader.onload = (e) => setPreview(e.target?.result as string);
    reader.readAsDataURL(file);
    setError(null);
    setResultUrl(null);
    setResultJobId(null);
    setResultActionFeedback(null);
  };

  const handleGenerate = async () => {
    if (!personFile || !selectedGarmentJob) {
      setError('Select a garment from the catalog and upload a person image first.');
      return;
    }
    setGenerating(true);
    setError(null);
    setResultUrl(null);
    setResultJobId(null);
    setResultActionFeedback(null);
    setPersonProgress(1);
    try {
      const personPresign = await api.post<{ uploadUrl: string; r2Key: string }>(
        '/v1/uploads/presign',
        { contentType: personFile.type, contentLength: personFile.size },
      );

      await api.uploadToR2WithProgress(personPresign.uploadUrl, personFile, setPersonProgress);
      setPersonProgress(100);

      const { jobId } = await api.post<{ jobId: string; catalogueId: string }>(
        '/v1/jobs/simple-tryon',
        { personKey: personPresign.r2Key, sourceJobId: selectedGarmentJob.jobId },
      );

      setPendingJobId(jobId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      const safe = /upload|credit|image|file|size|format/i.test(msg);
      setError(safe ? msg : 'Something went wrong. Please try again.');
      setGenerating(false);
      setPersonProgress(0);
    }
  };

  const handleSelectGarment = (img: GarmentCatalogImage) => {
    setSelectedGarmentJob({
      jobId: img.jobId,
      thumbnailUrl: img.thumbnailUrl,
      garmentTypeName: img.garmentTypeName,
    });
    setShowGarmentPicker(false);
    setError(null);
    setResultUrl(null);
    setResultJobId(null);
    setResultActionFeedback(null);
  };

  const fetchResultBlob = async () => {
    if (!resultUrl) throw new Error('Generate a Try On result first.');
    const response = await fetch(resultUrl);
    if (!response.ok) throw new Error(downloadErrorMessage(response.status));
    return response.blob();
  };

  const resultFile = (blob: Blob) => {
    const extension =
      blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg';
    const suffix = resultJobId?.slice(0, 8) ?? 'result';
    return new File([blob], `aivastra-tryon-${suffix}.${extension}`, {
      type: blob.type || 'image/jpeg',
    });
  };

  const handleDownloadResult = async () => {
    if (!resultUrl || downloadingResult) return;

    setDownloadingResult(true);
    setResultActionFeedback(null);
    try {
      const file = resultFile(await fetchResultBlob());
      const objectUrl = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = file.name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
      setResultActionFeedback({ tone: 'success', message: 'Image downloaded.' });
    } catch (downloadError) {
      setResultActionFeedback({
        tone: 'error',
        message:
          downloadError instanceof Error
            ? downloadError.message
            : 'The image could not be downloaded. Try again.',
      });
    } finally {
      setDownloadingResult(false);
    }
  };

  const handleShareResult = async () => {
    if (!resultUrl || sharingResult) return;

    setSharingResult(true);
    setResultActionFeedback(null);
    const shareData = {
      title: 'Ai Vastra Try On',
      text: 'My AI-generated Try On from Ai Vastra.',
    };

    try {
      if (navigator.share) {
        let fileShareAttempted = false;
        try {
          const file = resultFile(await fetchResultBlob());
          if (navigator.canShare?.({ files: [file] })) {
            fileShareAttempted = true;
            await navigator.share({ ...shareData, files: [file] });
            setResultActionFeedback({ tone: 'success', message: 'Image shared.' });
            return;
          }
        } catch (shareError) {
          if (shareError instanceof DOMException && shareError.name === 'AbortError') return;
          if (fileShareAttempted) throw shareError;
        }

        try {
          await navigator.share({ ...shareData, url: resultUrl });
          setResultActionFeedback({ tone: 'success', message: 'Result shared.' });
          return;
        } catch (shareError) {
          if (shareError instanceof DOMException && shareError.name === 'AbortError') return;
        }
      }

      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(resultUrl);
        setResultActionFeedback({
          tone: 'success',
          message: 'Result link copied to the clipboard.',
        });
        return;
      }

      throw new Error('Sharing is not available in this browser.');
    } catch (shareError) {
      setResultActionFeedback({
        tone: 'error',
        message:
          shareError instanceof Error
            ? shareError.message
            : 'The image could not be shared. Try again.',
      });
    } finally {
      setSharingResult(false);
    }
  };

  const canGenerate = !generating && !!personFile && !!selectedGarmentJob;
  const canUseResultActions = !!resultUrl && !downloadingResult && !sharingResult;

  return {
    personFile,
    setPersonFile,
    personPreview,
    setPersonPreview,
    personProgress,
    generating,
    resultUrl,
    resultJobId,
    downloadingResult,
    sharingResult,
    resultActionFeedback,
    error,
    selectedGarmentJob,
    showGarmentPicker,
    setShowGarmentPicker,
    previewPanelRef,
    isPreviewFullscreen,
    showContact,
    setShowContact,
    contactSource,
    contactName,
    setContactName,
    contactEmail,
    setContactEmail,
    contactPhone,
    setContactPhone,
    contactMessage,
    setContactMessage,
    contactSubmitting,
    contactDone,
    togglePreviewFullscreen,
    handleContactSubmit,
    openContact,
    personSampleUrl,
    creditsCost,
    credits,
    me,
    pickFile,
    handleGenerate,
    handleSelectGarment,
    handleDownloadResult,
    handleShareResult,
    canGenerate,
    canUseResultActions,
  };
}
