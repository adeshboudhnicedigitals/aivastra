// Throwaway: per-job duration, peak RAM and CPU for one CI Bench run.
//   node scripts/bench/report.mjs <run_id> <samples.csv>
// samples.csv is /var/lib/bench/samples.csv copied off the box.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const [runId, csvPath] = process.argv.slice(2);
if (!runId || !csvPath) {
  console.error('usage: report.mjs <run_id> <samples.csv>');
  process.exit(1);
}

const jobs = JSON.parse(
  execFileSync(
    'gh',
    ['api', `repos/{owner}/{repo}/actions/runs/${runId}/jobs`, '--paginate', '--jq', '[.jobs[]]'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  ).replace(/\]\s*\[/g, ','),
);

const rows = readFileSync(csvPath, 'utf8')
  .trim()
  .split('\n')
  .slice(1)
  .map((l) => l.split(',').map(Number));

const GiB = 1024 ** 3;
const out = [];
for (const j of jobs) {
  if (!j.started_at || !j.completed_at) continue;
  const t0 = Date.parse(j.started_at) / 1000;
  const t1 = Date.parse(j.completed_at) / 1000;
  const w = rows.filter((r) => r[0] >= t0 && r[0] <= t1);
  if (w.length < 2) continue;
  const cpus = w[0][1];
  const peakMem = Math.max(...w.map((r) => r[2]));
  const peakSys = Math.max(...w.map((r) => r[4])) * 1024;
  const cpuSec = (w[w.length - 1][3] - w[0][3]) / 1e6;
  out.push({
    job: j.name,
    cpus,
    wallSec: Math.round(t1 - t0),
    peakSliceGiB: +(peakMem / GiB).toFixed(2),
    peakSystemGiB: +(peakSys / GiB).toFixed(2),
    avgCpus: +(cpuSec / (t1 - t0)).toFixed(2),
  });
}
console.table(out);

// Run level: with jobs overlapping, a per-job peak is the whole slice, so the
// run's own wall clock, peak RAM and mean CPU are the numbers to compare.
const started = Math.min(
  ...jobs.filter((j) => j.started_at).map((j) => Date.parse(j.started_at) / 1000),
);
const ended = Math.max(
  ...jobs.filter((j) => j.completed_at).map((j) => Date.parse(j.completed_at) / 1000),
);
const win = rows.filter((r) => r[0] >= started && r[0] <= ended);
const events = jobs
  .filter((j) => j.started_at && j.completed_at)
  .flatMap((j) => [
    [Date.parse(j.started_at), 1],
    [Date.parse(j.completed_at), -1],
  ])
  .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
let live = 0;
let maxLive = 0;
for (const [, d] of events) maxLive = Math.max(maxLive, (live += d));
const sumJobs = out.reduce((a, o) => a + o.wallSec, 0);
console.log(
  `RUN  cpus=${win[0]?.[1]}  wall=${Math.round(ended - started)}s  sum-of-jobs=${sumJobs}s  max-concurrent-jobs=${maxLive}  ` +
    `peak-slice-RAM=${(Math.max(...win.map((r) => r[2])) / GiB).toFixed(2)}GiB  ` +
    `mean-CPUs=${((win[win.length - 1][3] - win[0][3]) / 1e6 / (ended - started)).toFixed(2)}`,
);
