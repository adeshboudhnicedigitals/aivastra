'use client';
import type { MerchantCatalogItem } from '@aivastra/types';
import { useEffect, useRef, useState } from 'react';
import { CameraIcon, InfoIcon, SpinnerIcon, UploadIcon } from '@/components/icons';
import { GradBtn } from '@/components/ui/grad-btn';
import { catalogAppApi as api } from '../catalog-app-api';
import {
  deleteProduct,
  finalizeGeneratedProduct,
  pollGenerateJob,
  presignAndUpload,
} from '../catalog-app-helpers';
import { LIGHT } from '../theme';
import { useSessionExpiryMessage } from '../use-session-expiry-message';
import { StickyBottomBar } from './StickyBottomBar';

export function ProductForm({
  subcategoryId,
  initialData,
  supportsTwoInputMannequin = false,
  supportsTwoInputDirectTryon = false,
  onSaved,
  onCancel,
}: {
  subcategoryId: string;
  initialData?: MerchantCatalogItem;
  // Flat Image's AI-generate step isn't needed for two-input (body+pallu) products — see
  // ProductModal.tsx (apps/catalogues-web/.../tryon/) for the sibling implementation this
  // mirrors. Optional/defaulted here because most subcategories aren't two-input-capable
  // and every existing caller predates this prop.
  supportsTwoInputMannequin?: boolean;
  supportsTwoInputDirectTryon?: boolean;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const isEditing = !!initialData;
  const getErrorMessage = useSessionExpiryMessage();

  const [label, setLabel] = useState(initialData?.label ?? '');
  const [sku, setSku] = useState(initialData?.sku ?? '');
  const [actualPrice, setActualPrice] = useState(initialData?.actualPrice.toString() ?? '');
  const [offerPrice, setOfferPrice] = useState(initialData?.offerPrice.toString() ?? '');
  // Server default for a newly created item is active — mirror that here so
  // leaving the toggle untouched needs no extra API call on create.
  const [liveInApp, setLiveInApp] = useState(initialData?.isActive ?? true);
  const [errorMsg, setErrorMsg] = useState<string | undefined>(undefined);

  const [imageMode, setImageMode] = useState<'catalogue' | 'flat'>('catalogue');
  const [selectedFile, setSelectedFile] = useState<File | undefined>(undefined);
  const [previewUrl, setPreviewUrl] = useState<string | undefined>(undefined);
  // Pallu — only relevant in 'catalogue' imageMode for a two-input-direct-tryon-capable
  // subcategory. Mirrors ProductModal.tsx's palluFile/palluPreviewUrl.
  const [palluFile, setPalluFile] = useState<File | undefined>(undefined);
  const [palluPreviewUrl, setPalluPreviewUrl] = useState<string | undefined>(undefined);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  // The product row created by the generate+import flow, still awaiting the
  // user's SKU/price entry before the final Save PATCH. If the form unmounts
  // before that PATCH happens, it's a $0 orphan and gets best-effort deleted.
  const [generatedItem, setGeneratedItem] = useState<MerchantCatalogItem | undefined>(undefined);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const palluFileInputRef = useRef<HTMLInputElement>(null);
  const palluCameraInputRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | undefined>(undefined);
  previewUrlRef.current = previewUrl;
  const palluPreviewUrlRef = useRef<string | undefined>(undefined);
  palluPreviewUrlRef.current = palluPreviewUrl;
  const generatedItemRef = useRef<MerchantCatalogItem | undefined>(undefined);
  generatedItemRef.current = generatedItem;

  // Clean up on unmount: revoke the object URL and delete an unsaved generated product.
  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      if (palluPreviewUrlRef.current) URL.revokeObjectURL(palluPreviewUrlRef.current);
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

  const handlePalluFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (palluPreviewUrl) URL.revokeObjectURL(palluPreviewUrl);
    setPalluFile(file);
    setPalluPreviewUrl(URL.createObjectURL(file));
    setErrorMsg(undefined);
  };

  const requiresCataloguePallu = imageMode === 'catalogue' && supportsTwoInputDirectTryon;

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
      setErrorMsg(getErrorMessage(err, 'Generation failed.'));
    } finally {
      setIsGenerating(false);
    }
  };

  const actualPriceNum = actualPrice ? parseInt(actualPrice, 10) : 0;
  const offerPriceNum = offerPrice ? parseInt(offerPrice, 10) : 0;
  const hasPriceError = offerPriceNum > actualPriceNum;
  const missingImage =
    !isEditing &&
    ((imageMode === 'catalogue' && (!selectedFile || (requiresCataloguePallu && !palluFile))) ||
      (imageMode === 'flat' && !generatedItem));
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
        await api.patch(`/v1/merchant/catalog/${initialData.id}`, {
          ...priceFields,
          isActive: liveInApp,
        });
      } else if (imageMode === 'flat') {
        if (!generatedItem) throw new Error('Generate the catalogue image first.');
        await api.patch(`/v1/merchant/catalog/${generatedItem.id}`, {
          ...priceFields,
          isActive: liveInApp,
        });
      } else {
        if (!selectedFile) throw new Error('Upload a product image first.');
        if (requiresCataloguePallu && !palluFile) throw new Error('Upload the pallu photo first.');
        const [{ r2Key }, { r2Key: thumbnailKey }] = await Promise.all([
          presignAndUpload(selectedFile, 'image'),
          presignAndUpload(selectedFile, 'thumbnail'),
        ]);
        let secondR2Key: string | undefined;
        let secondThumbnailKey: string | undefined;
        if (requiresCataloguePallu) {
          const [secondUpload, secondThumbUpload] = await Promise.all([
            presignAndUpload(palluFile as File, 'image'),
            presignAndUpload(palluFile as File, 'thumbnail'),
          ]);
          secondR2Key = secondUpload.r2Key;
          secondThumbnailKey = secondThumbUpload.r2Key;
        }
        // MerchantCatalogCreateBody has no isActive field (new items are
        // always active server-side) — a follow-up PATCH is the only way to
        // land the toggle when the merchant switched it off before saving.
        const created = await api.post<MerchantCatalogItem>('/v1/merchant/catalog', {
          subcategoryId,
          r2Key,
          thumbnailKey,
          ...(secondR2Key ? { secondR2Key } : {}),
          ...(secondThumbnailKey ? { secondThumbnailKey } : {}),
          ...priceFields,
        });
        if (!liveInApp) {
          await api.patch(`/v1/merchant/catalog/${created.id}`, { isActive: false });
        }
      }

      setGeneratedItem(undefined); // saved — don't clean it up on unmount
      onSaved();
    } catch (err) {
      setErrorMsg(getErrorMessage(err, 'Failed to save product.'));
    } finally {
      setIsSaving(false);
    }
  };

  const busy = isGenerating || isSaving;
  const displayImageUrl = previewUrl ?? initialData?.imageUrl ?? undefined;

  return (
    <>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 20, padding: 16 }}>
        <div
          style={{
            border: `1px solid ${LIGHT.border2}`,
            borderRadius: 8,
            padding: '12px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: LIGHT.text }}>Live in App</span>
              <span style={{ display: 'flex', color: LIGHT.mid }}>
                <InfoIcon size={14} />
              </span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={liveInApp}
              aria-label="Live in App"
              onClick={() => setLiveInApp((v) => !v)}
              style={{
                width: 42,
                height: 24,
                borderRadius: 999,
                border: 'none',
                padding: 2,
                background: liveInApp ? '#f55c7a' : LIGHT.border2,
                cursor: 'pointer',
                display: 'flex',
                justifyContent: liveInApp ? 'flex-end' : 'flex-start',
                transition: 'background 0.15s ease',
              }}
            >
              <span
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  background: '#ffffff',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
                  display: 'block',
                }}
              />
            </button>
          </div>
          <p style={{ fontSize: 12, color: LIGHT.mid, margin: 0 }}>
            {liveInApp
              ? 'Your product will be visible to users'
              : 'Your product will be hidden from users'}
          </p>
        </div>

        {isEditing ? (
          <div
            style={{
              height: 200,
              borderRadius: 8,
              border: `1px solid ${LIGHT.border2}`,
              background: LIGHT.field,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
            }}
          >
            {displayImageUrl ? (
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
            {/* Flat Image's AI-generate step isn't needed for two-input (body+pallu)
                products — see ProductModal.tsx for the sibling implementation this
                mirrors — so it's hidden (not removed) for two-input-capable
                subcategories; Catalogue Image (direct upload) only. */}
            {!supportsTwoInputMannequin && (
              <div
                style={{
                  display: 'flex',
                  borderRadius: 8,
                  border: `1px solid ${LIGHT.border2}`,
                  overflow: 'hidden',
                  background: LIGHT.card,
                }}
              >
                <button
                  type="button"
                  onClick={() => setImageMode('catalogue')}
                  disabled={busy}
                  style={{
                    flex: 1,
                    padding: '12px 16px',
                    border: 'none',
                    background:
                      imageMode === 'catalogue' ? 'rgba(245, 92, 122, 0.08)' : 'transparent',
                    color: imageMode === 'catalogue' ? '#f55c7a' : LIGHT.text,
                    fontWeight: imageMode === 'catalogue' ? 600 : 500,
                    fontSize: 14,
                    fontFamily: 'inherit',
                    cursor: busy ? 'not-allowed' : 'pointer',
                    transition: 'all 0.15s ease',
                    borderRight: `1px solid ${LIGHT.border2}`,
                  }}
                >
                  Catalogue Image
                </button>
                <button
                  type="button"
                  onClick={() => setImageMode('flat')}
                  disabled={busy}
                  style={{
                    flex: 1,
                    padding: '12px 16px',
                    border: 'none',
                    background: imageMode === 'flat' ? 'rgba(245, 92, 122, 0.08)' : 'transparent',
                    color: imageMode === 'flat' ? '#f55c7a' : LIGHT.text,
                    fontWeight: imageMode === 'flat' ? 600 : 500,
                    fontSize: 14,
                    fontFamily: 'inherit',
                    cursor: busy ? 'not-allowed' : 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  Flat Image
                </button>
              </div>
            )}

            {imageMode === 'catalogue' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {previewUrl ? (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={busy}
                    style={{
                      height: 180,
                      borderRadius: 8,
                      border: `1px dashed ${LIGHT.border2}`,
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
                    {/* biome-ignore lint/performance/noImgElement: local preview */}
                    <img
                      src={previewUrl}
                      alt="Preview"
                      style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                    />
                  </button>
                ) : (
                  <div
                    style={{
                      height: 180,
                      borderRadius: 8,
                      border: `1px dashed ${LIGHT.border2}`,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 12,
                      width: '100%',
                    }}
                  >
                    <div style={{ color: LIGHT.mid }}>
                      <UploadIcon size={28} />
                    </div>
                    <div style={{ fontSize: 13, color: LIGHT.mid, fontWeight: 500 }}>
                      Tap to choose a product photo
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        type="button"
                        onClick={() => cameraInputRef.current?.click()}
                        disabled={busy}
                        className="hover-surface"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          height: 36,
                          padding: '0 14px',
                          borderRadius: 8,
                          border: `1px solid ${LIGHT.border2}`,
                          background: 'none',
                          color: LIGHT.text,
                          fontFamily: 'inherit',
                          fontSize: 13,
                          fontWeight: 600,
                          cursor: busy ? 'not-allowed' : 'pointer',
                        }}
                      >
                        <CameraIcon size={16} />
                        Take Photo
                      </button>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={busy}
                        className="hover-surface"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          height: 36,
                          padding: '0 14px',
                          borderRadius: 8,
                          border: `1px solid ${LIGHT.border2}`,
                          background: 'none',
                          color: LIGHT.text,
                          fontFamily: 'inherit',
                          fontSize: 13,
                          fontWeight: 600,
                          cursor: busy ? 'not-allowed' : 'pointer',
                        }}
                      >
                        <UploadIcon size={16} />
                        Choose from Gallery
                      </button>
                    </div>
                  </div>
                )}
                {requiresCataloguePallu &&
                  (palluPreviewUrl ? (
                    <button
                      type="button"
                      onClick={() => palluFileInputRef.current?.click()}
                      disabled={busy}
                      style={{
                        height: 180,
                        borderRadius: 8,
                        border: `1px dashed ${LIGHT.border2}`,
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
                      {/* biome-ignore lint/performance/noImgElement: local preview */}
                      <img
                        src={palluPreviewUrl}
                        alt="Pallu Preview"
                        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                      />
                    </button>
                  ) : (
                    <div
                      style={{
                        height: 180,
                        borderRadius: 8,
                        border: `1px dashed ${LIGHT.border2}`,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 12,
                        width: '100%',
                      }}
                    >
                      <div style={{ color: LIGHT.mid }}>
                        <UploadIcon size={28} />
                      </div>
                      <div style={{ fontSize: 13, color: LIGHT.mid, fontWeight: 500 }}>
                        Tap to choose the pallu photo
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          type="button"
                          onClick={() => palluCameraInputRef.current?.click()}
                          disabled={busy}
                          className="hover-surface"
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            height: 36,
                            padding: '0 14px',
                            borderRadius: 8,
                            border: `1px solid ${LIGHT.border2}`,
                            background: 'none',
                            color: LIGHT.text,
                            fontFamily: 'inherit',
                            fontSize: 13,
                            fontWeight: 600,
                            cursor: busy ? 'not-allowed' : 'pointer',
                          }}
                        >
                          <CameraIcon size={16} />
                          Take Photo
                        </button>
                        <button
                          type="button"
                          onClick={() => palluFileInputRef.current?.click()}
                          disabled={busy}
                          className="hover-surface"
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            height: 36,
                            padding: '0 14px',
                            borderRadius: 8,
                            border: `1px solid ${LIGHT.border2}`,
                            background: 'none',
                            color: LIGHT.text,
                            fontFamily: 'inherit',
                            fontSize: 13,
                            fontWeight: 600,
                            cursor: busy ? 'not-allowed' : 'pointer',
                          }}
                        >
                          <UploadIcon size={16} />
                          Choose from Gallery
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            ) : !previewUrl ? (
              <div
                style={{
                  height: 180,
                  borderRadius: 8,
                  border: `1px dashed ${LIGHT.border2}`,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 12,
                  width: '100%',
                }}
              >
                <div style={{ color: LIGHT.mid }}>
                  <UploadIcon size={28} />
                </div>
                <div style={{ fontSize: 13, color: LIGHT.mid, fontWeight: 500 }}>
                  Upload flat garment photo
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => cameraInputRef.current?.click()}
                    disabled={busy}
                    className="hover-surface"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      height: 36,
                      padding: '0 14px',
                      borderRadius: 8,
                      border: `1px solid ${LIGHT.border2}`,
                      background: 'none',
                      color: LIGHT.text,
                      fontFamily: 'inherit',
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: busy ? 'not-allowed' : 'pointer',
                    }}
                  >
                    <CameraIcon size={16} />
                    Take Photo
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={busy}
                    className="hover-surface"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      height: 36,
                      padding: '0 14px',
                      borderRadius: 8,
                      border: `1px solid ${LIGHT.border2}`,
                      background: 'none',
                      color: LIGHT.text,
                      fontFamily: 'inherit',
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: busy ? 'not-allowed' : 'pointer',
                    }}
                  >
                    <UploadIcon size={16} />
                    Choose from Gallery
                  </button>
                </div>
              </div>
            ) : (
              <div
                style={{
                  display: 'flex',
                  gap: 16,
                  alignItems: 'center',
                  padding: 16,
                  borderRadius: 8,
                  border: `1px solid ${LIGHT.border2}`,
                  background: 'transparent',
                }}
              >
                <div
                  style={{
                    width: 96,
                    height: 120,
                    borderRadius: 8,
                    border: `1px solid ${LIGHT.border2}`,
                    background: LIGHT.field,
                    position: 'relative',
                    overflow: 'hidden',
                    flexShrink: 0,
                  }}
                >
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
                        top: 6,
                        right: 6,
                        background: '#f55c7a',
                        color: LIGHT.card,
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
                <div
                  style={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    gap: 12,
                  }}
                >
                  {!generatedItem ? (
                    <>
                      <GradBtn
                        type="button"
                        onClick={() => void handleGenerate()}
                        disabled={isGenerating}
                      >
                        {isGenerating && <SpinnerIcon size={14} />}
                        {isGenerating ? 'Generating...' : 'Generate Catalogue Image'}
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
                          color: LIGHT.mid,
                          fontSize: 13,
                          fontFamily: 'inherit',
                          fontWeight: 500,
                          cursor: isGenerating ? 'not-allowed' : 'pointer',
                          textDecoration: 'underline',
                        }}
                      >
                        Choose a different image
                      </button>
                    </>
                  ) : (
                    <>
                      <div style={{ fontSize: 13, color: LIGHT.text, fontWeight: 500 }}>
                        Ready to use!
                      </div>
                      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                        <button
                          type="button"
                          onClick={() => void handleGenerate()}
                          disabled={busy}
                          style={{
                            background: 'none',
                            border: 'none',
                            padding: 0,
                            color: LIGHT.text,
                            fontSize: 13,
                            fontFamily: 'inherit',
                            fontWeight: 600,
                            cursor: busy ? 'not-allowed' : 'pointer',
                            textDecoration: 'underline',
                          }}
                        >
                          Regenerate
                        </button>
                        <span style={{ color: LIGHT.border2 }}>|</span>
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
                            color: LIGHT.mid,
                            fontSize: 13,
                            fontFamily: 'inherit',
                            fontWeight: 500,
                            cursor: busy ? 'not-allowed' : 'pointer',
                            textDecoration: 'underline',
                          }}
                        >
                          Change image
                        </button>
                      </div>
                    </>
                  )}
                </div>
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
        <input
          type="file"
          ref={cameraInputRef}
          onChange={handleFileChange}
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          style={{ display: 'none' }}
          tabIndex={-1}
        />
        <input
          type="file"
          ref={palluFileInputRef}
          onChange={handlePalluFileChange}
          accept="image/jpeg,image/png,image/webp"
          style={{ display: 'none' }}
          tabIndex={-1}
        />
        <input
          type="file"
          ref={palluCameraInputRef}
          onChange={handlePalluFileChange}
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          style={{ display: 'none' }}
          tabIndex={-1}
        />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label
            htmlFor="product-name"
            style={{ fontSize: 13, fontWeight: 600, color: LIGHT.text }}
          >
            Product Name <span style={{ color: '#f55c7a' }}>*</span>
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
              border: `1px solid ${LIGHT.border2}`,
              padding: '0 14px',
              fontSize: 15,
              fontFamily: 'inherit',
              background: LIGHT.field,
              color: LIGHT.text,
            }}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label htmlFor="product-sku" style={{ fontSize: 13, fontWeight: 600, color: LIGHT.text }}>
            SKU <span style={{ color: '#f55c7a' }}>*</span>
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
              border: `1px solid ${LIGHT.border2}`,
              padding: '0 14px',
              fontSize: 15,
              fontFamily: 'inherit',
              background: LIGHT.field,
              color: LIGHT.text,
            }}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label
            htmlFor="product-actual-price"
            style={{ fontSize: 13, fontWeight: 600, color: LIGHT.text }}
          >
            Actual Price <span style={{ color: '#f55c7a' }}>*</span>
          </label>
          <div style={{ position: 'relative' }}>
            <span
              style={{
                position: 'absolute',
                left: 14,
                top: '50%',
                transform: 'translateY(-50%)',
                fontSize: 15,
                color: LIGHT.mid,
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
                border: `1px solid ${LIGHT.border2}`,
                padding: '0 14px 0 28px',
                fontSize: 15,
                fontFamily: 'inherit',
                background: LIGHT.field,
                color: LIGHT.text,
              }}
            />
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label
            htmlFor="product-offer-price"
            style={{ fontSize: 13, fontWeight: 600, color: LIGHT.text }}
          >
            Offer Price <span style={{ color: '#f55c7a' }}>*</span>
          </label>
          <div style={{ position: 'relative' }}>
            <span
              style={{
                position: 'absolute',
                left: 14,
                top: '50%',
                transform: 'translateY(-50%)',
                fontSize: 15,
                color: LIGHT.mid,
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
                border: `1px solid ${hasPriceError ? '#f55c7a' : LIGHT.border2}`,
                padding: '0 14px 0 28px',
                fontSize: 15,
                fontFamily: 'inherit',
                background: LIGHT.field,
                color: LIGHT.text,
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
              border: '1px solid #f55c7a',
              fontSize: 13,
              color: '#f55c7a',
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
              border: '1px solid #f55c7a',
              fontSize: 13,
              color: '#f55c7a',
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
            border: `1px solid ${LIGHT.border2}`,
            background: LIGHT.card,
            color: LIGHT.text,
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
            {isSaving ? 'Saving…' : 'Save Product'}
          </GradBtn>
        </div>
      </StickyBottomBar>
    </>
  );
}
