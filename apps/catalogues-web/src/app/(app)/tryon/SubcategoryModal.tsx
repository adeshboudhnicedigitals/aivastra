'use client';
import { useEffect, useRef, useState } from 'react';
import { C } from '@/components/tokens';
import { GradBtn } from '@/components/ui/grad-btn';
import { PremiumSelect } from '@/components/ui/premium-select';

export interface GarmentType {
  id: string;
  label: string;
}

export interface SubcategoryEditData {
  id: string;
  name: string;
  garmentSubcategoryId: string;
}

interface SubcategoryModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (name: string, garmentSubcategoryId: string) => void;
  initialData?: SubcategoryEditData;
  garmentTypes: GarmentType[];
  isSaving?: boolean;
}

export function SubcategoryModal({
  open,
  onClose,
  onSave,
  initialData,
  garmentTypes,
  isSaving = false,
}: SubcategoryModalProps) {
  const [name, setName] = useState('');
  const [garmentSubcategoryId, setGarmentSubcategoryId] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);

  // Reset state when opened
  useEffect(() => {
    if (open) {
      if (initialData) {
        setName(initialData.name);
        setGarmentSubcategoryId(initialData.garmentSubcategoryId);
      } else {
        setName('');
        setGarmentSubcategoryId(garmentTypes[0]?.id || '');
      }
    }
  }, [open, initialData, garmentTypes]);

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim() && garmentSubcategoryId && !isSaving) {
      onSave(name.trim(), garmentSubcategoryId);
    }
  };

  const garmentOptions = garmentTypes.map((g) => ({ value: g.id, label: g.label }));

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
          width: 420,
          maxWidth: '100%',
          boxShadow: '0 12px 48px rgba(0,0,0,0.18)',
        }}
      >
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: C.text, margin: 0 }}>
            {initialData ? 'Edit Subcategory' : 'Add Subcategory'}
          </h3>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: C.text }}>
              Name <span style={{ color: C.pink }}>*</span>
            </label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Summer Collection"
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
              Garment Type <span style={{ color: C.pink }}>*</span>
            </label>
            <div style={{ border: `1px solid ${C.border2}`, borderRadius: 8, background: C.field }}>
              <PremiumSelect
                value={garmentSubcategoryId}
                onChange={(val) => setGarmentSubcategoryId(val as string)}
                options={garmentOptions}
                fullWidth
                height={40}
                placeholder="Select garment type..."
              />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
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
                cursor: isSaving ? 'not-allowed' : 'pointer',
                opacity: isSaving ? 0.7 : 1,
              }}
            >
              Cancel
            </button>
            <GradBtn type="submit" disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Save'}
            </GradBtn>
          </div>
        </form>
      </div>
    </div>
  );
}
