'use client';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { C, grad } from '@/components/tokens';
import { api } from '@/lib/api';

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT = ['image/jpeg', 'image/png', 'image/webp'];
const OUTPUT_PX = 512;

// Square-crops and downsizes in the browser so a 12MB phone photo uploads as a
// ~60KB JPEG. The API re-encodes from pixels anyway (that is the real guard);
// this only keeps the upload small.
async function toSquareJpeg(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = OUTPUT_PX;
  canvas.height = OUTPUT_PX;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not process the image');
  ctx.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    OUTPUT_PX,
    OUTPUT_PX,
  );
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.88),
  );
  if (!blob) throw new Error('Could not process the image');
  return new File([blob], 'avatar.jpg', { type: 'image/jpeg' });
}

export function ProfilePicture({
  avatarUrl,
  name,
  onMessage,
}: {
  avatarUrl: string | null | undefined;
  name: string;
  onMessage: (m: { type: 'success' | 'error'; message: string }) => void;
}) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [broken, setBroken] = useState(false);

  async function pick(file: File | undefined) {
    if (!file) return;
    if (!ACCEPT.includes(file.type)) {
      onMessage({ type: 'error', message: 'Please choose a JPG, PNG or WebP image.' });
      return;
    }
    if (file.size > MAX_BYTES) {
      onMessage({ type: 'error', message: 'That image is over 5 MB. Please pick a smaller one.' });
      return;
    }
    setBusy(true);
    try {
      const jpeg = await toSquareJpeg(file);
      const { uploadUrl, key } = await api.post<{ uploadUrl: string; key: string }>(
        '/v1/me/avatar/presign',
        { contentType: jpeg.type, contentLength: jpeg.size },
      );
      await api.uploadToR2(uploadUrl, jpeg);
      await api.post('/v1/me/avatar/confirm', { key });
      setBroken(false);
      await qc.invalidateQueries({ queryKey: ['me'] });
      onMessage({ type: 'success', message: 'Profile picture updated' });
    } catch (e) {
      onMessage({
        type: 'error',
        message: e instanceof Error ? e.message : 'Failed to update profile picture',
      });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api.del('/v1/me/avatar');
      await qc.invalidateQueries({ queryKey: ['me'] });
      onMessage({ type: 'success', message: 'Profile picture removed' });
    } catch (e) {
      onMessage({
        type: 'error',
        message: e instanceof Error ? e.message : 'Failed to remove profile picture',
      });
    } finally {
      setBusy(false);
    }
  }

  const showImage = !!avatarUrl && !broken;
  const initial = (name.trim().charAt(0) || '?').toUpperCase();
  const btn = {
    padding: '7px 14px',
    borderRadius: 8,
    border: `1px solid ${C.border2}`,
    background: C.white,
    color: C.mid,
    cursor: busy ? 'default' : 'pointer',
    fontFamily: 'inherit',
    fontSize: 13,
    fontWeight: 500,
    opacity: busy ? 0.6 : 1,
  } as const;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginBottom: 22 }}>
      <div
        style={{
          width: 76,
          height: 76,
          borderRadius: '50%',
          overflow: 'hidden',
          flexShrink: 0,
          display: 'grid',
          placeItems: 'center',
          background: grad,
          color: '#fff',
          fontSize: 28,
          fontWeight: 700,
        }}
      >
        {showImage ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {/* biome-ignore lint/performance/noImgElement: short-lived presigned storage URL, not optimisable by next/image */}
            <img
              src={avatarUrl}
              alt="Your profile"
              onError={() => setBroken(true)}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          </>
        ) : (
          initial
        )}
      </div>
      <div>
        <div style={{ fontWeight: 600, fontSize: 14, color: C.text }}>Profile picture</div>
        <div style={{ fontSize: 12, color: C.light, margin: '2px 0 10px' }}>
          JPG, PNG or WebP, up to 5 MB. Shown to our support team when you contact us.
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT.join(',')}
            hidden
            onChange={(e) => void pick(e.target.files?.[0])}
          />
          <button
            type="button"
            style={btn}
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? 'Working…' : avatarUrl ? 'Change photo' : 'Upload photo'}
          </button>
          {avatarUrl && (
            <button type="button" style={btn} disabled={busy} onClick={() => void remove()}>
              Remove
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
