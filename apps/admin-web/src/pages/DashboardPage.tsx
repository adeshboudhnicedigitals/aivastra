import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Donut } from '../components/Donut';
import { Icon } from '../components/Icons';
import { StatusBadge } from '../components/StatusBadge';
import { TicketAnalytics } from '../components/TicketAnalytics';
import { apiErrorMessage, apiFetch, getToken } from '../lib/data';
import { createAdminSSEConnection } from '../lib/sse';

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
interface ErrorCount {
  code: string;
  count: number;
}
interface StuckBucket {
  label: string;
  count: number;
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
  jobsLast24h: number;
  jobsPerDay: number[];
  jobsPerDayLabels: string[];
  periodTotal: number;
  recentFailures: RecentFailure[];
  failuresByCode: ErrorCount[];
  stuckJobs: StuckJob[];
  stuckBuckets: StuckBucket[];
}

interface Props {
  onNav: (page: string, filter?: { page: string; filter?: string; date?: string }) => void;
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
}

const FALLBACK_INTERVAL = 60_000;

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

// Compact stacked progress bar for a System health tile — a quick-glance ratio
// (healthy/offline, moving/stuck, succeeded/failed) that doesn't need a full
// chart's worth of space. Renders nothing once every segment is zero.
function MiniRatioBar({ segments }: { segments: { value: number; color: string }[] }) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  if (total <= 0) return null;
  return (
    <div
      style={{
        display: 'flex',
        height: 6,
        borderRadius: 999,
        overflow: 'hidden',
        marginTop: 10,
        background: 'var(--border)',
      }}
    >
      {segments.map(
        (s) =>
          s.value > 0 && (
            <div
              key={s.color}
              style={{ flex: s.value, background: s.color }}
              title={`${s.value}`}
            />
          ),
      )}
    </div>
  );
}

