import type { MerchantAnalyticsResponse } from '@aivastra/types';
import { C, grad, M } from '@/components/tokens';
import { CrownIcon, GarmentIcon, PhoneIcon, TriangleIcon, UsersIcon } from './icons';
import { bigNumber, card, fmt, TILES } from './styles';

type Ranked = { name: string; tryOns: number } | null;

function ChangePill({ current, previous }: { current: number; previous: number }) {
  if (current === 0 && previous === 0) return null;
  // Solid card-coloured chip so it reads on the hero gradient in both themes.
  let label: string;
  let fg: string = M.statusGreen;
  let arrow: 'up' | 'down' | null = 'up';
  if (previous === 0) {
    label = 'New';
    fg = M.accent;
    arrow = null;
  } else {
    const pct = Math.round(((current - previous) / previous) * 100);
    label = `${pct >= 0 ? '+' : ''}${pct}%`;
    if (pct < 0) {
      fg = M.statusRed;
      arrow = 'down';
    }
  }
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '4px 10px',
        borderRadius: 999,
        background: C.card,
        color: fg,
        fontSize: 14,
        fontWeight: 700,
      }}
    >
      {arrow ? <TriangleIcon up={arrow === 'up'} /> : null}
      {label}
    </span>
  );
}

function Hero({ d, days }: { d: MerchantAnalyticsResponse; days: number }) {
  return (
    <div
      style={{
        flex: '1.5 1 340px',
        minWidth: 0,
        background: grad,
        color: C.onDark,
        borderRadius: 16,
        padding: 22,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: '50%',
            // on-dark at 16% over the gradient
            background: 'color-mix(in srgb, var(--c-on-dark) 16%, transparent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <GarmentIcon stroke={C.onDark} />
        </div>
        <span style={{ fontSize: 16, fontWeight: 600 }}>Total Virtual Try-Ons</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ ...bigNumber, fontSize: 46, lineHeight: 1.05 }}>
          {fmt.format(d.totalTryOns)}
        </span>
        <ChangePill current={d.totalTryOns} previous={d.previousTryOns} />
      </div>
      <span style={{ fontSize: 14, color: C.onDark, opacity: 0.85 }}>vs previous {days} days</span>
    </div>
  );
}

function PlaceholderStat({ label, icon }: { label: string; icon: React.ReactNode }) {
  return (
    <div
      style={{
        ...card,
        flex: '1 1 190px',
        minWidth: 0,
        padding: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: '50%',
          background: M.accentTint,
          color: M.accent,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {icon}
      </div>
      <div>
        <div style={{ fontSize: 14, fontWeight: 500, color: C.mid }}>{label}</div>
        {/* No data source until phone capture ships, so no number is invented. */}
        <div style={{ ...bigNumber, fontSize: 34, lineHeight: 1.15, color: C.text }}>—</div>
      </div>
    </div>
  );
}

function RankedCard({
  title,
  item,
  tile,
  crown,
  least,
}: {
  title: string;
  item: Ranked;
  tile: { bg: string; fg: string };
  crown?: boolean;
  least?: boolean;
}) {
  return (
    <div
      style={{
        flex: '1 1 220px',
        minWidth: 0,
        background: least ? M.dangerTint : C.card,
        border: `1px solid ${least ? 'color-mix(in srgb, var(--c-merchant-danger) 25%, transparent)' : C.border}`,
        borderRadius: 16,
        padding: 18,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {crown ? <CrownIcon /> : null}
        <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{title}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 12,
            background: tile.bg,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flex: 'none',
          }}
        >
          <GarmentIcon size={26} stroke={tile.fg} strokeWidth={1.8} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: C.text, overflowWrap: 'anywhere' }}>
            {item?.name ?? '—'}
          </div>
          {item ? (
            <div style={{ fontSize: 14, color: C.mid, fontVariantNumeric: 'tabular-nums' }}>
              {fmt.format(item.tryOns)} Try-Ons
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function Overview({ d, days }: { d: MerchantAnalyticsResponse; days: number }) {
  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        <Hero d={d} days={days} />
        <PlaceholderStat label="Total Customers" icon={<UsersIcon />} />
        <PlaceholderStat label="Phone Numbers Collected" icon={<PhoneIcon size={22} />} />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 16 }}>
        <RankedCard title="Most Tried Garment" item={d.topGarmentType} tile={TILES[4]} crown />
        <RankedCard title="Most Tried Product" item={d.mostTriedProduct} tile={TILES[0]} crown />
        <RankedCard title="Least Tried Product" item={d.leastTriedProduct} tile={TILES[3]} least />
      </div>
    </>
  );
}
