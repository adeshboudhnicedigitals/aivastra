import { useEffect, useState } from 'react';
import { BRAND } from '../theme';
import type { ShopifyProductListItem } from '../types';
import { SpinnerIcon } from './icons';

const PAGE_SIZE = 24;

export function ProductPickerGrid({
  loading,
  products,
  onPick,
}: {
  loading: boolean;
  products: ShopifyProductListItem[];
  onPick: (shopifyProductId: number) => void;
}) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset the page on a genuinely new product list, not every render
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [products]);

  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '48px 0',
        }}
      >
        <SpinnerIcon size={22} color={BRAND.purple} />
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div
        style={{
          padding: '32px 0',
          textAlign: 'center',
          fontSize: '13.5px',
          color: BRAND.textMuted,
        }}
      >
        No products found.
      </div>
    );
  }

  const visible = products.slice(0, visibleCount);
  const remaining = products.length - visible.length;

  return (
    <div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
          gap: '12px',
        }}
      >
        {visible.map((p) => (
          <button
            key={p.shopifyProductId}
            type="button"
            onClick={() => onPick(p.shopifyProductId)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              padding: '10px',
              border: `1px solid ${BRAND.border}`,
              borderRadius: '12px',
              background: '#fff',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            {/* biome-ignore lint/performance/noImgElement: dynamic remote thumbnail */}
            <img
              src={p.thumbnailUrl}
              alt=""
              style={{
                width: '100%',
                aspectRatio: '1',
                objectFit: 'cover',
                borderRadius: '8px',
                background: '#F1F0F5',
              }}
            />
            <span
              style={{
                fontSize: '12.5px',
                fontWeight: 600,
                color: BRAND.ink,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {p.title}
            </span>
          </button>
        ))}
      </div>

      {remaining > 0 && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: '16px' }}>
          <button
            type="button"
            onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
            style={{
              height: '36px',
              padding: '0 18px',
              border: `1px solid ${BRAND.borderStrong}`,
              borderRadius: '10px',
              background: '#fff',
              color: BRAND.inkSoft,
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Load {Math.min(remaining, PAGE_SIZE)} more
          </button>
        </div>
      )}
    </div>
  );
}
