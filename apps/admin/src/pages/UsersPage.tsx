import { useState } from 'react';
import type { User } from '../types';
import { MOCK_USERS } from '../lib/data';
import { Icon } from '../components/Icons';
import { StatusBadge } from '../components/StatusBadge';
import { NameAvatar } from '../components/NameAvatar';
import { KV } from '../components/KV';
import { Pager } from '../components/Pager';
import { Th } from '../components/Th';
import type { SortDir } from '../components/Th';

const PAGE_SIZE = 20;

interface Props {
  onNav: (_page: string, _filter?: { page: string; filter?: string }) => void;
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
}

export default function UsersPage({ onNav: _onNav, toast }: Props) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [sortKey, setSortKey] = useState<keyof User>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [detail, setDetail] = useState<User | null>(null);
  const [confirmSuspend, setConfirmSuspend] = useState<string | null>(null);

  const filtered = MOCK_USERS.filter((u) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.id.toLowerCase().includes(q);
  });

  const sorted = [...filtered].sort((a, b) => {
    const aVal = a[sortKey] ?? '';
    const bVal = b[sortKey] ?? '';
    const cmp = typeof aVal === 'string' ? aVal.localeCompare(bVal as string) : (aVal as number) - (bVal as number);
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const paged = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const handleSort = (k: keyof User) => {
    if (k === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(k); setSortDir('asc'); }
  };

  if (detail) {
    const u = detail;
    return (
      <>
        <div className="page-head">
          <div>
            <button className="btn ghost" onClick={() => setDetail(null)}><Icon.Chevron /> Back to users</button>
            <h1 style={{ marginTop: 8 }}>{u.name}</h1>
            <p className="lede">{u.email} &middot; {u.id}</p>
          </div>
          <div className="head-tools">
            <StatusBadge status={u.status === 'active' ? 'active' : 'inactive'} />
            <button className="btn"><Icon.MessageSquare /> Contact</button>
            <button className="btn danger" onClick={() => setConfirmSuspend(u.id)}><Icon.Ban /> {u.status === 'suspended' ? 'Unsuspend' : 'Suspend'}</button>
          </div>
        </div>

        <div className="kv-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 20 }}>
          <KV k="Role" v={u.role} />
          <KV k="Plan" v={u.plan} />
          <KV k="Credits" v={u.creditsRemaining.toLocaleString()} />
          <KV k="Credit limit" v={u.creditLimit.toLocaleString()} />
          <KV k="Jobs total" v={u.totalJobs.toLocaleString()} />
          <KV k="Joined" v={u.joinedAt} />
          <KV k="Last active" v={u.lastActive} />
          <KV k="Email verified" v={u.emailVerified ? 'Yes' : 'No'} />
        </div>

        <div className="card">
          <div className="card-head"><h3>Recent activity</h3></div>
          <div className="card-body" style={{ padding: 0 }}>
            {u.recentJobs?.length ? u.recentJobs.slice(0, 5).map((j) => (
              <div key={j.id} style={{ padding: '10px 18px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 10, alignItems: 'center' }}>
                <span className="mono" style={{ fontSize: 12 }}>{j.id}</span>
                <StatusBadge status={j.status} />
                <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 'auto' }}>{j.createdAt}</span>
                <span className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>{j.duration}</span>
              </div>
            )) : <div style={{ padding: 20, color: 'var(--muted)', fontSize: 13 }}>No recent activity.</div>}
          </div>
        </div>

        {confirmSuspend && (
          <div className="modal-overlay" onClick={() => setConfirmSuspend(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-head"><h3>{u.status === 'suspended' ? 'Unsuspend' : 'Suspend'} user</h3></div>
              <div className="modal-body">
                <p>Are you sure you want to {u.status === 'suspended' ? 'unsuspend' : 'suspend'} <strong>{u.name}</strong>?</p>
              </div>
              <div className="modal-foot">
                <button className="btn ghost" onClick={() => setConfirmSuspend(null)}>Cancel</button>
                <button className="btn danger" onClick={() => { setConfirmSuspend(null); toast({ title: `User ${u.status === 'suspended' ? 'unsuspended' : 'suspended'}` }); }}>Confirm</button>
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
          <p className="lede">{MOCK_USERS.length} registered users &middot; Manage accounts, credits, and access.</p>
        </div>
        <div className="head-tools">
          <div className="search">
            <Icon.Search />
            <input placeholder="Search by name, email, or ID\u2026" value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} />
          </div>
          <button className="btn"><Icon.Add /> Add user</button>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <Th k="name" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>User</Th>
              <Th k="role" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Role</Th>
              <Th k="plan" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Plan</Th>
              <Th k="creditsRemaining" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Credits</Th>
              <Th k="totalJobs" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Jobs</Th>
              <Th k="lastActive" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Last active</Th>
              <Th k="status" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Status</Th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {paged.map((u) => (
              <tr key={u.id} onClick={() => setDetail(u)} style={{ cursor: 'pointer' }}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <NameAvatar name={u.name} email={u.email} size={34} />
                    <div>
                      <span className="semi">{u.name}</span>
                      <span className="sub" style={{ display: 'block' }}>{u.email}</span>
                    </div>
                  </div>
                </td>
                <td><span className="badge dot">{u.role}</span></td>
                <td>{u.plan}</td>
                <td><span className="mono">{u.creditsRemaining.toLocaleString()}</span></td>
                <td><span className="mono">{u.totalJobs.toLocaleString()}</span></td>
                <td><span className="mono">{u.lastActive || '--'}</span></td>
                <td><StatusBadge status={u.status === 'active' ? 'active' : u.status === 'suspended' ? 'FAILED' : 'draft'} /></td>
                <td>
                  <button className="btn sm ghost" onClick={(e) => e.stopPropagation()}><Icon.MoreHorizontal /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pager page={page} totalPages={totalPages} onPage={setPage} totalItems={sorted.length} pageSize={PAGE_SIZE} />
    </>
  );
}
