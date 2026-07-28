'use client';
import type { MerchantCatalogCategory } from '@aivastra/types';
import { C } from '@/components/tokens';

const CATEGORIES: { id: MerchantCatalogCategory; label: string }[] = [
  { id: 'men', label: 'Men' },
  { id: 'women', label: 'Women' },
  { id: 'boys', label: 'Boys' },
  { id: 'girls', label: 'Girls' },
];

export function CategoryTabs({
  selected,
  onSelect,
}: {
  selected: MerchantCatalogCategory;
  onSelect: (category: MerchantCatalogCategory) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '12px 16px' }}>
      {CATEGORIES.map((cat) => {
        const isSelected = cat.id === selected;
        return (
          <button
            key={cat.id}
            type="button"
            onClick={() => onSelect(cat.id)}
            className="focus-ring"
            style={{
              flexShrink: 0,
              padding: '8px 16px',
              borderRadius: 20,
              border: `1px solid ${isSelected ? C.pink : C.border2}`,
              background: isSelected ? 'rgba(245, 92, 122, 0.08)' : C.white,
              color: isSelected ? C.pink : C.text,
              fontWeight: isSelected ? 600 : 500,
              fontSize: 14,
              whiteSpace: 'nowrap',
              cursor: 'pointer',
            }}
          >
            {cat.label}
          </button>
        );
      })}
    </div>
  );
}
