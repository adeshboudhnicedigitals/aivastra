import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { apiErrorMessage, apiFetch } from '../lib/data';
import { CHART_TOOLTIP_STYLE, Donut } from './Donut';
import { Icon } from './Icons';

// Graphical ticket overview built from the same list endpoint Chat Inbox uses
// (GET /admin/chatbot/conversations) — no stats endpoint exists for tickets, so
// the rows are fetched once per status and aggregated here. Mirrors
// support-web's TicketAnalytics card-for-card.

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
    return { byStatus, byChannel, channelByStatus };
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
    <div>
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
                <Tooltip
                  cursor={{ fill: 'var(--surface-hover)' }}
                  contentStyle={CHART_TOOLTIP_STYLE}
                />
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
    </div>
  );
}
