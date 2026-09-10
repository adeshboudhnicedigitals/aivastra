'use client';

import { ImagePlus, Images, Upload, X } from 'lucide-react';
import { useRef, useState } from 'react';

import { C } from '@/components/tokens';
import { GradBtn } from '@/components/ui/grad-btn';
import { JobThumbnail } from './JobThumbnail';
import type { ImageSource } from './types';

const CARD_STYLE: React.CSSProperties = {
  width: '100%',
  height: '100%',
  minHeight: 360,
  borderRadius: 20,
  background: C.card,
  boxShadow: `inset 0 0 0 1.5px ${C.border2}, 0 4px 15px rgba(0,0,0,0.08)`,
  boxSizing: 'border-box',
};

// Left half of the Motion Studio main screen (mirrors Studio's two-column
// layout: source input on the left, output preview on the right). Two ways
// to pick a source image: "Browse Catalogues" opens CataloguePickerModal to
// reuse a past completed generation; "Upload Custom Image" (or dragging a
// file onto the card, or clicking the card itself) uploads a fresh photo.
// Once `source` is set, the empty-state prompt is replaced by a preview of
// the chosen image with a "Change image" control — same
// preview-with-remove-button pattern CatalogVideoWizard's UploadDropzone used
// before it was deleted in favor of this page, so picking a source has a
// visible result instead of the card silently staying the same.
export function SourcePanel({
  source,
  onFile,
  onBrowseCatalogues,
  onRemove,
  uploading,
  progress,
  error,
}: {
  source: ImageSource | null;
  onFile: (file: File) => void;
  onBrowseCatalogues: () => void;
  onRemove: () => void;
  uploading: boolean;
  progress: number;
  error: string | null;
}): React.ReactElement {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function browse() {
    if (!uploading) inputRef.current?.click();
  }

  if (source && !uploading) {
    return (
      <div style={{ ...CARD_STYLE, position: 'relative', overflow: 'hidden' }}>
        {source.kind === 'existing' ? (
          <JobThumbnail jobId={source.jobId} alt="Selected source" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          // biome-ignore lint/performance/noImgElement: local blob URL preview
          <img
            src={source.previewUrl}
            alt="Selected source"
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        )}
        <button
          type="button"
          onClick={onRemove}
          style={{
            position: 'absolute',
            top: 16,
            right: 16,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 14px',
            borderRadius: 999,
            border: 'none',
            background: 'rgba(0,0,0,0.55)',
            color: C.white,
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          <X size={14} />
          Change image
        </button>
      </div>
    );
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: drag-and-drop surface backing a real <input type=file>; the two buttons and the input itself remain independently keyboard-accessible
    // biome-ignore lint/a11y/useKeyWithClickEvents: same reasoning — the file input and the two buttons below are the keyboard-operable controls
    <div
      onClick={browse}
      onDragOver={(event) => {
        event.preventDefault();
        if (!uploading) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragOver(false);
        const file = event.dataTransfer.files?.[0];
        if (file && !uploading) onFile(file);
      }}
      style={{
        ...CARD_STYLE,
        boxShadow: `inset 0 0 0 1.5px ${dragOver ? C.pink : C.border2}, 0 4px 15px rgba(0,0,0,0.08)`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 20,
        padding: 40,
        textAlign: 'center',
        cursor: uploading ? 'not-allowed' : 'pointer',
        transition: 'box-shadow 150ms ease',
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        disabled={uploading}
        style={{ display: 'none' }}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) onFile(file);
        }}
      />
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: '50%',
          background: dragOver ? 'rgba(245,92,122,0.16)' : 'rgba(245,92,122,0.1)',
          display: 'grid',
          placeItems: 'center',
          color: C.pink,
          transition: 'background 150ms ease',
        }}
      >
        <ImagePlus size={28} strokeWidth={1.5} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: C.text }}>
          Animate Your Fashion
        </h2>
        <p style={{ margin: 0, fontSize: 14, color: C.mid, maxWidth: 320, lineHeight: 1.5 }}>
          Drag and Drop your image here, Or click the button below to upload
        </p>
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
        <GradBtn
          outline
          disabled={uploading}
          onClick={(event) => {
            // Stop the click from also bubbling to the card's own onClick —
            // without this the card handler would fire too and open the
            // file dialog on top of the catalogue picker.
            event.stopPropagation();
            onBrowseCatalogues();
          }}
        >
          <Images size={16} />
          Browse Catalogues
        </GradBtn>
        <GradBtn
          disabled={uploading}
          onClick={(event) => {
            event.stopPropagation();
            browse();
          }}
        >
          <Upload size={16} />
          Upload Custom Image
        </GradBtn>
      </div>
      {uploading && <p style={{ margin: 0, fontSize: 12, color: C.mid }}>Uploading… {progress}%</p>}
      {error && !uploading && <p style={{ margin: 0, fontSize: 12, color: '#D63B4C' }}>{error}</p>}
    </div>
  );
}
