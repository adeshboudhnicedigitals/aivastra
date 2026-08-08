'use client';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';
import { C } from '@/components/tokens';
import { api } from '@/lib/api';
import type { TrayGarment } from './types';

const MAX_FILE_BYTES = 10 * 1024 * 1024;

/**
 * Presigns and uploads one file, resolving to its R2 key. Each call gets its own
 * key from /v1/uploads/presign (the UUID in the key is a per-upload token, not
 * the user id), so parallel uploads never collide.
 */
export async function uploadTrayFile(
  file: File,
  onProgress: (pct: number) => void,
): Promise<string> {
  const { uploadUrl, r2Key } = await api.post<{
    uploadUrl: string;
    r2Key: string;
    expiresIn: number;
  }>('/v1/uploads/presign', { contentType: file.type, contentLength: file.size });
  await api.uploadToR2WithProgress(uploadUrl, file, onProgress);
  return r2Key;
}

export function GarmentTray({
  garments,
  onAdd,
  onPatch,
  onRemove,
  selectedGarmentId,
  onSelect,
}: {
  garments: TrayGarment[];
  onAdd: (garments: TrayGarment[]) => void;
  onPatch: (id: string, patch: Partial<TrayGarment>) => void;
  onRemove: (id: string) => void;
  selectedGarmentId: string | null;
  onSelect: (id: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<'upload' | 'past'>('upload');

  const pastAssets = useQuery({
    queryKey: ['assets'],
    queryFn: () =>
      api.get<
        Array<{ r2Key: string; thumbnailUrl: string | null; uploadedAt: string; jobsCount: number }>
      >('/v1/assets'),
    enabled: tab === 'past',
  });

  // A past asset already has its key, so it lands in the tray at 100% with no
  // upload. Re-adding one that is already present is a no-op rather than a
  // duplicate tile.
  const addPastAsset = (r2Key: string, thumbnailUrl: string | null) => {
    if (garments.some((g) => g.r2Key === r2Key)) return;
    onAdd([
      {
        id: crypto.randomUUID(),
        r2Key,
        previewUrl: thumbnailUrl ?? '',
        fileName: r2Key.split('/').slice(-2, -1)[0] ?? 'Previous upload',
        progress: 100,
        error: null,
      },
    ]);
  };

  const handleFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList?.length) return;
      const files = Array.from(fileList);

      const pending: TrayGarment[] = files.map((file) => ({
        id: crypto.randomUUID(),
        r2Key: null,
        previewUrl: URL.createObjectURL(file),
        fileName: file.name,
        progress: 0,
        error: file.size > MAX_FILE_BYTES ? 'Over 10 MB' : null,
      }));
      onAdd(pending);

      // Uploads run independently: one rejected file leaves the others alone,
      // and the tile keeps its own retry affordance.
      pending.forEach((entry, i) => {
        if (entry.error) return;
        const file = files[i];
        if (!file) return;
        uploadTrayFile(file, (pct) => onPatch(entry.id, { progress: pct }))
          .then((r2Key) => onPatch(entry.id, { r2Key, progress: 100, error: null }))
          .catch((err: Error) => onPatch(entry.id, { error: err.message || 'Upload failed' }));
      });
    },
    [onAdd, onPatch],
  );

  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <strong style={{ color: C.text }}>Garments</strong>
        <button type="button" onClick={() => inputRef.current?.click()}>
          Add images
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        {(['upload', 'past'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            style={{
              padding: '4px 10px',
              borderRadius: 999,
              border: `1px solid ${tab === t ? C.pink : C.border}`,
              background: 'transparent',
              color: tab === t ? C.pink : C.mid,
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            {t === 'upload' ? 'New uploads' : 'Past uploads'}
          </button>
        ))}
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp"
        style={{ display: 'none' }}
        onChange={(e) => {
          handleFiles(e.target.files);
          // Reset so re-selecting the same file fires onChange again.
          e.target.value = '';
        }}
      />

      {tab === 'upload' && (
        // biome-ignore lint/a11y/noStaticElementInteractions: drag-and-drop zone needs div for layout
        <div
          onDrop={(e) => {
            e.preventDefault();
            handleFiles(e.dataTransfer.files);
          }}
          onDragOver={(e) => e.preventDefault()}
          style={{
            marginTop: 12,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))',
            gap: 8,
            minHeight: 112,
          }}
        >
          {garments.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => onSelect(g.id)}
              title={g.fileName}
              style={{
                position: 'relative',
                padding: 0,
                borderRadius: 8,
                overflow: 'hidden',
                border: `2px solid ${g.id === selectedGarmentId ? C.pink : C.border}`,
                opacity: g.r2Key ? 1 : 0.6,
                cursor: 'pointer',
              }}
            >
              {/* biome-ignore lint/performance/noImgElement: object URLs cannot go through next/image */}
              <img
                src={g.previewUrl}
                alt={g.fileName}
                style={{ width: '100%', height: 96, objectFit: 'cover', display: 'block' }}
              />
              {!g.r2Key && !g.error && (
                <span style={{ position: 'absolute', inset: 'auto 0 0 0', fontSize: 11 }}>
                  {g.progress}%
                </span>
              )}
              {g.error && (
                <span style={{ position: 'absolute', inset: 'auto 0 0 0', fontSize: 11 }}>
                  {g.error}
                </span>
              )}
              {/* biome-ignore lint/a11y/useSemanticElements: contains a nested interactive <button> (remove) — real <button> here would be invalid HTML (no nesting) */}
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(g.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.stopPropagation();
                    onRemove(g.id);
                  }
                }}
                style={{ position: 'absolute', top: 2, right: 4, fontSize: 12 }}
              >
                ×
              </span>
            </button>
          ))}
        </div>
      )}

      {tab === 'past' && (
        <div
          style={{
            marginTop: 8,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))',
            gap: 8,
          }}
        >
          {(pastAssets.data ?? []).map((asset) => (
            <button
              key={asset.r2Key}
              type="button"
              onClick={() => addPastAsset(asset.r2Key, asset.thumbnailUrl ?? null)}
              style={{
                padding: 0,
                borderRadius: 8,
                overflow: 'hidden',
                border: `1px solid ${C.border}`,
                cursor: 'pointer',
              }}
            >
              {/* biome-ignore lint/performance/noImgElement: presigned R2 URLs cannot go through next/image */}
              <img
                src={asset.thumbnailUrl ?? ''}
                alt="Previous upload"
                style={{ width: '100%', height: 96, objectFit: 'cover', display: 'block' }}
              />
            </button>
          ))}
          {pastAssets.data?.length === 0 && (
            <p style={{ color: C.mid, fontSize: 13 }}>No previous uploads yet.</p>
          )}
        </div>
      )}
    </div>
  );
}
