import { Bar, BarChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis } from 'recharts';

export interface DistributionPoint {
  jobId: string;
  jobType: string;
  workerId: string | null;
  e2eMs: number;
  comfyMs: number | null;
  queueMs: number | null;
  attempts: number;
  errorCode: string | null;
  createdAt: string;
  isOutlier: boolean;
}

export interface DistributionBucket {
  bucketMs: number;
  jobType: string;
  count: number;
  q1: number;
  median: number;
  q3: number;
  whiskerLow: number;
  whiskerHigh: number;
  points: DistributionPoint[];
}

interface BoxStats {
  q1: number;
  median: number;
  q3: number;
  whiskerLow: number;
  whiskerHigh: number;
  count: number;
  points: DistributionPoint[];
}

// One chart row per time bucket; each job type contributes a `[low, high]`
// range under its own key so recharts renders and offsets one Bar series per
// type automatically — that offset is what encodes job type positionally.
interface ChartRow {
  bucketMs: number;
  label: string;
  stats: Record<string, BoxStats>;
  [jobTypeKey: string]: unknown;
}

interface Props {
  buckets: DistributionBucket[];
  jobTypeOrder: string[];
  bucketSeconds: number;
  onPointClick: (p: DistributionPoint) => void;
  selectedJobId: string | null;
}

// Hue encodes the phase, not the job type — the phases are what you compare
// within a single job's bar. Job type is encoded by column position instead.
export const PHASE_COLORS = {
  queue: '#f59e0b',
  comfy: '#3b82f6',
  overhead: '#94a3b8',
} as const;

export const PHASE_LABELS = {
  queue: 'Queue wait',
  comfy: 'ComfyUI',
  overhead: 'Dispatch + I/O',
} as const;

const BOX_COLOR = 'var(--muted)';

/**
 * Splits a job into three non-overlapping segments that sum exactly to E2E.
 *
 * `comfy_duration_ms` records only the most recent attempt/phase, so on a
 * retried or two-phase job queue+comfy can exceed the wall-clock total. Clamping
 * keeps the bar honest about the total (its height is always exactly E2E) at the
 * cost of understating comfy in those cases; the click detail shows raw values.
 */
function phaseSegments(p: DistributionPoint): { queue: number; comfy: number; overhead: number } {
  const e2e = Math.max(p.e2eMs, 0);
  const queue = Math.min(Math.max(p.queueMs ?? 0, 0), e2e);
  const comfy = Math.min(Math.max(p.comfyMs ?? 0, 0), e2e - queue);
  return { queue, comfy, overhead: e2e - queue - comfy };
}

/**
 * Deterministic [-0.5, 0.5] offset from a job id. Bars at identical durations
 * would otherwise stack into one mark; jittering spreads them so density is
 * readable. Derived from the id rather than Math.random so a bar doesn't hop
 * around between renders.
 */
function jitterFor(jobId: string): number {
  let h = 0;
  for (let i = 0; i < jobId.length; i++) h = (h * 31 + jobId.charCodeAt(i)) | 0;
  return ((h >>> 0) % 1000) / 1000 - 0.5;
}

function formatBucketLabel(ms: number, bucketSeconds: number): string {
  const d = new Date(ms);
  // A daily bucket labelled with an hour reads as false precision.
  return bucketSeconds >= 86400
    ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : d.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
}

function tickSeconds(v: number): string {
  return v < 1 ? `${Math.round(v * 1000)}ms` : `${v.toFixed(1)}s`;
}

