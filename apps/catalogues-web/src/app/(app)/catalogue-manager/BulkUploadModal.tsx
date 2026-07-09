'use client';
import { useEffect, useRef, useState } from 'react';
import { SpinnerIcon, TrashIcon, UploadIcon } from '@/components/icons';
import { C } from '@/components/tokens';
import { GradBtn } from '@/components/ui/grad-btn';
import type { Product } from './ProductModal';

interface QueueItem {
  id: string;
  fileUrl: string;
  status: 'queued' | 'generating' | 'generated';
  sku: string;
  actualPrice: string;
  offerPrice: string;
  hasError: boolean;
}

interface BulkUploadModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (products: Omit<Product, 'id' | 'subcategoryId'>[]) => void;
}

const generateId = () => Math.random().toString(36).substring(2, 9);

export function BulkUploadModal({ open, onClose, onSave }: BulkUploadModalProps) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const [globalActual, setGlobalActual] = useState('');
  const [globalOffer, setGlobalOffer] = useState('');

  // Reset state
  useEffect(() => {
    if (open) {
      setItems([]);
      setGlobalActual('');
      setGlobalOffer('');
      setIsDragging(false);
    }
  }, [open]);

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

  const processFiles = (files: FileList | File[]) => {
    const newItems: QueueItem[] = [];
    Array.from(files).forEach((file) => {
      if (!file.type.startsWith('image/')) return;
      const reader = new FileReader();
      const id = generateId();
      reader.onloadend = () => {
        setItems((prev) => [
          ...prev,
          {
            id,
            fileUrl: reader.result as string,
            status: 'queued',
            sku: '',
            actualPrice: '',
            offerPrice: '',
            hasError: false,
          },
        ]);
      };
      reader.readAsDataURL(file);
    });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      processFiles(e.target.files);
    }
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) {
      processFiles(e.dataTransfer.files);
    }
  };

  const handleGenerateAll = () => {
    const queuedItems = items.filter((i) => i.status === 'queued');
    if (queuedItems.length === 0) return;

    setItems((prev) =>
      prev.map((item) => (item.status === 'queued' ? { ...item, status: 'generating' } : item)),
    );

    queuedItems.forEach((item) => {
      const delay = 1500 + Math.random() * 1000; // 1.5s - 2.5s staggering
      setTimeout(() => {
        setItems((prev) => prev.map((p) => (p.id === item.id ? { ...p, status: 'generated' } : p)));
      }, delay);
    });
  };

  const handleApplyGlobalPrice = () => {
    if (!globalActual && !globalOffer) return;
    setItems((prev) =>
      prev.map((item) => {
        if (item.status === 'generated') {
          return {
            ...item,
            actualPrice: globalActual || item.actualPrice,
            offerPrice: globalOffer || item.offerPrice,
            hasError: false,
          };
        }
        return item;
      }),
    );
  };

  const handleUpdateItem = (id: string, updates: Partial<QueueItem>) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...updates, hasError: false } : item)),
    );
  };

  const handleRemoveItem = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  const handleAddCatalogue = () => {
    let hasValidationError = false;
    const validatedItems = items.map((item) => {
      if (item.status !== 'generated') return item;
      const act = parseInt(item.actualPrice, 10) || 0;
      const off = parseInt(item.offerPrice, 10) || 0;
      const isValid =
        item.sku.trim() !== '' && item.actualPrice !== '' && item.offerPrice !== '' && off <= act;
      if (!isValid) hasValidationError = true;
      return { ...item, hasError: !isValid };
    });

    setItems(validatedItems);

    if (hasValidationError) return;

    const readyItems = validatedItems.filter((i) => i.status === 'generated');
    const productsToAdd: Omit<Product, 'id' | 'subcategoryId'>[] = readyItems.map((item) => ({
      label: `Product ${item.sku.toUpperCase()}`,
      sku: item.sku.trim(),
      actualPrice: parseInt(item.actualPrice, 10),
      offerPrice: parseInt(item.offerPrice, 10),
      imageDataUrl: item.fileUrl,
      imageSource: 'flat',
    }));

    onSave(productsToAdd);
  };

  const hasQueued = items.some((i) => i.status === 'queued');
  const hasGenerated = items.some((i) => i.status === 'generated');
  const generatedCount = items.filter((i) => i.status === 'generated').length;
  const isAnyGenerating = items.some((i) => i.status === 'generating');

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
          width: 920,
          maxWidth: '90vw',
          height: '85vh',
          maxHeight: 800,
          boxShadow: '0 12px 48px rgba(0,0,0,0.18)',
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: C.text, margin: 0 }}>
              Bulk Upload Flat Images
            </h3>
            <div style={{ fontSize: 13, color: C.mid, marginTop: 4 }}>
              Upload multiple flat garment photos and process them into catalogue images.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: 24,
              color: C.mid,
              cursor: 'pointer',
              lineHeight: 1,
            }}
          >
            &times;
          </button>
        </div>

        {/* Dropzone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          // biome-ignore lint/a11y/useKeyWithClickEvents: simple click trigger
          onClick={() => fileInputRef.current?.click()}
          style={{
            height: 100,
            borderRadius: 8,
            border: `2px dashed ${isDragging ? C.pink : C.border2}`,
            background: isDragging ? 'rgba(245, 92, 122, 0.05)' : C.field,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            flexShrink: 0,
            transition: 'all 0.15s ease',
            gap: 8,
          }}
          className="hover-surface"
        >
          <div style={{ color: isDragging ? C.pink : C.mid }}>
            <UploadIcon size={24} />
          </div>
          <div style={{ fontSize: 13, color: isDragging ? C.pink : C.mid, fontWeight: 500 }}>
            Drop flat images here or click to browse
          </div>
          <input
            type="file"
            multiple
            ref={fileInputRef}
            onChange={handleFileChange}
            accept="image/*"
            style={{ display: 'none' }}
            tabIndex={-1}
          />
        </div>

        {/* Queue Actions */}
        {items.length > 0 && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-end',
              background: C.lighter,
              padding: '12px 16px',
              borderRadius: 8,
              border: `1px solid ${C.border}`,
            }}
          >
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <GradBtn
                type="button"
                onClick={handleGenerateAll}
                disabled={!hasQueued || isAnyGenerating}
              >
                Generate All
              </GradBtn>
              <span style={{ fontSize: 13, color: C.mid, fontWeight: 500 }}>
                {items.length} item{items.length !== 1 && 's'} ({generatedCount} ready)
              </span>
            </div>

            {hasGenerated && (
              <div
                style={{
                  display: 'flex',
                  gap: 8,
                  alignItems: 'center',
                  background: C.card,
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: `1px solid ${C.border2}`,
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>
                  Set price for all:
                </span>
                <input
                  type="number"
                  placeholder="Actual"
                  value={globalActual}
                  onChange={(e) => setGlobalActual(e.target.value)}
                  style={{
                    width: 70,
                    height: 28,
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
                    width: 70,
                    height: 28,
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
                    padding: 0,
                    marginLeft: 4,
                  }}
                >
                  Apply
                </button>
              </div>
            )}
          </div>
        )}

        {/* Grid Area */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '4px',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: 16,
            alignContent: 'start',
          }}
        >
          {items.map((item) => (
            <div
              key={item.id}
              style={{
                border: `1px solid ${item.hasError ? C.pink : C.border}`,
                borderRadius: 12,
                background: item.hasError ? 'rgba(245,92,122,0.03)' : C.card,
                overflow: 'hidden',
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <button
                type="button"
                onClick={() => handleRemoveItem(item.id)}
                style={{
                  position: 'absolute',
                  top: 6,
                  right: 6,
                  background: 'rgba(0,0,0,0.5)',
                  color: C.white,
                  border: 'none',
                  borderRadius: 6,
                  width: 24,
                  height: 24,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  zIndex: 10,
                }}
                title="Remove item"
              >
                <TrashIcon />
              </button>

              <div style={{ aspectRatio: '3/4', background: C.lighter, position: 'relative' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {/* biome-ignore lint/performance/noImgElement: local data url */}
                <img
                  src={item.fileUrl}
                  alt="Upload preview"
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                />

                {/* Status Badge overlay */}
                <div style={{ position: 'absolute', bottom: 6, left: 6 }}>
                  {item.status === 'queued' && (
                    <div
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
                    </div>
                  )}
                  {item.status === 'generating' && (
                    <div
                      style={{
                        background: C.card,
                        color: C.pink,
                        fontSize: 10,
                        fontWeight: 700,
                        padding: '2px 8px',
                        borderRadius: 4,
                        textTransform: 'uppercase',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        border: `1px solid ${C.border2}`,
                        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                      }}
                    >
                      <SpinnerIcon size={10} /> Generating
                    </div>
                  )}
                  {item.status === 'generated' && (
                    <div
                      style={{
                        background: '#10b981',
                        color: C.white,
                        fontSize: 10,
                        fontWeight: 700,
                        padding: '2px 6px',
                        borderRadius: 4,
                        textTransform: 'uppercase',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      ✓ Generated
                    </div>
                  )}
                </div>
              </div>

              {item.status === 'generated' && (
                <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <input
                    placeholder="SKU"
                    value={item.sku}
                    onChange={(e) => handleUpdateItem(item.id, { sku: e.target.value })}
                    style={{
                      width: '100%',
                      height: 30,
                      fontSize: 12,
                      borderRadius: 6,
                      border: `1px solid ${item.hasError && !item.sku ? C.pink : C.border2}`,
                      padding: '0 8px',
                      background: C.field,
                      color: C.text,
                    }}
                  />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <div style={{ position: 'relative', flex: 1 }}>
                      <span
                        style={{
                          position: 'absolute',
                          left: 8,
                          top: '50%',
                          transform: 'translateY(-50%)',
                          fontSize: 11,
                          color: C.mid,
                          fontWeight: 600,
                        }}
                      >
                        ₹
                      </span>
                      <input
                        type="number"
                        placeholder="Actual"
                        value={item.actualPrice}
                        onChange={(e) => handleUpdateItem(item.id, { actualPrice: e.target.value })}
                        style={{
                          width: '100%',
                          height: 30,
                          fontSize: 12,
                          borderRadius: 6,
                          border: `1px solid ${item.hasError && (!item.actualPrice || parseInt(item.offerPrice, 10) > parseInt(item.actualPrice, 10)) ? C.pink : C.border2}`,
                          padding: '0 6px 0 20px',
                          background: C.field,
                          color: C.text,
                        }}
                      />
                    </div>
                    <div style={{ position: 'relative', flex: 1 }}>
                      <span
                        style={{
                          position: 'absolute',
                          left: 8,
                          top: '50%',
                          transform: 'translateY(-50%)',
                          fontSize: 11,
                          color: C.mid,
                          fontWeight: 600,
                        }}
                      >
                        ₹
                      </span>
                      <input
                        type="number"
                        placeholder="Offer"
                        value={item.offerPrice}
                        onChange={(e) => handleUpdateItem(item.id, { offerPrice: e.target.value })}
                        style={{
                          width: '100%',
                          height: 30,
                          fontSize: 12,
                          borderRadius: 6,
                          border: `1px solid ${item.hasError && (!item.offerPrice || parseInt(item.offerPrice, 10) > parseInt(item.actualPrice, 10)) ? C.pink : C.border2}`,
                          padding: '0 6px 0 20px',
                          background: C.field,
                          color: C.text,
                        }}
                      />
                    </div>
                  </div>
                  {item.hasError && (
                    <div style={{ fontSize: 10, color: C.pink, lineHeight: 1.2 }}>
                      Please fill valid SKU and ensure Offer ≤ Actual Price.
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 10,
            paddingTop: 16,
            borderTop: `1px solid ${C.border2}`,
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            onClick={onClose}
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
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <GradBtn
            type="button"
            disabled={generatedCount === 0 || isAnyGenerating}
            onClick={handleAddCatalogue}
          >
            Add {generatedCount} to Catalogue
          </GradBtn>
        </div>
      </div>
    </div>
  );
}
