'use client';
import { useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { SpinnerIcon, TrashIcon, UploadIcon } from '@/components/icons';
import { C } from '@/components/tokens';
import { GradBtn } from '@/components/ui/grad-btn';
import { catalogAppApi as api } from '../../../catalog-app-api';
import {
  deleteProduct,
  finalizeGeneratedProduct,
  pollGenerateBatch,
  presignAndUpload,
} from '../../../catalog-app-helpers';
import { ScreenHeader } from '../../../components/ScreenHeader';
import { StickyBottomBar } from '../../../components/StickyBottomBar';

interface QueueItem {
  id: string;
  file: File;
  fileUrl: string;
  status: 'queued' | 'uploading' | 'generating' | 'generated' | 'failed';
  jobId?: string;
  itemId?: string;
  sku: string;
  actualPrice: string;
  offerPrice: string;
  hasError: boolean;
  errorMessage?: string;
}

const generateId = () => Math.random().toString(36).substring(2, 9);

export default function BulkUploadScreen() {
  const params = useParams<{ id: string }>();
  const subcategoryId = params.id;
  const router = useRouter();
  const qc = useQueryClient();

  const [items, setItems] = useState<QueueItem[]>([]);
  const [isGeneratingAll, setIsGeneratingAll] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const itemsRef = useRef<QueueItem[]>([]);
  itemsRef.current = items;
  const finalizingJobIds = useRef<Set<string>>(new Set());

  const [globalActual, setGlobalActual] = useState('');
  const [globalOffer, setGlobalOffer] = useState('');
  const [saveError, setSaveError] = useState<string | undefined>(undefined);

  useEffect(() => {
    return () => {
      for (const item of itemsRef.current) {
        URL.revokeObjectURL(item.fileUrl);
        if (item.status === 'generated' && item.itemId) void deleteProduct(item.itemId);
      }
    };
  }, []);

  const busy = isGeneratingAll || isSaving;

  function goBackToProducts() {
    router.push(`/tryon-library-app/subcategory/${subcategoryId}`);
  }

  const processFiles = (files: FileList | File[]) => {
    const newItems: QueueItem[] = Array.from(files)
      .filter((file) => file.type.startsWith('image/'))
      .map((file) => ({
        id: generateId(),
        file,
        fileUrl: URL.createObjectURL(file),
        status: 'queued',
        sku: '',
        actualPrice: '',
        offerPrice: '',
        hasError: false,
      }));
    setItems((prev) => [...prev, ...newItems]);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) processFiles(e.target.files);
    e.target.value = '';
  };

  const finalizeCompletedJob = async (jobId: string) => {
    if (finalizingJobIds.current.has(jobId)) return;
    finalizingJobIds.current.add(jobId);
    try {
      const item = await finalizeGeneratedProduct(jobId, subcategoryId);
      setItems((prev) =>
        prev.map((p) => {
          if (p.jobId !== jobId) return p;
          if (item.imageUrl && item.imageUrl !== p.fileUrl) URL.revokeObjectURL(p.fileUrl);
          return {
            ...p,
            status: 'generated',
            itemId: item.id,
            fileUrl: item.imageUrl ?? p.fileUrl,
          };
        }),
      );
    } catch (err) {
      setItems((prev) =>
        prev.map((p) =>
          p.jobId === jobId
            ? {
                ...p,
                status: 'failed',
                hasError: true,
                errorMessage: err instanceof Error ? err.message : 'Import failed',
              }
            : p,
        ),
      );
    }
  };

  const handleGenerateAll = async () => {
    const queued = items.filter((i) => i.status === 'queued');
    if (queued.length === 0) return;
    setIsGeneratingAll(true);
    setItems((prev) =>
      prev.map((i) => (i.status === 'queued' ? { ...i, status: 'uploading' } : i)),
    );

    const uploaded: { id: string; flatImageKey: string }[] = [];
    for (const item of queued) {
      try {
        const { r2Key } = await presignAndUpload(item.file, 'flat');
        uploaded.push({ id: item.id, flatImageKey: r2Key });
      } catch (err) {
        setItems((prev) =>
          prev.map((p) =>
            p.id === item.id
              ? {
                  ...p,
                  status: 'failed',
                  hasError: true,
                  errorMessage: err instanceof Error ? err.message : 'Upload failed',
                }
              : p,
          ),
        );
      }
    }

    if (uploaded.length === 0) {
      setIsGeneratingAll(false);
      return;
    }

    setItems((prev) =>
      prev.map((p) => (uploaded.some((u) => u.id === p.id) ? { ...p, status: 'generating' } : p)),
    );

    let jobIds: string[] = [];
    let failures: Array<{ flatImageKey: string; error: string }> = [];
    try {
      const res = await api.post<{
        jobIds: string[];
        failures: Array<{ flatImageKey: string; error: string }>;
      }>('/v1/merchant/catalog/generate-bulk', {
        subcategoryId,
        flatImageKeys: uploaded.map((u) => u.flatImageKey),
      });
      jobIds = res.jobIds;
      failures = res.failures;
    } catch (err) {
      setItems((prev) =>
        prev.map((p) =>
          uploaded.some((u) => u.id === p.id)
            ? {
                ...p,
                status: 'failed',
                hasError: true,
                errorMessage: err instanceof Error ? err.message : 'Failed to enqueue',
              }
            : p,
        ),
      );
      setIsGeneratingAll(false);
      return;
    }

    const failedKeys = new Map(failures.map((f) => [f.flatImageKey, f.error]));
    const succeeded = uploaded.filter((u) => !failedKeys.has(u.flatImageKey));
    // generate-bulk returns jobIds in the same order as the flatImageKeys that succeeded.
    const jobIdByLocalId = new Map(succeeded.map((u, idx) => [u.id, jobIds[idx]]));

    setItems((prev) =>
      prev.map((p) => {
        const jobId = jobIdByLocalId.get(p.id);
        if (jobId) return { ...p, jobId };
        const uploadedEntry = uploaded.find((u) => u.id === p.id);
        const error = uploadedEntry ? failedKeys.get(uploadedEntry.flatImageKey) : undefined;
        if (error) return { ...p, status: 'failed', hasError: true, errorMessage: error };
        return p;
      }),
    );

    if (jobIds.length > 0) {
      try {
        await pollGenerateBatch(jobIds, (statuses) => {
          for (const s of statuses) {
            if (s.status === 'COMPLETED') {
              void finalizeCompletedJob(s.jobId);
            } else if (s.status === 'FAILED' || s.status === 'CANCELLED') {
              setItems((prev) =>
                prev.map((p) =>
                  p.jobId === s.jobId && p.status !== 'generated'
                    ? {
                        ...p,
                        status: 'failed',
                        hasError: true,
                        errorMessage: s.errorCode ?? 'Generation failed',
                      }
                    : p,
                ),
              );
            }
          }
        });
      } catch {
        // Timed out — items left mid-flight stay 'generating'; remove & retry.
      }
    }

    setIsGeneratingAll(false);
  };

  const handleApplyGlobalPrice = () => {
    if (!globalActual && !globalOffer) return;
    setItems((prev) =>
      prev.map((item) =>
        item.status === 'generated'
          ? {
              ...item,
              actualPrice: globalActual || item.actualPrice,
              offerPrice: globalOffer || item.offerPrice,
              hasError: false,
            }
          : item,
      ),
    );
  };

  const handleUpdateItem = (id: string, updates: Partial<QueueItem>) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...updates, hasError: false } : item)),
    );
  };

  const handleRemoveItem = (id: string) => {
    const item = items.find((i) => i.id === id);
    if (item) {
      URL.revokeObjectURL(item.fileUrl);
      if (item.status === 'generated' && item.itemId) void deleteProduct(item.itemId);
    }
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  const handleAddCatalogue = async () => {
    let hasValidationError = false;
    const validated = items.map((item) => {
      if (item.status !== 'generated') return item;
      const act = parseInt(item.actualPrice, 10) || 0;
      const off = parseInt(item.offerPrice, 10) || 0;
      const isValid =
        item.sku.trim() !== '' && item.actualPrice !== '' && item.offerPrice !== '' && off <= act;
      if (!isValid) hasValidationError = true;
      return { ...item, hasError: !isValid };
    });
    setItems(validated);
    if (hasValidationError) return;

    const ready = validated.filter(
      (i): i is QueueItem & { itemId: string } => i.status === 'generated' && !!i.itemId,
    );
    if (ready.length === 0) return;

    setIsSaving(true);
    setSaveError(undefined);
    try {
      await Promise.all(
        ready.map((item) =>
          api.patch(`/v1/merchant/catalog/${item.itemId}`, {
            label: `Product ${item.sku.toUpperCase()}`,
            sku: item.sku.trim(),
            actualPrice: parseInt(item.actualPrice, 10),
            offerPrice: parseInt(item.offerPrice, 10),
          }),
        ),
      );
      qc.invalidateQueries({ queryKey: ['merchant-catalog-products', subcategoryId] });
      qc.invalidateQueries({ queryKey: ['merchant-catalog-subcategories'] });
      goBackToProducts();
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : 'Failed to save some items. Please try again.',
      );
    } finally {
      setIsSaving(false);
    }
  };

  const hasQueued = items.some((i) => i.status === 'queued');
  const hasGenerated = items.some((i) => i.status === 'generated');
  const generatedCount = items.filter((i) => i.status === 'generated').length;
  const isAnyGenerating = items.some((i) => i.status === 'uploading' || i.status === 'generating');

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <ScreenHeader variant="back" title="Bulk Upload" onBack={goBackToProducts} />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16, padding: 16 }}>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="hover-surface"
          style={{
            height: 88,
            borderRadius: 8,
            border: `2px dashed ${C.border2}`,
            background: C.field,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            gap: 8,
          }}
        >
          <UploadIcon size={22} />
          <span style={{ fontSize: 13, color: C.mid, fontWeight: 500 }}>
            Tap to choose flat images
          </span>
          <input
            type="file"
            multiple
            ref={fileInputRef}
            onChange={handleFileChange}
            accept="image/jpeg,image/png,image/webp"
            style={{ display: 'none' }}
            tabIndex={-1}
          />
        </button>

        {items.length > 0 && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              background: C.lighter,
              padding: '12px 14px',
              borderRadius: 8,
              border: `1px solid ${C.border}`,
            }}
          >
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <GradBtn type="button" onClick={handleGenerateAll} disabled={!hasQueued || busy}>
                {isGeneratingAll && <SpinnerIcon size={14} />}
                {isGeneratingAll ? 'Generating…' : 'Generate All'}
              </GradBtn>
              <span style={{ fontSize: 13, color: C.mid, fontWeight: 500 }}>
                {items.length} item{items.length !== 1 && 's'} ({generatedCount} ready)
              </span>
            </div>

            {hasGenerated && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>
                  Set price for all:
                </span>
                <input
                  type="number"
                  placeholder="Actual"
                  value={globalActual}
                  onChange={(e) => setGlobalActual(e.target.value)}
                  style={{
                    width: 80,
                    height: 32,
                    fontSize: 12,
                    borderRadius: 4,
                    border: `1px solid ${C.border2}`,
                    padding: '0 8px',
                  }}
                />
                <input
                  type="number"
                  placeholder="Offer"
                  value={globalOffer}
                  onChange={(e) => setGlobalOffer(e.target.value)}
                  style={{
                    width: 80,
                    height: 32,
                    fontSize: 12,
                    borderRadius: 4,
                    border: `1px solid ${C.border2}`,
                    padding: '0 8px',
                  }}
                />
                <button
                  type="button"
                  onClick={handleApplyGlobalPrice}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: C.pink,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    textDecoration: 'underline',
                  }}
                >
                  Apply
                </button>
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {items.map((item) => (
            <div
              key={item.id}
              style={{
                border: `1px solid ${item.hasError || item.status === 'failed' ? C.pink : C.border}`,
                borderRadius: 12,
                background:
                  item.hasError || item.status === 'failed' ? 'rgba(245,92,122,0.03)' : C.card,
                overflow: 'hidden',
                position: 'relative',
              }}
            >
              <button
                type="button"
                onClick={() => handleRemoveItem(item.id)}
                disabled={item.status === 'uploading' || item.status === 'generating'}
                aria-label="Remove item"
                style={{
                  position: 'absolute',
                  top: 6,
                  right: 6,
                  background: 'rgba(0,0,0,0.5)',
                  color: C.white,
                  border: 'none',
                  borderRadius: 6,
                  width: 28,
                  height: 28,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  zIndex: 1,
                }}
              >
                <TrashIcon />
              </button>

              <div style={{ aspectRatio: '3/4', background: C.lighter, position: 'relative' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {/* biome-ignore lint/performance/noImgElement: local/generated preview */}
                <img
                  src={item.fileUrl}
                  alt="Upload preview"
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                />
                <div style={{ position: 'absolute', bottom: 6, left: 6 }}>
                  {item.status === 'queued' && (
                    <span
                      style={{
                        background: C.mid,
                        color: C.white,
                        fontSize: 10,
                        fontWeight: 700,
                        padding: '2px 6px',
                        borderRadius: 4,
                        textTransform: 'uppercase',
                      }}
                    >
                      Queued
                    </span>
                  )}
                  {(item.status === 'uploading' || item.status === 'generating') && (
                    <span
                      style={{
                        background: C.card,
                        color: C.pink,
                        fontSize: 10,
                        fontWeight: 700,
                        padding: '2px 8px',
                        borderRadius: 4,
                        textTransform: 'uppercase',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        border: `1px solid ${C.border2}`,
                      }}
                    >
                      <SpinnerIcon size={10} />{' '}
                      {item.status === 'uploading' ? 'Uploading' : 'Generating'}
                    </span>
                  )}
                  {item.status === 'generated' && (
                    <span
                      style={{
                        background: '#10b981',
                        color: C.white,
                        fontSize: 10,
                        fontWeight: 700,
                        padding: '2px 6px',
                        borderRadius: 4,
                        textTransform: 'uppercase',
                      }}
                    >
                      ✓ Generated
                    </span>
                  )}
                  {item.status === 'failed' && (
                    <span
                      style={{
                        background: C.pink,
                        color: C.white,
                        fontSize: 10,
                        fontWeight: 700,
                        padding: '2px 6px',
                        borderRadius: 4,
                        textTransform: 'uppercase',
                      }}
                    >
                      Failed
                    </span>
                  )}
                </div>
              </div>

              {item.status === 'generated' && (
                <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <input
                    placeholder="SKU"
                    value={item.sku}
                    onChange={(e) => handleUpdateItem(item.id, { sku: e.target.value })}
                    style={{
                      width: '100%',
                      height: 32,
                      fontSize: 12,
                      borderRadius: 6,
                      border: `1px solid ${item.hasError && !item.sku ? C.pink : C.border2}`,
                      padding: '0 8px',
                      background: C.field,
                      color: C.text,
                    }}
                  />
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      type="number"
                      placeholder="₹ Actual"
                      value={item.actualPrice}
                      onChange={(e) => handleUpdateItem(item.id, { actualPrice: e.target.value })}
                      style={{
                        width: '100%',
                        height: 32,
                        fontSize: 12,
                        borderRadius: 6,
                        border: `1px solid ${item.hasError && (!item.actualPrice || parseInt(item.offerPrice, 10) > parseInt(item.actualPrice, 10)) ? C.pink : C.border2}`,
                        padding: '0 8px',
                        background: C.field,
                        color: C.text,
                      }}
                    />
                    <input
                      type="number"
                      placeholder="₹ Offer"
                      value={item.offerPrice}
                      onChange={(e) => handleUpdateItem(item.id, { offerPrice: e.target.value })}
                      style={{
                        width: '100%',
                        height: 32,
                        fontSize: 12,
                        borderRadius: 6,
                        border: `1px solid ${item.hasError && (!item.offerPrice || parseInt(item.offerPrice, 10) > parseInt(item.actualPrice, 10)) ? C.pink : C.border2}`,
                        padding: '0 8px',
                        background: C.field,
                        color: C.text,
                      }}
                    />
                  </div>
                  {item.hasError && (
                    <div style={{ fontSize: 10, color: C.pink, lineHeight: 1.2 }}>
                      Please fill valid SKU and ensure Offer ≤ Actual Price.
                    </div>
                  )}
                </div>
              )}

              {item.status === 'failed' && item.errorMessage && (
                <div style={{ padding: 10, fontSize: 10, color: C.pink, lineHeight: 1.3 }}>
                  {item.errorMessage}
                </div>
              )}
            </div>
          ))}
        </div>

        {saveError && (
          <div
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              background: 'rgba(245,92,122,0.06)',
              border: `1px solid ${C.pink}`,
              fontSize: 13,
              color: C.pink,
            }}
          >
            {saveError}
          </div>
        )}
      </div>

      <StickyBottomBar>
        <button
          type="button"
          onClick={goBackToProducts}
          disabled={busy}
          style={{
            flex: 1,
            height: 48,
            borderRadius: 8,
            border: `1px solid ${C.border2}`,
            background: C.white,
            color: C.text,
            fontFamily: 'inherit',
            fontSize: 15,
            fontWeight: 600,
            cursor: busy ? 'not-allowed' : 'pointer',
          }}
        >
          Cancel
        </button>
        <div style={{ flex: 1 }}>
          <GradBtn
            type="button"
            disabled={generatedCount === 0 || isAnyGenerating || isSaving}
            onClick={() => void handleAddCatalogue()}
            style={{ width: '100%', height: 48 }}
          >
            {isSaving ? 'Saving…' : `Add ${generatedCount} to Catalogue`}
          </GradBtn>
        </div>
      </StickyBottomBar>
    </div>
  );
}
