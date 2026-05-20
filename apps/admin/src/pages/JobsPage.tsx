import { useState } from 'react';
import type { ReactNode } from 'react';
import type { Job } from '../types';
import { MOCK_JOBS } from '../lib/data';
import { Icon } from '../components/Icons';
import { StatusBadge } from '../components/StatusBadge';
import { Pager } from '../components/Pager';
import { Th } from '../components/Th';
import type { SortDir } from '../components/Th';

const PAGE_SIZE = 25;

const FILTERS = [
  { k: 'all', l: 'All' },
  { k: 'COMPLETED', l: 'Completed' },
  { k: 'GENERATING', l: 'Generating' },
  { k: 'QUEUED', l: 'Queued' },
  { k: 'FAILED', l: 'Failed' },
  { k: 'CANCELLED', l: 'Cancelled' },
] as const;

type FilterKey = 'all' | 'COMPLETED' | 'GENERATING' | 'QUEUED' | 'FAILED' | 'CANCELLED';

interface Props {
  onNav: (_page: string, _filter?: { page: string; filter?: string }) => void;
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
}

export default function JobsPage({ onNav: _onNav, toast }: Props) {
  const [filter, setFilter] = useState<FilterKey>('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [sortKey, setSortKey] = useState<keyof Job>('createdAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [detail, setDetail] = useState<Job | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);

  const filtered = MOCK_JOBS.filter((j) => {
    if (filter !== 'all' && j.status !== filter) return false;
    if (!query) return true;
    const q = query.toLowerCase();
    return j.id.toLowerCase().includes(q) || j.userEmail.toLowerCase().includes(q);
  });

  const sorted = [...filtered].sort((a, b) => {
    const aVal = a[sortKey] ?? '';
    const bVal = b[sortKey] ?? '';
    let cmp: number;
    if (typeof aVal === 'boolean') {
      cmp = Number(bVal as boolean) - Number(aVal);
    } else if (typeof aVal === 'string') {
      cmp = aVal.localeCompare(bVal as string);
    } else {
      cmp = (aVal as number) - (bVal as number);
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const paged = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const handleSort = (k: keyof Job) => {
    if (k === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(k); setSortDir('desc'); }
  };

  const handleCancel = (id: string) => setConfirmCancel(id);

  const confirmCancelAction = () => {
    toast({ title: `Job ${confirmCancel} cancelled` });
    setConfirmCancel(null);
  };

  if (detail) {
    const j = detail;
    return (
      <>
        <div className="page-head">
          <div>
            <button className="btn ghost" onClick={() => setDetail(null)}><Icon.Chevron /> Back to jobs</button>
            <h1 style={{ marginTop: 8 }}>{j.id}</h1>
            <p className="lede">{j.userEmail} · Created {j.createdAt}</p>
          </div>
          <div className="head-tools">
            <StatusBadge status={j.status} />
            {(j.status === 'QUEUED' || j.status === 'GENERATING') && (
              <button className="btn danger" onClick={() => handleCancel(j.id)}><Icon.Ban /> Cancel job</button>
            )}
          </div>
        </div>

        <div className="kv-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 20 }}>
          <KV k="User" v={j.userEmail} />
          <KV k="Status" v={<StatusBadge status={j.status} />} />
          <KV k="Credits charged" v={String(j.creditsCharged)} />
          <KV k="Priority" v={j.priority ? 'PRO' : 'Normal'} />
          <KV k="Face" v={j.faceLabel ?? '—'} />
          <KV k="Background" v={j.backgroundLabel ?? '—'} />
          <KV k="Pose" v={j.poseLabel ?? '—'} />
          <KV k="Worker" v={j.workerId ?? '—'} />
          <KV k="Created" v={j.createdAt} />
          <KV k="Started" v={j.startedAt ?? '—'} />
          <KV k="Completed" v={j.completedAt ?? '—'} />
          <KV k="Error code" v={j.errorCode ?? '—'} />
        </div>

        {j.outputUrl && (
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="card-head"><h3>Output</h3></div>
            <div className="card-body">
              <a href={j.outputUrl} target="_blank" rel="noreferrer" className="link">
                View output <Icon.ExternalLink />
              </a>
            </div>
          </div>
        )}

        {j.userHint && (
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="card-head"><h3>User hint</h3></div>
            <div className="card-body"><p style={{ margin: 0, fontFamily: 'var(--mono)', fontSize: 13 }}>{j.userHint}</p></div>
          </div>
        )}

        {j.errorCode && (
          <div className="card" style={{ marginTop: 14 }}>
            <div className="card-head"><h3>Error</h3></div>
            <div className="card-body">
              <div className="banner error">
                <div className="ic"><Icon.Alert /></div>
                <div><b>Error code</b><p style={{ margin: 0, fontSize: 13, marginTop: 2, fontFamily: 'var(--mono)' }}>{j.errorCode}</p></div>
              </div>
            </div>
          </div>
        )}

        {confirmCancel && (
          <div className="modal-overlay" onClick={() => setConfirmCancel(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-head"><h3>Cancel job</h3></div>
              <div className="modal-body">
                <p>Cancel job <strong>{confirmCancel}</strong>? Credits will be refunded.</p>
              </div>
              <div className="modal-foot">
                <button className="btn ghost" onClick={() => setConfirmCancel(null)}>Cancel</button>
                <button className="btn danger" onClick={confirmCancelAction}><Icon.Ban /> Yes, cancel</button>
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
          <h1>Jobs</h1>
          <p className="lede">{MOCK_JOBS.length} total jobs · Monitor and manage try-on jobs.</p>
        </div>
        <div className="head-tools">
          <div className="search">
            <Icon.Search />
            <input
              placeholder="Search by ID or user email…"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setPage(0); }}
            />
          </div>
        </div>
      </div>

      <div className="tabs">
        {FILTERS.map((f) => (
          <button key={f.k} className={`tab ${filter === f.k ? 'active' : ''}`} onClick={() => { setFilter(f.k); setPage(0); }}>
            {f.l}
          </button>
        ))}
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <Th k="id" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Job ID</Th>
              <Th k="userEmail" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>User</Th>
              <Th k="faceLabel" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Face / Pose</Th>
              <th>Add-ons</th>
              <Th k="status" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Status</Th>
              <Th k="creditsCharged" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Credits</Th>
              <Th k="workerId" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Worker</Th>
              <Th k="createdAt" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Created</Th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {paged.map((j) => (
              <tr key={j.id} onClick={() => setDetail(j)} style={{ cursor: 'pointer' }}>
                <td><span className="mono sub">{j.id}</span></td>
                <td><span className="semi">{j.userEmail}</span></td>
                <td>
                  <span className="semi">{j.faceLabel ?? '—'}</span>
                  <span className="sub" style={{ display: 'block' }}>{j.poseLabel ?? '—'}</span>
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {j.hasLower && <span className="badge dot accent">Lower</span>}
                    {j.hasShoe && <span className="badge dot warn">Shoe</span>}
                    {!j.hasLower && !j.hasShoe && <span className="sub">—</span>}
                  </div>
                </td>
                <td><StatusBadge status={j.status} /></td>
                <td><span className="mono">{j.creditsCharged}</span></td>
                <td><span className="mono sub">{j.workerId ?? '—'}</span></td>
                <td><span className="mono sub">{j.createdAt}</span></td>
                <td>
                  {(j.status === 'QUEUED' || j.status === 'GENERATING') && (
                    <button className="btn sm ghost" onClick={(e) => { e.stopPropagation(); handleCancel(j.id); }}><Icon.Ban /></button>
                  )}
                </td>
              </tr>
            ))}
            {paged.length === 0 && (
              <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--muted)', padding: '2rem' }}>No jobs found.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Pager page={page} totalPages={totalPages} onPage={setPage} totalItems={sorted.length} pageSize={PAGE_SIZE} />
    </>
  );
}

function KV({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="kv">
      <span className="kv-k">{k}</span>
      <span className="kv-v">{v}</span>
    </div>
  );
}
