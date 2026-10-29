/**
 * Print one end-to-end timeline for a job: DB timestamps + job_events + the
 * dispatcher's `job stage timing` log lines.
 *
 * The dispatcher logs one pino JSON line per stage (stage, durationMs, jobId) but
 * persists nothing, so capture its output to a file while you generate:
 *   pnpm --filter @aivastra/dispatcher dev 2>&1 | tee dispatcher.log
 * (pino is JSON in every mode here; only pino-pretty would break the parse.)
 *
 * Usage:
 *   pnpm tsx --env-file=.env scripts/job-timeline.mts <jobId> [dispatcher.log]
 *
 * Read-only. Requires DATABASE_URL.
 */

import { readFileSync } from 'node:fs';
import { createDb, eq, schema } from '@aivastra/db';

const [jobId, logPath] = process.argv.slice(2);
if (!jobId) {
  console.error('usage: job-timeline.mts <jobId> [dispatcher.log]');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const { db } = createDb(process.env.DATABASE_URL);
const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
if (!job) {
  console.error(`job ${jobId} not found`);
  process.exit(1);
}
const events = await db.select().from(schema.jobEvents).where(eq(schema.jobEvents.jobId, jobId));

interface Row {
  at: number;
  source: string;
  label: string;
  durationMs?: number;
}
const rows: Row[] = [];

const push = (at: Date | null | undefined, label: string) => {
  if (at) rows.push({ at: at.getTime(), source: 'db', label });
};
push(job.createdAt, 'jobs.created_at (API inserted job)');
push(job.queuedAt, 'jobs.queued_at');
push(job.startedAt, 'jobs.started_at');
push(job.completedAt, 'jobs.completed_at');
for (const e of events) push(e.createdAt, `job_events ${e.eventType}`);

if (logPath) {
  for (const line of readFileSync(logPath, 'utf8').split(/\r?\n/)) {
    if (!line.includes(jobId) || !line.includes('"stage"')) continue;
    try {
      const l = JSON.parse(line) as { time?: string; stage?: string; durationMs?: number };
      if (!l.time || !l.stage || typeof l.durationMs !== 'number') continue;
      // pino stamps the line when the stage finished, so the stage began durationMs earlier.
      rows.push({
        at: Date.parse(l.time),
        source: 'log',
        label: l.stage,
        durationMs: l.durationMs,
      });
    } catch {
      // not a JSON log line
    }
  }
}

// ComfyUI's own clock for the run: /history records when it started and finished
// executing, which the dispatcher cannot see (it only sees the poll that noticed).
// Needs the worker's API key from the workers row; the key is never printed.
for (const e of events.filter((ev) => ev.eventType === 'COMFY_DISPATCH')) {
  const { promptId, workerId } = (e.payload ?? {}) as { promptId?: string; workerId?: string };
  if (!promptId || !workerId) continue;
  const [worker] = await db.select().from(schema.workers).where(eq(schema.workers.id, workerId));
  if (!worker) continue;
  try {
    const res = await fetch(`${worker.url.replace(/\/$/, '')}/history/${promptId}`, {
      headers: { 'X-Api-Key': worker.apiKey },
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await res.json()) as Record<
      string,
      { status?: { messages?: [string, { timestamp?: number }][] } }
    >;
    for (const [type, payload] of body[promptId]?.status?.messages ?? []) {
      if (
        ['execution_start', 'execution_cached', 'execution_success'].includes(type) &&
        payload.timestamp
      )
        rows.push({ at: payload.timestamp, source: `comfy:${workerId}`, label: type });
    }
  } catch (err) {
    console.error(`could not read ComfyUI history from ${workerId}: ${(err as Error).message}`);
  }
}

rows.sort((a, b) => a.at - b.at);
const t0 = rows[0]?.at ?? 0;
const fmt = (ms: number) => `${(ms / 1000).toFixed(2)}s`.padStart(9);

console.log(`job ${jobId}  status=${job.status}  source=${job.source}`);
console.log('  +elapsed   stage duration  source  event');
for (const r of rows) {
  console.log(
    `${fmt(r.at - t0)}  ${r.durationMs === undefined ? ' '.repeat(14) : fmt(r.durationMs).padStart(14)}  ${r.source.padEnd(6)}  ${r.label}`,
  );
}
if (job.completedAt)
  console.log(
    `\ntotal created -> completed: ${fmt(job.completedAt.getTime() - job.createdAt.getTime())}`,
  );
const cStart = rows.find((r) => r.label === 'execution_start')?.at;
const cEnd = rows.find((r) => r.label === 'execution_success')?.at;
if (cStart && cEnd)
  console.log(`ComfyUI execution (execution_start -> execution_success): ${fmt(cEnd - cStart)}`);
if (job.comfyDurationMs != null)
  console.log(`ComfyUI round trip (jobs.comfy_duration_ms): ${fmt(job.comfyDurationMs)}`);
process.exit(0);
