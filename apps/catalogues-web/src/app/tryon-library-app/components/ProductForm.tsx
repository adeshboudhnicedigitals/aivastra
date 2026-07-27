'use client';
import type { MerchantCatalogItem } from '@aivastra/types';
import { useEffect, useRef, useState } from 'react';
import { SpinnerIcon, UploadIcon } from '@/components/icons';
import { C } from '@/components/tokens';
import { GradBtn } from '@/components/ui/grad-btn';
import { catalogAppApi as api } from '../catalog-app-api';
import {
  deleteProduct,
  finalizeGeneratedProduct,
  pollGenerateJob,
  presignAndUpload,
} from '../catalog-app-helpers';
import { StickyBottomBar } from './StickyBottomBar';

export function ProductForm({
  subcategoryId,
  initialData,
  onSaved,
  onCancel,
}: {
  subcategoryId: string;
  initialData?: MerchantCatalogItem;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const isEditing = !!initialData;

  const [label, setLabel] = useState(initialData?.label ?? '');
  const [sku, setSku] = useState(initialData?.sku ?? '');
  const [actualPrice, setActualPrice] = useState(initialData?.actualPrice.toString() ?? '');
  const [offerPrice, setOfferPrice] = useState(initialData?.offerPrice.toString() ?? '');
  const [errorMsg, setErrorMsg] = useState<string | undefined>(undefined);

  const [imageMode, setImageMode] = useState<'catalogue' | 'flat'>('catalogue');
  const [selectedFile, setSelectedFile] = useState<File | undefined>(undefined);
  const [previewUrl, setPreviewUrl] = useState<string | undefined>(undefined);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [generatedItem, setGeneratedItem] = useState<MerchantCatalogItem | undefined>(undefined);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | undefined>(undefined);
  previewUrlRef.current = previewUrl;
  const generatedItemRef = useRef<MerchantCatalogItem | undefined>(undefined);
  generatedItemRef.current = generatedItem;

  // Clean up on unmount: revoke the object URL, and best-effort delete an
  // unsaved generated product so it doesn't sit as a $0 orphan.
  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      if (generatedItemRef.current) void deleteProduct(generatedItemRef.current.id);
    };
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setErrorMsg(undefined);
    if (imageMode === 'flat' && generatedItem) {
      void deleteProduct(generatedItem.id);
      setGeneratedItem(undefined);
    }
  };

  const handleGenerate = async () => {
    if (!selectedFile) return;
    setIsGenerating(true);
    setErrorMsg(undefined);
    try {
      if (generatedItem) {
        await deleteProduct(generatedItem.id);
        setGeneratedItem(undefined);
      }
      const { r2Key: flatImageKey } = await presignAndUpload(selectedFile, 'flat');
      const { jobId } = await api.post<{ jobId: string }>('/v1/merchant/catalog/generate', {
        subcategoryId,
        flatImageKey,
      });
      const status = await pollGenerateJob(jobId);
      if (status.status !== 'COMPLETED') {
        throw new Error(
          status.errorCode
            ? `Generation failed (${status.errorCode})`
            : 'Generation failed. Please try again.',
        );
      }
      const item = await finalizeGeneratedProduct(jobId, subcategoryId);
      setGeneratedItem(item);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Generation failed.');
    } finally {
      setIsGenerating(false);
    }
  };

  const actualPriceNum = actualPrice ? parseInt(actualPrice, 10) : 0;
  const offerPriceNum = offerPrice ? parseInt(offerPrice, 10) : 0;
  const hasPriceError = offerPriceNum > actualPriceNum;
  const missingImage =
    !isEditing &&
    ((imageMode === 'catalogue' && !selectedFile) || (imageMode === 'flat' && !generatedItem));
  const isSaveDisabled = hasPriceError || isGenerating || isSaving || missingImage;

  const handleSubmit = async () => {
    if (!label.trim() || !sku.trim() || !actualPrice || !offerPrice) return;
    if (isSaveDisabled) return;

    setIsSaving(true);
    setErrorMsg(undefined);
    try {
      const priceFields = {
        label: label.trim(),
        sku: sku.trim(),
        actualPrice: actualPriceNum,
        offerPrice: offerPriceNum,
      };

      if (isEditing && initialData) {
        await api.patch(`/v1/merchant/catalog/${initialData.id}`, priceFields);
      } else if (imageMode === 'flat') {
        if (!generatedItem) throw new Error('Generate the catalogue image first.');
        await api.patch(`/v1/merchant/catalog/${generatedItem.id}`, priceFields);
      } else {
        if (!selectedFile) throw new Error('Upload a product image first.');
        const [{ r2Key }, { r2Key: thumbnailKey }] = await Promise.all([
          presignAndUpload(selectedFile, 'image'),
          presignAndUpload(selectedFile, 'thumbnail'),
        ]);
        await api.post('/v1/merchant/catalog', {
          subcategoryId,
          r2Key,
          thumbnailKey,
          ...priceFields,
        });
      }

      setGeneratedItem(undefined); // saved — don't clean it up on unmount
      onSaved();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save product.');
    } finally {
      setIsSaving(false);
    }
  };

  const busy = isGenerating || isSaving;
  const displayImageUrl = previewUrl ?? initialData?.imageUrl ?? undefined;

  return (
    <>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 20, padding: 16 }}>
        {isEditing ? (
          <div
            style={{
              height: 200,
              borderRadius: 8,
              border: `1px solid ${C.border2}`,
              background: C.field,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
            }}
          >
            {displayImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              // biome-ignore lint/performance/noImgElement: presigned R2 preview
              <img
                src={displayImageUrl}
                alt={label || 'Product'}
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              />
            ) : (
              <UploadIcon size={28} />
            )}
          </div>
        ) : (
          <>
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
                onClick={() => {
                  if (imageMode !== 'catalogue') {
                    if (previewUrl) URL.revokeObjectURL(previewUrl);
                    if (generatedItem) void deleteProduct(generatedItem.id);
                    setSelectedFile(undefined);
                    setPreviewUrl(undefined);
                    setGeneratedItem(undefined);
                  }
                  setImageMode('catalogue');
                }}
                disabled={busy}
                style={{
                  flex: 1,
                  padding: '12px 8px',
                  border: 'none',
                  background:
                    imageMode === 'catalogue' ? 'rgba(245, 92, 122, 0.08)' : 'transparent',
                  color: imageMode === 'catalogue' ? C.pink : C.text,
                  fontWeight: imageMode === 'catalogue' ? 600 : 500,
                  fontSize: 14,
                  cursor: busy ? 'not-allowed' : 'pointer',
                  borderRight: `1px solid ${C.border2}`,
                }}
              >
                Catalogue Image
              </button>
              <button
                type="button"
                onClick={() => {
                  if (imageMode !== 'flat') {
                    if (previewUrl) URL.revokeObjectURL(previewUrl);
                    if (generatedItem) void deleteProduct(generatedItem.id);
                    setSelectedFile(undefined);
                    setPreviewUrl(undefined);
                    setGeneratedItem(undefined);
                  }
                  setImageMode('flat');
                }}
                disabled={busy}
                style={{
                  flex: 1,
                  padding: '12px 8px',
                  border: 'none',
                  background: imageMode === 'flat' ? 'rgba(245, 92, 122, 0.08)' : 'transparent',
                  color: imageMode === 'flat' ? C.pink : C.text,
                  fontWeight: imageMode === 'flat' ? 600 : 500,
                  fontSize: 14,
                  cursor: busy ? 'not-allowed' : 'pointer',
                }}
              >
                Flat Image
              </button>
            </div>

            {imageMode === 'catalogue' ? (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy}
                style={{
                  height: 180,
                  borderRadius: 8,
                  border: `1px dashed ${C.border2}`,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: busy ? 'not-allowed' : 'pointer',
                  overflow: 'hidden',
                  position: 'relative',
                  gap: 8,
                  background: 'none',
                  padding: 0,
                  fontFamily: 'inherit',
                  width: '100%',
                }}
                className="hover-surface"
              >
                {previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  // biome-ignore lint/performance/noImgElement: local preview
                  <img
                    src={previewUrl}
                    alt="Preview"
                    style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                  />
                ) : (
                  <>
                    <div style={{ color: C.mid }}>
                      <UploadIcon size={28} />
                    </div>
                    <div style={{ fontSize: 13, color: C.mid, fontWeight: 500 }}>
                      Tap to choose a product photo
                    </div>
                  </>
                )}
              </button>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {!previewUrl ? (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={busy}
                    style={{
                      height: 180,
                      borderRadius: 8,
                      border: `1px dashed ${C.border2}`,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: busy ? 'not-allowed' : 'pointer',
                      gap: 8,
                      background: 'none',
                      padding: 0,
                      fontFamily: 'inherit',
                      width: '100%',
                    }}
                    className="hover-surface"
                  >
                    <div style={{ color: C.mid }}>
                      <UploadIcon size={28} />
                    </div>
                    <div style={{ fontSize: 13, color: C.mid, fontWeight: 500 }}>
                      Tap to upload a flat garment photo
                    </div>
                  </button>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div
                      style={{
                        height: 160,
                        borderRadius: 8,
                        border: `1px solid ${C.border2}`,
                        background: C.field,
                        position: 'relative',
                        overflow: 'hidden',
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {/* biome-ignore lint/performance/noImgElement: local/generated preview */}
                      <img
                        src={generatedItem?.imageUrl ?? previewUrl}
                        alt="Flat Garment"
                        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                      />
                      {generatedItem && (
                        <div
                          style={{
                            position: 'absolute',
                            top: 8,
                            right: 8,
                            background: C.pink,
                            color: C.white,
                            fontSize: 10,
                            fontWeight: 700,
                            padding: '2px 6px',
                            borderRadius: 4,
                            textTransform: 'uppercase',
                          }}
                        >
                          Generated
                        </div>
                      )}
                    </div>
                    {!generatedItem ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <GradBtn type="button" onClick={handleGenerate} disabled={busy}>
                          {isGenerating && <SpinnerIcon size={14} />}
                          {isGenerating ? 'Generating…' : 'Generate Catalogue Image'}
                        </GradBtn>
                        <button
                          type="button"
                          onClick={() => {
                            if (previewUrl) URL.revokeObjectURL(previewUrl);
                            setSelectedFile(undefined);
                            setPreviewUrl(undefined);
                          }}
                          disabled={isGenerating}
                          style={{
                            background: 'none',
                            border: 'none',
                            padding: 0,
                            color: C.mid,
                            fontSize: 13,
                            fontWeight: 500,
                            cursor: isGenerating ? 'not-allowed' : 'pointer',
                            textDecoration: 'underline',
                            alignSelf: 'flex-start',
                          }}
                        >
                          Choose a different image
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                        <button
                          type="button"
                          onClick={handleGenerate}
                          disabled={busy}
                          style={{
                            background: 'none',
                            border: 'none',
                            padding: 0,
                            color: C.text,
                            fontSize: 13,
                            fontWeight: 600,
                            cursor: busy ? 'not-allowed' : 'pointer',
                            textDecoration: 'underline',
                          }}
                        >
                          Regenerate
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (previewUrl) URL.revokeObjectURL(previewUrl);
                            if (generatedItem) void deleteProduct(generatedItem.id);
                            setSelectedFile(undefined);
                            setPreviewUrl(undefined);
                            setGeneratedItem(undefined);
                          }}
                          disabled={busy}
                          style={{
                            background: 'none',
                            border: 'none',
                            padding: 0,
                            color: C.mid,
                            fontSize: 13,
                            fontWeight: 500,
                            cursor: busy ? 'not-allowed' : 'pointer',
                            textDecoration: 'underline',
                          }}
                        >
                          Change image
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          accept="image/jpeg,image/png,image/webp"
          style={{ display: 'none' }}
          tabIndex={-1}
        />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label htmlFor="product-name" style={{ fontSize: 13, fontWeight: 600, color: C.text }}>
            Product Name <span style={{ color: C.pink }}>*</span>
          </label>
          <input
            id="product-name"
            required
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Slim Fit Cotton Shirt"
            style={{
              width: '100%',
              height: 48,
              borderRadius: 8,
              border: `1px solid ${C.border2}`,
              padding: '0 14px',
              fontSize: 15,
              fontFamily: 'inherit',
              background: C.field,
              color: C.text,
            }}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label htmlFor="product-sku" style={{ fontSize: 13, fontWeight: 600, color: C.text }}>
            SKU <span style={{ color: C.pink }}>*</span>
          </label>
          <input
            id="product-sku"
            required
            value={sku}
            onChange={(e) => setSku(e.target.value)}
            placeholder="e.g. SH-COT-BLU-S"
            style={{
              width: '100%',
              height: 48,
              borderRadius: 8,
              border: `1px solid ${C.border2}`,
              padding: '0 14px',
              fontSize: 15,
              fontFamily: 'inherit',
              background: C.field,
              color: C.text,
            }}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label
            htmlFor="product-actual-price"
            style={{ fontSize: 13, fontWeight: 600, color: C.text }}
          >
            Actual Price <span style={{ color: C.pink }}>*</span>
          </label>
          <div style={{ position: 'relative' }}>
            <span
              style={{
                position: 'absolute',
                left: 14,
                top: '50%',
                transform: 'translateY(-50%)',
                fontSize: 15,
                color: C.mid,
                fontWeight: 600,
              }}
            >
              ₹
            </span>
            <input
              id="product-actual-price"
              required
              type="number"
              min="0"
              step="1"
              value={actualPrice}
              onChange={(e) => setActualPrice(e.target.value)}
              placeholder="0"
              style={{
                width: '100%',
                height: 48,
                borderRadius: 8,
                border: `1px solid ${C.border2}`,
                padding: '0 14px 0 28px',
                fontSize: 15,
                fontFamily: 'inherit',
                background: C.field,
                color: C.text,
              }}
            />
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label
            htmlFor="product-offer-price"
            style={{ fontSize: 13, fontWeight: 600, color: C.text }}
          >
            Offer Price <span style={{ color: C.pink }}>*</span>
          </label>
          <div style={{ position: 'relative' }}>
            <span
              style={{
                position: 'absolute',
                left: 14,
                top: '50%',
                transform: 'translateY(-50%)',
                fontSize: 15,
                color: C.mid,
                fontWeight: 600,
              }}
            >
              ₹
            </span>
            <input
              id="product-offer-price"
              required
              type="number"
              min="0"
              step="1"
              value={offerPrice}
              onChange={(e) => setOfferPrice(e.target.value)}
              placeholder="0"
              style={{
                width: '100%',
                height: 48,
                borderRadius: 8,
                border: `1px solid ${hasPriceError ? C.pink : C.border2}`,
                padding: '0 14px 0 28px',
                fontSize: 15,
                fontFamily: 'inherit',
                background: C.field,
                color: C.text,
              }}
            />
          </div>
        </div>

        {hasPriceError && (
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
            Offer price cannot be greater than the actual price.
          </div>
        )}

        {errorMsg && (
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
            {errorMsg}
          </div>
        )}
      </div>

      <StickyBottomBar>
        <button
          type="button"
          onClick={onCancel}
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
            onClick={() => void handleSubmit()}
            disabled={isSaveDisabled}
            style={{ width: '100%', height: 48 }}
          >
            {isSaving ? 'Saving…' : 'Save'}
          </GradBtn>
        </div>
      </StickyBottomBar>
    </>
  );
}
