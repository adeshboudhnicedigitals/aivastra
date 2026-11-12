'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useHq } from '@/components/hq/hq-session';
import { C } from '@/components/tokens';
import { ListState } from '@/components/ui/state';
import { useToast } from '@/components/ui/toast';
import { hqFetch } from '@/lib/hq-api';
import { INVITE_LABEL, relativeTime } from '@/lib/hq-format';

type Detail = {
  id: string;
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  isActive: boolean;
  creditBalance: number | null;
  createdAt: string;
};
type Org = {
  staffLimitPerBranch: number;
  deviceQuotaPerMonth: number | null;
  branches: Array<{
    id: string;
    name: string;
    isActive: boolean;
    staff: Array<{ id: string; email: string; displayName: string; isActive: boolean }>;
  }>;
};
type Device = {
  id: string;
  branchId: string;
  name: string;
  isActive: boolean;
  paired: boolean;
  lastSeenAt: string | null;
};

const card: React.CSSProperties = {
  background: C.card,
  border: `1px solid ${C.border}`,
  borderRadius: 12,
  padding: 16,
  marginBottom: 16,
};
const h2: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 700,
  color: C.text,
  margin: '0 0 12px',
};
const btn: React.CSSProperties = {
  height: 40,
  padding: '0 16px',
  borderRadius: 8,
  border: `1px solid ${C.border2}`,
  background: C.white,
  color: C.text,
  fontFamily: 'inherit',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
};

export default function AccountDetail() {
  const { id } = useParams<{ id: string }>();
  const { can } = useHq();
  const qc = useQueryClient();
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');

  const detail = useQuery({
    queryKey: ['hq', 'account', id],
    queryFn: () => hqFetch<Detail>(`/admin/merchants/${id}`),
  });
  const org = useQuery({
    queryKey: ['hq', 'account', id, 'org'],
    queryFn: () => hqFetch<Org>(`/admin/merchants/${id}/org`),
  });
  const devices = useQuery({
    queryKey: ['hq', 'account', id, 'devices'],
    queryFn: () => hqFetch<Device[]>(`/admin/merchants/${id}/devices`),
  });
  const invite = useQuery({
    queryKey: ['hq', 'account', id, 'invite'],
    queryFn: () => hqFetch<{ status: string }>(`/admin/merchants/${id}/invite`),
  });

  const err = (e: unknown) =>
    toast.show(e instanceof Error ? e.message : 'The request could not be completed.');
  const resend = useMutation({
    mutationFn: () =>
      hqFetch<{ invite: string }>(`/admin/merchants/${id}/invite/resend`, { method: 'POST' }),
    onSuccess: (r) => {
      toast.show(
        r.invite === 'sent' ? 'Invite sent' : 'Invite created but the email failed',
        r.invite === 'sent' ? 'success' : undefined,
      );
      qc.invalidateQueries({ queryKey: ['hq', 'account', id, 'invite'] });
    },
    onError: err,
  });
  const grant = useMutation({
    mutationFn: () =>
      hqFetch<{ newBalance: number }>(`/admin/merchants/${id}/credits`, {
        method: 'POST',
        body: JSON.stringify({ amount: Number(amount), reason: reason.trim() }),
      }),
    onSuccess: (r) => {
      toast.show(`Granted. New balance ${r.newBalance.toLocaleString('en-IN')}`, 'success');
      setAmount('');
      setReason('');
      qc.invalidateQueries({ queryKey: ['hq', 'account', id] });
    },
    onError: err,
  });

  const d = detail.data;
  const grantValid =
    Number.isInteger(Number(amount)) && Number(amount) > 0 && reason.trim().length > 0;
  const branchName = (bid: string) => org.data?.branches.find((b) => b.id === bid)?.name ?? '';

  return (
    <div>
      <Link href="/hq/accounts" style={{ fontSize: 13, color: C.mid }}>
        ← All accounts
      </Link>
      <ListState
        status={detail.status}
        isEmpty={false}
        emptyText=""
        error={detail.error instanceof Error ? detail.error.message : null}
        onRetry={() => detail.refetch()}
      >
        {d && (
          <>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: C.text, margin: '8px 0 16px' }}>
              {d.companyName}
              {!d.isActive && <span style={{ color: C.mid, fontSize: 14 }}> (inactive)</span>}
            </h1>

            <section style={card} aria-label="Owner">
              <h2 style={h2}>Owner</h2>
              <p style={{ margin: 0, fontSize: 14, color: C.text }}>
                {d.contactName} · {d.email} · {d.phone}
              </p>
              <p style={{ margin: '8px 0 0', fontSize: 13, color: C.mid }}>
                Created {relativeTime(d.createdAt)}.{' '}
                {invite.data && (INVITE_LABEL[invite.data.status] ?? invite.data.status)}
              </p>
              {invite.data && invite.data.status !== 'accepted' && can('merchants.write') && (
                <button
                  type="button"
                  style={{ ...btn, marginTop: 8 }}
                  disabled={resend.isPending}
                  onClick={() => resend.mutate()}
                >
                  {resend.isPending ? 'Sending...' : 'Resend invite'}
                </button>
              )}
            </section>

            <section style={card} aria-label="Credits">
              <h2 style={h2}>Credits</h2>
              <p style={{ margin: '0 0 12px', fontSize: 14, color: C.text }}>
                Balance: <strong>{(d.creditBalance ?? 0).toLocaleString('en-IN')}</strong>
              </p>
              {can('credits.grant') ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (grantValid) grant.mutate();
                  }}
                  style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}
                >
                  <input
                    aria-label="Credits to grant"
                    type="number"
                    min={1}
                    placeholder="Credits"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    style={{ ...btn, width: 120, fontWeight: 400 }}
                  />
                  <input
                    aria-label="Reason"
                    placeholder="Reason (recorded in the audit log)"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    style={{ ...btn, flex: '1 1 240px', fontWeight: 400 }}
                  />
                  <button type="submit" style={btn} disabled={!grantValid || grant.isPending}>
                    {grant.isPending ? 'Granting...' : 'Grant credits'}
                  </button>
                </form>
              ) : (
                <p style={{ margin: 0, fontSize: 13, color: C.mid }}>
                  Your role cannot grant credits.
                </p>
              )}
            </section>

            <section style={card} aria-label="Branches and staff">
              <h2 style={h2}>Branches</h2>
              <ListState
                status={org.status}
                isEmpty={(org.data?.branches.length ?? 0) === 0}
                emptyText="No branches yet."
              >
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, color: C.text }}>
                  {org.data?.branches.map((b) => (
                    <li key={b.id}>
                      {b.name}
                      {!b.isActive && ' (inactive)'}: {b.staff.filter((s) => s.isActive).length}{' '}
                      staff
                    </li>
                  ))}
                </ul>
              </ListState>
            </section>

            <section style={card} aria-label="Tablets">
              <h2 style={h2}>Tablets</h2>
              <ListState
                status={devices.status}
                isEmpty={(devices.data?.length ?? 0) === 0}
                emptyText="No tablets yet."
              >
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, color: C.text }}>
                  {devices.data?.map((dv) => (
                    <li key={dv.id}>
                      {dv.name} ({branchName(dv.branchId)}):{' '}
                      {!dv.isActive
                        ? 'inactive'
                        : dv.paired
                          ? `paired, seen ${relativeTime(dv.lastSeenAt)}`
                          : 'not paired yet'}
                    </li>
                  ))}
                </ul>
              </ListState>
            </section>
          </>
        )}
      </ListState>
    </div>
  );
}
