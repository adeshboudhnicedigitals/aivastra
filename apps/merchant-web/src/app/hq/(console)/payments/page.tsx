'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { useHq } from '@/components/hq/hq-session';
import {
  EmptyBox,
  ErrorBox,
  FilterTabs,
  field,
  NoAccess,
  PageHead,
  Pager,
  td,
  th,
} from '@/components/hq/list-parts';
import { btn, Pill, Skeleton, type Tone } from '@/components/hq/ui';
import { C, M } from '@/components/tokens';
import { hqFetch } from '@/lib/hq-api';

// A copy of admin-web's Payments page for the team console. The admin page is untouched; both
// call the same /admin/payments routes, which require payments.read.

const PAGE_SIZE = 20;
const STATUS_FILTERS = [
  { k: 'all', l: 'All' },
  { k: 'paid', l: 'Paid' },
  { k: 'created', l: 'Pending' },
  { k: 'failed', l: 'Failed' },
] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number]['k'];

type PaymentRow = {
  id: string;
  userId: string;
  userEmail: string | null;
  userDisplayName: string | null;
  userTier: string;
  planId: string;
  planName: string | null;
  credits: number;
  totalPaise: number;
  razorpayOrderId: string;
  razorpayPaymentId: string | null;
  status: string;
  createdAt: string;
  paidAt: string | null;
  invoiceNumber: string | null;
  invoiceUrl: string | null;
};
type PaymentList = { page: number; pageSize: number; total: number; items: PaymentRow[] };

