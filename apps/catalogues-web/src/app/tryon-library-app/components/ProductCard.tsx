'use client';
import type { MerchantCatalogItem } from '@aivastra/types';
import { GarmentIcon, TrashIcon } from '@/components/icons';
import { C } from '@/components/tokens';

export function ProductCard({
  product,
  onOpen,
  onDelete,
}: {
  product: MerchantCatalogItem;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      style={{
        border: `1px solid ${C.border}`,
        borderRadius: 14,
        overflow: 'hidden',
        background: C.card,
        position: 'relative',
      }}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        aria-label={`Delete ${product.label}`}
        className="focus-ring hover-surface"
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          width: 32,
          height: 32,
          borderRadius: 8,
          background: C.card,
          border: `1px solid ${C.border2}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: C.pink,
          cursor: 'pointer',
          zIndex: 1,
          boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
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
            aspectRatio: '3/4',
            background: C.lighter,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
          }}
        >
          {product.thumbnailUrl || product.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            // biome-ignore lint/performance/noImgElement: presigned R2 URL
            <img
              src={product.thumbnailUrl ?? product.imageUrl ?? undefined}
              alt={product.label}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                objectPosition: 'top center',
              }}
            />
          ) : (
            <GarmentIcon size={40} />
          )}
          {!product.isActive && product.actualPrice === 0 && (
            <div
              style={{
                position: 'absolute',
                top: 6,
                left: 6,
                background: C.pink,
                color: C.white,
                fontSize: 10,
                fontWeight: 700,
                padding: '2px 6px',
                borderRadius: 4,
                textTransform: 'uppercase',
              }}
            >
              Needs details
            </div>
          )}
        </div>
        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: C.text,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {product.label}
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: C.pink }}>
              ₹{product.offerPrice}
            </span>
            {product.offerPrice < product.actualPrice && (
              <span style={{ fontSize: 12, color: C.mid, textDecoration: 'line-through' }}>
                ₹{product.actualPrice}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
