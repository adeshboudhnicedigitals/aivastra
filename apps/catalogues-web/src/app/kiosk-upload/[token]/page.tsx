'use client';

import { useParams } from 'next/navigation';
import { useCallback, useRef, useState } from 'react';
import { C, grad } from '@/components/tokens';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

type Phase = 'idle' | 'uploading' | 'done' | 'error' | 'expired';

function uploadToR2(
  uploadUrl: string,
  file: File,
  onProgress: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Upload failed (${xhr.status}). Please try again.`));
    xhr.onerror = () => reject(new Error('Could not reach the network. Please try again.'));
    xhr.send(file);
  });
}

export default function KioskUploadPage() {
  const { token } = useParams<{ token: string }>();
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback(
    async (file: File) => {
      setPhase('uploading');
      setProgress(0);
      setError(null);
      try {
        const presignRes = await fetch(`${API_URL}/v1/kiosk-upload-sessions/${token}/presign`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contentType: file.type, contentLength: file.size }),
        });
        if (presignRes.status === 404) {
          setPhase('expired');
          return;
        }
        if (!presignRes.ok) {
          throw new Error('Server error: could not start the upload. Please try again.');
        }
        const { uploadUrl } = (await presignRes.json()) as { uploadUrl: string };

        await uploadToR2(uploadUrl, file, setProgress);

        const completeRes = await fetch(`${API_URL}/v1/kiosk-upload-sessions/${token}/complete`, {
          method: 'POST',
        });
        if (completeRes.status === 404) {
          setPhase('expired');
          return;
        }
        if (!completeRes.ok) {
          throw new Error('Upload did not finish correctly. Please try again.');
        }
        setPhase('done');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
        setPhase('error');
      }
    },
    [token],
  );

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
  };

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
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: 16,
          background: grad,
        }}
        aria-hidden
      />
      <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Send your photo</h1>

      {phase === 'idle' && (
        <>
          <p style={{ color: C.mid, maxWidth: 320, margin: 0 }}>
            Take or choose a photo of yourself - it will appear on the kiosk in a moment.
          </p>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="user"
            onChange={onFileChange}
            style={{ display: 'none' }}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            style={{
              padding: '14px 28px',
              borderRadius: 999,
              border: 'none',
              background: grad,
              color: C.white,
              fontWeight: 600,
              fontSize: 16,
              cursor: 'pointer',
            }}
          >
            Choose photo
          </button>
        </>
      )}

      {phase === 'uploading' && (
        <>
          <p style={{ color: C.mid, margin: 0 }}>Uploading... {progress}%</p>
          <div
            style={{
              width: 200,
              height: 6,
              borderRadius: 3,
              background: C.border,
              overflow: 'hidden',
            }}
          >
            <div style={{ width: `${progress}%`, height: '100%', background: grad }} />
          </div>
        </>
      )}

      {phase === 'done' && (
        <p style={{ color: C.mint, fontWeight: 600, margin: 0 }}>
          Done - you can close this page and check the kiosk.
        </p>
      )}

      {phase === 'expired' && (
        <p style={{ color: C.text, maxWidth: 320, margin: 0 }}>
          This upload link has expired. Please ask staff to generate a new QR code.
        </p>
      )}

      {phase === 'error' && (
        <>
          <p style={{ color: C.text, maxWidth: 320, margin: 0 }}>{error}</p>
          <button
            type="button"
            onClick={() => setPhase('idle')}
            style={{
              padding: '10px 20px',
              borderRadius: 999,
              border: `1px solid ${C.border}`,
              background: 'transparent',
              color: C.text,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </>
      )}
    </div>
  );
}
