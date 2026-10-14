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
  onToggle: (categoryId: number, itemId: string) => void;
}

/**
 * One row per accessory category, each a single-select grid. Clicking an
 * already-selected item clears it, but at least one item across any category
 * must stay selected for Generate to enable once this step is showing — see
 * canGenerate in studio/page.tsx. Reuses the studio's SelCard/SectionHead so
 * it matches the lower/shoe pickers visually.
 */
export function AccessoryStep({
  categories,
  selectedIds,
  stepNumber,
  onToggle,
}: AccessoryStepProps) {
  if (categories.length === 0) return null;

  return (
    <section className="studio-section-card" style={sectionCardStyle}>
      <SectionHead title="Accessories" stepNumber={stepNumber} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {categories.map((category) => (
          <div key={category.id}>
            <h4 style={{ margin: '0 0 8px', fontSize: 14, color: C.text }}>{category.label}</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16 }}>
              {category.items.map((item) => (
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
        ))}
      </div>
    </section>
  );
}