const rupees = (paise: number) =>
  `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

function statusOf(status: string): { tone: Tone; label: string } {
  if (status === 'paid') return { tone: 'ok', label: 'Paid' };
  if (status === 'failed') return { tone: 'bad', label: 'Failed' };
  return { tone: 'warn', label: 'Pending' };
}

export default function PaymentsPage() {
  const { can } = useHq();
  if (!can('payments.read')) return <NoAccess what="payments" />;
  return <Payments />;
}

function Payments() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [page, setPage] = useState(1);
  const [invoiceError, setInvoiceError] = useState<string | null>(null);

  const key = ['hq', 'payments', applied, status, page];
  const q = useQuery({
    queryKey: key,
    queryFn: () => {
      const p = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), status });
      if (applied) p.set('search', applied);
      return hqFetch<PaymentList>(`/admin/payments?${p}`);
    },
    placeholderData: (prev) => prev,
  });
  const rows = q.data?.items ?? [];
  const total = q.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = applied !== '' || status !== 'all';

  const invoice = useMutation({
    mutationFn: (id: string) =>
      hqFetch<{ invoiceNumber: string; invoiceUrl: string | null }>(
        `/admin/payments/${id}/generate-invoice`,
        { method: 'POST' },
      ),
    onMutate: () => setInvoiceError(null),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hq', 'payments'] }),
    onError: (e) =>
      setInvoiceError(e instanceof Error ? e.message : 'Could not generate the invoice.'),
  });

  const invoiceCell = (p: PaymentRow) =>
    p.invoiceUrl ? (
      <a
        href={p.invoiceUrl}
        target="_blank"
        rel="noreferrer"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: C.text }}
      >
        <Download size={14} aria-hidden="true" />
        {p.invoiceNumber}
      </a>
    ) : p.status === 'paid' ? (
      <button
        type="button"
        style={{ ...btn.base, height: 32, padding: '0 10px', fontSize: 13 }}
        disabled={invoice.isPending && invoice.variables === p.id}
        onClick={() => invoice.mutate(p.id)}
      >
        {invoice.isPending && invoice.variables === p.id ? 'Generating…' : 'Generate invoice'}
      </button>
    ) : (
      <span style={{ color: C.mid }}>No invoice</span>
    );

  return (
    <div>
      <PageHead
        title="Payments"
        lede="Credit purchases across all customers. Search by invoice number, Razorpay ID or email."
      />

      <search>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setApplied(search.trim());
            setPage(1);
          }}
          style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}
        >
          <input
            aria-label="Search payments"
            type="search"
            placeholder="Invoice number, Razorpay ID or email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ ...field, flex: '1 1 280px' }}
          />
          <button type="submit" style={btn.primary}>
            Search
          </button>
          {applied !== '' && (
            <button
              type="button"
              style={btn.base}
              onClick={() => {
                setSearch('');
                setApplied('');
                setPage(1);
              }}
            >
              Clear search
            </button>
          )}
        </form>
      </search>

      <FilterTabs
        label="Payment status"
        value={status}
        options={STATUS_FILTERS}
        onChange={(k) => {
          setStatus(k);
          setPage(1);
        }}
      />

      <div
        aria-live="polite"
        style={{ fontSize: 13, color: C.mid, marginBottom: 8, minHeight: 18 }}
      >
        {q.isSuccess && `${total.toLocaleString('en-IN')} payment${total === 1 ? '' : 's'}`}
      </div>
      {invoiceError && (
        <div role="alert" style={{ color: M.danger, fontSize: 14, marginBottom: 10 }}>
          {invoiceError}
        </div>
      )}

      {q.isError ? (
        <ErrorBox what="payments" error={q.error} onRetry={() => void q.refetch()} />
      ) : q.isPending ? (
        <div style={{ display: 'grid', gap: 10 }} aria-busy="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} h={52} />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyBox>{filtered ? 'No payments match those filters.' : 'No payments yet.'}</EmptyBox>
      ) : (
        <>
          <div
            className="hq-table hq-card"
            style={{ overflowX: 'auto', opacity: q.isPlaceholderData ? 0.6 : 1 }}
          >
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <caption className="sr-only">Payments</caption>
              <thead>
                <tr style={{ color: C.mid, fontSize: 12 }}>
                  <th scope="col" style={th}>
                    Date
                  </th>
                  <th scope="col" style={th}>
                    Customer
                  </th>
                  <th scope="col" style={th}>
                    Plan
                  </th>
                  <th scope="col" style={{ ...th, textAlign: 'right' }}>
                    Credits
                  </th>
                  <th scope="col" style={{ ...th, textAlign: 'right' }}>
                    Amount
                  </th>
                  <th scope="col" style={th}>
                    Razorpay payment ID
                  </th>
                  <th scope="col" style={th}>
                    Status
                  </th>
                  <th scope="col" style={th}>
                    Invoice
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const s = statusOf(p.status);
                  return (
                    <tr key={p.id} style={{ borderTop: `1px solid ${C.border}` }}>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>
                        {day(p.paidAt ?? p.createdAt)}
                      </td>
                      <td style={td}>
                        <div style={{ fontWeight: 700 }}>{p.userDisplayName ?? '—'}</div>
                        <div style={{ fontSize: 12, color: C.mid }}>{p.userEmail ?? '—'}</div>
                      </td>
                      <td style={td}>
                        {p.planName ?? p.planId}
                        <div style={{ fontSize: 12, color: C.mid, textTransform: 'capitalize' }}>
                          {p.userTier} access
                        </div>
                      </td>
                      <td style={{ ...td, textAlign: 'right' }}>
                        {p.credits.toLocaleString('en-IN')}
                      </td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>
                        {rupees(p.totalPaise)}
                      </td>
                      <td style={{ ...td, fontSize: 12, overflowWrap: 'anywhere' }}>
                        {p.razorpayPaymentId ?? '—'}
                      </td>
                      <td style={td}>
                        <Pill tone={s.tone}>{s.label}</Pill>
                      </td>
                      <td style={td}>{invoiceCell(p)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <ul className="hq-cards" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {rows.map((p) => {
              const s = statusOf(p.status);
              return (
                <li key={p.id} className="hq-card" style={{ padding: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <strong style={{ overflowWrap: 'anywhere' }}>
                        {p.userDisplayName ?? p.userEmail ?? '—'}
                      </strong>
                      <div style={{ fontSize: 12, color: C.mid }}>
                        {day(p.paidAt ?? p.createdAt)}
                      </div>
                    </div>
                    <Pill tone={s.tone}>{s.label}</Pill>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      marginTop: 10,
                      fontSize: 13,
                    }}
                  >
                    <span style={{ color: C.mid }}>
                      {p.planName ?? p.planId} · +{p.credits.toLocaleString('en-IN')} credits
                    </span>
                    <strong>{rupees(p.totalPaise)}</strong>
                  </div>
                  <div style={{ marginTop: 10, fontSize: 13 }}>{invoiceCell(p)}</div>
                </li>
              );
            })}
          </ul>

          <Pager page={page} pages={pages} onPage={setPage} />
        </>
      )}
    </div>
  );
}
