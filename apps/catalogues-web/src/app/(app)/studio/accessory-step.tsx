'use client';

import { C } from '@/components/tokens';
import { SectionHead, SelCard, sectionCardStyle } from './shared-cards';

export interface AccessoryItem {
  id: string;
  label: string;
  thumbnailUrl: string;
}

export interface AccessoryCategory {
  id: number;
  label: string;
  items: AccessoryItem[];
}

interface AccessoryStepProps {
  categories: AccessoryCategory[];
  selectedIds: string[];
  stepNumber: number;
  visibleCount: number;
  onToggle: (categoryId: number, itemId: string) => void;
  onViewAll: () => void;
}

/**
 * One row per accessory category, each a single-select grid. Clicking an
 * already-selected item clears it, but at least one item across any category
 * must stay selected for Generate to enable once this step is showing — see
 * canGenerate in studio/page.tsx. Reuses the studio's SelCard/SectionHead so
 * it matches the lower/shoe pickers visually.
 *
 * Each category is capped to visibleCount (same tiered count as every other
 * studio grid) with the selected item pinned into view if it'd otherwise fall
 * outside that cap — large accessory categories (e.g. "Jewellery Set" with
 * 70+ items) rendered unbounded otherwise, making the whole step unusable.
 * "View All" opens a single modal covering every category, filterable by
 * category pill, matching the lower/shoe "View more" pattern.
 */
export function AccessoryStep({
  categories,
  selectedIds,
  stepNumber,
  visibleCount,
  onToggle,
  onViewAll,
}: AccessoryStepProps) {
  if (categories.length === 0) return null;
  const totalItems = categories.reduce((n, c) => n + c.items.length, 0);

  return (
    <section className="studio-section-card" style={sectionCardStyle}>
      <SectionHead
        title="Accessories"
        stepNumber={stepNumber}
        right={
          totalItems > visibleCount && (
            <button
              type="button"
              onClick={onViewAll}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                background: 'none',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                height: 16,
              }}
            >
              <span style={{ fontWeight: 600, fontSize: 12, color: '#626262' }}>View All</span>
            </button>
          )
        }
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {categories.map((category) => {
          const selectedItem = category.items.find((i) => selectedIds.includes(i.id));
          const firstN = category.items.slice(0, visibleCount);
          const inFirstN = !!selectedItem && firstN.some((i) => i.id === selectedItem.id);
          const visibleItems =
            selectedItem && !inFirstN
              ? [selectedItem, ...firstN.filter((i) => i.id !== selectedItem.id)].slice(
                  0,
                  visibleCount,
                )
              : firstN;
          return (
            <div key={category.id}>
              <h4 style={{ margin: '0 0 8px', fontSize: 14, color: C.text }}>{category.label}</h4>
              <div className="studio-5col-grid">
                {visibleItems.map((item) => (
                  <SelCard
                    key={item.id}
                    selected={selectedIds.includes(item.id)}
                    onClick={() => onToggle(category.id, item.id)}
                    imageUrl={item.thumbnailUrl}
                    w="100%"
                    ratio={1}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
