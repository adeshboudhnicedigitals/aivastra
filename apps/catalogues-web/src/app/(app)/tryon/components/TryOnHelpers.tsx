'use client';

import { useQuery } from '@tanstack/react-query';
import type React from 'react';
import { useCallback, useRef, useState } from 'react';
import { InfoIcon } from '@/components/icons';
import { C } from '@/components/tokens';
import { api } from '@/lib/api';
import type { GarmentCatalogImage } from '../use-tryon-data';

export function UploadZone({
  file: _file,
  preview,
  progress,
  label,
  tip,
  icon,
  onFile,
  disabled,
  sampleUrl,
}: {
  file: File | null;
  preview: string | null;
  progress: number;
  label: string;
  tip: string;
  icon: React.ReactNode;
  onFile: (f: File) => void;
  disabled?: boolean;
  sampleUrl?: string | null;
}) {
  const [showSamples, setShowSamples] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const accept = useCallback(
    (f: File) => {
      if (!f.type.startsWith('image/')) return;
      onFile(f);
    },
    [onFile],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const f = e.dataTransfer.files[0];
      if (f) accept(f);
    },
    [accept],
  );

  return (
    <>
      {/* biome-ignore lint/a11y/useSemanticElements: drag-and-drop zone needs div for layout */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(e) => e.key === 'Enter' && !disabled && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        style={{
          width: '100%',
          minHeight: 190,
          maxHeight: 220,
          borderRadius: 12,
          border: `2px dashed ${dragging ? C.pink : preview ? C.border : 'var(--tryon-person-dashed, #EC4899)'}`,
          background: C.bg,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          padding: 14,
          boxSizing: 'border-box',
          cursor: disabled ? 'default' : 'pointer',
          overflow: 'hidden',
          position: 'relative',
          transition: 'all .15s',
        }}
      >
        {/* Info button — top-right corner */}
        {sampleUrl && (
          <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 10 }}>
            <button
              type="button"
              onMouseEnter={() => setShowSamples(true)}
              onMouseLeave={() => setShowSamples(false)}
              onFocus={() => setShowSamples(true)}
              onBlur={() => setShowSamples(false)}
              onClick={(e) => e.stopPropagation()}
              style={{
                width: 22,
                height: 22,
                borderRadius: '50%',
                border: 'none',
                background: 'transparent',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                padding: 0,
              }}
            >
              <InfoIcon size={16} color={C.mid} />
            </button>
            {showSamples && (
              // biome-ignore lint/a11y/noStaticElementInteractions: hover-sustain region
              <div
                onMouseEnter={() => setShowSamples(true)}
                onMouseLeave={() => setShowSamples(false)}
                style={{
                  position: 'absolute',
                  top: 26,
                  right: 0,
                  zIndex: 100,
                  background: C.white,
                  boxShadow: `0 8px 24px rgba(0,0,0,0.18), inset 0 0 0 1px ${C.border}`,
                  borderRadius: 12,
                  padding: 10,
                  maxWidth: 'calc(100vw - 48px)',
                }}
              >
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: C.mid,
                    display: 'block',
                    marginBottom: 6,
                  }}
                >
                  Sample
                </span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {/* biome-ignore lint/performance/noImgElement: sample preview image */}
                <img
                  src={sampleUrl}
                  alt=""
                  style={{
                    width: 'min(320px, calc(100vw - 64px))',
                    height: 'auto',
                    maxHeight: 200,
                    objectFit: 'contain',
                    borderRadius: 8,
                    display: 'block',
                  }}
                />
              </div>
            )}
          </div>
        )}

        {preview ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          // biome-ignore lint/performance/noImgElement: upload zone preview
          <img
            src={preview}
            alt="preview"
            style={{
              width: '100%',
              height: '100%',
              maxHeight: 180,
              objectFit: 'contain',
              borderRadius: 8,
              boxSizing: 'border-box',
            }}
          />
        ) : (
          <>
            <div
              style={{
                width: 50,
                height: 50,
                borderRadius: '50%',
                background: C.white,
                boxShadow: `inset 0 0 0 1px ${C.border2}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {icon}
            </div>
            <span
              style={{
                fontSize: 11,
                fontWeight: 500,
                textAlign: 'center',
                color: C.light,
                lineHeight: 1.4,
              }}
            >
              Drag & drop person image here &middot; Max 10MB
            </span>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: C.white,
                border: `1px solid ${C.border}`,
                padding: '6px 14px',
                borderRadius: 8,
                boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {/* biome-ignore lint/performance/noImgElement: upload icon SVG */}
              <img
                src="/assets/image-upload.svg"
                alt=""
                width={14}
                height={14}
                style={{ opacity: 0.7, filter: 'var(--icon-invert)' }}
              />
              <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>Browse Image</span>
            </div>
          </>
        )}

        {/* Upload progress overlay */}
        {progress > 0 && progress < 100 && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(0,0,0,0.45)',
              borderRadius: 12,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            <span style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>{progress}%</span>
            <div
              style={{
                width: '60%',
                height: 4,
                background: 'rgba(255,255,255,0.2)',
                borderRadius: 4,
              }}
            >
              <div
                style={{
                  width: `${progress}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, #F55C7A 0%, #BD2587 100%)',
                  borderRadius: 4,
                  transition: 'width .2s',
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Tip — only shown when tip text is provided */}
      {tip && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}>
          {/* biome-ignore lint/performance/noImgElement: static SVG asset */}
          <img
            src="/assets/bulb.svg"
            alt=""
            width={12}
            height={14}
            style={{ flexShrink: 0, marginTop: 1 }}
          />
          <span style={{ fontSize: 10, fontWeight: 600, color: C.pink, flexShrink: 0 }}>Tips</span>
          <span style={{ fontSize: 10, fontWeight: 400, lineHeight: '16px', color: C.mid }}>
            {tip}
          </span>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) accept(f);
          e.target.value = '';
        }}
      />
    </>
  );
}

