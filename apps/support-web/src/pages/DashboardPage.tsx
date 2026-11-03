import { useCallback, useEffect, useRef, useState } from 'react';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';
import { Icon } from '../components/Icons';
import { TicketAnalytics } from '../components/TicketAnalytics';
import { apiErrorMessage, apiFetch, getToken } from '../lib/data';
import { createAdminSSEConnection } from '../lib/sse';

// Mirrors admin-web's DashboardPage design (same /admin/stats endpoint, same
// stat-grid/card/banner markup) trimmed to what Support can act on: tiles
// that belong to Chat Inbox/Jobs/Users switch this app's own page. Workers has
// no Support equivalent, so those tiles are informational only (no link out
// — this app is standalone, not a companion to the admin panel).

interface Worker {
  id: string;
  status: string;
  healthy: boolean;
  lastSeen?: string;
}
interface RecentFailure {
  id: string;
  user: string;
  error: string;
  age: string;
}
interface StuckJob {
  id: string;
  user: string;
  age: string;
}

interface Stats {
  jobsToday: number;
  jobsTodayDelta: number | null;
  creditsToday: number;
  creditsTodayDelta: number | null;
  activeUsersToday: number;
  activeUsersDelta: number | null;
  newUsersToday: number;
  unclaimedChats: number;
  workersHealthy: number;
  workersTotal: number;
  workers: Worker[];
  queueDepth: number;
  failed24h: number;
  jobsPerDay: number[];
  jobsPerDayLabels: string[];
  periodTotal: number;
  recentFailures: RecentFailure[];
  stuckJobs: StuckJob[];
}

type SupportTab = 'chat-inbox' | 'jobs' | 'users';

interface Props {
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
  onNavigateTab: (tab: SupportTab, filter?: { status?: string }) => void;
}

const FALLBACK_INTERVAL = 60_000;
// The chart that used a selectable range is gone; the endpoint still wants a window.
const days = 7;

function Delta({ value, dir }: { value: number | null; dir?: 'down' }) {
  if (value === null || value === undefined) return null;
  const isGood = dir === 'down' ? value <= 0 : value >= 0;
  return (
    <div className={`delta ${isGood ? 'up' : 'down'}`}>
      <span style={{ fontFamily: 'var(--mono)' }}>
        {value > 0 ? '↑' : '↓'} {Math.abs(value)}%
      </span>
      <span style={{ color: 'var(--muted)' }}>vs yesterday</span>
    </div>
  );
}

