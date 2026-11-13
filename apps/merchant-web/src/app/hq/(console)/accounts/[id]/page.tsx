'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Coins, MonitorSmartphone, ShoppingBag, Store } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { KpiCard } from '@/components/analytics/KpiCard';
import { AccountAnalytics } from '@/components/hq/account-analytics';
import { AccountInsights } from '@/components/hq/account-insights';
import { useHq } from '@/components/hq/hq-session';
import { Avatar, btn, Card, Fact, Pill, Skeleton } from '@/components/hq/ui';
import { C } from '@/components/tokens';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
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
type ShopifyStore = {
  id: string;
  shopDomain: string;
  shopName: string | null;
  partnerDevelopment: boolean;
  installedAt: string;
  uninstalledAt: string | null;
  balance: number;
  jobs: number;
};

const n = (v: number) => v.toLocaleString('en-IN');
const field: React.CSSProperties = {
  height: 40,
  padding: '0 12px',
  borderRadius: 8,
  border: `1px solid ${C.border2}`,
  background: C.field,
  color: C.text,
  fontFamily: 'inherit',
  fontSize: 14,
  minWidth: 0,
};
const ONLINE_MS = 24 * 3600 * 1000;

function deviceState(d: Device): { tone: 'ok' | 'warn' | 'muted'; label: string } {
  if (!d.isActive) return { tone: 'muted', label: 'Switched off' };
  if (!d.paired) return { tone: 'warn', label: 'Not paired yet' };
  if (!d.lastSeenAt) return { tone: 'warn', label: 'Never seen' };
  return Date.now() - new Date(d.lastSeenAt).getTime() <= ONLINE_MS
    ? { tone: 'ok', label: 'Online' }
    : { tone: 'warn', label: 'Offline' };
}

