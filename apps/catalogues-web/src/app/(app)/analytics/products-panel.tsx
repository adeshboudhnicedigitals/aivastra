import { C } from '@/components/tokens';
import { GarmentIcon } from './icons';
import { card, cardTitle, fmt, TILES } from './styles';

type Product = { itemId: string; name: string; tryOns: number; rank: number };

// Gold / silver / bronze from tokens (amber, grey, pink); the rest are plain outlined circles.
function rankColors(rank: number) {
  if (rank === 1) return { bg: C.amber, fg: C.dark };
  if (rank === 2) return { bg: C.light, fg: C.onDark };
  if (rank === 3) return { bg: C.pink, fg: C.onDark };
  return { bg: C.card, fg: C.mid };
}

export function ProductsPanel({ products }: { products: Product[] }) {
  const max = products[0]?.tryOns ?? 0;
  return (
    <div style={{ ...card, padding: 22 }}>
      <h3 style={{ ...cardTitle, marginBottom: 8 }}>Top 10 Popular Products</h3>
      {products.length === 0 ? (
        <p style={{ margin: '12px 0 0', fontSize: 15, color: C.mid }}>
          No product try-ons in this period yet.
        </p>
      ) : (
        <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {products.map((p, i) => {
            const rc = rankColors(p.rank);
            const pct = max > 0 ? Math.max(0, Math.min(100, (p.tryOns / max) * 100)) : 0;
            return (
              <li
                key={p.itemId}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '30px 52px minmax(0,1.1fr) minmax(0,1.3fr) auto',
                  alignItems: 'center',
                  gap: 16,
                  padding: '12px 0',
                  borderBottom: `1px solid ${C.border}`,
                }}
              >
                <span
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 14,
                    fontWeight: 800,
                    background: rc.bg,
                    color: rc.fg,
                    border: p.rank > 3 ? `1px solid ${C.border2}` : undefined,
                  }}
                >
                  {p.rank}
                </span>
                <div
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: 10,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: TILES[i % TILES.length]?.bg,
                  }}
                >
                  <GarmentIcon stroke={TILES[i % TILES.length]?.fg} strokeWidth={1.8} />
                </div>
                <span
                  style={{ fontSize: 15, fontWeight: 600, color: C.text, overflowWrap: 'anywhere' }}
                >
                  {p.name}
                </span>
                <div
                  style={{
                    height: 8,
                    borderRadius: 4,
                    background: C.border,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{ height: 8, borderRadius: 4, background: C.pink, width: `${pct}%` }}
                  />
                </div>
                <span
                  style={{
                    fontSize: 15,
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                    textAlign: 'right',
                    fontVariantNumeric: 'tabular-nums',
                    color: C.text,
                  }}
                >
                  {fmt.format(p.tryOns)} Try-Ons
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
