import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { apiErrorMessage, apiFetch } from '../lib/data';
import { Icon } from './Icons';

// Graphical ticket overview built from the same list endpoint Chat Inbox uses
// (GET /admin/chatbot/conversations) — no stats endpoint exists for tickets, so
// the rows are fetched once per status and aggregated here.

interface TicketRow {
  id: string;
  status: string;
  shopDomain: string | null;
}

const STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const;
const STATUS_LABEL: Record<string, string> = {
  OPEN: 'Unclaimed',
  IN_PROGRESS: 'Answered',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
};
const STATUS_COLOR: Record<string, string> = {
  OPEN: '#f0a020',
  IN_PROGRESS: '#14a37f',
  RESOLVED: '#3b82f6',
  CLOSED: '#6b7280',
};
const PAGE = 200;
const MAX_PAGES = 5;

const TOOLTIP_STYLE = {
  background: 'var(--surface-2)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  fontSize: 12,
};

async function fetchAll(status: string): Promise<TicketRow[]> {
  const out: TicketRow[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { rows, total } = await apiFetch<{ rows: TicketRow[]; total: number }>(
      `/admin/chatbot/conversations?status=${status}&limit=${PAGE}&offset=${page * PAGE}`,
    );
    out.push(...rows);
    if (out.length >= total || rows.length < PAGE) break;
  }
  return out;
}

function Donut({
  data,
  centerLabel,
  centerValue,
  highlight,
}: {
  data: { name: string; value: number; color: string }[];
  centerLabel: string;
  /** Shown in the middle instead of the total — for a slice that matters more than the sum. */
  centerValue?: number;
  /** Legend row to emphasise. */
  highlight?: string;
}) {
  const total = data.reduce((n, d) => n + d.value, 0);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
      <div style={{ position: 'relative', width: 160, height: 160, flexShrink: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={total === 0 ? [{ name: 'none', value: 1, color: 'var(--border)' }] : data}
              dataKey="value"
              innerRadius={52}
              outerRadius={74}
              paddingAngle={total === 0 ? 0 : 2}
              stroke="none"
            >
              {(total === 0 ? [{ color: 'var(--border)' }] : data).map((d, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static slice list
                <Cell key={i} fill={d.color} />
              ))}
            </Pie>
            {total > 0 && <Tooltip contentStyle={TOOLTIP_STYLE} />}
          </PieChart>
        </ResponsiveContainer>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--ink)' }}>
            {centerValue ?? total}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>{centerLabel}</div>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 130, flex: 1 }}>
        {data.map((d) => {
          const on = d.name === highlight;
          return (
            <div
              key={d.name}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: on ? 14 : 13,
                padding: on ? '6px 8px' : '0 8px',
                borderRadius: 8,
                background: on ? `color-mix(in srgb, ${d.color} 16%, transparent)` : undefined,
                border: on ? `1px solid ${d.color}` : '1px solid transparent',
              }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 3,
                  background: d.color,
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  flex: 1,
                  color: on ? 'var(--ink)' : 'var(--ink-2)',
                  fontWeight: on ? 700 : 400,
                }}
              >
                {d.name}
              </span>
              <b style={{ color: 'var(--ink)', fontSize: on ? 16 : undefined }}>{d.value}</b>
              <span style={{ color: 'var(--muted)', width: 38, textAlign: 'right', fontSize: 12 }}>
                {total ? `${Math.round((d.value / total) * 100)}%` : '0%'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface Props {
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
  onOpenInbox: () => void;
}

export function TicketAnalytics({ toast, onOpenInbox }: Props) {
  const [rows, setRows] = useState<TicketRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all(STATUSES.map(fetchAll))
      .then((groups) => {
        if (!cancelled) setRows(groups.flat());
      })
      .catch((e) => {
        if (cancelled) return;
        setRows([]);
        toast({
          kind: 'error',
          title: 'Failed to load tickets',
          body: apiErrorMessage(e, 'Please try again.'),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [toast]);

  const view = useMemo(() => {
    const all = rows ?? [];
    const byStatus = STATUSES.map((s) => ({
      key: s,
      name: STATUS_LABEL[s] as string,
      value: all.filter((r) => r.status === s).length,
      color: STATUS_COLOR[s] as string,
    }));
    const shopify = all.filter((r) => r.shopDomain).length;
    const byChannel = [
      { name: 'Shopify', value: shopify, color: '#14a37f' },
      { name: 'Web', value: all.length - shopify, color: '#a56ae8' },
    ];
    // One row per channel, one column per status, for the stacked bar.
    const channelByStatus = [
      { name: 'Shopify', test: (r: TicketRow) => !!r.shopDomain },
      { name: 'Web', test: (r: TicketRow) => !r.shopDomain },
    ].map(({ name, test }) => {
      const row: Record<string, string | number> = { name };
      for (const st of STATUSES) {
        row[STATUS_LABEL[st] as string] = all.filter((r) => test(r) && r.status === st).length;
      }
      return row;
    });
    return {
      byStatus,
      byChannel,
      channelByStatus,
    };
  }, [rows]);

  if (!rows) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: 160,
          color: 'var(--muted)',
          gap: 10,
        }}
      >
        <Icon.Refresh />
        Loading tickets…
      </div>
    );
  }

  return (
    <>
      <div className="section-title">Tickets</div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: 16,
        }}
      >
        <div className="card" style={{ minWidth: 0 }}>
          <div className="card-head" style={{ justifyContent: 'space-between' }}>
            <h3>By status</h3>
            <button className="btn sm" onClick={onOpenInbox}>
              <Icon.MessageSquare /> Open inbox
            </button>
          </div>
          <div className="card-body">
            <Donut
              data={view.byStatus}
              centerLabel="unclaimed"
              centerValue={view.byStatus[0]?.value ?? 0}
              highlight="Unclaimed"
            />
          </div>
        </div>
        <div className="card" style={{ minWidth: 0 }}>
          <div className="card-head">
            <h3>By channel</h3>
          </div>
          <div className="card-body">
            <Donut data={view.byChannel} centerLabel="tickets" />
          </div>
        </div>
        <div className="card" style={{ minWidth: 0 }}>
          <div className="card-head">
            <h3>Status by channel</h3>
          </div>
          <div className="card-body">
            <ResponsiveContainer width="100%" height={170}>
              <BarChart data={view.channelByStatus} layout="vertical" margin={{ right: 16 }}>
                <CartesianGrid stroke="var(--border)" horizontal={false} />
                <XAxis
                  type="number"
                  allowDecimals={false}
                  stroke="var(--muted)"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  stroke="var(--muted)"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                  width={64}
                />
                <Tooltip cursor={{ fill: 'var(--surface-hover)' }} contentStyle={TOOLTIP_STYLE} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                {STATUSES.map((st) => (
                  <Bar
                    key={st}
                    dataKey={STATUS_LABEL[st] as string}
                    stackId="status"
                    fill={STATUS_COLOR[st]}
                    barSize={22}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </>
  );
}