export default function DashboardPage({ onNav, toast }: Props) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [secsAgo, setSecsAgo] = useState(0);
  const [days, setDays] = useState<7 | 14 | 30>(7);
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
  }, [toast, days]);

  // Main fetch + 60s fallback poll
  useEffect(() => {
    void fetchStats();
    const id = setInterval(fetchStats, FALLBACK_INTERVAL);
    return () => clearInterval(id);
  }, [fetchStats]);

  // SSE event-driven fetch
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

  // Seconds-ago counter, updates every second
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
  const dailyAvg = stats.periodTotal > 0 ? Math.round(stats.periodTotal / days) : 0;
  const nextRefreshSecs = Math.max(0, FALLBACK_INTERVAL / 1000 - secsAgo);
  const totalStuck = stats.stuckBuckets.reduce((a, b) => a + b.count, 0);
  const jobsSucceeded24h = Math.max(stats.jobsLast24h - stats.failed24h, 0);

  // Same status→color mapping as the worker rows below, just rolled up into
  // a donut's four slices instead of one dot per worker.
  const workerBreakdown = [
    {
      name: 'Idle',
      value: stats.workers.filter(
        (w) => w.healthy && w.status !== 'BUSY' && w.status !== 'DRAINING',
      ).length,
      color: 'var(--success)',
    },
    {
      name: 'Busy',
      value: stats.workers.filter((w) => w.healthy && w.status === 'BUSY').length,
      color: 'var(--accent)',
    },
    {
      name: 'Draining',
      value: stats.workers.filter((w) => w.healthy && w.status === 'DRAINING').length,
      color: 'var(--warn)',
    },
    {
      name: 'Offline',
      value: stats.workers.filter((w) => !w.healthy).length,
      color: 'var(--danger)',
    },
  ];

  return (
    <>
      {/* ── Header ─────────────────────────────────────────────── */}
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

      {/* ── Alert banners ──────────────────────────────────────── */}
      {allOffline && (
        <div className="banner">
          <div className="ic">
            <Icon.Warning />
          </div>
          <div>
            <b>All workers offline.</b> No jobs will be processed until at least one worker reports
            healthy.
          </div>
          <button className="btn" onClick={() => onNav('workers')}>
            <Icon.Server /> View workers
          </button>
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
          <button className="btn" onClick={() => onNav('workers')}>
            <Icon.Server /> View workers
          </button>
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
          <button className="btn" onClick={() => onNav('jobs', { page: 'jobs', filter: 'QUEUED' })}>
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
          <button className="btn" onClick={() => onNav('chat-inbox')}>
            <Icon.MessageSquare /> View queries
          </button>
        </div>
      )}

      {/* ── Activity metrics ───────────────────────────────────── */}
      <div>
        <div className="section-title">Today's activity</div>
        <div className="stat-grid" style={{ marginBottom: 0 }}>
          <button
            className="stat"
            style={{ borderTop: '3px solid #e5566b' }}
            onClick={() => onNav('jobs', { page: 'jobs', filter: 'today' })}
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
            onClick={() => onNav('users')}
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
            onClick={() => onNav('users')}
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
            onClick={() => onNav('users')}
          >
            <div className="lbl">
              <Icon.Coin /> Credits consumed
            </div>
            <div className="val">{stats.creditsToday.toLocaleString()}</div>
            <Delta value={stats.creditsTodayDelta} />
          </button>
        </div>
      </div>

      {/* ── System health metrics ──────────────────────────────── */}
      <div>
        <div className="section-title">System health</div>
        <div className="stat-grid">
          <button
            className={`stat ${!workersOk && stats.workersTotal > 0 ? 'alert' : ''}`}
            style={{
              borderTop: `3px solid ${workersOk || stats.workersTotal === 0 ? 'var(--success)' : 'var(--danger)'}`,
            }}
            onClick={() => onNav('workers')}
          >
            <div className="lbl">
              <Icon.Server /> Workers healthy
            </div>
            <div className="val">
              {stats.workersTotal > 0 ? `${stats.workersHealthy}/${stats.workersTotal}` : '—'}
            </div>
            <div className="delta">
              <span style={{ color: 'var(--muted)' }}>
                {stats.workersTotal === 0
                  ? 'none registered'
                  : stats.workersHealthy === stats.workersTotal
                    ? 'all systems go'
                    : `${stats.workersTotal - stats.workersHealthy} offline`}
              </span>
            </div>
            <MiniRatioBar
              segments={[
                { value: stats.workersHealthy, color: 'var(--success)' },
                { value: stats.workersTotal - stats.workersHealthy, color: 'var(--danger)' },
              ]}
            />
          </button>

          <button
            className="stat"
            style={{ borderTop: '3px solid var(--warn)' }}
            onClick={() => onNav('jobs', { page: 'jobs', filter: 'QUEUED' })}
          >
            <div className="lbl">
              <Icon.Queue /> Queue depth
            </div>
            <div className="val">{stats.queueDepth}</div>
            <div className="delta">
              <span style={{ color: 'var(--muted)' }}>
                {totalStuck > 0 ? `${totalStuck} stuck >10m` : 'pending jobs'}
              </span>
            </div>
            <MiniRatioBar
              segments={[
                { value: Math.max(stats.queueDepth - totalStuck, 0), color: 'var(--accent)' },
                { value: totalStuck, color: 'var(--warn)' },
              ]}
            />
          </button>

          <button
            className={`stat ${stats.failed24h > 20 ? 'alert' : ''}`}
            style={{
              borderTop: `3px solid ${stats.failed24h > 0 ? 'var(--danger)' : 'var(--success)'}`,
            }}
            onClick={() => onNav('jobs', { page: 'jobs', filter: 'FAILED' })}
          >
            <div className="lbl">
              <Icon.Alert /> Failed · 24h
            </div>
            <div className="val">{stats.failed24h}</div>
            <div className="delta">
              <span style={{ color: 'var(--muted)' }}>
                {stats.failed24h === 0 ? 'all clear' : 'job failures'}
              </span>
            </div>
            <MiniRatioBar
              segments={[
                { value: jobsSucceeded24h, color: 'var(--success)' },
                { value: stats.failed24h, color: 'var(--danger)' },
              ]}
            />
          </button>

          <button
            className={`stat ${stats.unclaimedChats > 0 ? 'alert' : ''}`}
            style={
              stats.unclaimedChats > 0
                ? {
                    borderColor: 'var(--accent)',
                    borderTop: '3px solid var(--accent)',
                    background: 'var(--accent-soft)',
                  }
                : { borderTop: '3px solid var(--accent)' }
            }
            onClick={() => onNav('chat-inbox')}
          >
            <div
              className="lbl"
              style={stats.unclaimedChats > 0 ? { color: 'var(--accent-ink)' } : undefined}
            >
              <Icon.MessageSquare /> Queries
            </div>
            <div
              className="val"
              style={stats.unclaimedChats > 0 ? { color: 'var(--accent-ink)' } : undefined}
            >
              {stats.unclaimedChats}
            </div>
            <div className="delta">
              <span style={{ color: 'var(--muted)' }}>
                {stats.unclaimedChats === 0 ? 'inbox clear' : 'unclaimed chats'}
              </span>
            </div>
          </button>
        </div>
      </div>

      {/* ── Job success rate ───────────────────────────────────── */}
      <div className="card">
        <div className="card-head">
          <h3>Job success rate</h3>
          <span className="sub">Last 24 hours</span>
        </div>
        <div className="card-body">
          <Donut
            data={[
              {
                name: 'Succeeded',
                value: Math.max(stats.jobsLast24h - stats.failed24h, 0),
                color: 'var(--success)',
              },
              { name: 'Failed', value: stats.failed24h, color: 'var(--danger)' },
            ]}
            centerLabel="last 24h"
            centerValue={stats.jobsLast24h}
          />
        </div>
      </div>

      {/* ── Charts + Worker pool ───────────────────────────────── */}
      <div className="dash-grid-2col">
        {/* Jobs sparkline */}
        <div className="card">
          <div className="card-head">
            <h3>Jobs per day</h3>
            <div style={{ display: 'flex', gap: 4, marginLeft: 12 }}>
              {[7, 14, 30].map((d) => (
                <button
                  key={d}
                  className={`btn sm ghost`}
                  onClick={() => setDays(d as 7 | 14 | 30)}
                  style={{
                    padding: '2px 8px',
                    fontSize: 11,
                    background: days === d ? 'var(--bg-2)' : 'transparent',
                    color: days === d ? 'var(--text)' : 'var(--muted)',
                  }}
                >
                  {d}d
                </button>
              ))}
            </div>
            <div className="tools">
              <span
                style={{
                  fontFamily: 'var(--mono)',
                  fontSize: 12,
                  color: 'var(--muted)',
                }}
              >
                avg {dailyAvg}/day
              </span>
            </div>
          </div>
          <div className="card-body">
            <div className="spark" style={{ minHeight: 200 }}>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart
                  data={stats.jobsPerDay.map((jobs, i) => {
                    const nowUtc = new Date();
                    const daysAgo = stats.jobsPerDay.length - 1 - i;
                    const dateKey = new Date(
                      Date.UTC(
                        nowUtc.getUTCFullYear(),
                        nowUtc.getUTCMonth(),
                        nowUtc.getUTCDate() - daysAgo,
                      ),
                    )
                      .toISOString()
                      .slice(0, 10);
                    return {
                      date: stats.jobsPerDayLabels[i],
                      dateKey,
                      jobs,
                    };
                  })}
                >
                  <XAxis
                    dataKey="date"
                    stroke="var(--muted)"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: 'rgba(128,128,128,0.08)' }}
                    contentStyle={{
                      background: 'var(--surface-2)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Bar
                    dataKey="jobs"
                    fill="var(--accent)"
                    radius={[4, 4, 0, 0]}
                    onClick={(data: { payload?: { dateKey?: string } }) => {
                      const dateKey = data.payload?.dateKey;
                      if (dateKey) {
                        onNav('jobs', { page: 'jobs', date: dateKey });
                      }
                    }}
                    style={{ cursor: 'pointer' }}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div
              style={{
                display: 'flex',
                gap: 28,
                marginTop: 18,
                paddingTop: 14,
                borderTop: '1px solid var(--border)',
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--muted)',
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                  }}
                >
                  {days}-day total
                </div>
                <div
                  style={{
                    fontSize: 18,
                    fontWeight: 500,
                    fontVariantNumeric: 'tabular-nums',
                    marginTop: 2,
                  }}
                >
                  {stats.periodTotal.toLocaleString()} jobs
                </div>
              </div>
              <div>
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--muted)',
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                  }}
                >
                  Daily avg
                </div>
                <div
                  style={{
                    fontSize: 18,
                    fontWeight: 500,
                    fontVariantNumeric: 'tabular-nums',
                    marginTop: 2,
                  }}
                >
                  {dailyAvg.toLocaleString()}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Worker pool */}
        <div className="card">
          <div className="card-head">
            <h3>Worker pool</h3>
            <span className="sub">
              {stats.workersHealthy} of {stats.workersTotal} healthy
            </span>
            <div className="tools">
              <button className="btn sm ghost" onClick={() => onNav('workers')}>
                Manage <Icon.Chevron />
              </button>
            </div>
          </div>
          {stats.workersTotal > 0 && (
            <div style={{ padding: '16px 18px 4px', borderBottom: '1px solid var(--border)' }}>
              <Donut data={workerBreakdown} centerLabel="workers" size={128} />
            </div>
          )}
          <div className="card-body" style={{ padding: 0 }}>
            {stats.workers.length === 0 ? (
              <div style={{ padding: '24px 18px', color: 'var(--muted)', fontSize: 13 }}>
                No workers registered.
              </div>
            ) : (
              stats.workers.map((w) => (
                <div
                  key={w.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 18px',
                    borderBottom: '1px solid var(--border)',
                  }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      flexShrink: 0,
                      background: !w.healthy
                        ? 'var(--danger)'
                        : w.status === 'DRAINING'
                          ? 'var(--warn)'
                          : w.status === 'BUSY'
                            ? 'var(--accent)'
                            : 'var(--success)',
                    }}
                  />
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 12, flex: 1 }}>{w.id}</span>
                  <StatusBadge status={w.healthy ? w.status : 'OFFLINE'} />
                  {w.lastSeen && (
                    <span
                      style={{
                        fontFamily: 'var(--mono)',
                        fontSize: 11,
                        color: 'var(--muted)',
                        minWidth: 40,
                        textAlign: 'right',
                      }}
                    >
                      {w.lastSeen}
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* ── Failures + Stuck queue ─────────────────────────────── */}
      <div className="dash-grid-2col-even">
        {/* Recent failures */}
        <div className="card" style={{ minWidth: 0, overflow: 'hidden' }}>
          <div className="card-head">
            <h3>Recent failures</h3>
            <span className="sub">Last 24 hours</span>
            <div className="tools">
              <button
                className="btn sm ghost"
                onClick={() => onNav('jobs', { page: 'jobs', filter: 'FAILED' })}
              >
                All <Icon.Chevron />
              </button>
            </div>
          </div>
          {stats.failuresByCode.length > 0 && (
            <div style={{ padding: '14px 18px 6px', borderBottom: '1px solid var(--border)' }}>
              <ResponsiveContainer
                width="100%"
                height={Math.max(stats.failuresByCode.length * 28, 60)}
              >
                <BarChart
                  data={stats.failuresByCode}
                  layout="vertical"
                  margin={{ left: 0, right: 16 }}
                >
                  <XAxis
                    type="number"
                    allowDecimals={false}
                    stroke="var(--muted)"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="code"
                    stroke="var(--muted)"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    width={110}
                  />
                  <Tooltip
                    cursor={{ fill: 'rgba(128,128,128,0.08)' }}
                    contentStyle={{
                      background: 'var(--surface-2)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="count" fill="var(--danger)" radius={[0, 4, 4, 0]} barSize={14} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="card-body" style={{ padding: 0 }}>
            {stats.recentFailures.length === 0 ? (
              <div
                style={{
                  padding: '20px 18px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  color: 'var(--muted)',
                  fontSize: 12.5,
                }}
              >
                <Icon.Check /> No failures in the last 24 hours.
              </div>
            ) : (
              stats.recentFailures.map((j) => (
                <div
                  key={j.id}
                  style={{
                    padding: '11px 18px',
                    borderBottom: '1px solid var(--border)',
                    display: 'grid',
                    gridTemplateColumns: '1fr auto',
                    gap: '2px 10px',
                    alignItems: 'center',
                  }}
                >
                  <span
                    style={{
                      fontSize: 12.5,
                      fontWeight: 500,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {j.user}
                  </span>
                  <span
                    style={{
                      fontFamily: 'var(--mono)',
                      fontSize: 11,
                      color: 'var(--muted)',
                      textAlign: 'right',
                    }}
                  >
                    {j.age}
                  </span>
                  <span
                    style={{
                      fontSize: 11.5,
                      color: 'var(--danger)',
                      fontFamily: 'var(--mono)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {j.error}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Stuck queue */}
        <div className="card">
          <div className="card-head">
            <h3>Stuck queue</h3>
            <span className="sub">Pending &gt; 10 min</span>
            <div className="tools">
              <button
                className="btn sm ghost"
                onClick={() => onNav('jobs', { page: 'jobs', filter: 'QUEUED' })}
              >
                View queue <Icon.Chevron />
              </button>
            </div>
          </div>
          {stats.stuckBuckets.some((b) => b.count > 0) && (
            <div style={{ padding: '14px 18px 6px', borderBottom: '1px solid var(--border)' }}>
              <ResponsiveContainer width="100%" height={110}>
                <BarChart data={stats.stuckBuckets} margin={{ top: 4 }}>
                  <XAxis
                    dataKey="label"
                    stroke="var(--muted)"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: 'rgba(128,128,128,0.08)' }}
                    contentStyle={{
                      background: 'var(--surface-2)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="count" fill="var(--warn)" radius={[4, 4, 0, 0]} barSize={28} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="card-body" style={{ padding: 0 }}>
            {stats.stuckJobs.length === 0 ? (
              <div
                style={{
                  padding: '20px 18px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  color: 'var(--muted)',
                  fontSize: 12.5,
                }}
              >
                <Icon.Check /> Queue is healthy — no stuck jobs.
              </div>
            ) : (
              stats.stuckJobs.map((j) => (
                <div
                  key={j.id}
                  style={{
                    padding: '11px 18px',
                    borderBottom: '1px solid var(--border)',
                    display: 'grid',
                    gridTemplateColumns: '1fr auto',
                    gap: '2px 10px',
                    alignItems: 'center',
                  }}
                >
                  <span
                    style={{
                      fontSize: 12.5,
                      fontWeight: 500,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {j.user}
                  </span>
                  <span className="badge warn dot">Stuck {j.age}</span>
                  <span
                    style={{
                      fontFamily: 'var(--mono)',
                      fontSize: 11,
                      color: 'var(--muted)',
                    }}
                  >
                    {j.id}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* ── Ticket analytics ───────────────────────────────────── */}
      <TicketAnalytics toast={toast} onOpenInbox={() => onNav('chat-inbox')} />
    </>
  );
}
