'use client';
import type { MerchantCatalogSubcategory } from '@aivastra/types';
import { GarmentIcon, TrashIcon } from '@/components/icons';
import { C } from '@/components/tokens';

export function SubcategoryCard({
  subcategory,
  garmentTypeLabel,
  onOpen,
  onDelete,
}: {
  subcategory: MerchantCatalogSubcategory;
  garmentTypeLabel: string;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      style={{
        position: 'relative',
        border: `1px solid ${C.border}`,
        borderRadius: 14,
        background: C.card,
        padding: '20px 16px 16px',
      }}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        aria-label={`Delete ${subcategory.name}`}
        className="focus-ring hover-surface"
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          width: 36,
          height: 36,
          borderRadius: 8,
          border: 'none',
          background: 'transparent',
          color: C.light,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          zIndex: 1,
        }}
      >
        <TrashIcon />
      </button>

      {/* biome-ignore lint/a11y/useSemanticElements: contains a nested interactive <button> (delete) — real <button> here would be invalid HTML (no nesting) */}
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpen();
          }
        }}
        className="focus-ring"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          cursor: 'pointer',
          outline: 'none',
          minHeight: 44,
        }}
      >
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 10,
            background: 'rgba(245, 92, 122, 0.08)',
            color: C.pink,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <GarmentIcon size={22} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: C.text, wordBreak: 'break-word' }}>
            {subcategory.name}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                background: C.border2,
                color: C.text,
                padding: '2px 8px',
                borderRadius: 6,
                textTransform: 'uppercase',
              }}
            >
              {garmentTypeLabel}
            </span>
            <span style={{ fontSize: 12, color: C.mid }}>
              {subcategory.productCount} {subcategory.productCount === 1 ? 'product' : 'products'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
