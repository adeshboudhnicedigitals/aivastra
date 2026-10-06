'use client';
import { useEffect, useMemo, useRef } from 'react';
import { CheckIcon, ImagePlusIcon, SpinnerIcon, XIcon } from '@/components/icons';
import { C } from '@/components/tokens';

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * Upload box for a garment image the user may leave empty (the saree blouse). Mirrors the
 * look of the required third-garment box in page.tsx, but is its own component because
 * that box is ~180 lines of inline JSX per slot. Upload/validation stays in the page's
 * handler — this only renders the state it is handed.
 */
export function OptionalUploadBox({
  label,
  file,
  uploaded,
  uploading,
  onSelect,
  onClear,
}: {
  label: string;
  file: File | null;
  uploaded: boolean;
  uploading: boolean;
  onSelect: (file: File) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : ''), [file]);
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  return (
    <label
      style={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        background: C.card,
        border: `1px dashed ${C.border}`,
        borderRadius: 8,
        padding: 12,
        cursor: 'pointer',
        boxSizing: 'border-box',
        overflow: 'hidden',
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = e.dataTransfer.files?.[0];
        if (f && ACCEPTED_TYPES.includes(f.type)) onSelect(f);
      }}
    >
      {file ? (
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {/* biome-ignore lint/performance/noImgElement: local blob preview, Next Image not needed */}
          <img
            src={previewUrl}
            alt={file.name}
            style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: 6 }}
          />
          <button
            type="button"
            aria-label={`Remove ${label}`}
            onClick={(e) => {
              e.preventDefault();
              onClear();
            }}
            style={{
              position: 'absolute',
              top: 6,
              right: 6,
              width: 24,
              height: 24,
              borderRadius: '50%',
              background: 'rgba(0,0,0,0.5)',
              border: 'none',
              color: 'white',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <XIcon size={14} />
          </button>
          {uploading && (
            <div
              style={{
                position: 'absolute',
                bottom: 8,
                left: 8,
                right: 8,
                background: 'rgba(255,255,255,0.95)',
                borderRadius: 8,
                padding: '6px 10px',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 12,
                color: C.text,
              }}
            >
              <SpinnerIcon size={14} /> Uploading…
            </div>
          )}
          {uploaded && (
            <div
              style={{
                position: 'absolute',
                top: 8,
                left: 8,
                background: C.mint,
                color: 'white',
                borderRadius: 6,
                padding: '3px 8px',
                fontSize: 11,
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <CheckIcon color="#fff" size={10} /> Uploaded
            </div>
          )}
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <span
              style={{
                width: '100%',
                fontSize: 11,
                fontWeight: 500,
                lineHeight: '100%',
                color: C.text,
                textAlign: 'center',
              }}
            >
              {label}
            </span>
            <span
              style={{
                width: '100%',
                fontSize: 10,
                fontWeight: 500,
                lineHeight: '140%',
                color: C.mid,
                textAlign: 'center',
              }}
            >
              Optional · JPG, PNG · Max 20MB
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <ImagePlusIcon size={14} />
            <span style={{ fontSize: 11, fontWeight: 500, lineHeight: '18px', color: C.text }}>
              Browse
            </span>
          </div>
        </>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_TYPES.join(',')}
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onSelect(f);
          // Same file re-picked after a clear must still fire onChange.
          e.target.value = '';
        }}
      />
    </label>
  );
}
