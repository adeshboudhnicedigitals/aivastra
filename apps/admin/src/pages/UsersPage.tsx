import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../components/Icons';
import { KV } from '../components/KV';
import { NameAvatar } from '../components/NameAvatar';
import { Pager } from '../components/Pager';
import { StatusBadge } from '../components/StatusBadge';
import type { SortDir } from '../components/Th';
import { Th } from '../components/Th';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../lib/data';
import type { User } from '../types';

const PAGE_SIZE = 20;

interface Props {
  onNav: (_page: string, _filter?: { page: string; filter?: string }) => void;
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
}

export default function UsersPage({ onNav: _onNav, toast }: Props) {
  const { role: myRole } = useAuth();
  const isSuperAdmin = myRole === 'SUPER_ADMIN';
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [sortKey, setSortKey] = useState<keyof User>('createdAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [users, setUsers] = useState<User[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<User | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [confirmSuspend, setConfirmSuspend] = useState<string | null>(null);
  const [grantUserId, setGrantUserId] = useState<string | null>(null);
  const [grantAmount, setGrantAmount] = useState('');
  const [grantReason, setGrantReason] = useState('');
  const [granting, setGranting] = useState(false);
  const [adminActioning, setAdminActioning] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page + 1), pageSize: String(PAGE_SIZE) });
      if (query) params.set('search', query);
      const data = await apiFetch<{ items: User[]; total: number }>(`/admin/users?${params}`);
      setUsers(data.items);
      setTotal(data.total);
    } catch {
      toast({ kind: 'error', title: 'Failed to load users' });
    } finally {
      setLoading(false);
    }
  }, [page, query, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSearch = (q: string) => {
    setQuery(q);
    setPage(0);
  };

  const sorted = [...users].sort((a, b) => {
    const aVal = a[sortKey] ?? '';
    const bVal = b[sortKey] ?? '';
    const cmp =
      typeof aVal === 'string'
        ? aVal.localeCompare(bVal as string)
        : (aVal as number) - (bVal as number);
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const handleSort = (k: keyof User) => {
    if (k === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(k);
      setSortDir('asc');
    }
  };

  const openDetail = async (u: User) => {
    setDetail(u);
    setDetailLoading(true);
    try {
      const full = await apiFetch<User>(`/admin/users/${u.id}`);
      setDetail(full);
    } catch {
      toast({ kind: 'error', title: 'Failed to load user detail' });
    } finally {
      setDetailLoading(false);
    }
  };

  const handleSuspendConfirm = async () => {
    if (!confirmSuspend || !detail) return;
    const willBan = !detail.isBanned;
    try {
      await apiFetch(`/admin/users/${detail.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isBanned: willBan }),
      });
      setDetail({ ...detail, isBanned: willBan });
      setUsers((prev) => prev.map((u) => (u.id === detail.id ? { ...u, isBanned: willBan } : u)));
      toast({ title: `User ${willBan ? 'suspended' : 'unsuspended'}` });
    } catch {
      toast({ kind: 'error', title: 'Action failed' });
    }
    setConfirmSuspend(null);
  };

  const handleGrant = async () => {
    if (!grantUserId || !grantAmount) return;
    setGranting(true);
    try {
      const body = {
        userId: grantUserId,
        amount: parseInt(grantAmount, 10),
        reason: grantReason.trim() || 'Manual credit grant',
      };
      await apiFetch('/admin/credits/grant', { method: 'POST', body: JSON.stringify(body) });
      setDetail((prev) =>
        prev ? { ...prev, balance: prev.balance + parseInt(grantAmount, 10) } : null,
      );
      setUsers((prev) =>
        prev.map((u) =>
          u.id === grantUserId ? { ...u, balance: u.balance + parseInt(grantAmount, 10) } : u,
        ),
      );
      toast({ title: `Granted ${parseInt(grantAmount, 10).toLocaleString()} credits` });
      setGrantUserId(null);
      setGrantAmount('');
      setGrantReason('');
    } catch {
      toast({ kind: 'error', title: 'Failed to grant credits' });
    } finally {
      setGranting(false);
    }
  };

  if (detail) {
    const u = detail;
    return (
      <>
        <div className="page-head">
          <div>
            <button className="btn ghost" onClick={() => setDetail(null)}>
              <Icon.Back /> Back to users
            </button>
            <h1 style={{ marginTop: 8 }}>{u.displayName ?? u.email}</h1>
            <p className="lede">
              {u.email} &middot; {u.id}
            </p>
          </div>
          <div className="head-tools">
            {u.isAdmin && (
              <span className="badge dot" style={{ background: 'var(--pink)', color: '#fff' }}>
                {u.adminRole === 'SUPER_ADMIN'
                  ? 'Super Admin'
                  : u.adminRole === 'MODERATOR'
                    ? 'Moderator'
                    : u.adminRole === 'SUPPORT'
                      ? 'Support'
                      : 'Admin'}
              </span>
            )}
            <StatusBadge status={u.isBanned ? 'FAILED' : 'active'} />
            <button
              className="btn"
              onClick={() => {
                setGrantUserId(u.id);
                setGrantAmount('');
                setGrantReason('');
              }}
            >
              <Icon.Plus /> Grant Credits
            </button>
            {isSuperAdmin && !u.isAdmin && (
              <button
                className="btn"
                disabled={adminActioning || !u.hasPassword}
                title={
                  !u.hasPassword
                    ? 'User must set a password before being granted admin access'
                    : undefined
                }
                onClick={async () => {
                  setAdminActioning(true);
                  try {
                    await apiFetch('/admin/admin-users', {
                      method: 'POST',
                      body: JSON.stringify({ userId: u.id, role: 'ADMIN' }),
                    });
                    setDetail((prev) => prev && { ...prev, isAdmin: true });
                    setUsers((prev) =>
                      prev.map((x) => (x.id === u.id ? { ...x, isAdmin: true } : x)),
                    );
                    toast({ title: `${u.displayName ?? u.email} granted admin access` });
                  } catch {
                    toast({ kind: 'error', title: 'Failed to grant admin access' });
                  } finally {
                    setAdminActioning(false);
                  }
                }}
              >
                <Icon.Check /> Grant Admin
              </button>
            )}
            {isSuperAdmin && u.isAdmin && (
              <button
                className="btn danger"
                disabled={adminActioning}
                onClick={async () => {
                  setAdminActioning(true);
                  try {
                    await apiFetch(`/admin/admin-users/${u.id}`, { method: 'DELETE' });
                    setDetail((prev) => prev && { ...prev, isAdmin: false });
                    setUsers((prev) =>
                      prev.map((x) => (x.id === u.id ? { ...x, isAdmin: false } : x)),
                    );
                    toast({ title: `${u.displayName ?? u.email} admin access revoked` });
                  } catch {
                    toast({ kind: 'error', title: 'Failed to revoke admin access' });
                  } finally {
                    setAdminActioning(false);
                  }
                }}
              >
                <Icon.Ban /> Revoke Admin
              </button>
            )}
            {!u.isAdmin && (
              <button className="btn danger" onClick={() => setConfirmSuspend(u.id)}>
                <Icon.Ban /> {u.isBanned ? 'Unsuspend' : 'Suspend'}
              </button>
            )}
          </div>
        </div>

        {detailLoading ? (
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>Loading&hellip;</p>
        ) : (
          <>
            <div
              className="kv-grid"
              style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 20 }}
            >
              <KV k="Tier" v={u.tier} />
              <KV k="Balance" v={u.balance.toLocaleString()} />
              <KV k="Total jobs" v={(u.totalJobs ?? 0).toLocaleString()} />
              <KV k="Last job" v={u.lastJobAt ? new Date(u.lastJobAt).toLocaleString() : '—'} />
              <KV k="Joined" v={new Date(u.createdAt).toLocaleDateString()} />
              <KV k="Auth" v={u.hasPassword ? 'Email + Password' : 'Google (no password)'} />
              <KV
                k="Banned"
                v={u.isBanned ? `Yes${u.banReason ? ` — ${u.banReason}` : ''}` : 'No'}
              />
            </div>

            <div className="card">
              <div className="card-head">
                <h3>Recent jobs</h3>
              </div>
              <div className="card-body" style={{ padding: 0 }}>
                {u.recentJobs?.length ? (
                  u.recentJobs.slice(0, 10).map((j) => (
                    <div
                      key={j.id}
                      style={{
                        padding: '10px 18px',
                        borderBottom: '1px solid var(--border)',
                        display: 'flex',
                        gap: 10,
                        alignItems: 'center',
                      }}
                    >
                      <span className="mono" style={{ fontSize: 12 }}>
                        {j.id}
                      </span>
                      <StatusBadge status={j.status} />
                      <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 'auto' }}>
                        {new Date(j.createdAt).toLocaleString()}
                      </span>
                      {j.completedAt && j.startedAt && (
                        <span className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>
                          {(
                            (new Date(j.completedAt).getTime() - new Date(j.startedAt).getTime()) /
                            1000
                          ).toFixed(1)}
                          s
                        </span>
                      )}
                    </div>
                  ))
                ) : (
                  <div style={{ padding: 20, color: 'var(--muted)', fontSize: 13 }}>
                    No jobs yet.
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {confirmSuspend && (
          <div className="modal-overlay" onClick={() => setConfirmSuspend(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-head">
                <h3>{u.isBanned ? 'Unsuspend' : 'Suspend'} user</h3>
              </div>
              <div className="modal-body">
                <p>
                  Are you sure you want to {u.isBanned ? 'unsuspend' : 'suspend'}{' '}
                  <strong>{u.displayName ?? u.email}</strong>?
                </p>
              </div>
              <div className="modal-foot">
                <button className="btn ghost" onClick={() => setConfirmSuspend(null)}>
                  Cancel
                </button>
                <button className="btn danger" onClick={handleSuspendConfirm}>
                  Confirm
                </button>
              </div>
            </div>
          </div>
        )}

        {grantUserId && (
          <div className="modal-overlay" onClick={() => setGrantUserId(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-head">
                <h3>Grant credits to {u.displayName ?? u.email}</h3>
              </div>
              <div
                className="modal-body"
                style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
              >
                <div className="field">
                  <label>Amount</label>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    max={10000}
                    value={grantAmount}
                    onChange={(e) => setGrantAmount(e.target.value)}
                    placeholder="Enter credits (max 10,000)"
                  />
                </div>
                <div className="field">
                  <label>Reason</label>
                  <textarea
                    className="input"
                    value={grantReason}
                    onChange={(e) => setGrantReason(e.target.value)}
                    placeholder="e.g. Customer support, bulk top-up"
                    rows={3}
                    style={{ resize: 'vertical' }}
                  />
                </div>
              </div>
              <div className="modal-foot">
                <button className="btn ghost" onClick={() => setGrantUserId(null)}>
                  Cancel
                </button>
                <button
                  className="btn primary"
                  onClick={handleGrant}
                  disabled={granting || !grantAmount || parseInt(grantAmount, 10) < 1}
                >
                  {granting
                    ? 'Granting…'
                    : `Grant ${grantAmount ? parseInt(grantAmount, 10).toLocaleString() : ''} credits`}
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Users</h1>
          <p className="lede">
            {loading ? '…' : total} registered users &middot; Manage accounts, credits, and access.
          </p>
        </div>
        <div className="head-tools">
          <div className="search">
            <Icon.Search />
            <input
              placeholder="Search by name or email…"
              value={query}
              onChange={(e) => handleSearch(e.target.value)}
            />
          </div>
        </div>
      </div>

      {loading ? (
        <p style={{ color: 'var(--muted)', fontSize: 13, padding: '20px 0' }}>Loading&hellip;</p>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <Th
                    k="displayName"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={handleSort}
                    style={{ textAlign: 'left' }}
                  >
                    User
                  </Th>
                  <Th
                    k="tier"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={handleSort}
                    style={{ textAlign: 'center' }}
                  >
                    Tier
                  </Th>
                  <Th
                    k="balance"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={handleSort}
                    style={{ textAlign: 'center' }}
                  >
                    Balance
                  </Th>
                  <Th
                    k="totalJobs"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={handleSort}
                    style={{ textAlign: 'center' }}
                  >
                    Jobs
                  </Th>
                  <Th
                    k="lastJobAt"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={handleSort}
                    style={{ textAlign: 'center' }}
                  >
                    Last job
                  </Th>
                  <Th
                    k="isBanned"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={handleSort}
                    style={{ textAlign: 'center' }}
                  >
                    Status
                  </Th>
                  <th style={{ textAlign: 'center' }}></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((u) => (
                  <tr
                    key={u.id}
                    onClick={() => openDetail(u)}
                    style={{ cursor: 'pointer', textAlign: 'center' }}
                  >
                    <td style={{ textAlign: 'left' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <NameAvatar name={u.displayName ?? u.email} email={u.email} size={34} />
                        <div>
                          <span
                            className="semi"
                            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                          >
                            {u.displayName ?? (
                              <span style={{ color: 'var(--muted)' }}>{u.email}</span>
                            )}
                            {u.isAdmin && (
                              <span
                                className="badge dot"
                                style={{ background: 'var(--pink)', color: '#fff', fontSize: 10 }}
                              >
                                {u.adminRole === 'SUPER_ADMIN'
                                  ? 'Super Admin'
                                  : u.adminRole === 'MODERATOR'
                                    ? 'Moderator'
                                    : u.adminRole === 'SUPPORT'
                                      ? 'Support'
                                      : 'Admin'}
                              </span>
                            )}
                            {!u.hasPassword && (
                              <span
                                className="badge dot"
                                style={{
                                  background: 'var(--muted-2)',
                                  color: 'var(--muted)',
                                  fontSize: 10,
                                }}
                                title="Google account — no password set"
                              >
                                Google
                              </span>
                            )}
                          </span>
                          {u.displayName && (
                            <span className="sub" style={{ display: 'block' }}>
                              {u.email}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="badge dot">{u.tier}</span>
                    </td>
                    <td>
                      <span className="mono">{u.balance.toLocaleString()}</span>
                    </td>
                    <td>
                      <span className="mono">{(u.totalJobs ?? 0).toLocaleString()}</span>
                    </td>
                    <td>
                      <span className="mono">
                        {u.lastJobAt ? new Date(u.lastJobAt).toLocaleDateString() : '—'}
                      </span>
                    </td>
                    <td>
                      <StatusBadge status={u.isBanned ? 'FAILED' : 'active'} />
                    </td>
                    <td>
                      <button className="btn sm ghost" onClick={(e) => e.stopPropagation()}>
                        <Icon.MoreHorizontal />
                      </button>
                    </td>
                  </tr>
                ))}
                {sorted.length === 0 && (
                  <tr>
                    <td
                      colSpan={7}
                      style={{
                        padding: 20,
                        color: 'var(--muted)',
                        fontSize: 13,
                        textAlign: 'center',
                      }}
                    >
                      No users found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <Pager
            page={page}
            totalPages={totalPages}
            onPage={setPage}
            totalItems={total}
            pageSize={PAGE_SIZE}
          />
        </>
      )}
    </>
  );
}
