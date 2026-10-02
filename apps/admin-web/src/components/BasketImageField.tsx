import { useEffect, useRef, useState } from 'react';
import { apiFetch, UPLOAD_NETWORK_ERROR, uploadErrorMessage } from '../lib/data';
import { makeThumbnail } from '../lib/thumbnail';
import { Icon } from './Icons';

/** What the field has decided; the page turns it into an upload + imageKey on save. */
export type BasketImageChange =
  | { kind: 'keep' }
  | { kind: 'remove' }
  | { kind: 'upload'; file: File };

function putFile(url: string, file: Blob): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(uploadErrorMessage(xhr.status)));
    xhr.onerror = () => reject(new Error(UPLOAD_NETWORK_ERROR));
    xhr.send(file);
  });
}

/**
 * Uploads a basket image and returns the storage key to save on the basket.
 * Downscaled to 1200px JPEG: it is shown at merchant-card size, and the presign
 * route only issues image/jpeg upload links.
 */
export async function uploadBasketImage(file: File): Promise<string> {
  const presign = await apiFetch<{ uploadUrl: string; imageKey: string }>(
    '/admin/shopify/funnel-templates/image/presign',
    { method: 'POST' },
  );
  const jpeg = await makeThumbnail(file, 1200, 0.85);
  await putFile(presign.uploadUrl, jpeg);
  return presign.imageKey;
}

export function BasketImageField({
  currentUrl,
  change,
  disabled,
  onChange,
}: {
  /** The saved image's signed link, when the basket already has one. */
  currentUrl?: string | null;
  change: BasketImageChange;
  disabled?: boolean;
  onChange: (change: BasketImageChange) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (change.kind !== 'upload') {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(change.file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [change]);

  const shown = change.kind === 'remove' ? null : (previewUrl ?? currentUrl ?? null);

  return (
    <div>
      <div
        style={{
          width: '100%',
          aspectRatio: '16 / 9',
          border: '1px dashed var(--border)',
          borderRadius: 'var(--r)',
          background: 'var(--bg-2)',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--muted)',
          fontSize: 12,
        }}
      >
        {shown ? (
          // biome-ignore lint/performance/noImgElement: admin panel preview
          <img
            src={shown}
            alt="Basket preview"
            style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
          />
        ) : (
          <span>No image</span>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button
          type="button"
          className="btn sm"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          <Icon.Upload /> {shown ? 'Change image' : 'Upload image'}
        </button>
        {shown && (
          <button
            type="button"
            className="btn sm ghost"
            disabled={disabled}
            onClick={() => onChange({ kind: 'remove' })}
          >
            <Icon.Trash /> Remove
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onChange({ kind: 'upload', file });
        }}
      />
    </div>
  );
}
