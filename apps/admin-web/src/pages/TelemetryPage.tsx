import { useCallback, useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Icon } from '../components/Icons';
import { apiErrorMessage, apiFetch } from '../lib/data';

type DayRange = 7 | 14 | 30;

interface JobTypeTelemetry {
  jobType: string;
  sampleCount: number;
  processingP50Ms: number | null;
  processingP95Ms: number | null;
  e2eP50Ms: number | null;
  e2eP95Ms: number | null;
  comfySampleCount: number;
  comfyP50Ms: number | null;
  comfyP95Ms: number | null;
}

interface StreamDepth {
  stream: string;
  depth: number;
}

interface OutcomeCount {
  status: string;
  count: number;
}

interface TelemetryResponse {
  days: number;
  jobTypes: JobTypeTelemetry[];
  queueDepthByStream: StreamDepth[];
  outcomes: OutcomeCount[];
  successRate: number | null;
}

interface Props {
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
}

interface ChartPoint {
  jobType: string;
  p50: number;
  p95: number;
}

const P50_COLOR = 'var(--accent)';
const P95_COLOR = 'var(--info)';

const OUTCOME_COLORS: Record<string, string> = {
  COMPLETED: 'var(--success)',
  FAILED: 'var(--danger)',
  CANCELLED: 'var(--warn)',
};
const OUTCOME_DEFAULT_COLOR = 'var(--accent)';

