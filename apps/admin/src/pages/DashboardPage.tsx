import { MOCK_STATS } from '../lib/data';
import { Icon } from '../components/Icons';
import { StatusBadge } from '../components/StatusBadge';

interface Props {
  onNav: (page: string, filter?: { page: string; filter?: string }) => void;
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
}

export default function DashboardPage({ onNav }: Props) {
  const s = MOCK_STATS;
  const workersOk = s.workersHealthy >= s.workersTotal * 0.5;
  const allOffline = s.workersHealthy === 0;
  const maxBar = Math.max(...s.jobsPerDay);

  const stats = [
    { k: 'jobs', lbl: 'Jobs today', val: s.jobsToday.toLocaleString(), delta: s.jobsTodayDelta, icon: <Icon.Activity />, to: { page: 'jobs', filter: 'today' } },
    { k: 'credits', lbl: 'Credits consumed', val: s.creditsToday.toLocaleString(), delta: s.creditsTodayDelta, icon: <Icon.Coin />, to: { page: 'users' } },
    { k: 'users', lbl: 'Active users', val: s.activeUsersToday.toLocaleString(), delta: s.activeUsersDelta, icon: <Icon.Users />, to: { page: 'users', filter: 'active-today' } },
    { k: 'workers', lbl: 'Healthy workers', val: `${s.workersHealthy}/${s.workersTotal}`, alert: !workersOk, icon: <Icon.Server />, to: { page: 'jobs', filter: 'workers' } },
    { k: 'queue', lbl: 'Queue depth', val: s.queueDepth.toString(), sub: 'pending', icon: <Icon.Queue />, to: { page: 'jobs', filter: 'QUEUED' } },
    { k: 'failed', lbl: 'Failed \u00b7 24h', val: s.failed24h.toString(), delta: s.failed24hDelta, deltaDir: 'down' as const, icon: <Icon.Alert />, alert: s.failed24h > 20, to: { page: 'jobs', filter: 'FAILED' } },
  ];

  const workers = [
    { id: 'wrk-7af2-eu-1', status: 'BUSY' as string, lastSeen: '2s ago' },
    { id: 'wrk-7af2-eu-2', status: 'BUSY' as string, lastSeen: '1s ago' },
    { id: 'wrk-7af2-eu-3', status: 'IDLE' as string, lastSeen: '4s ago' },
    { id: 'wrk-7af2-us-1', status: 'BUSY' as string, lastSeen: '1s ago' },
    { id: 'wrk-7af2-us-2', status: 'IDLE' as string, lastSeen: '3s ago' },
  ];

  const failures = [
    { id: 'j_g7c2a4', user: 'felix@marchetti.tn', error: 'Model output dimension mismatch', age: '4m' },
    { id: 'j_k8e2d4', user: 'karim.m@cairo-cut.eg', error: 'R2 upload timeout', age: '12m' },
  ];

  const stuckJobs = [
    { id: 'j_e4a8c2', user: 'lior@studio-lb.co.il', age: '11m' },
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>System health</h1>
          <p className="lede">Live snapshot of jobs, workers, and credit flow across the platform.</p>
        </div>
        <div className="head-tools">
          <span className="badge dot mono success">Auto-refresh \u00b7 30s</span>
          <button className="btn"><Icon.Refresh /> Refresh</button>
          <button className="btn"><Icon.Download /> Export</button>
        </div>
      </div>

      {allOffline && (
        <div className="banner">
          <div className="ic"><Icon.Warning /></div>
          <div>
            <b>All workers offline.</b> No jobs will be processed until at least one worker reports healthy.
          </div>
          <button className="btn danger">View workers</button>
        </div>
      )}

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
        {stats.map((st) => (
          <button
            key={st.k}
            className={`stat ${st.alert ? 'alert' : ''}`}
            onClick={() => onNav(st.to.page, st.to)}
          >
            <div className="lbl">{st.icon}{st.lbl}</div>
            <div className="val">{st.val}</div>
            {'delta' in st && st.delta !== undefined && (
              <div className={`delta ${st.deltaDir === 'down' ? 'down' : st.delta >= 0 ? 'up' : 'down'}`}>
                <span style={{ fontFamily: 'var(--mono)' }}>
                  {st.delta > 0 ? '\u2191' : '\u2193'} {Math.abs(st.delta)}%
                </span>
                <span style={{ color: 'var(--muted)' }}>vs yesterday</span>
              </div>
            )}
            {'sub' in st && !('delta' in st) && (
              <div className="delta"><span style={{ color: 'var(--muted)' }}>{st.sub}</span></div>
            )}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.7fr 1fr', gap: 14 }}>
        <div className="card">
          <div className="card-head">
            <h3>Jobs per day</h3>
            <span className="sub">Last 7 days</span>
            <div className="tools">
              <button className="btn sm ghost">7d</button>
              <button className="btn sm">30d</button>
              <button className="btn sm ghost">90d</button>
            </div>
          </div>
          <div className="card-body">
            <div className="spark">
              {s.jobsPerDay.map((v, i) => (
                <div key={i} className={`bar ${i === s.jobsPerDay.length - 1 ? 'accent' : ''}`} style={{ height: `${(v / maxBar) * 100}%` }}>
                  <span className="val">{v.toLocaleString()}</span>
                </div>
              ))}
            </div>
            <div className="spark-labels">
              {s.jobsPerDayLabels.map((l, i) => <span key={i}>{l}</span>)}
            </div>
            <div style={{ display: 'flex', gap: 28, marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>7-day total</div>
                <div style={{ fontSize: 18, fontWeight: 500, fontFamily: 'var(--sans)', fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>8,060 jobs</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Daily avg</div>
                <div style={{ fontSize: 18, fontWeight: 500, fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>1,151</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Success rate</div>
                <div style={{ fontSize: 18, fontWeight: 500, fontVariantNumeric: 'tabular-nums', marginTop: 2, color: 'var(--success-ink)' }}>97.4%</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Avg duration</div>
                <div style={{ fontSize: 18, fontWeight: 500, fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>38.4s</div>
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h3>Worker pool</h3>
            <span className="sub">{s.workersHealthy} of {s.workersTotal} healthy</span>
            <div className="tools">
              <button className="btn sm ghost" onClick={() => onNav('jobs', { page: 'jobs', filter: 'workers' })}>View all <Icon.Chevron /></button>
            </div>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            {workers.map((w) => (
              <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 18px', borderBottom: '1px solid var(--border)' }}>
                <span style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: w.status === 'OFFLINE' ? 'var(--danger)' :
                    w.status === 'DRAINING' ? 'var(--warn)' :
                    w.status === 'BUSY' ? 'var(--accent)' : 'var(--success)',
                  flexShrink: 0,
                }} />
                <span style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{w.id}</span>
                <span style={{ marginLeft: 'auto' }}><StatusBadge status={w.status} /></span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', minWidth: 50, textAlign: 'right' }}>{w.lastSeen}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div className="card">
          <div className="card-head">
            <h3>Recent failures</h3>
            <span className="sub">Last 24 hours</span>
            <div className="tools">
              <button className="btn sm ghost" onClick={() => onNav('jobs', { page: 'jobs', filter: 'FAILED' })}>All failures <Icon.Chevron /></button>
            </div>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            {failures.map((j) => (
              <div key={j.id} style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 10, alignItems: 'center' }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{j.id}</span>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{j.user}</span>
                  <span style={{ fontSize: 12, color: 'var(--danger)' }}>{j.error}</span>
                </div>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)' }}>{j.age}</span>
                <button className="btn sm"><Icon.Refresh /> Retry</button>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h3>Stuck queue</h3>
            <span className="sub">Pending &gt; 10min</span>
            <div className="tools">
              <button className="btn sm ghost" onClick={() => onNav('jobs', { page: 'jobs', filter: 'QUEUED' })}>View queue <Icon.Chevron /></button>
            </div>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            {stuckJobs.map((j) => (
              <div key={j.id} style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 10, alignItems: 'center' }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{j.id}</span>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{j.user}</span>
                  <span style={{ fontSize: 12, color: 'var(--warn)' }}>Queued for {j.age} — exceeds threshold</span>
                </div>
                <span className="badge warn dot">Stuck</span>
              </div>
            ))}
            <div style={{ padding: '20px 18px', display: 'flex', alignItems: 'center', gap: 10, color: 'var(--muted)', fontSize: 12.5 }}>
              <Icon.Check />
              No other queue anomalies in the last hour.
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
