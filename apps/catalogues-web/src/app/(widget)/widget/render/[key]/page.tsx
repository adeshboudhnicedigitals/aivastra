'use client';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

import { C, grad } from '@/components/tokens';
import { GradBtn } from '@/components/ui/grad-btn';

type Step =
  | 'validating'
  | 'waiting'
  | 'uploading'
  | 'processing'
  | 'result'
  | 'error'
  | 'cancelled';

interface WidgetConfig {
  widgetClientId: string;
  companyName: string;
  isActive: boolean;
}

function Spinner() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div
        className="av-spin"
        style={{
          width: 40,
          height: 40,
          border: '3px solid #EEE',
          borderTopColor: C.pink,
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }}
      />
    </div>
  );
}

export default function WidgetRenderPage() {
  const params = useParams();
  const key = params.key as string;

  const [step, setStep] = useState<Step>('validating');
  const [config, setConfig] = useState<WidgetConfig | null>(null);
  const [garmentImageUrl, setGarmentImageUrl] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState('');

  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadPreview, setUploadPreview] = useState<string>('');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [validationError, setValidationError] = useState('');
  const [dragActive, setDragActive] = useState(false);

  const [jobId, setJobId] = useState<string>('');
  const [resultUrl, setResultUrl] = useState<string>('');
  const [sseConnState, setSseConnState] = useState<'connecting' | 'connected' | 'reconnecting'>(
    'connecting',
  );
  const [cancelling, setCancelling] = useState(false);
  const [cancelToast, setCancelToast] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const sseRetryDelay = useRef(1_000);
  const sseClosedRef = useRef(false);
  const idempKeyRef = useRef<string>('');

  useEffect(() => {
    fetch(`${API_URL}/v1/widget/config/${key}`)
      .then((r) => {
        if (!r.ok) throw new Error('Widget not found');
        return r.json();
      })
      .then((d: WidgetConfig) => {
        if (!d.isActive) throw new Error('This widget is not active.');
        setConfig(d);
        setStep('waiting');
      })
      .catch((err: Error) => {
        setErrorMessage(err.message);
        setStep('error');
      });
  }, [key]);

  useEffect(() => {
    function handler(event: MessageEvent) {
      if (event.data?.type === 'INIT_TRYON') {
        const url = event.data?.payload?.garment_image;
        if (url) {
          idempKeyRef.current = '';
          setGarmentImageUrl(url);
          setStep('uploading');
        }
      }
    }
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // SSE subscription for the processing step — reconnects on network drop
  useEffect(() => {
    if (step !== 'processing' || !jobId) return;
    sseClosedRef.current = false;
    sseRetryDelay.current = 1_000;
    setSseConnState('connecting');

    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;

    async function connectSSE(): Promise<void> {
      if (sseClosedRef.current) return;
      setSseConnState('connecting');
      controller = new AbortController();

      try {
        const sseRes = await fetch(`${API_URL}/v1/widget/jobs/${jobId}/events`, {
          headers: { 'X-Widget-Key': key },
          signal: controller.signal,
        });

        if (!sseRes.body) throw new Error('No SSE body');
        setSseConnState('connected');
        sseRetryDelay.current = 1_000;

        const reader = sseRes.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (!sseClosedRef.current) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const evt = JSON.parse(line.slice(6)) as { type?: string; resultUrl?: string };
              if ((evt.type === 'COMPLETED' || evt.type === 'job:completed') && evt.resultUrl) {
                sseClosedRef.current = true;
                setResultUrl(evt.resultUrl);
                setStep('result');
                return;
              }
              if (evt.type === 'FAILED' || evt.type === 'job:failed') {
                sseClosedRef.current = true;
                setErrorMessage('Try-on generation failed');
                setStep('error');
                return;
              }
              if (evt.type === 'CANCELLED') {
                sseClosedRef.current = true;
                setStep('cancelled');
                return;
              }
            } catch {
              /* partial JSON */
            }
          }
        }
      } catch (err) {
        if (sseClosedRef.current) return;
        if ((err as Error).name === 'AbortError') return;
      }

      // Stream closed without terminal event — schedule reconnect
      if (!sseClosedRef.current) {
        setSseConnState('reconnecting');
        sseRetryDelay.current = Math.min(sseRetryDelay.current * 2, 30_000);
        retryTimer = setTimeout(() => {
          void connectSSE();
        }, sseRetryDelay.current);
      }
    }

    void connectSSE();

    return () => {
      sseClosedRef.current = true;
      if (retryTimer) clearTimeout(retryTimer);
      controller?.abort();
    };
  }, [step, jobId, key]);

  const handleFileSelect = useCallback((file: File) => {
    setValidationError('');
    const validMimes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!validMimes.includes(file.type)) {
      setValidationError('Please upload a valid JPEG, PNG, or WEBP image.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setValidationError('File must be smaller than 5MB.');
      return;
    }
    setUploadFile(file);
    const url = URL.createObjectURL(file);
    setUploadPreview(url);
    setUploadProgress(0);
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!uploadFile || !garmentImageUrl) return;
    if (!idempKeyRef.current) idempKeyRef.current = crypto.randomUUID();
    const idempKey = idempKeyRef.current;

    setUploading(true);
    setUploadProgress(0);

    try {
      const presignRes = await fetch(`${API_URL}/v1/widget/presign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Widget-Key': key },
        body: JSON.stringify({ contentType: uploadFile.type, contentLength: uploadFile.size }),
      });
      if (!presignRes.ok) throw new Error('Failed to get upload URL');
      const { uploadUrl, r2Key } = (await presignRes.json()) as {
        uploadUrl: string;
        r2Key: string;
      };

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', uploadUrl);
        xhr.setRequestHeader('Content-Type', uploadFile.type);
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () =>
          xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('Upload failed'));
        xhr.onerror = () => reject(new Error('Network error'));
        xhr.send(uploadFile);
      });

      setUploadProgress(100);

      const jobRes = await fetch(`${API_URL}/v1/widget/jobs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Widget-Key': key,
          'X-Idempotency-Key': idempKey,
        },
        body: JSON.stringify({ garmentImageUrl, customerPhotoKey: r2Key, aspectRatio: '2:3' }),
      });
      if (!jobRes.ok) {
        const err = await jobRes.json();
        throw new Error(
          (err as { error?: { message?: string } }).error?.message ?? 'Job creation failed',
        );
      }
      const { jobId: newJobId } = (await jobRes.json()) as { jobId: string };
      setJobId(newJobId);
      setStep('processing');
      setUploading(false);
      // SSE subscription is handled by the useEffect watching [step, jobId]
    } catch (err: unknown) {
      setErrorMessage((err as Error).message);
      setStep('error');
      setUploading(false);
    }
  }, [uploadFile, garmentImageUrl, key]);

  const close = () => {
    try {
      window.parent.postMessage({ type: 'TRYON_CLOSED' }, '*');
    } catch {
      /* cross-origin ok */
    }
  };

  const handleCancel = useCallback(async () => {
    if (!jobId || cancelling) return;
    setCancelling(true);
    setCancelToast('');
    try {
      const res = await fetch(`${API_URL}/v1/widget/jobs/${jobId}`, {
        method: 'DELETE',
        headers: { 'X-Widget-Key': key },
      });
      if (!res.ok) {
        if (res.status === 409) {
          setCancelToast("Can't cancel — generation already started");
        } else {
          setCancelToast('Failed to cancel');
        }
        setCancelling(false);
        return;
      }
      sseClosedRef.current = true;
      setStep('cancelled');
    } catch {
      setCancelToast('Network error while cancelling');
      setCancelling(false);
    }
  }, [jobId, key, cancelling]);

  return (
    <div
      style={{
        width: 437,
        margin: '0 auto',
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        background: '#fff',
        position: 'relative',
      }}
    >
      <button
        onClick={close}
        style={{
          position: 'absolute',
          top: 12,
          right: 12,
          zIndex: 10,
          background: 'none',
          border: 'none',
          fontSize: 20,
          color: '#999',
          cursor: 'pointer',
          width: 36,
          height: 36,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        ✕
      </button>

      {step === 'validating' && (
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
        >
          <Spinner />
          <p style={{ fontSize: 13, color: '#999', marginTop: 12 }}>Loading widget...</p>
        </div>
      )}

      {step === 'waiting' && (
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
        >
          <Spinner />
          <p style={{ fontSize: 13, color: '#999', marginTop: 12 }}>Waiting for product...</p>
        </div>
      )}

      {step === 'uploading' && (
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            padding: 24,
            gap: 20,
            alignItems: 'center',
          }}
        >
          {garmentImageUrl && (
            <div style={{ width: '100%' }}>
              <p style={{ fontSize: 12, color: '#999', marginBottom: 6 }}>Garment</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={garmentImageUrl}
                alt="Garment"
                style={{
                  width: '100%',
                  maxHeight: 150,
                  objectFit: 'cover',
                  borderRadius: 8,
                  border: '1px solid #EEE',
                }}
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            </div>
          )}

          <div
            onClick={() => !uploading && fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!uploading) setDragActive(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (e.currentTarget.contains(e.relatedTarget as Node)) return;
              if (!uploading) setDragActive(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragActive(false);
              if (uploading) return;
              const f = e.dataTransfer.files?.[0];
              if (f) handleFileSelect(f);
            }}
            style={{
              width: '100%',
              border: `2px dashed ${dragActive ? C.pink : '#DDD'}`,
              background: dragActive ? 'rgba(255, 64, 129, 0.03)' : 'transparent',
              borderRadius: 12,
              padding: 40,
              textAlign: 'center',
              cursor: uploading ? 'default' : 'pointer',
              transition: 'all .2s',
            }}
            onMouseOver={(e) => {
              if (!uploading && !dragActive) e.currentTarget.style.borderColor = C.pink;
            }}
            onMouseOut={(e) => {
              if (!uploading && !dragActive) e.currentTarget.style.borderColor = '#DDD';
            }}
          >
            {uploadPreview ? (
              <div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={uploadPreview}
                  alt="Preview of uploaded garment"
                  style={{
                    width: 120,
                    height: 160,
                    objectFit: 'cover',
                    borderRadius: 8,
                    marginBottom: 8,
                  }}
                />
                <p
                  style={{ fontSize: 12, color: C.pink, margin: 0, cursor: 'pointer' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setUploadFile(null);
                    setUploadPreview('');
                  }}
                >
                  Change photo
                </p>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: 36, marginBottom: 8 }}>📷</div>
                <p style={{ fontSize: 14, fontWeight: 600, color: '#333', marginBottom: 4 }}>
                  Upload your photo
                </p>
                <p style={{ fontSize: 12, color: '#999', margin: 0 }}>
                  Full body or half body photo works best
                </p>
              </div>
            )}
          </div>
          {validationError && (
            <div
              style={{
                padding: '12px 16px',
                background: '#FFF0F0',
                border: '1px solid #FFD6D6',
                borderRadius: 8,
                color: '#D32F2F',
                fontSize: 13,
                fontWeight: 500,
                marginTop: 12,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <span>⚠️</span>
              {validationError}
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg, image/png, image/webp"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFileSelect(f);
            }}
          />

          {uploading && (
            <div style={{ width: '100%' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 12,
                  color: '#999',
                  marginBottom: 4,
                }}
              >
                <span>Uploading...</span>
                <span>{uploadProgress}%</span>
              </div>
              <div style={{ height: 6, background: '#EEE', borderRadius: 3, overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${uploadProgress}%`,
                    background: grad,
                    borderRadius: 3,
                    transition: 'width .2s',
                  }}
                />
              </div>
            </div>
          )}

          <GradBtn disabled={!uploadFile || uploading} onClick={handleGenerate}>
            {uploading ? 'Uploading…' : 'Generate Try-On →'}
          </GradBtn>
        </div>
      )}

      {step === 'processing' && (
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            padding: 24,
            gap: 16,
          }}
        >
          <div style={{ display: 'flex', gap: 8, width: '100%' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {garmentImageUrl && (
              <img
                src={garmentImageUrl}
                alt="Garment"
                style={{
                  width: 60,
                  height: 80,
                  objectFit: 'cover',
                  borderRadius: 6,
                  border: '1px solid #EEE',
                }}
              />
            )}
            {uploadPreview && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={uploadPreview}
                alt="You"
                style={{
                  width: 60,
                  height: 80,
                  objectFit: 'cover',
                  borderRadius: 6,
                  border: '1px solid #EEE',
                }}
              />
            )}
          </div>
          <Spinner />
          <div aria-live="polite" aria-atomic="true" style={{ textAlign: 'center' }}>
            <p
              style={{
                fontSize: 15,
                fontWeight: 600,
                color: '#333',
                margin: 0,
                textAlign: 'center',
              }}
            >
              Generating your try-on...
            </p>
            <p style={{ fontSize: 12, color: '#999', margin: 0 }}>Usually takes 30–60 seconds</p>
            {sseConnState === 'reconnecting' && (
              <p
                role="status"
                style={{
                  fontSize: 11,
                  color: '#E53935',
                  margin: '6px 0 0',
                  fontWeight: 500,
                }}
              >
                Connection lost — retrying…
              </p>
            )}
            {!cancelling && !cancelToast && (
              <button
                type="button"
                onClick={handleCancel}
                style={{
                  marginTop: 16,
                  background: 'none',
                  border: 'none',
                  color: C.pink,
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: 'pointer',
                  padding: '4px 8px',
                }}
              >
                Cancel
              </button>
            )}
            {cancelling && (
              <p style={{ marginTop: 16, fontSize: 13, color: C.mid }}>Cancelling...</p>
            )}
            {cancelToast && (
              <p style={{ marginTop: 16, fontSize: 13, color: C.pink }}>{cancelToast}</p>
            )}
          </div>
        </div>
      )}

      {step === 'cancelled' && (
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            padding: 24,
            textAlign: 'center',
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: '50%',
              background: C.field,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 16,
            }}
          >
            <span style={{ fontSize: 24, color: C.text }}>✕</span>
          </div>
          <h2 style={{ margin: '0 0 8px', fontSize: 18, color: C.text }}>Job cancelled</h2>
          <p style={{ margin: '0 0 24px', fontSize: 14, color: C.mid, lineHeight: 1.5 }}>
            Credits have been refunded.
          </p>
          <button
            type="button"
            onClick={() => {
              setStep('waiting');
              setJobId('');
              setUploadFile(null);
              setUploadPreview('');
              setCancelling(false);
              setCancelToast('');
              idempKeyRef.current = '';
              sseClosedRef.current = false;
            }}
            className="btn-hover-opacity"
            style={{
              background: C.dark,
              color: C.onDark,
              border: 'none',
              borderRadius: 8,
              padding: '12px 24px',
              fontSize: 14,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Upload new photo
          </button>
        </div>
      )}

      {step === 'result' && (
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            padding: 24,
            gap: 16,
            alignItems: 'center',
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {resultUrl && (
            <img src={resultUrl} alt="Result" style={{ width: '100%', borderRadius: 8 }} />
          )}
          <div style={{ display: 'flex', gap: 12, width: '100%' }}>
            <a
              href={resultUrl}
              download
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '10px 20px',
                borderRadius: 8,
                border: `1px solid ${C.border2}`,
                background: C.white,
                color: C.text,
                fontFamily: 'inherit',
                fontWeight: 600,
                fontSize: 14,
                textDecoration: 'none',
                cursor: 'pointer',
              }}
            >
              Download
            </a>
            <GradBtn
              onClick={() => {
                idempKeyRef.current = '';
                setStep('uploading');
                setUploadFile(null);
                setUploadPreview('');
              }}
            >
              Try Another Photo
            </GradBtn>
          </div>
        </div>
      )}

      {step === 'error' && (
        <div
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            gap: 16,
          }}
        >
          <div style={{ fontSize: 48 }}>⚠️</div>
          <p
            style={{
              fontSize: 14,
              color: '#D0244A',
              margin: 0,
              textAlign: 'center',
              fontWeight: 600,
            }}
          >
            {errorMessage}
          </p>
          {garmentImageUrl ? (
            <GradBtn
              onClick={() => {
                setStep('uploading');
                setErrorMessage('');
              }}
            >
              Try Again
            </GradBtn>
          ) : (
            <GradBtn
              onClick={() => {
                setStep('waiting');
                setErrorMessage('');
              }}
            >
              Try Again
            </GradBtn>
          )}
        </div>
      )}

      <div style={{ textAlign: 'center', padding: '12px 0', fontSize: 10, color: '#BBB' }}>
        Powered by Aivastra
      </div>
    </div>
  );
}