export default function DashboardPage({ toast, onNavigateTab }: Props) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [secsAgo, setSecsAgo] = useState(0);
  const lastFetchRef = useRef<number>(0);

  const fetchStats = useCallback(async () => {
    try {
      const data = await apiFetch<Stats>(`/admin/stats?days=${days}`);
      setStats(data);
      lastFetchRef.current = Date.now();
      setSecsAgo(0);
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to load stats',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void fetchStats();
    const id = setInterval(fetchStats, FALLBACK_INTERVAL);
    return () => clearInterval(id);
  }, [fetchStats]);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    let debounceId: ReturnType<typeof setTimeout>;
    const conn = createAdminSSEConnection('/admin/jobs/stream', token, () => {
      clearTimeout(debounceId);
      debounceId = setTimeout(() => void fetchStats(), 800);
    });
    return () => {
      conn.close();
      clearTimeout(debounceId);
    };
  }, [fetchStats]);

  useEffect(() => {
    const id = setInterval(() => {
      if (lastFetchRef.current) {
        setSecsAgo(Math.floor((Date.now() - lastFetchRef.current) / 1000));
      }
    }, 1_000);
    return () => clearInterval(id);
  }, []);

  if (loading || !stats) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: 300,
          color: 'var(--muted)',
          gap: 10,
        }}
      >
        <Icon.Refresh />
        Loading…
      </div>
    );
  }

  const workersOk = stats.workersHealthy >= Math.max(1, stats.workersTotal * 0.5);
  const allOffline = stats.workersTotal > 0 && stats.workersHealthy === 0;
  const nextRefreshSecs = Math.max(0, FALLBACK_INTERVAL / 1000 - secsAgo);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p className="lede">Live — updates on job events</p>
        </div>
        <div className="head-tools">
          <span className="badge dot mono" style={{ color: 'var(--muted)' }}>
            {secsAgo === 0 ? 'Just updated' : `${secsAgo}s ago`} · next in {nextRefreshSecs}s
          </span>
          <button className="btn" onClick={fetchStats}>
            <Icon.Refresh /> Refresh
          </button>
        </div>
      </div>

      {allOffline && (
        <div className="banner">
          <div className="ic">
            <Icon.Warning />
          </div>
          <div>
            <b>All workers offline.</b> No jobs will be processed until at least one worker reports
            healthy.
          </div>
        </div>
      )}
      {!allOffline && !workersOk && stats.workersTotal > 0 && (
        <div className="banner warn">
          <div className="ic">
            <Icon.Warning />
          </div>
          <div>
            <b>Worker capacity degraded.</b> Only {stats.workersHealthy} of {stats.workersTotal}{' '}
            workers healthy — throughput may be reduced.
          </div>
        </div>
      )}
      {stats.stuckJobs.length > 0 && (
        <div className="banner warn">
          <div className="ic">
            <Icon.Clock />
          </div>
          <div>
            <b>
              {stats.stuckJobs.length} job{stats.stuckJobs.length > 1 ? 's' : ''} stuck
            </b>{' '}
            in queue for more than 10 minutes.
          </div>
          <button className="btn" onClick={() => onNavigateTab('jobs', { status: 'QUEUED' })}>
            <Icon.Jobs /> View queue
          </button>
        </div>
      )}
      {stats.unclaimedChats > 0 && (
        <div
          className="banner"
          style={{
            background: 'var(--accent-soft)',
            borderColor: 'var(--accent)',
            color: 'var(--accent-ink)',
          }}
        >
          <div className="ic" style={{ background: 'var(--accent)' }}>
            <Icon.MessageSquare />
          </div>
          <div>
            <b>
              {stats.unclaimedChats} unclaimed chat{stats.unclaimedChats > 1 ? 's' : ''}
            </b>{' '}
            waiting for a response.
          </div>
          <button className="btn" onClick={() => onNavigateTab('chat-inbox')}>
            <Icon.MessageSquare /> View queries
          </button>
        </div>
      )}

      <div>
        <div className="section-title">Today's activity</div>
        <div className="stat-grid" style={{ marginBottom: 0 }}>
          <button
            className="stat"
            style={{ borderTop: '3px solid #e5566b' }}
            onClick={() => onNavigateTab('jobs')}
          >
            <div className="lbl">
              <Icon.Activity /> Jobs processed
            </div>
            <div className="val">{stats.jobsToday.toLocaleString()}</div>
            <Delta value={stats.jobsTodayDelta} />
            {stats.jobsPerDay.length > 1 && (
              <div style={{ height: 36, marginTop: 8 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={stats.jobsPerDay.map((v, i) => ({ i, v }))}>
                    <Area
                      type="monotone"
                      dataKey="v"
                      stroke="#e5566b"
                      strokeWidth={1.5}
                      fill="#e5566b"
                      fillOpacity={0.15}
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </button>

          <button
            className="stat"
            style={{ borderTop: '3px solid #3b82f6' }}
            onClick={() => onNavigateTab('users')}
          >
            <div className="lbl">
              <Icon.Users /> Active users
            </div>
            <div className="val">{stats.activeUsersToday.toLocaleString()}</div>
            <Delta value={stats.activeUsersDelta} />
          </button>

          <button
            className="stat"
            style={{ borderTop: '3px solid #14a37f' }}
            onClick={() => onNavigateTab('users')}
          >
            <div className="lbl">
              <Icon.Plus /> New signups
            </div>
            <div className="val">{stats.newUsersToday.toLocaleString()}</div>
            <div className="delta">
              <span style={{ color: 'var(--muted)' }}>registered today</span>
            </div>
          </button>

          <button
            className="stat"
            style={{ borderTop: '3px solid #a56ae8' }}
            onClick={() => onNavigateTab('users')}
          >
            <div className="lbl">
              <Icon.Coin /> Credits consumed
            </div>
            <div className="val">{stats.creditsToday.toLocaleString()}</div>
            <Delta value={stats.creditsTodayDelta} />
          </button>
        </div>
      </div>

      <TicketAnalytics toast={toast} onOpenInbox={() => onNavigateTab('chat-inbox')} />
    </>
  );
}
