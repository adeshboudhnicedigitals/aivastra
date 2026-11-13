'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useHq } from '@/components/hq/hq-session';
import {
  EmptyBox,
  ErrorBox,
  FilterTabs,
  field,
  NoAccess,
  PageHead,
  td,
  th,
} from '@/components/hq/list-parts';
import { Modal } from '@/components/hq/modal';
import { btn, Fact, Pill, Skeleton, type Tone } from '@/components/hq/ui';
import { C, M } from '@/components/tokens';
import { PremiumSelect } from '@/components/ui/premium-select';
import { hqFetch } from '@/lib/hq-api';

// A copy of admin-web's Contact requests page: the old Contact Us and Support submissions
// (new ones now open Chat inbox tickets). Same /admin/contact-requests routes.

type Status = 'new' | 'read' | 'done';
type ContactRequest = {
  id: string;
  name: string;
  email: string;
  phone: string;
  source: string | null;
  message: string | null;
  attachmentKey: string | null;
  attachmentUrl: string | null;
  status: Status;
  createdAt: string;
};
type Summary = {
  sources: Array<string | null>;
  newBySource: Record<string, number>;
  totalBySource: Record<string, number>;
};

const STATUSES = [
  { k: 'all', l: 'All' },
  { k: 'new', l: 'New' },
  { k: 'read', l: 'Read' },
  { k: 'done', l: 'Done' },
] as const;
type StatusFilter = (typeof STATUSES)[number]['k'];
const STATUS_TONE: Record<Status, Tone> = { new: 'bad', read: 'warn', done: 'ok' };
const STATUS_LABEL: Record<Status, string> = { new: 'New', read: 'Read', done: 'Done' };
const SOURCE_LABELS: Record<string, string> = {
  'app-support': 'App support',
  'Integrate with Website': 'Integration',
  'Retail Store Kiosk': 'Retail / kiosk',
  __null__: 'General',
};
const sourceKey = (s: string | null) => (s === null ? '__null__' : s);
const sourceLabel = (s: string | null) => SOURCE_LABELS[sourceKey(s)] ?? s ?? 'General';
const when = (v: string) =>
  new Date(v).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

export default function ContactRequestsPage() {
  const { can } = useHq();
  if (!can('contact.read')) return <NoAccess what="contact requests" />;
  return <Contacts canWrite={can('contact.write')} />;
}

