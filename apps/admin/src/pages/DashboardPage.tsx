import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../lib/data';
import { Icon } from '../components/Icons';
import { StatusBadge } from '../components/StatusBadge';

interface Worker { id: string; status: string; healthy: boolean; lastSeen?: string }
interface RecentFailure { id: string; user: string; error: string; age: string }
interface StuckJob { id: string; user: string; age: string }

interface Stats {
  jobsToday: number;
  jobsTodayDelta: number | null;
  creditsToday: number;
  creditsTodayDelta: number | null;
  activeUsersToday: number;
  activeUsersDelta: number | null;
  workersHealthy: number;
  workersTotal: number;
  workers: Worker[];
  queueDepth: number;
  failed24h: number;
  jobsPerDay: number[];
  jobsPerDayLabels: string[];
  sevenDayTotal: number;
  recentFailures: RecentFailure[];
  stuckJobs: StuckJob[];
}

interface Props {
  onNav: (page: string, filter?: { page: string; filter?: string }) => void;
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
}

export default function DashboardPage({ onNav, toast }: Props) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const data = await apiFetch<Stats>('/admin/stats');
      setStats(data);
      setLastRefresh(new Date());
    } catch {
      toast({ kind: 'error', title: 'Failed to load stats' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchStats();
    const id = setInterval(fetchStats, 30_000);
    return () => clearInterval(id);
  }, [fetchStats]);

  if (loading || !stats) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, color: 'var(--muted)', gap: 10 }}>
        <Icon.Refresh />
        Loading…
      </div>
    );
  }

  const workersOk = stats.workersHealthy >= Math.max(1, stats.workersTotal * 0.5);
  const allOffline = stats.workersTotal > 0 && stats.workersHealthy === 0;
  const maxBar = Math.max(...stats.jobsPerDay, 1);
  const dailyAvg = stats.sevenDayTotal > 0 ? Math.round(stats.sevenDayTotal / 7) : 0;

  const statCards = [
    { k: 'jobs', lbl: 'Jobs today', val: stats.jobsToday.toLocaleString(), delta: stats.jobsTodayDelta, icon: <Icon.Activity />, to: { page: 'jobs', filter: 'today' } },
    { k: 'credits', lbl: 'Credits consumed', val: stats.creditsToday.toLocaleString(), delta: stats.creditsTodayDelta, icon: <Icon.Coin />, to: { page: 'users' } },
    { k: 'users', lbl: 'Active users', val: stats.activeUsersToday.toLocaleString(), delta: stats.activeUsersDelta, icon: <Icon.Users />, to: { page: 'users' } },
    { k: 'workers', lbl: 'Healthy workers', val: stats.workersTotal > 0 ? `${stats.workersHealthy}/${stats.workersTotal}` : '—', alert: !workersOk && stats.workersTotal > 0, icon: <Icon.Server />, to: { page: 'jobs', filter: 'workers' } },
    { k: 'queue', lbl: 'Queue depth', val: stats.queueDepth.toString(), sub: 'pending', icon: <Icon.Queue />, to: { page: 'jobs', filter: 'QUEUED' } },
    { k: 'failed', lbl: 'Failed · 24h', val: stats.failed24h.toString(), deltaDir: 'down' as const, icon: <Icon.Alert />, alert: stats.failed24h > 20, to: { page: 'jobs', filter: 'FAILED' } },
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>System health</h1>
          <p className="lede">Live snapshot of jobs, workers, and credit flow across the platform.</p>
        </div>
        <div className="head-tools">
          {lastRefresh && (
            <span className="badge dot mono success">
              Refreshed {lastRefresh.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
          <button className="btn" onClick={fetchStats}><Icon.Refresh /> Refresh</button>
        </div>
      </div>

      {allOffline && (
        <div className="banner">
          <div className="ic"><Icon.Warning /></div>
          <div>
            <b>All workers offline.</b> No jobs will be processed until at least one worker reports healthy.
          </div>
        </div>
      )}

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
        {statCards.map((st) => (
          <button
            key={st.k}
            className={`stat ${st.alert ? 'alert' : ''}`}
            onClick={() => onNav(st.to.page, st.to)}
          >
            <div className="lbl">{st.icon}{st.lbl}</div>
            <div className="val">{st.val}</div>
            {'delta' in st && st.delta !== null && st.delta !== undefined && (
              <div className={`delta ${st.deltaDir === 'down' ? (st.delta <= 0 ? 'up' : 'down') : (st.delta >= 0 ? 'up' : 'down')}`}>
                <span style={{ fontFamily: 'var(--mono)' }}>
                  {st.delta > 0 ? '↑' : '↓'} {Math.abs(st.delta)}%
                </span>
                <span style={{ color: 'var(--muted)' }}>vs yesterday</span>
              </div>
            )}
            {'sub' in st && !('delta' in st) && (
              <div className="delta"><span style={{ color: 'var(--muted)' }}>{(st as any).sub}</span></div>
            )}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.7fr 1fr', gap: 14 }}>
        <div className="card">
          <div className="card-head">
            <h3>Jobs per day</h3>
            <span className="sub">Last 7 days</span>
          </div>
          <div className="card-body">
            <div className="spark">
              {stats.jobsPerDay.map((v, i) => (
                <div key={i} className={`bar ${i === stats.jobsPerDay.length - 1 ? 'accent' : ''}`} style={{ height: `${(v / maxBar) * 100}%` }}>
                  <span className="val">{v.toLocaleString()}</span>
                </div>
              ))}
            </div>
            <div className="spark-labels">
              {stats.jobsPerDayLabels.map((l, i) => <span key={i}>{l}</span>)}
            </div>
            <div style={{ display: 'flex', gap: 28, marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>7-day total</div>
                <div style={{ fontSize: 18, fontWeight: 500, fontFamily: 'var(--sans)', fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>{stats.sevenDayTotal.toLocaleString()} jobs</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Daily avg</div>
                <div style={{ fontSize: 18, fontWeight: 500, fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>{dailyAvg.toLocaleString()}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h3>Worker pool</h3>
            <span className="sub">{stats.workersHealthy} of {stats.workersTotal} healthy</span>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            {stats.workers.length === 0 ? (
              <div style={{ padding: '24px 18px', color: 'var(--muted)', fontSize: 13 }}>No workers registered.</div>
            ) : (
              stats.workers.map((w) => (
                <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 18px', borderBottom: '1px solid var(--border)' }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                    background: !w.healthy ? 'var(--danger)' :
                      w.status === 'DRAINING' ? 'var(--warn)' :
                      w.status === 'BUSY' ? 'var(--accent)' : 'var(--success)',
                  }} />
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{w.id}</span>
                  <span style={{ marginLeft: 'auto' }}><StatusBadge status={w.healthy ? w.status : 'OFFLINE'} /></span>
                  {w.lastSeen && (
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', minWidth: 50, textAlign: 'right' }}>{w.lastSeen}</span>
                  )}
                </div>
              ))
            )}
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
            {stats.recentFailures.length === 0 ? (
              <div style={{ padding: '20px 18px', display: 'flex', alignItems: 'center', gap: 10, color: 'var(--muted)', fontSize: 12.5 }}>
                <Icon.Check /> No failures in the last 24 hours.
              </div>
            ) : (
              stats.recentFailures.map((j) => (
                <div key={j.id} style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 12, flexShrink: 0 }}>{j.id}</span>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <span style={{ fontSize: 12, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{j.user}</span>
                    <span style={{ fontSize: 12, color: 'var(--danger)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{j.error}</span>
                  </div>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>{j.age}</span>
                </div>
              ))
            )}
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
            {stats.stuckJobs.map((j) => (
              <div key={j.id} style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 10, alignItems: 'center' }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 12, flexShrink: 0 }}>{j.id}</span>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <span style={{ fontSize: 12, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{j.user}</span>
                  <span style={{ fontSize: 12, color: 'var(--warn)' }}>Queued for {j.age} — exceeds threshold</span>
                </div>
                <span className="badge warn dot">Stuck</span>
              </div>
            ))}
            <div style={{ padding: '20px 18px', display: 'flex', alignItems: 'center', gap: 10, color: 'var(--muted)', fontSize: 12.5 }}>
              <Icon.Check />
              {stats.stuckJobs.length === 0 ? 'No stuck jobs.' : 'No other queue anomalies.'}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
