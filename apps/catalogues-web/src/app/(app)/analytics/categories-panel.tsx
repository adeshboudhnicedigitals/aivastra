import { C } from '@/components/tokens';
import { Donut, sliceColor } from './donut';
import { card, cardTitle, fmt } from './styles';

export function CategoriesPanel({
  categories,
}: {
  categories: { name: string; tryOns: number; pct: number }[];
}) {
  return (
    <div style={{ ...card, marginTop: 16, padding: 22 }}>
      <h3 style={{ ...cardTitle, marginBottom: 16 }}>Most Tried Garment Category</h3>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 32 }}>
        <Donut
          slices={categories}
          centerValue={fmt.format(categories.reduce((n, c) => n + c.tryOns, 0))}
          centerLabel="Try-Ons"
        />
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, flex: '1 1 260px', minWidth: 0 }}>
          {categories.map((c, i) => (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: names are not guaranteed unique
              key={`${c.name}-${i}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '12px 0',
                borderBottom: `1px solid ${C.border}`,
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  flex: 'none',
                  background: sliceColor(i),
                }}
              />
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: 15,
                  fontWeight: 500,
                  color: C.text,
                  overflowWrap: 'anywhere',
                }}
              >
                {c.name}
              </span>
              <span
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  fontVariantNumeric: 'tabular-nums',
                  color: C.text,
                }}
              >
                {c.pct}%
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
