import type {
  DemandByVariant,
  InsightsFunnelResponse,
  InsightsReliabilityResponse,
  LostDemandResponse,
  OutOfStockResponse,
} from '@aivastra/types';
import { PackageX, Shirt, ShoppingCart, Users } from 'lucide-react';
import { KpiCard } from '@/components/analytics/KpiCard';
import { C } from '@/components/tokens';
import { ListState } from '@/components/ui/state';
import { rupees } from '@/lib/cart-format';
import { downloadCsv, toCsv } from '@/lib/csv';
import { pctChange, pointsChange } from '@/lib/delta';
import { pct, perUnit, stepPct, waitText } from '@/lib/insights';

// Minimal shape of a react-query result, so the retailer page (apiFetch) and the team console
// (hqFetch) can feed the same sections.
type Q<T> = {
  data?: T;
  status: 'pending' | 'error' | 'success';
  isPending: boolean;
  isError: boolean;
  refetch: () => unknown;
};

const card: React.CSSProperties = {
  background: C.card,
  border: `1px solid ${C.border2}`,
  borderRadius: 12,
  padding: 16,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};
const th: React.CSSProperties = {
  textAlign: 'left',
  fontSize: 12,
  fontWeight: 600,
  color: C.mid,
  padding: '8px 10px',
  whiteSpace: 'nowrap',
};
const td: React.CSSProperties = { padding: '10px', fontSize: 14, color: C.text };
const num: React.CSSProperties = { textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

const exportBtn: React.CSSProperties = {
  height: 32,
  padding: '0 12px',
  borderRadius: 8,
  border: `1px solid ${C.border2}`,
  background: C.white,
  color: C.text,
  fontFamily: 'inherit',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  flex: 'none',
};

/** Saves what the section shows. Disabled until there is data; the file is the screen's own numbers. */
function ExportButton({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  return (
    <button type="button" style={exportBtn} disabled={disabled} onClick={onClick}>
      Export CSV
    </button>
  );
}

function Section({
  title,
  note,
  action,
  children,
}: {
  title: string;
  note?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section style={card}>
      <div
        style={{ display: 'flex', gap: 12, justifyContent: 'space-between', alignItems: 'start' }}
      >
        <div style={{ minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: C.text }}>{title}</h2>
          {note && <p style={{ margin: '4px 0 0', fontSize: 13, color: C.mid }}>{note}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function VariantTable({ title, rows }: { title: string; rows: DemandByVariant[] }) {
  return (
    <div style={{ flex: '1 1 240px', minWidth: 0 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <caption style={{ textAlign: 'left', fontSize: 13, fontWeight: 700, color: C.text }}>
          {title}
        </caption>
        <thead>
          <tr>
            <th style={th} scope="col">
              {title.replace('By ', '').replace(/^./, (c) => c.toUpperCase())}
            </th>
            <th style={{ ...th, ...num }} scope="col">
              In carts
            </th>
            <th style={{ ...th, ...num }} scope="col">
              Sold
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} style={{ borderTop: `1px solid ${C.border}` }}>
              <td style={td}>{r.label || 'No colour'}</td>
              <td style={{ ...td, ...num }}>{r.carted}</td>
              <td style={{ ...td, ...num }}>{r.sold}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function InsightsSections({
  funnel,
  lost,
  oos,
  rel,
  prevFunnel,
  prevRel,
}: {
  /** The equally long period before the range, for the "vs. previous period" change. */
  prevFunnel?: InsightsFunnelResponse;
  prevRel?: InsightsReliabilityResponse;
  funnel: Q<InsightsFunnelResponse>;
  lost: Q<LostDemandResponse>;
  oos: Q<OutOfStockResponse>;
  rel: Q<InsightsReliabilityResponse>;
}) {
  const f = funnel.data;
  const r = rel.data;
  const pf = prevFunnel;
  const pr = prevRel;
  const loadingF = funnel.isPending;
  const loadingR = rel.isPending;
  const stamp = (w?: { from: string; to: string }) => (w ? `${w.from}_to_${w.to}` : '');

  const exportSummary = () => {
    if (!f) return;
    const rows: (string | number | null)[][] = [
      ['Sessions', f.sessions],
      ['Tried something', f.tried],
      ['Added to cart', f.carted],
      ['Billed', f.billed],
      ['Carts billed', f.carts.billed],
      ['Carts abandoned', f.carts.abandoned],
      ['Carts still open', f.carts.open],
      ['Cart abandonment rate', f.abandonmentRate],
    ];
    if (r) {
      rows.push(
        ['Finished try-ons', r.finished],
        ['Failed try-ons', r.failed],
        ['Failure rate', r.failureRate],
        ['Wait p50 (ms)', r.waitMs.p50],
        ['Wait p90 (ms)', r.waitMs.p90],
        ['Credits per try-on', r.creditsPerTryon],
        ['Credits per sale', r.creditsPerSale],
      );
    }
    downloadCsv(`insights-summary_${stamp(f.window)}.csv`, toCsv(['Metric', 'Value'], rows));
  };
  const exportLost = () => {
    const d = lost.data;
    if (!d) return;
    const rows = [
      ...d.items.map((i) => [
        'item',
        i.name,
        i.pricePaise === null ? null : i.pricePaise / 100,
        i.tried,
        i.carted,
        i.sold,
        i.rate,
      ]),
      ...d.bySize.map((v) => ['size', v.label, null, null, v.carted, v.sold, null]),
      ...d.byColour.map((v) => ['colour', v.label, null, null, v.carted, v.sold, null]),
    ];
    downloadCsv(
      `lost-demand_${stamp(d.window)}.csv`,
      toCsv(['Kind', 'Name', 'Price (INR)', 'Tried', 'In carts', 'Sold', 'Sold per try'], rows),
    );
  };
  const exportOos = () => {
    const d = oos.data;
    if (!d) return;
    downloadCsv(
      `out-of-stock_${stamp(d.window)}.csv`,
      toCsv(
        ['Item', 'Size', 'Colour', 'Branch', 'Refused', 'Viewed on tablet'],
        d.rows.map((x) => [x.name, x.size, x.colour, x.branchName, x.refused, x.views]),
      ),
    );
  };
  return (
    <>
      <Section
        title="From visit to sale"
        action={<ExportButton onClick={exportSummary} disabled={!f} />}
        note="Each step counts the visits (sessions) that reached it."
      >
        {funnel.isError ? (
          <ListState
            status="error"
            isEmpty={false}
            emptyText=""
            error="Could not load the funnel."
            onRetry={() => void funnel.refetch()}
          >
            {null}
          </ListState>
        ) : (
          <>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
                gap: 12,
              }}
            >
              <KpiCard
                label="Sessions"
                value={String(f?.sessions ?? 0)}
                delta={f && pf ? pctChange(f.sessions, pf.sessions) : null}
                loading={loadingF}
                icon={<Users size={16} aria-hidden="true" />}
              />
              <KpiCard
                label="Tried something"
                value={String(f?.tried ?? 0)}
                delta={f && pf ? pctChange(f.tried, pf.tried) : null}
                hint={f ? `${stepPct(f.tried, f.sessions)} of sessions` : undefined}
                loading={loadingF}
                icon={<Shirt size={16} aria-hidden="true" />}
              />
              <KpiCard
                label="Added to cart"
                value={String(f?.carted ?? 0)}
                delta={f && pf ? pctChange(f.carted, pf.carted) : null}
                hint={f ? `${stepPct(f.carted, f.tried)} of those who tried` : undefined}
                loading={loadingF}
                icon={<ShoppingCart size={16} aria-hidden="true" />}
              />
              <KpiCard
                label="Billed"
                value={String(f?.billed ?? 0)}
                delta={f && pf ? pctChange(f.billed, pf.billed) : null}
                hint={f ? `${stepPct(f.billed, f.carted)} of carts` : undefined}
                loading={loadingF}
                icon={<ShoppingCart size={16} aria-hidden="true" />}
              />
            </div>
            {f && (
              <p style={{ margin: 0, fontSize: 13, color: C.mid }}>
                Cart abandonment:{' '}
                <strong style={{ color: C.text }}>{pct(f.abandonmentRate)}</strong> (
                {f.carts.abandoned} abandoned, {f.carts.billed} billed
                {f.carts.open > 0 ? `, ${f.carts.open} still open and not counted` : ''}). A cart is
                abandoned when nobody bills it within 24 hours.
              </p>
            )}
          </>
        )}
      </Section>

      <Section
        title="Tried a lot, bought little"
        action={<ExportButton onClick={exportLost} disabled={!lost.data} />}
        note={`Items with at least ${lost.data?.minTries ?? 5} try-ons, most missed sales first. Size and colour start at the cart, because a try-on does not record a size.`}
      >
        <ListState
          status={lost.status}
          isEmpty={(lost.data?.items.length ?? 0) === 0}
          emptyText="No item was tried often enough in this range."
          error="Could not load this list."
          onRetry={() => void lost.refetch()}
        >
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th} scope="col">
                    Item
                  </th>
                  <th style={{ ...th, ...num }} scope="col">
                    Price
                  </th>
                  <th style={{ ...th, ...num }} scope="col">
                    Tried
                  </th>
                  <th style={{ ...th, ...num }} scope="col">
                    In carts
                  </th>
                  <th style={{ ...th, ...num }} scope="col">
                    Sold
                  </th>
                  <th style={{ ...th, ...num }} scope="col">
                    Sold per try
                  </th>
                </tr>
              </thead>
              <tbody>
                {lost.data?.items.map((i) => (
                  <tr key={i.catalogItemId} style={{ borderTop: `1px solid ${C.border}` }}>
                    <td style={{ ...td, fontWeight: 600 }}>{i.name}</td>
                    <td style={{ ...td, ...num }}>
                      {i.pricePaise === null ? '—' : rupees(i.pricePaise)}
                    </td>
                    <td style={{ ...td, ...num }}>{i.tried}</td>
                    <td style={{ ...td, ...num }}>{i.carted}</td>
                    <td style={{ ...td, ...num }}>{i.sold}</td>
                    <td style={{ ...td, ...num }}>{pct(i.rate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {((lost.data?.bySize.length ?? 0) > 0 || (lost.data?.byColour.length ?? 0) > 0) && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, marginTop: 8 }}>
              <VariantTable title="By size" rows={lost.data?.bySize ?? []} />
              <VariantTable title="By colour" rows={lost.data?.byColour ?? []} />
            </div>
          )}
        </ListState>
      </Section>

      <Section
        title="Out of stock"
        action={<ExportButton onClick={exportOos} disabled={!oos.data} />}
        note="“Refused” is counted by our server when a cart add is turned down. “Viewed” is reported by the tablet and is a hint, not a count of lost sales."
      >
        <ListState
          status={oos.status}
          isEmpty={(oos.data?.rows.length ?? 0) === 0 && (oos.data?.stale.length ?? 0) === 0}
          emptyText="No out-of-stock demand in this range."
          error="Could not load out-of-stock demand."
          onRetry={() => void oos.refetch()}
        >
          {(oos.data?.rows.length ?? 0) > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th} scope="col">
                      Item
                    </th>
                    <th style={th} scope="col">
                      Size
                    </th>
                    <th style={th} scope="col">
                      Branch
                    </th>
                    <th style={{ ...th, ...num }} scope="col">
                      Refused
                    </th>
                    <th style={{ ...th, ...num }} scope="col">
                      Viewed
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {oos.data?.rows.map((x) => (
                    <tr
                      key={`${x.catalogItemId}-${x.branchId}-${x.size}-${x.colour}`}
                      style={{ borderTop: `1px solid ${C.border}` }}
                    >
                      <td style={{ ...td, fontWeight: 600 }}>{x.name}</td>
                      <td style={td}>{[x.size, x.colour].filter(Boolean).join(' · ') || '—'}</td>
                      <td style={td}>{x.branchName || '—'}</td>
                      <td style={{ ...td, ...num }}>{x.refused}</td>
                      <td style={{ ...td, ...num }}>{x.views}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {(oos.data?.stale.length ?? 0) > 0 && (
            <div
              role="note"
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'flex-start',
                fontSize: 13,
                color: C.text,
              }}
            >
              <PackageX size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                Stock not updated in {oos.data?.staleDays} days:{' '}
                {oos.data?.stale
                  .map(
                    (b) =>
                      `${b.branchName} (${b.variants} sizes, last ${new Date(b.lastUpdate).toLocaleDateString('en-IN')})`,
                  )
                  .join('; ')}
                . Out-of-stock figures for these branches may be out of date.
              </div>
            </div>
          )}
        </ListState>
      </Section>

      <Section
        title="Try-on reliability and cost"
        note="Try-ons started from a tablet in this range."
      >
        {rel.isError ? (
          <ListState
            status="error"
            isEmpty={false}
            emptyText=""
            error="Could not load reliability."
            onRetry={() => void rel.refetch()}
          >
            {null}
          </ListState>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
              gap: 12,
            }}
          >
            <KpiCard
              label="Failed try-ons"
              value={pct(r?.failureRate ?? null)}
              delta={r && pr ? pointsChange(r.failureRate, pr.failureRate, true) : null}
              hint={r ? `${r.failed} of ${r.finished} finished` : undefined}
              loading={loadingR}
              tone={r && r.failureRate !== null && r.failureRate > 0.1 ? 'warn' : undefined}
            />
            <KpiCard
              label="Typical wait"
              value={waitText(r?.waitMs.p50 ?? null)}
              delta={r && pr ? pctChange(r.waitMs.p50, pr.waitMs.p50, true) : null}
              hint={
                r && r.waitMs.p90 !== null ? `9 in 10 within ${waitText(r.waitMs.p90)}` : undefined
              }
              loading={loadingR}
            />
            <KpiCard
              label="Credits per try-on"
              value={perUnit(r?.creditsPerTryon ?? null)}
              delta={r && pr ? pctChange(r.creditsPerTryon, pr.creditsPerTryon, true) : null}
              hint="Net of refunds"
              loading={loadingR}
            />
            <KpiCard
              label="Credits per sale"
              value={perUnit(r?.creditsPerSale ?? null)}
              delta={r && pr ? pctChange(r.creditsPerSale, pr.creditsPerSale, true) : null}
              hint="Net of refunds"
              loading={loadingR}
            />
          </div>
        )}
      </Section>
    </>
  );
}