function Contacts({ canWrite }: { canWrite: boolean }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<StatusFilter>('all');
  const [source, setSource] = useState('all');
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // New enquiries arrive while the page is open, so both queries refresh on a timer.
  const list = useQuery({
    queryKey: ['hq', 'contacts', status, source],
    queryFn: () => {
      const p = new URLSearchParams({ status, limit: '100' });
      if (source !== 'all') p.set('source', source);
      return hqFetch<{ rows: ContactRequest[]; total: number }>(`/admin/contact-requests?${p}`);
    },
    refetchInterval: 15_000,
    placeholderData: (prev) => prev,
  });
  const summary = useQuery({
    queryKey: ['hq', 'contacts', 'sources'],
    queryFn: () => hqFetch<Summary>('/admin/contact-requests/sources'),
    refetchInterval: 15_000,
  });

  const update = useMutation({
    mutationFn: (v: { id: string; status: Status }) =>
      hqFetch<ContactRequest>(`/admin/contact-requests/${v.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: v.status }),
      }),
    onMutate: () => setError(null),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['hq', 'contacts'] }),
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not update the request.'),
  });

  const needle = search.trim().toLowerCase();
  const rows = (list.data?.rows ?? []).filter(
    (r) =>
      !needle ||
      r.name.toLowerCase().includes(needle) ||
      r.email.toLowerCase().includes(needle) ||
      r.message?.toLowerCase().includes(needle),
  );
  const open = list.data?.rows.find((r) => r.id === openId) ?? null;
  const totalNew = summary.data?.newBySource.__total__ ?? 0;

  const sourceOptions = [
    { value: 'all', label: 'All channels' },
    ...(summary.data?.sources ?? []).map((s) => {
      const k = sourceKey(s);
      return {
        value: k,
        label: `${sourceLabel(s)} (${summary.data?.newBySource[k] ?? 0} new)`,
      };
    }),
  ];

  return (
    <div>
      <PageHead
        title="Contact requests"
        lede="Older Contact Us and Support submissions. New ones now open tickets in Chat inbox."
      />

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <input
          aria-label="Search name, email or message"
          type="search"
          placeholder="Search name, email or message"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...field, flex: '1 1 260px' }}
        />
        <div
          style={{
            flex: '0 1 240px',
            minWidth: 170,
            height: 40,
            borderRadius: 8,
            border: `1px solid ${C.border2}`,
            background: C.field,
          }}
        >
          <PremiumSelect
            fullWidth
            height={38}
            fontSize={14}
            ariaLabel="Channel"
            value={source}
            options={sourceOptions}
            onChange={(v) => setSource(String(v))}
          />
        </div>
      </div>

      <FilterTabs label="Request status" value={status} options={STATUSES} onChange={setStatus} />

      <div
        aria-live="polite"
        style={{ fontSize: 13, color: C.mid, marginBottom: 8, minHeight: 18 }}
      >
        {list.isSuccess &&
          `${list.data.total.toLocaleString('en-IN')} total${totalNew > 0 ? ` · ${totalNew} new` : ''}`}
      </div>
      {error && !open && (
        <div role="alert" style={{ color: M.danger, fontSize: 14, marginBottom: 10 }}>
          {error}
        </div>
      )}

      {list.isError ? (
        <ErrorBox what="contact requests" error={list.error} onRetry={() => void list.refetch()} />
      ) : list.isPending ? (
        <div style={{ display: 'grid', gap: 10 }} aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} h={52} />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyBox>
          {needle ? `Nothing matches “${search}”.` : 'No contact requests match these filters.'}
        </EmptyBox>
      ) : (
        <>
          <div className="hq-table hq-card" style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <caption className="sr-only">Contact requests</caption>
              <thead>
                <tr style={{ color: C.mid, fontSize: 12 }}>
                  <th scope="col" style={th}>
                    Name
                  </th>
                  <th scope="col" style={th}>
                    Email
                  </th>
                  <th scope="col" style={th}>
                    Channel
                  </th>
                  <th scope="col" style={th}>
                    Status
                  </th>
                  <th scope="col" style={th}>
                    Received
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="hq-row" style={{ borderTop: `1px solid ${C.border}` }}>
                    <td style={td}>
                      <button
                        type="button"
                        onClick={() => setOpenId(r.id)}
                        style={{
                          all: 'unset',
                          cursor: 'pointer',
                          color: C.text,
                          fontWeight: r.status === 'new' ? 800 : 600,
                        }}
                      >
                        {r.name}
                      </button>
                    </td>
                    <td style={{ ...td, color: C.mid, overflowWrap: 'anywhere' }}>{r.email}</td>
                    <td style={td}>{sourceLabel(r.source)}</td>
                    <td style={td}>
                      <Pill tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Pill>
                    </td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{when(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="hq-cards" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {rows.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className="hq-card hq-card--link"
                  onClick={() => setOpenId(r.id)}
                  style={{
                    display: 'grid',
                    gap: 4,
                    width: '100%',
                    padding: 14,
                    textAlign: 'left',
                    fontFamily: 'inherit',
                    color: C.text,
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <strong>{r.name}</strong>
                    <Pill tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Pill>
                  </span>
                  <span style={{ fontSize: 12, color: C.mid, overflowWrap: 'anywhere' }}>
                    {r.email}
                  </span>
                  <span style={{ fontSize: 12, color: C.mid }}>
                    {sourceLabel(r.source)} · {when(r.createdAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <Modal open={!!open} title={open?.name ?? 'Contact request'} onClose={() => setOpenId(null)}>
        {open && (
          <>
            <div>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{open.name}</h2>
              <div style={{ color: C.mid, overflowWrap: 'anywhere' }}>
                {open.email}
                {open.phone ? ` · ${open.phone}` : ''}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
              <Fact label="Status">
                <Pill tone={STATUS_TONE[open.status]}>{STATUS_LABEL[open.status]}</Pill>
              </Fact>
              <Fact label="Channel">{sourceLabel(open.source)}</Fact>
              <Fact label="Received">{when(open.createdAt)}</Fact>
            </div>
            <Fact label="Message">
              <span style={{ fontWeight: 400, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                {open.message || 'No message included'}
              </span>
            </Fact>
            {open.attachmentUrl && (
              <Fact label="Attachment">
                <a
                  href={open.attachmentUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: C.text }}
                >
                  {open.attachmentKey && /\.(jpe?g|png|webp)$/i.test(open.attachmentKey) ? (
                    // biome-ignore lint/performance/noImgElement: presigned storage URL
                    <img
                      src={open.attachmentUrl}
                      alt="Attachment (opens full size)"
                      style={{ maxWidth: 240, maxHeight: 240, borderRadius: 8, display: 'block' }}
                    />
                  ) : (
                    'Open attachment'
                  )}
                </a>
              </Fact>
            )}
            {error && (
              <div role="alert" style={{ color: M.danger }}>
                {error}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button type="button" style={btn.base} onClick={() => setOpenId(null)}>
                Close
              </button>
              {canWrite && open.status === 'new' && (
                <button
                  type="button"
                  style={btn.base}
                  disabled={update.isPending}
                  onClick={() => update.mutate({ id: open.id, status: 'read' })}
                >
                  Mark read
                </button>
              )}
              {canWrite && open.status !== 'done' && (
                <button
                  type="button"
                  style={btn.primary}
                  disabled={update.isPending}
                  title="Sends the customer a resolution email"
                  onClick={() => update.mutate({ id: open.id, status: 'done' })}
                >
                  Mark resolved (emails the customer)
                </button>
              )}
              {canWrite && open.status === 'done' && (
                <button
                  type="button"
                  style={btn.base}
                  disabled={update.isPending}
                  onClick={() => update.mutate({ id: open.id, status: 'new' })}
                >
                  Reopen
                </button>
              )}
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
