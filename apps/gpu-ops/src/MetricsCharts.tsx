import { useCallback, useEffect, useRef, useState } from 'react';
import type { AuthRecovery } from './auth';
import {
  type ChartPoint,
  chartSegments,
  counterDeltaSeconds,
  FleetAgentApiError,
  type FleetMetrics,
  loadFleetMetrics,
  METRICS_WINDOWS,
  type MetricsWindow,
} from './live-agent';

const W = 320;
const H = 90;
const WINDOWS = Object.keys(METRICS_WINDOWS) as MetricsWindow[];

type Series = { label: string; cls: string; values: { t: string; value: number | null }[] };

const pathOf = (segment: ChartPoint[]) =>
  segment
    .map((p, i) => `${i ? 'L' : 'M'}${(p.x * W).toFixed(1)},${(p.y * H).toFixed(1)}`)
    .join(' ');

const timeLabel = (ms: number, window: MetricsWindow) =>
  new Date(ms).toLocaleString(undefined, {
    ...(window === '7d' || window === '30d' ? { month: 'short', day: 'numeric' } : {}),
    hour: '2-digit',
    minute: '2-digit',
  });

function Chart({
  title,
  unit,
  series,
  range,
  stepSeconds,
  yMax,
  digits = 0,
  window,
}: {
  title: string;
  unit: string;
  series: Series[];
  range: { start: number; end: number };
  stepSeconds: number;
  yMax: number;
  digits?: number;
  window: MetricsWindow;
}) {
  const drawn = series.map((s) => ({
    ...s,
    segments: chartSegments(s.values, range, stepSeconds, yMax),
  }));
  const hasData = drawn.some((s) => s.segments.length > 0);
  const latest = (s: Series) => {
    for (let i = s.values.length - 1; i >= 0; i--) {
      const v = s.values[i];
      if (v && v.value !== null) return v.value;
    }
    return null;
  };
  return (
    <figure className="metric-chart">
      <figcaption>
        <b>{title}</b>
        <span>
          {drawn
            .map((s) => {
              const v = latest(s);
              return `${s.label} ${v === null ? 'no data' : `${v.toFixed(digits)} ${unit}`}`;
            })
            .join(' · ')}
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${title} over the last ${window}`}
        preserveAspectRatio="none"
      >
        <line className="chart-grid" x1="0" x2={W} y1={H / 2} y2={H / 2} />
        <line className="chart-grid" x1="0" x2={W} y1={H - 0.5} y2={H - 0.5} />
        {drawn.map((s) =>
          s.segments.map((seg, i) =>
            seg.length === 1 ? (
              <circle
                // biome-ignore lint/suspicious/noArrayIndexKey: segments have no identity beyond order
                key={`${s.label}${i}`}
                className={`chart-dot ${s.cls}`}
                cx={(seg[0]?.x ?? 0) * W}
                cy={(seg[0]?.y ?? 0) * H}
                r="2"
              />
            ) : (
              <path
                // biome-ignore lint/suspicious/noArrayIndexKey: segments have no identity beyond order
                key={`${s.label}${i}`}
                className={`chart-line ${s.cls}`}
                d={pathOf(seg)}
                vectorEffect="non-scaling-stroke"
              />
            ),
          ),
        )}
      </svg>
      <div className="chart-axis">
        <span>
          0–{yMax.toFixed(digits)} {unit}
        </span>
        <span>{hasData ? '' : 'No history in this window'}</span>
      </div>
      <div className="chart-axis">
        <span>{timeLabel(range.start, window)}</span>
        <span>{timeLabel(range.end, window)}</span>
      </div>
    </figure>
  );
}

const maxOf = (values: (number | null)[], floor: number) => {
  let max = floor;
  for (const v of values) if (v !== null && v > max) max = v;
  return max;
};
const niceMax = (value: number) => {
  const pow = 10 ** Math.floor(Math.log10(Math.max(value, 1)));
  return Math.ceil(value / pow) * pow;
};

export function MetricsCharts({
  baseUrl,
  token,
  workerId,
  authRecovery,
}: {
  baseUrl: string;
  token: string;
  workerId: string;
  authRecovery: AuthRecovery;
}) {
  const [window, setWindow] = useState<MetricsWindow>('1h');
  const [metrics, setMetrics] = useState<FleetMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  // StrictMode runs effect -> cleanup -> effect on mount, so the flag must be re-armed here.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const load = useCallback(
    async (w: MetricsWindow) => {
      try {
        const next = await loadFleetMetrics(baseUrl, token, workerId, w, authRecovery);
        if (next.workerId !== workerId) throw new Error('Metrics response worker ID mismatch.');
        if (!mounted.current) return;
        setMetrics(next);
        setError(null);
      } catch (cause) {
        if (!mounted.current) return;
        setError(
          cause instanceof FleetAgentApiError && cause.status === 403
            ? 'Your role lacks fleet.view.'
            : cause instanceof Error
              ? cause.message
              : 'Fleet API request failed.',
        );
      }
    },
    [baseUrl, token, workerId, authRecovery],
  );
  useEffect(() => {
    setMetrics(null);
    void load(window);
    const timer = globalThis.setInterval(() => void load(window), 60_000);
    return () => globalThis.clearInterval(timer);
  }, [load, window]);

  const view = metrics && metrics.window === window ? metrics : null;
  const end = view ? Date.parse(view.generatedAt) : 0;
  const range = { start: end - METRICS_WINDOWS[window].ms, end };
  const earliest = view?.earliest ? Date.parse(view.earliest) : null;

  return (
    <section className="metrics-section" aria-label="Hardware history">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">HISTORY · 1-MINUTE ROLLUPS</span>
          <h3>Hardware over time</h3>
        </div>
        <div className="window-picker">
          {WINDOWS.map((w) => (
            <button
              key={w}
              type="button"
              className={w === window ? 'button-secondary active' : 'button-secondary'}
              aria-pressed={w === window}
              onClick={() => setWindow(w)}
            >
              {w}
            </button>
          ))}
        </div>
      </div>
      {error ? (
        <div className="permission-panel" role="alert">
          {error}
        </div>
      ) : !view ? (
        <p aria-live="polite">Loading history…</p>
      ) : !view.gpus.some((g) => g.points.length) && !view.host.length ? (
        <p>No history recorded for this worker yet. Charts fill in as samples arrive.</p>
      ) : (
        <>
          {earliest !== null && earliest > range.start + 5 * 60 * 1000 && (
            <p className="chart-note">
              Recording started {timeLabel(earliest, window)}. Anything earlier was never recorded,
              it is not zero.
            </p>
          )}
          {view.gpus.map((gpu) => {
            const vals = (pick: (p: (typeof gpu.points)[number]) => number | null) =>
              gpu.points.map((p) => ({ t: p.t, value: pick(p) }));
            const vramTotal = maxOf(
              gpu.points.map((p) => p.vramTotalMax),
              0,
            );
            const common = { range, stepSeconds: view.stepSeconds, window };
            return (
              <div className="chart-grid-wrap" key={gpu.index}>
                <h4>GPU {gpu.index}</h4>
                <div className="chart-cards">
                  <Chart
                    {...common}
                    title="Temperature"
                    unit="°C"
                    yMax={100}
                    series={[
                      { label: 'max', cls: 's-red', values: vals((p) => p.tempMax) },
                      { label: 'avg', cls: 's-amber', values: vals((p) => p.tempAvg) },
                    ]}
                  />
                  <Chart
                    {...common}
                    title="SM clock"
                    unit="MHz"
                    yMax={niceMax(
                      maxOf(
                        gpu.points.map((p) => p.smClockAvg),
                        1000,
                      ),
                    )}
                    series={[
                      { label: 'avg', cls: 's-blue', values: vals((p) => p.smClockAvg) },
                      { label: 'min', cls: 's-amber', values: vals((p) => p.smClockMin) },
                    ]}
                  />
                  <Chart
                    {...common}
                    title="Power"
                    unit="W"
                    yMax={niceMax(
                      maxOf(
                        gpu.points.map((p) => p.powerMax),
                        100,
                      ),
                    )}
                    series={[
                      { label: 'max', cls: 's-red', values: vals((p) => p.powerMax) },
                      { label: 'avg', cls: 's-blue', values: vals((p) => p.powerAvg) },
                    ]}
                  />
                  <Chart
                    {...common}
                    title="Time slowed per interval"
                    unit="s"
                    digits={1}
                    yMax={view.stepSeconds}
                    series={[
                      {
                        label: 'heat (hw)',
                        cls: 's-red',
                        values: counterDeltaSeconds(
                          vals((p) => p.hwThermalSlowdownUsMax),
                          view.stepSeconds,
                        ),
                      },
                      {
                        label: 'heat (sw)',
                        cls: 's-amber',
                        values: counterDeltaSeconds(
                          vals((p) => p.swThermalSlowdownUsMax),
                          view.stepSeconds,
                        ),
                      },
                      {
                        label: 'power cap',
                        cls: 's-blue',
                        values: counterDeltaSeconds(
                          vals((p) => p.swPowerCapUsMax),
                          view.stepSeconds,
                        ),
                      },
                    ]}
                  />
                  <Chart
                    {...common}
                    title="GPU utilisation"
                    unit="%"
                    yMax={100}
                    series={[{ label: 'avg', cls: 's-green', values: vals((p) => p.utilAvg) }]}
                  />
                  <Chart
                    {...common}
                    title="VRAM used"
                    unit="MiB"
                    yMax={vramTotal > 0 ? vramTotal : 1}
                    series={[{ label: 'max', cls: 's-blue', values: vals((p) => p.vramUsedMax) }]}
                  />
                </div>
              </div>
            );
          })}
          {view.host.length > 0 && (
            <div className="chart-grid-wrap">
              <h4>Host</h4>
              <div className="chart-cards">
                <Chart
                  range={range}
                  stepSeconds={view.stepSeconds}
                  window={window}
                  title="RAM available (low point)"
                  unit="MiB"
                  yMax={niceMax(
                    maxOf(
                      view.host.map((p) => p.ramAvailMin),
                      1024,
                    ),
                  )}
                  series={[
                    {
                      label: 'min',
                      cls: 's-green',
                      values: view.host.map((p) => ({ t: p.t, value: p.ramAvailMin })),
                    },
                  ]}
                />
                <Chart
                  range={range}
                  stepSeconds={view.stepSeconds}
                  window={window}
                  title="Swap used"
                  unit="MiB"
                  yMax={niceMax(
                    maxOf(
                      view.host.map((p) => p.swapUsedMax),
                      100,
                    ),
                  )}
                  series={[
                    {
                      label: 'max',
                      cls: 's-amber',
                      values: view.host.map((p) => ({ t: p.t, value: p.swapUsedMax })),
                    },
                  ]}
                />
                <Chart
                  range={range}
                  stepSeconds={view.stepSeconds}
                  window={window}
                  title="Load (1 min)"
                  unit=""
                  digits={1}
                  yMax={niceMax(
                    maxOf(
                      view.host.map((p) => p.load1Max),
                      4,
                    ),
                  )}
                  series={[
                    {
                      label: 'max',
                      cls: 's-blue',
                      values: view.host.map((p) => ({ t: p.t, value: p.load1Max })),
                    },
                  ]}
                />
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
