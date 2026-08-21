'use client';
import type { MerchantCatalogSubcategory } from '@aivastra/types';
import { ChevronRight, GarmentIcon, TrashIcon } from '@/components/icons';
import { categoryAccent, categoryTint, LIGHT } from '../theme';

export function SubcategoryCard({
  subcategory,
  thumbnailUrl,
  onOpen,
  onDelete,
}: {
  subcategory: MerchantCatalogSubcategory;
  thumbnailUrl: string | null;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const accent = categoryAccent(subcategory.category);
  const tint = categoryTint(subcategory.category);

  return (
    <div
      style={{
        position: 'relative',
        border: `1px solid ${LIGHT.border}`,
        borderRadius: 14,
        background: LIGHT.card,
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        aria-label={`Delete ${subcategory.name}`}
        className="focus-ring"
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          width: 30,
          height: 30,
          borderRadius: '50%',
          border: 'none',
          background: 'rgba(255,255,255,0.85)',
          color: LIGHT.mid,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          zIndex: 1,
          boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
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
        style={{ display: 'flex', flexDirection: 'column', cursor: 'pointer', outline: 'none' }}
      >
        <div
          style={{
            aspectRatio: '4 / 3',
            background: LIGHT.field,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {thumbnailUrl ? (
            // biome-ignore lint/performance/noImgElement: standalone page not using next/image
            <img
              src={thumbnailUrl}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <div style={{ color: accent, opacity: 0.5 }}>
              <GarmentIcon size={32} />
            </div>
          )}
        </div>

        <div
          style={{
            padding: '12px 14px 14px',
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 15,
                fontWeight: 700,
                color: LIGHT.text,
                wordBreak: 'break-word',
              }}
            >
              {subcategory.name}
            </div>
            <div style={{ fontSize: 12, color: LIGHT.mid, marginTop: 2 }}>
              {subcategory.productCount} {subcategory.productCount === 1 ? 'Product' : 'Products'}
            </div>
          </div>
          <div
            style={{
              flexShrink: 0,
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: tint,
              color: accent,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ChevronRight />
          </div>
        </div>
      </div>
    </div>
  );
}