export default function AccountDetail() {
  const { id } = useParams<{ id: string }>();
  const { can } = useHq();
  const qc = useQueryClient();
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [grantError, setGrantError] = useState<string | null>(null);

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
  const stores = useQuery({
    queryKey: ['hq', 'account', id, 'shopify'],
    queryFn: () => hqFetch<{ stores: ShopifyStore[] }>(`/admin/accounts/${id}/shopify-stores`),
  });
  const invite = useQuery({
    queryKey: ['hq', 'account', id, 'invite'],
    queryFn: () => hqFetch<{ status: string }>(`/admin/merchants/${id}/invite`),
  });

  const resend = useMutation({
    mutationFn: () =>
      hqFetch<{ invite: string }>(`/admin/merchants/${id}/invite/resend`, { method: 'POST' }),
    onSuccess: (r) => {
      if (r.invite === 'sent') toast.show('Invite email sent', 'success');
      else toast.show('The invite was created but the email could not be sent. Try again.');
      qc.invalidateQueries({ queryKey: ['hq', 'account', id, 'invite'] });
    },
    onError: (e) => toast.show(e instanceof Error ? e.message : 'Could not resend the invite.'),
  });

  const credits = Number(amount);
  const amountError =
    amount === ''
      ? 'Enter how many credits to add.'
      : !Number.isInteger(credits) || credits <= 0
        ? 'Use a whole number above zero.'
        : null;
  const reasonError = reason.trim() === '' ? 'A reason is required for the audit log.' : null;

  const grant = useMutation({
    mutationFn: () =>
      hqFetch<{ newBalance: number }>(`/admin/merchants/${id}/credits`, {
        method: 'POST',
        body: JSON.stringify({ amount: credits, reason: reason.trim() }),
      }),
    onSuccess: (r) => {
      setConfirming(false);
      setGrantError(null);
      setAmount('');
      setReason('');
      setTouched(false);
      toast.show(`Added ${n(credits)} credits. New balance ${n(r.newBalance)}.`, 'success');
      qc.invalidateQueries({ queryKey: ['hq', 'account', id] });
    },
    onError: (e) => setGrantError(e instanceof Error ? e.message : 'The grant did not go through.'),
  });

  const d = detail.data;
  const branchName = (bid: string) =>
    org.data?.branches.find((b) => b.id === bid)?.name ?? 'Unknown branch';
  const online = (devices.data ?? []).filter((x) => deviceState(x).tone === 'ok').length;

  if (detail.isError) {
    return (
      <div>
        <Link href="/hq/accounts" style={{ fontSize: 13, color: C.mid }}>
          ← All accounts
        </Link>
        <div
          role="alert"
          style={{
            marginTop: 12,
            background: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: 14,
            padding: 20,
          }}
        >
          <strong style={{ color: C.text }}>Could not load this account.</strong>
          <p style={{ margin: '6px 0 12px', fontSize: 14, color: C.mid }}>
            {detail.error instanceof Error ? detail.error.message : 'Try again in a moment.'}
          </p>
          <button type="button" style={btn.base} onClick={() => void detail.refetch()}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Link
        href="/hq/accounts"
        style={{
          display: 'inline-block',
          fontSize: 13,
          fontWeight: 600,
          color: C.mid,
          textDecoration: 'none',
        }}
      >
        ← All accounts
      </Link>

      {!d ? (
        <div style={{ display: 'grid', gap: 12, marginTop: 12 }} aria-busy="true">
          <Skeleton h={34} w="40%" />
          <Skeleton h={90} />
          <Skeleton h={160} />
        </div>
      ) : (
        <>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'flex-start',
              gap: 12,
              margin: '12px 0 20px',
            }}
          >
            <Avatar name={d.companyName} size={44} />
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                <h1
                  style={{
                    fontSize: 22,
                    fontWeight: 700,
                    color: C.text,
                    margin: 0,
                    overflowWrap: 'anywhere',
                  }}
                >
                  {d.companyName}
                </h1>
                <Pill tone={d.isActive ? 'ok' : 'muted'}>{d.isActive ? 'Active' : 'Inactive'}</Pill>
              </div>
              <div style={{ fontSize: 13, color: C.mid, marginTop: 2 }}>
                {d.email} · customer since {relativeTime(d.createdAt)}
              </div>
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
              gap: 12,
              marginBottom: 16,
            }}
          >
            <KpiCard
              label="Credit balance"
              icon={<Coins size={20} />}
              value={n(d.creditBalance ?? 0)}
              hint="Shared across every channel"
            />
            <KpiCard
              label="Branches"
              icon={<Store size={20} />}
              value={n(org.data?.branches.length ?? 0)}
              loading={org.isPending}
              hint="Physical stores on this account"
            />
            <KpiCard
              label="Tablets online"
              icon={<MonitorSmartphone size={20} />}
              value={devices.data ? `${online} of ${devices.data.length}` : '…'}
              loading={devices.isPending}
              hint="Seen in the last 24 hours"
            />
            <KpiCard
              label="Shopify stores"
              icon={<ShoppingBag size={20} />}
              value={stores.data ? n(stores.data.stores.length) : '…'}
              loading={stores.isPending}
              hint="Linked to the account owner"
            />
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))',
              gap: 16,
              marginBottom: 16,
              alignItems: 'start',
            }}
          >
            <Card title="Owner and access">
              <div style={{ display: 'grid', gap: 12 }}>
                <Fact label="Contact">{d.contactName}</Fact>
                <Fact label="Email">{d.email}</Fact>
                <Fact label="Phone">{d.phone}</Fact>
                <Fact label="Customer since">{relativeTime(d.createdAt)}</Fact>
                <Fact label="Sign-in">
                  {invite.data ? (
                    <Pill
                      tone={
                        invite.data.status === 'accepted'
                          ? 'ok'
                          : invite.data.status === 'pending'
                            ? 'warn'
                            : 'bad'
                      }
                    >
                      {INVITE_LABEL[invite.data.status] ?? invite.data.status}
                    </Pill>
                  ) : (
                    <Skeleton h={20} w={160} />
                  )}
                </Fact>
              </div>
              {invite.data && invite.data.status !== 'accepted' && can('merchants.write') && (
                <button
                  type="button"
                  style={{ ...btn.base, marginTop: 14 }}
                  disabled={resend.isPending}
                  onClick={() => resend.mutate()}
                >
                  {resend.isPending ? 'Sending…' : 'Send a new invite email'}
                </button>
              )}
            </Card>

            <Card title="Add credits">
              <p style={{ margin: '0 0 12px', fontSize: 13, color: C.mid }}>
                Current balance:{' '}
                <strong style={{ color: C.text }}>{n(d.creditBalance ?? 0)}</strong>. Every grant is
                recorded in the audit log with your name and the reason.
              </p>
              {can('credits.grant') ? (
                <form
                  noValidate
                  onSubmit={(e) => {
                    e.preventDefault();
                    setTouched(true);
                    if (!amountError && !reasonError) setConfirming(true);
                  }}
                  style={{ display: 'grid', gap: 10 }}
                >
                  <label
                    style={{ display: 'grid', gap: 6, fontSize: 12, fontWeight: 600, color: C.mid }}
                  >
                    Credits to add
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      value={amount}
                      aria-invalid={touched && !!amountError}
                      aria-describedby="amount-err"
                      onChange={(e) => setAmount(e.target.value)}
                      style={field}
                    />
                  </label>
                  <div
                    id="amount-err"
                    role="alert"
                    style={{ fontSize: 12, color: C.danger, minHeight: 0 }}
                  >
                    {touched && amountError}
                  </div>
                  <label
                    style={{ display: 'grid', gap: 6, fontSize: 12, fontWeight: 600, color: C.mid }}
                  >
                    Reason
                    <input
                      value={reason}
                      aria-invalid={touched && !!reasonError}
                      aria-describedby="reason-err"
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="e.g. Pilot top-up agreed with the account owner"
                      style={field}
                    />
                  </label>
                  {touched && reasonError && (
                    <div
                      id="reason-err"
                      role="alert"
                      style={{ fontSize: 12, color: C.danger, marginTop: -4 }}
                    >
                      {reasonError}
                    </div>
                  )}
                  <button type="submit" style={btn.primary}>
                    Review and add credits
                  </button>
                </form>
              ) : (
                <p style={{ margin: 0, fontSize: 13, color: C.mid }}>
                  Your role cannot add credits. Ask a super admin.
                </p>
              )}
            </Card>
          </div>

          <div style={{ marginBottom: 16 }}>
            <AccountAnalytics merchantId={d.id} />
          </div>

          <div style={{ marginBottom: 16 }}>
            <AccountInsights merchantId={d.id} branches={org.data?.branches ?? []} />
          </div>

          <div style={{ display: 'grid', gap: 16 }}>
            <Card title="Branches and staff">
              {org.isPending ? (
                <Skeleton h={60} />
              ) : (org.data?.branches.length ?? 0) === 0 ? (
                <p style={{ margin: 0, color: C.mid, fontSize: 14 }}>No branches yet.</p>
              ) : (
                <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 10 }}>
                  {org.data?.branches.map((b) => (
                    <li
                      key={b.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 8,
                        flexWrap: 'wrap',
                        fontSize: 14,
                        color: C.text,
                      }}
                    >
                      <strong>{b.name}</strong>
                      <span style={{ color: C.mid }}>
                        {b.staff.filter((s) => s.isActive).length} active staff
                        {!b.isActive && ' · branch switched off'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="Tablets">
              {devices.isPending ? (
                <Skeleton h={60} />
              ) : (devices.data?.length ?? 0) === 0 ? (
                <p style={{ margin: 0, color: C.mid, fontSize: 14 }}>No tablets yet.</p>
              ) : (
                <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 10 }}>
                  {devices.data?.map((dv) => {
                    const st = deviceState(dv);
                    return (
                      <li
                        key={dv.id}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: 8,
                          flexWrap: 'wrap',
                          fontSize: 14,
                        }}
                      >
                        <span style={{ color: C.text }}>
                          <strong>{dv.name}</strong>{' '}
                          <span style={{ color: C.mid }}>· {branchName(dv.branchId)}</span>
                        </span>
                        <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <span style={{ fontSize: 12, color: C.mid }}>
                            {dv.paired ? `seen ${relativeTime(dv.lastSeenAt)}` : ''}
                          </span>
                          <Pill tone={st.tone}>{st.label}</Pill>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>

            <Card title="Shopify stores">
              {stores.isPending ? (
                <Skeleton h={60} />
              ) : (stores.data?.stores.length ?? 0) === 0 ? (
                <p style={{ margin: 0, color: C.mid, fontSize: 14 }}>
                  No Shopify stores are linked to this account.
                </p>
              ) : (
                <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 10 }}>
                  {stores.data?.stores.map((st) => (
                    <li
                      key={st.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 8,
                        flexWrap: 'wrap',
                        fontSize: 14,
                      }}
                    >
                      <span style={{ color: C.text, overflowWrap: 'anywhere' }}>
                        <strong>{st.shopName ?? st.shopDomain}</strong>{' '}
                        <span style={{ color: C.mid }}>
                          · {st.shopDomain} · {n(st.balance)} credits · {n(st.jobs)} try-ons
                          {st.partnerDevelopment && ' · development store'}
                        </span>
                      </span>
                      <Pill tone={st.uninstalledAt ? 'muted' : 'ok'}>
                        {st.uninstalledAt ? 'Uninstalled' : 'Installed'}
                      </Pill>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <ConfirmDialog
            open={confirming}
            title={`Add ${n(credits)} credits to ${d.companyName}?`}
            body={`New balance will be ${n((d.creditBalance ?? 0) + (Number.isFinite(credits) ? credits : 0))}. Reason: “${reason.trim()}”. This is recorded in the audit log.`}
            confirmLabel="Add credits"
            busy={grant.isPending}
            error={grantError}
            onConfirm={() => grant.mutate()}
            onCancel={() => {
              setConfirming(false);
              setGrantError(null);
            }}
          />
        </>
      )}
    </div>
  );
}