function fmtMs(ms: number | null): string {
  if (ms === null) return '—';
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function tickSeconds(v: number): string {
  return v < 1 ? `${Math.round(v * 1000)}ms` : `${v.toFixed(1)}s`;
}

function DurationChart({ title, data }: { title: string; data: ChartPoint[] }) {
  if (data.length === 0) {
    return (
      <div className="card">
        <div className="card-head">
          <h3>{title}</h3>
        </div>
        <div className="card-body">
          <p style={{ color: 'var(--muted)', fontSize: 13, padding: '20px 0' }}>No data yet.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="card">
      <div className="card-head">
        <h3>{title}</h3>
      </div>
      <div className="card-body">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 24 }}>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="jobType"
              stroke="var(--muted)"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              angle={-25}
              textAnchor="end"
              height={50}
              interval={0}
            />
            <YAxis
              stroke="var(--muted)"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              tickFormatter={tickSeconds}
              width={48}
            />
            <Tooltip
              cursor={{ fill: 'rgba(128,128,128,0.08)' }}
              contentStyle={{
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                fontSize: 12,
              }}
              formatter={(value: number, name: string) => [`${value.toFixed(2)}s`, name]}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="p50" name="p50" fill={P50_COLOR} radius={[4, 4, 0, 0]} />
            <Bar dataKey="p95" name="p95" fill={P95_COLOR} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default function TelemetryPage({ toast }: Props) {
  const [days, setDays] = useState<DayRange>(7);
  const [data, setData] = useState<TelemetryResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<TelemetryResponse>(`/admin/telemetry?days=${days}`);
      setData(res);
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to load telemetry',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    } finally {
      setLoading(false);
    }
  }, [days, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  // p50/p95 share the same SQL FILTER predicate per metric (see telemetry.routes.ts),
  // so within one metric they're always both null or both present together.
  const processingData: ChartPoint[] =
    data?.jobTypes
      .filter(
        (r): r is JobTypeTelemetry & { processingP50Ms: number; processingP95Ms: number } =>
          r.processingP50Ms !== null,
      )
      .map((r) => ({
        jobType: r.jobType,
        p50: r.processingP50Ms / 1000,
        p95: r.processingP95Ms / 1000,
      })) ?? [];

  const e2eData: ChartPoint[] =
    data?.jobTypes
      .filter(
        (r): r is JobTypeTelemetry & { e2eP50Ms: number; e2eP95Ms: number } => r.e2eP50Ms !== null,
      )
      .map((r) => ({
        jobType: r.jobType,
        p50: r.e2eP50Ms / 1000,
        p95: r.e2eP95Ms / 1000,
      })) ?? [];

  const comfyData: ChartPoint[] =
    data?.jobTypes
      .filter(
        (r): r is JobTypeTelemetry & { comfyP50Ms: number; comfyP95Ms: number } =>
          r.comfySampleCount > 0 && r.comfyP50Ms !== null,
      )
      .map((r) => ({
        jobType: r.jobType,
        p50: r.comfyP50Ms / 1000,
        p95: r.comfyP95Ms / 1000,
      })) ?? [];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Telemetry</h1>
          <p className="lede">
            Queue depth, job outcomes, and processing/E2E/ComfyUI duration by job type — mirrors the
            Grafana Pipeline Overview dashboard's Postgres/Redis-derivable panels, over the last{' '}
            {days} day{days > 1 ? 's' : ''}.
          </p>
        </div>
        <div className="head-tools">
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value) as DayRange)}
            style={{ padding: '8px 12px', borderRadius: 6, fontSize: 13 }}
          >
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
          </select>
          <button className="btn" onClick={load}>
            <Icon.Refresh /> Refresh
          </button>
        </div>
      </div>

      {loading || !data ? (
        <p style={{ color: 'var(--muted)', fontSize: 13, padding: '20px 0' }}>Loading&hellip;</p>
      ) : (
        <>
          <div className="stat-grid" style={{ marginBottom: 16 }}>
            <div className="stat">
              <div className="lbl">
                <Icon.Activity /> Success rate
              </div>
              <div className="val">
                {data.successRate === null ? '—' : `${Math.round(data.successRate * 100)}%`}
              </div>
              <div className="delta">
                <span style={{ color: 'var(--muted)' }}>
                  completed / (completed + failed), last {days}d
                </span>
              </div>
            </div>
            <div className="stat">
              <div className="lbl">
                <Icon.Clock /> Queue depth (live)
              </div>
              <div className="val">
                {data.queueDepthByStream.reduce((sum, s) => sum + s.depth, 0).toLocaleString()}
              </div>
              <div className="delta">
                <span style={{ color: 'var(--muted)' }}>across all Redis Streams, right now</span>
              </div>
            </div>
          </div>

          <div className="dash-grid-2col" style={{ marginBottom: 16 }}>
            <div className="card">
              <div className="card-head">
                <h3>Queue depth by stream</h3>
              </div>
              <div className="card-body">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart
                    data={data.queueDepthByStream}
                    margin={{ top: 4, right: 8, left: 0, bottom: 4 }}
                  >
                    <CartesianGrid stroke="var(--border)" vertical={false} />
                    <XAxis
                      dataKey="stream"
                      stroke="var(--muted)"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      stroke="var(--muted)"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                      allowDecimals={false}
                      width={32}
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
                    <Bar dataKey="depth" name="pending" fill={P50_COLOR} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <h3>Jobs by outcome</h3>
              </div>
              <div className="card-body">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={data.outcomes} margin={{ top: 4, right: 8, left: 0, bottom: 24 }}>
                    <CartesianGrid stroke="var(--border)" vertical={false} />
                    <XAxis
                      dataKey="status"
                      stroke="var(--muted)"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                      angle={-25}
                      textAnchor="end"
                      height={50}
                      interval={0}
                    />
                    <YAxis
                      stroke="var(--muted)"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                      allowDecimals={false}
                      width={40}
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
                    <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                      {data.outcomes.map((o) => (
                        <Cell
                          key={o.status}
                          fill={OUTCOME_COLORS[o.status] ?? OUTCOME_DEFAULT_COLOR}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {data.jobTypes.length === 0 ? (
            <p style={{ color: 'var(--muted)', fontSize: 13, padding: '20px 0' }}>
              No completed jobs in this window.
            </p>
          ) : (
            <>
              <div className="dash-grid-2col">
                <DurationChart title="Processing duration by job type" data={processingData} />
                <DurationChart title="End-to-end latency by job type" data={e2eData} />
              </div>
              <div style={{ marginTop: 16 }}>
                <DurationChart title="ComfyUI round-trip by job type" data={comfyData} />
              </div>
            </>
          )}

          <div className="table-wrap" style={{ marginTop: 16 }}>
            <table className="table">
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Job type</th>
                  <th style={{ textAlign: 'right' }}>Samples</th>
                  <th style={{ textAlign: 'right' }}>Processing p50</th>
                  <th style={{ textAlign: 'right' }}>Processing p95</th>
                  <th style={{ textAlign: 'right' }}>E2E p50</th>
                  <th style={{ textAlign: 'right' }}>E2E p95</th>
                  <th style={{ textAlign: 'right' }}>ComfyUI p50</th>
                  <th style={{ textAlign: 'right' }}>ComfyUI p95</th>
                </tr>
              </thead>
              <tbody>
                {data.jobTypes.map((r) => (
                  <tr key={r.jobType}>
                    <td style={{ textAlign: 'left' }}>
                      <span className="semi">{r.jobType}</span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <span className="mono">{r.sampleCount.toLocaleString()}</span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <span className="mono">{fmtMs(r.processingP50Ms)}</span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <span className="mono">{fmtMs(r.processingP95Ms)}</span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <span className="mono">{fmtMs(r.e2eP50Ms)}</span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <span className="mono">{fmtMs(r.e2eP95Ms)}</span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <span className="mono">
                        {r.comfySampleCount > 0 ? fmtMs(r.comfyP50Ms) : '—'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <span className="mono">
                        {r.comfySampleCount > 0 ? fmtMs(r.comfyP95Ms) : '—'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 12 }}>
        Processing duration is measured GENERATING → completed, so it excludes queue-wait and
        worker-selection time (unlike the Grafana "job processing duration" panel, which measures
        the dispatcher's full per-attempt wall time). ComfyUI round-trip only appears for jobs
        processed since this column was added.
      </p>
    </>
  );
}