function fmt(ms: number | null): string {
  if (ms === null) return '—';
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Renders one column: a faint Q1–Q3 box for reference, plus a stacked bar per
 * job rising from zero to that job's E2E, split into its three phases.
 *
 * The Bar this replaces spans 0..whiskerHigh, so `y`/`height` give a
 * value->pixel scale without needing recharts' axis internals.
 */
function PhaseStackShape(props: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: ChartRow;
  jobType: string;
  onPointClick: (p: DistributionPoint) => void;
  selectedJobId: string | null;
}) {
  const { x, y, width, height, payload, jobType, onPointClick, selectedJobId } = props;
  const s = payload?.stats?.[jobType];
  if (s === undefined || x === undefined || y === undefined || width === undefined) return null;
  if (height === undefined) return null;

  // The bar spans 0..whiskerHigh, so pixels-per-ms falls out of its geometry.
  const pxPerMs = s.whiskerHigh > 0 && height > 0 ? height / s.whiskerHigh : 0;
  const yZero = y + height;
  const yFor = (valueMs: number) => yZero - valueMs * pxPerMs;

  const cx = x + width / 2;
  const jitterSpread = Math.max(width * 0.75, 2);
  const barW = Math.max(1, Math.min(3, width / Math.max(s.points.length, 1)));

  const yQ1 = yFor(s.q1);
  const yQ3 = yFor(s.q3);
  const yMed = yFor(s.median);

  return (
    <g>
      {/* Q1-Q3 reference box, behind the bars */}
      <rect
        x={x}
        y={Math.min(yQ1, yQ3)}
        width={Math.max(width, 1)}
        height={Math.max(Math.abs(yQ1 - yQ3), 1)}
        fill={BOX_COLOR}
        fillOpacity={0.1}
        stroke={BOX_COLOR}
        strokeOpacity={0.35}
        strokeWidth={1}
      />
      <line
        x1={x}
        x2={x + width}
        y1={yMed}
        y2={yMed}
        stroke={BOX_COLOR}
        strokeOpacity={0.7}
        strokeWidth={1.5}
      />
      {/* one stacked bar per job: queue at the bottom, then ComfyUI, then the
          remaining dispatch/upload/download overhead up to E2E */}
      {s.points.map((p) => {
        const seg = phaseSegments(p);
        const bx = cx + jitterFor(p.jobId) * jitterSpread - barW / 2;
        const selected = p.jobId === selectedJobId;
        const yQueueTop = yFor(seg.queue);
        const yComfyTop = yFor(seg.queue + seg.comfy);
        const yTop = yFor(p.e2eMs);
        const rect = (yA: number, yB: number, fill: string) =>
          Math.abs(yB - yA) < 0.4 ? null : (
            <rect
              x={bx}
              y={Math.min(yA, yB)}
              width={barW}
              height={Math.abs(yB - yA)}
              fill={fill}
              fillOpacity={selected ? 1 : 0.85}
            />
          );
        return (
          <g
            key={p.jobId}
            style={{ cursor: 'pointer' }}
            onClick={() => onPointClick(p)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onPointClick(p);
            }}
          >
            {rect(yZero, yQueueTop, PHASE_COLORS.queue)}
            {rect(yQueueTop, yComfyTop, PHASE_COLORS.comfy)}
            {rect(yComfyTop, yTop, PHASE_COLORS.overhead)}
            {/* outliers get a cap so they're findable without relying on height */}
            {p.isOutlier ? (
              <rect x={bx - 1} y={yTop - 2} width={barW + 2} height={2} fill="var(--danger)" />
            ) : null}
            {selected ? (
              <rect
                x={bx - 1.5}
                y={yTop - 2}
                width={barW + 3}
                height={yZero - yTop + 2}
                fill="none"
                stroke="var(--text)"
                strokeWidth={1}
              />
            ) : null}
            <title>
              {`${p.jobType}${p.workerId ? ` · ${p.workerId}` : ''}\nE2E ${fmt(p.e2eMs)} = queue ${fmt(p.queueMs)} + ComfyUI ${fmt(p.comfyMs)} + overhead ${fmt(seg.overhead)}${p.isOutlier ? '\noutlier' : ''}`}
            </title>
          </g>
        );
      })}
    </g>
  );
}

export default function JobDistributionChart({
  buckets,
  jobTypeOrder,
  bucketSeconds,
  onPointClick,
  selectedJobId,
}: Props) {
  // Pivot the flat (bucket, jobType) rows into one row per bucket.
  const byBucket = new Map<number, ChartRow>();
  for (const b of buckets) {
    let row = byBucket.get(b.bucketMs);
    if (!row) {
      row = {
        bucketMs: b.bucketMs,
        label: formatBucketLabel(b.bucketMs, bucketSeconds),
        stats: {},
      };
      byBucket.set(b.bucketMs, row);
    }
    row.stats[b.jobType] = {
      q1: b.q1,
      median: b.median,
      q3: b.q3,
      whiskerLow: b.whiskerLow,
      whiskerHigh: b.whiskerHigh,
      count: b.count,
      points: b.points,
    };
    // Bars are anchored at zero because the stack is a decomposition of E2E,
    // not a floating range — so the series spans 0..whiskerHigh.
    row[b.jobType] = b.whiskerHigh / 1000;
  }
  const data = [...byBucket.values()].sort((a, b) => a.bucketMs - b.bucketMs);

  // Domain must cover outliers too — they rise above the whisker range the bars
  // themselves declare, so autoscale alone would clip them.
  let maxSec = 0;
  for (const b of buckets) {
    maxSec = Math.max(maxSec, b.whiskerHigh / 1000);
    for (const p of b.points) maxSec = Math.max(maxSec, p.e2eMs / 1000);
  }

  const typesPresent = jobTypeOrder.filter((t) => buckets.some((b) => b.jobType === t));

  return (
    <ResponsiveContainer width="100%" height={340}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 40 }}>
        <CartesianGrid stroke="var(--border)" vertical={false} />
        <XAxis
          dataKey="label"
          stroke="var(--muted)"
          fontSize={10}
          tickLine={false}
          axisLine={false}
          angle={-35}
          textAnchor="end"
          height={60}
          interval="preserveStartEnd"
        />
        <YAxis
          stroke="var(--muted)"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          tickFormatter={tickSeconds}
          width={52}
          domain={[0, Math.ceil(maxSec * 1.05)]}
        />
        {typesPresent.map((t) => (
          <Bar
            key={t}
            dataKey={t}
            isAnimationActive={false}
            shape={
              <PhaseStackShape
                jobType={t}
                onPointClick={onPointClick}
                selectedJobId={selectedJobId}
              />
            }
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
