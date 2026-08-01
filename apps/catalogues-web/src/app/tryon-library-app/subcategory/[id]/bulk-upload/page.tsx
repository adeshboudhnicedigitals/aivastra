'use client';
import { useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { SpinnerIcon, TrashIcon, UploadIcon } from '@/components/icons';
import { C } from '@/components/tokens';
import { GradBtn } from '@/components/ui/grad-btn';
import { catalogAppApi as api } from '../../../catalog-app-api';
import { deleteProduct, presignAndUpload } from '../../../catalog-app-helpers';
import { ScreenHeader } from '../../../components/ScreenHeader';
import { StickyBottomBar } from '../../../components/StickyBottomBar';
import { useSessionExpiryMessage } from '../../../use-session-expiry-message';

interface QueueItem {
  id: string;
  file: File;
  fileUrl: string;
  // 'uploaded' is catalogue mode's counterpart to 'generated': the merchant
  // supplied a finished product photo, so there is nothing to generate and the
  // detail fields open immediately. No server row exists until Save.
  // 'sent' — a flat-mode batch that was successfully handed off to the held-job pipeline; nothing more happens in this screen for it.
  status: 'queued' | 'uploading' | 'generating' | 'sent' | 'generated' | 'uploaded' | 'failed';
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

  const getErrorMessage = useSessionExpiryMessage();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [imageMode, setImageMode] = useState<'catalogue' | 'flat'>('catalogue');
  // Which status means "details editable, ready to save" in the current mode.
  const readyStatus = imageMode === 'catalogue' ? 'uploaded' : 'generated';
  const [isGeneratingAll, setIsGeneratingAll] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [sentForProcessing, setSentForProcessing] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const itemsRef = useRef<QueueItem[]>([]);
  itemsRef.current = items;

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
        // Catalogue images are already final — no generate step to wait through.
        status: imageMode === 'catalogue' ? 'uploaded' : 'queued',
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
                  errorMessage: getErrorMessage(err, 'Upload failed'),
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
                errorMessage: getErrorMessage(err, 'Failed to enqueue'),
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

    // Held batches run only when an admin releases them, so there is nothing to
    // poll here. The images land in the products list (marked "Needs details")
    // once generation finishes — see reconcileHeldProducts on that screen.
    setItems((prev) => prev.map((p) => (jobIdByLocalId.get(p.id) ? { ...p, status: 'sent' } : p)));
    setIsGeneratingAll(false);
    setSentForProcessing((prev) => prev + jobIds.length);
  };

  const handleApplyGlobalPrice = () => {
    if (!globalActual && !globalOffer) return;
    setItems((prev) =>
      prev.map((item) =>
        item.status === readyStatus
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
      if (item.status !== readyStatus) return item;
      const act = parseInt(item.actualPrice, 10) || 0;
      const off = parseInt(item.offerPrice, 10) || 0;
      const isValid =
        item.sku.trim() !== '' && item.actualPrice !== '' && item.offerPrice !== '' && off <= act;
      if (!isValid) hasValidationError = true;
      return { ...item, hasError: !isValid };
    });
    setItems(validated);
    if (hasValidationError) return;

    const ready = validated.filter((i) => i.status === readyStatus);
    if (ready.length === 0) return;

    setIsSaving(true);
    setSaveError(undefined);
    try {
      if (imageMode === 'catalogue') {
        // No job, no generation — upload each finished photo and create the row.
        await Promise.all(
          ready.map(async (item) => {
            const [{ r2Key }, { r2Key: thumbnailKey }] = await Promise.all([
              presignAndUpload(item.file, 'image'),
              presignAndUpload(item.file, 'thumbnail'),
            ]);
            await api.post('/v1/merchant/catalog', {
              subcategoryId,
              r2Key,
              thumbnailKey,
              label: `Product ${item.sku.trim().toUpperCase()}`,
              sku: item.sku.trim(),
              actualPrice: parseInt(item.actualPrice, 10),
              offerPrice: parseInt(item.offerPrice, 10),
            });
          }),
        );
      } else {
        await Promise.all(
          ready
            .filter((i): i is QueueItem & { itemId: string } => !!i.itemId)
            .map((item) =>
              api.patch(`/v1/merchant/catalog/${item.itemId}`, {
                label: `Product ${item.sku.toUpperCase()}`,
                sku: item.sku.trim(),
                actualPrice: parseInt(item.actualPrice, 10),
                offerPrice: parseInt(item.offerPrice, 10),
              }),
            ),
        );
      }
      qc.invalidateQueries({ queryKey: ['merchant-catalog-products', subcategoryId] });
      qc.invalidateQueries({ queryKey: ['merchant-catalog-subcategories'] });
      goBackToProducts();
    } catch (err) {
      setSaveError(getErrorMessage(err, 'Failed to save some items. Please try again.'));
    } finally {
      setIsSaving(false);
    }
  };

  const hasQueued = items.some((i) => i.status === 'queued');
  const hasGenerated = items.some((i) => i.status === readyStatus);
  const generatedCount = items.filter((i) => i.status === readyStatus).length;
  const isAnyGenerating = items.some((i) => i.status === 'uploading' || i.status === 'generating');

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <ScreenHeader variant="back" title="Bulk Upload" onBack={goBackToProducts} />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16, padding: 16 }}>
        <div
          style={{
            display: 'flex',
            borderRadius: 8,
            border: `1px solid ${C.border2}`,
            overflow: 'hidden',
            background: C.white,
          }}
        >
          <button
            type="button"
            onClick={() => setImageMode('catalogue')}
            disabled={busy || items.length > 0}
            style={{
              flex: 1,
              padding: '12px 16px',
              border: 'none',
              background: imageMode === 'catalogue' ? 'rgba(245, 92, 122, 0.08)' : 'transparent',
              color: imageMode === 'catalogue' ? C.pink : C.text,
              fontWeight: imageMode === 'catalogue' ? 600 : 500,
              fontSize: 14,
              fontFamily: 'inherit',
              cursor: busy || items.length > 0 ? 'not-allowed' : 'pointer',
              borderRight: `1px solid ${C.border2}`,
            }}
          >
            Catalogue Images
          </button>
          <button
            type="button"
            onClick={() => setImageMode('flat')}
            disabled={busy || items.length > 0}
            style={{
              flex: 1,
              padding: '12px 16px',
              border: 'none',
              background: imageMode === 'flat' ? 'rgba(245, 92, 122, 0.08)' : 'transparent',
              color: imageMode === 'flat' ? C.pink : C.text,
              fontWeight: imageMode === 'flat' ? 600 : 500,
              fontSize: 14,
              fontFamily: 'inherit',
              cursor: busy || items.length > 0 ? 'not-allowed' : 'pointer',
            }}
          >
            Flat Images
          </button>
        </div>

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
            {imageMode === 'catalogue'
              ? 'Tap to choose product photos'
              : 'Tap to choose flat images'}
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
              {imageMode === 'flat' && (
                <GradBtn type="button" onClick={handleGenerateAll} disabled={!hasQueued || busy}>
                  {isGeneratingAll && <SpinnerIcon size={14} />}
                  {isGeneratingAll ? 'Sending…' : 'Send for Processing'}
                </GradBtn>
              )}
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
                  {item.status === readyStatus && (
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
                      {imageMode === 'catalogue' ? '✓ Ready' : '✓ Generated'}
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
                  {item.status === 'sent' && (
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
                      Sent
                    </span>
                  )}
                </div>
              </div>

              {item.status === readyStatus && (
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

        {sentForProcessing > 0 && (
          <div
            style={{
              padding: '10px 12px',
              borderRadius: 8,
              background: C.lighter,
              border: `1px solid ${C.border}`,
              fontSize: 13,
              color: C.text,
              lineHeight: 1.4,
            }}
          >
            {sentForProcessing} image{sentForProcessing === 1 ? '' : 's'} sent for processing.
            They&apos;re queued for the next processing window — you&apos;ll find them in this
            category once they&apos;re ready, waiting for SKU and pricing.
          </div>
        )}

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
          {imageMode === 'catalogue' ? (
            <GradBtn
              type="button"
              disabled={generatedCount === 0 || isAnyGenerating || isSaving}
              onClick={() => void handleAddCatalogue()}
              style={{ width: '100%', height: 48 }}
            >
              {isSaving ? 'Saving…' : `Add ${generatedCount} to Catalogue`}
            </GradBtn>
          ) : (
            <GradBtn
              type="button"
              disabled={busy}
              onClick={goBackToProducts}
              style={{ width: '100%', height: 48 }}
            >
              Done
            </GradBtn>
          )}
        </div>
      </StickyBottomBar>
    </div>
  );
}
