'use client';
import { useEffect, useRef, useState } from 'react';
import { SpinnerIcon, UploadIcon } from '@/components/icons';
import { C } from '@/components/tokens';
import { GradBtn } from '@/components/ui/grad-btn';

export interface Product {
  id: string;
  subcategoryId: string;
  label: string;
  sku: string;
  actualPrice: number;
  offerPrice: number;
  imageDataUrl?: string;
  imageSource?: 'flat' | 'catalogue';
}

interface ProductModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (product: Omit<Product, 'id' | 'subcategoryId'>) => void;
  initialData?: Product;
}

export function ProductModal({ open, onClose, onSave, initialData }: ProductModalProps) {
  const [label, setLabel] = useState('');
  const [sku, setSku] = useState('');
  const [actualPrice, setActualPrice] = useState('');
  const [offerPrice, setOfferPrice] = useState('');
  const [imageDataUrl, setImageDataUrl] = useState<string | undefined>(undefined);
  
  const [imageMode, setImageMode] = useState<'catalogue' | 'flat'>('catalogue');
  const [flatImageUrl, setFlatImageUrl] = useState<string | undefined>(undefined);
  const [isGenerating, setIsGenerating] = useState(false);
  const [hasGenerated, setHasGenerated] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Reset state
  useEffect(() => {
    if (open) {
      if (initialData) {
        setLabel(initialData.label);
        setSku(initialData.sku);
        setActualPrice(initialData.actualPrice.toString());
        setOfferPrice(initialData.offerPrice.toString());
        setImageDataUrl(initialData.imageDataUrl);
        setImageMode(initialData.imageSource === 'flat' ? 'flat' : 'catalogue');
        if (initialData.imageSource === 'flat') {
          setFlatImageUrl(initialData.imageDataUrl);
          setHasGenerated(true);
        } else {
          setFlatImageUrl(undefined);
          setHasGenerated(false);
        }
      } else {
        setLabel('');
        setSku('');
        setActualPrice('');
        setOfferPrice('');
        setImageDataUrl(undefined);
        setImageMode('catalogue');
        setFlatImageUrl(undefined);
        setHasGenerated(false);
      }
      setIsGenerating(false);
    }
  }, [open, initialData]);

  // Escape to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Focus trap
  useEffect(() => {
    if (!open) return;
    const el = dialogRef.current;
    if (!el) return;
    const FOCUSABLE =
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusable = el.querySelectorAll<HTMLElement>(FOCUSABLE);
    if (focusable.length > 0) {
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      first?.focus();

      const trap = (e: KeyboardEvent) => {
        if (e.key !== 'Tab') return;
        if (e.shiftKey ? document.activeElement === first : document.activeElement === last) {
          e.preventDefault();
          (e.shiftKey ? last : first)?.focus();
        }
      };
      document.addEventListener('keydown', trap);
      return () => document.removeEventListener('keydown', trap);
    }
  }, [open]);

  if (!open) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      if (imageMode === 'catalogue') {
        setImageDataUrl(reader.result as string);
      } else {
        setFlatImageUrl(reader.result as string);
        setHasGenerated(false);
        setImageDataUrl(undefined);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleGenerate = () => {
    if (!flatImageUrl) return;
    setIsGenerating(true);
    setTimeout(() => {
      setImageDataUrl(flatImageUrl); // simulated result
      setHasGenerated(true);
      setIsGenerating(false);
    }, 2000);
  };

  const actualPriceNum = actualPrice ? parseInt(actualPrice, 10) : 0;
  const offerPriceNum = offerPrice ? parseInt(offerPrice, 10) : 0;
  const hasPriceError = offerPriceNum > actualPriceNum;
  const isSaveDisabled = hasPriceError || (imageMode === 'flat' && !hasGenerated) || isGenerating;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!label.trim() || !sku.trim() || !actualPrice || !offerPrice) return;
    if (isSaveDisabled) return;

    onSave({
      label: label.trim(),
      sku: sku.trim(),
      actualPrice: actualPriceNum,
      offerPrice: offerPriceNum,
      imageDataUrl,
      imageSource: imageMode,
    });
  };

  return (
    <div
      role="presentation"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        zIndex: 1100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: C.white,
          borderRadius: 14,
          padding: 24,
          width: 480,
          maxWidth: '100%',
          boxShadow: '0 12px 48px rgba(0,0,0,0.18)',
        }}
      >
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: C.text, margin: 0 }}>
            {initialData ? 'Edit Product' : 'Add Product'}
          </h3>

          <div style={{ display: 'flex', borderRadius: 8, border: `1px solid ${C.border2}`, overflow: 'hidden' }}>
            <button
              type="button"
              onClick={() => setImageMode('catalogue')}
              style={{
                flex: 1,
                padding: '8px 12px',
                border: 'none',
                background: imageMode === 'catalogue' ? 'rgba(245, 92, 122, 0.08)' : C.field,
                color: imageMode === 'catalogue' ? C.pink : C.text,
                fontWeight: imageMode === 'catalogue' ? 600 : 500,
                fontSize: 13,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                borderRight: `1px solid ${C.border2}`,
              }}
            >
              Catalogue Image
            </button>
            <button
              type="button"
              onClick={() => setImageMode('flat')}
              style={{
                flex: 1,
                padding: '8px 12px',
                border: 'none',
                background: imageMode === 'flat' ? 'rgba(245, 92, 122, 0.08)' : C.field,
                color: imageMode === 'flat' ? C.pink : C.text,
                fontWeight: imageMode === 'flat' ? 600 : 500,
                fontSize: 13,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              Flat Image
            </button>
          </div>

          {imageMode === 'catalogue' ? (
            <div
              // biome-ignore lint/a11y/useKeyWithClickEvents: simple click trigger
              onClick={() => fileInputRef.current?.click()}
              style={{
                height: 140,
                borderRadius: 8,
                border: `2px dashed ${C.border2}`,
                background: C.field,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                overflow: 'hidden',
                position: 'relative',
                gap: 8,
              }}
              className="hover-surface"
            >
              {imageDataUrl ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {/* biome-ignore lint/performance/noImgElement: local data url */}
                  <img
                    src={imageDataUrl}
                    alt="Preview"
                    style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      bottom: 0,
                      left: 0,
                      right: 0,
                      background: 'rgba(0,0,0,0.6)',
                      color: '#fff',
                      fontSize: 12,
                      textAlign: 'center',
                      padding: '6px 0',
                      fontWeight: 500,
                    }}
                  >
                    Click to change image
                  </div>
                </>
              ) : (
                <>
                  <div style={{ color: C.mid }}>
                    <UploadIcon size={28} />
                  </div>
                  <div style={{ fontSize: 13, color: C.mid, fontWeight: 500 }}>
                    Click to upload product image
                  </div>
                </>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {!flatImageUrl ? (
                <div
                  // biome-ignore lint/a11y/useKeyWithClickEvents: simple click trigger
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    height: 140,
                    borderRadius: 8,
                    border: `2px dashed ${C.border2}`,
                    background: C.field,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    overflow: 'hidden',
                    position: 'relative',
                    gap: 8,
                  }}
                  className="hover-surface"
                >
                  <div style={{ color: C.mid }}>
                    <UploadIcon size={28} />
                  </div>
                  <div style={{ fontSize: 13, color: C.mid, fontWeight: 500 }}>
                    Upload flat garment photo
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                  <div
                    style={{
                      width: 100,
                      height: 140,
                      borderRadius: 8,
                      border: `1px solid ${C.border2}`,
                      background: C.lighter,
                      position: 'relative',
                      overflow: 'hidden',
                      flexShrink: 0,
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {/* biome-ignore lint/performance/noImgElement: local preview */}
                    <img
                      src={hasGenerated && imageDataUrl ? imageDataUrl : flatImageUrl}
                      alt="Flat Garment"
                      style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                    />
                    {hasGenerated && (
                      <div
                        style={{
                          position: 'absolute',
                          top: 6,
                          right: 6,
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
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {!hasGenerated ? (
                      <>
                        <GradBtn type="button" onClick={handleGenerate} disabled={isGenerating}>
                          {isGenerating && <SpinnerIcon size={14} />}
                          {isGenerating ? 'Generating...' : 'Generate Catalogue Image'}
                        </GradBtn>
                        <button
                          type="button"
                          onClick={() => {
                            setFlatImageUrl(undefined);
                            setImageDataUrl(undefined);
                          }}
                          disabled={isGenerating}
                          style={{
                            background: 'none',
                            border: 'none',
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
                      </>
                    ) : (
                      <>
                        <div style={{ fontSize: 13, color: C.text, fontWeight: 500 }}>
                          Ready to use!
                        </div>
                        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                          <button
                            type="button"
                            onClick={handleGenerate}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: C.text,
                              fontSize: 13,
                              fontWeight: 600,
                              cursor: 'pointer',
                              textDecoration: 'underline',
                            }}
                          >
                            Regenerate
                          </button>
                          <span style={{ color: C.border2 }}>|</span>
                          <button
                            type="button"
                            onClick={() => {
                              setFlatImageUrl(undefined);
                              setImageDataUrl(undefined);
                              setHasGenerated(false);
                            }}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: C.mid,
                              fontSize: 13,
                              fontWeight: 500,
                              cursor: 'pointer',
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
            </div>
          )}

          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept="image/*"
            style={{ display: 'none' }}
            tabIndex={-1}
          />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: C.text }}>
              Product Name <span style={{ color: C.pink }}>*</span>
            </label>
            <input
              required
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Slim Fit Cotton Shirt"
              style={{
                width: '100%',
                height: 40,
                borderRadius: 8,
                border: `1px solid ${C.border2}`,
                padding: '0 14px',
                fontSize: 14,
                fontFamily: 'inherit',
                outline: 'none',
                background: C.field,
                color: C.text,
              }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: C.text }}>
              SKU <span style={{ color: C.pink }}>*</span>
            </label>
            <input
              required
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              placeholder="e.g. SH-COT-BLU-S"
              style={{
                width: '100%',
                height: 40,
                borderRadius: 8,
                border: `1px solid ${C.border2}`,
                padding: '0 14px',
                fontSize: 14,
                fontFamily: 'inherit',
                outline: 'none',
                background: C.field,
                color: C.text,
              }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: C.text }}>
                Actual Price <span style={{ color: C.pink }}>*</span>
              </label>
              <div style={{ position: 'relative' }}>
                <span
                  style={{
                    position: 'absolute',
                    left: 14,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    fontSize: 14,
                    color: C.mid,
                    fontWeight: 600,
                  }}
                >
                  ₹
                </span>
                <input
                  required
                  type="number"
                  min="0"
                  step="1"
                  value={actualPrice}
                  onChange={(e) => setActualPrice(e.target.value)}
                  placeholder="0"
                  style={{
                    width: '100%',
                    height: 40,
                    borderRadius: 8,
                    border: `1px solid ${C.border2}`,
                    padding: '0 14px 0 28px',
                    fontSize: 14,
                    fontFamily: 'inherit',
                    outline: 'none',
                    background: C.field,
                    color: C.text,
                  }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: C.text }}>
                Offer Price <span style={{ color: C.pink }}>*</span>
              </label>
              <div style={{ position: 'relative' }}>
                <span
                  style={{
                    position: 'absolute',
                    left: 14,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    fontSize: 14,
                    color: C.mid,
                    fontWeight: 600,
                  }}
                >
                  ₹
                </span>
                <input
                  required
                  type="number"
                  min="0"
                  step="1"
                  value={offerPrice}
                  onChange={(e) => setOfferPrice(e.target.value)}
                  placeholder="0"
                  style={{
                    width: '100%',
                    height: 40,
                    borderRadius: 8,
                    border: `1px solid ${hasPriceError ? C.pink : C.border2}`,
                    padding: '0 14px 0 28px',
                    fontSize: 14,
                    fontFamily: 'inherit',
                    outline: 'none',
                    background: C.field,
                    color: C.text,
                  }}
                />
              </div>
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

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
            <button
              type="button"
              onClick={onClose}
              disabled={isGenerating}
              style={{
                height: 40,
                padding: '0 18px',
                borderRadius: 8,
                border: `1px solid ${C.border2}`,
                background: C.white,
                color: C.text,
                fontFamily: 'inherit',
                fontSize: 14,
                fontWeight: 600,
                cursor: isGenerating ? 'not-allowed' : 'pointer',
                opacity: isGenerating ? 0.7 : 1,
              }}
            >
              Cancel
            </button>
            <GradBtn type="submit" disabled={isSaveDisabled}>
              Save
            </GradBtn>
          </div>
        </form>
      </div>
    </div>
  );
}