export function GarmentCatalogModal({
  onSelect,
  onClose,
}: {
  onSelect: (img: GarmentCatalogImage) => void;
  onClose: () => void;
}) {
  const { data, isLoading } = useQuery<GarmentCatalogImage[]>({
    queryKey: ['tryon-garment-images'],
    queryFn: () => api.get('/v1/tryon/garment-images'),
  });
  const images = data ?? [];

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: modal backdrop
    // biome-ignore lint/a11y/noStaticElementInteractions: modal backdrop
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: stopPropagation */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: stopPropagation */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: C.white,
          borderRadius: 16,
          width: 'min(1180px, calc(100vw - 32px))',
          height: 'min(857px, calc(100vh - 32px))',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 24px 60px rgba(0,0,0,0.2)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '16px 20px',
            borderBottom: `1px solid ${C.border}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: C.text }}>
            <svg
              aria-hidden="true"
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ opacity: 0.7 }}
            >
              <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />
            </svg>
            <span style={{ fontSize: 12, fontWeight: 500, color: C.text }}>
              Browse from Catalog
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 8,
              color: C.mid,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 8,
            }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
        <div style={{ padding: 20, overflowY: 'auto', flex: 1 }}>
          {isLoading ? (
            <div style={{ textAlign: 'center', color: C.mid, padding: '2rem' }}>Loading…</div>
          ) : images.length === 0 ? (
            <div style={{ textAlign: 'center', color: C.mid, padding: '2rem', fontSize: 13 }}>
              No eligible catalog images yet — generate one in Studio first.
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                gap: 12,
              }}
            >
              {images.map((img) => (
                <button
                  key={img.jobId}
                  type="button"
                  onClick={() => onSelect(img)}
                  style={{
                    border: `1px solid ${C.border}`,
                    borderRadius: 10,
                    padding: 0,
                    overflow: 'hidden',
                    cursor: 'pointer',
                    background: 'none',
                    textAlign: 'left',
                  }}
                >
                  {img.thumbnailUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    // biome-ignore lint/performance/noImgElement: garment thumbnail in picker
                    <img
                      src={img.thumbnailUrl}
                      alt={img.garmentTypeName}
                      style={{
                        width: '100%',
                        aspectRatio: '3/4',
                        objectFit: 'cover',
                        display: 'block',
                      }}
                    />
                  ) : (
                    <div style={{ width: '100%', aspectRatio: '3/4', background: C.bg }} />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
