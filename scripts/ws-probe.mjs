// WebSocket vs /history timing probe. Waits for the next new job, opens a ws to its worker
// with the dispatcher's clientId (av:<jobId>:1:main) so ComfyUI routes that prompt's
// messages to it, polls /history every 200ms in parallel, and records when each signal
// arrives on THIS machine's clock. Read-only. Never prints the API key.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../apps/dispatcher/package.json', import.meta.url));
const WebSocket = require('ws');
const OUT = process.argv[2];
const psql = (sql) =>
  execFileSync(
    'docker',
    [
      'exec',
      'aivastra-postgres',
      'psql',
      '-U',
      'tryon',
      '-d',
      'tryon_dev',
      '-t',
      '-A',
      '-F',
      '|',
      '-c',
      sql,
    ],
    { encoding: 'utf8' },
  ).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const since = psql('select now()');
console.log('waiting for a new job after', since);
let jobId;
for (;;) {
  const row = psql(`select id from jobs where created_at > '${since}' order by created_at limit 1`);
  if (row) {
    jobId = row;
    break;
  }
  await sleep(300);
}
const workerId = 'w3';
const [url, key] = psql(`select url, api_key from workers where id='${workerId}'`).split('|');
const base = url.replace(/\/$/, '');
const clientId = `av:${jobId}:1:main`;
console.log('job', jobId, '- opening ws as', clientId);

const wsEvents = [];
const ws = new WebSocket(
  `${base.replace(/^http/, 'ws')}/ws?clientId=${encodeURIComponent(clientId)}`,
  {
    headers: { 'X-Api-Key': key },
  },
);
ws.on('open', () => console.log('ws open'));
ws.on('error', (e) => console.log('ws error', e.message));
let wsSuccessAt;
let wsExecutingNullAt;
ws.on('message', (data, isBinary) => {
  const at = Date.now();
  if (isBinary) return;
  let m;
  try {
    m = JSON.parse(data.toString());
  } catch {
    return;
  }
  wsEvents.push({
    at,
    type: m.type,
    node: m.data?.node,
    ts: m.data?.timestamp,
    prompt: m.data?.prompt_id,
  });
  if (m.type === 'execution_success' && !wsSuccessAt)
    wsSuccessAt = { at, ts: m.data?.timestamp, prompt: m.data?.prompt_id };
  if (m.type === 'executing' && m.data?.node === null && !wsExecutingNullAt) wsExecutingNullAt = at;
});

// Wait for the prompt id so /history can be polled for it.
let promptId;
for (;;) {
  promptId = psql(
    `select payload->>'promptId' from job_events where job_id='${jobId}' and event_type='COMFY_DISPATCH' limit 1`,
  );
  if (promptId || wsSuccessAt) {
    promptId ||= wsSuccessAt?.prompt;
    break;
  }
  await sleep(300);
}
console.log('promptId', promptId);

const polls = [];
globalThis.__snap = () =>
  writeFileSync(
    OUT + '.snap',
    JSON.stringify({
      jobId,
      promptId,
      wsOpen: ws.readyState,
      wsCounts: wsEvents.reduce((a, e) => ((a[e.type] = (a[e.type] ?? 0) + 1), a), {}),
      historySeen: !!first,
      polls: polls.length,
    }),
  );
setInterval(() => globalThis.__snap(), 3000);
let first;
const deadline = Date.now() + 20 * 60_000;
while (Date.now() < deadline) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${base}/history/${promptId}`, {
      headers: { 'X-Api-Key': key },
      signal: AbortSignal.timeout(10000),
    });
    const body = await res.json().catch(() => ({}));
    polls.push({ t0, ms: Date.now() - t0 });
    if (body[promptId] && !first)
      first = { sentAt: t0, receivedAt: Date.now(), body: body[promptId] };
  } catch {}
  if (first && (wsSuccessAt || Date.now() - first.receivedAt > 10_000)) break;
  await sleep(Math.max(0, 200 - (Date.now() - t0)));
}
await sleep(1500); // let trailing ws frames land
ws.close();

const msgs = first?.body?.status?.messages ?? [];
const get = (t) => msgs.find((m) => m[0] === t)?.[1]?.timestamp;
const iso = (x) => (x ? new Date(x).toISOString() : null);
const success = get('execution_success') ?? wsSuccessAt?.ts;
const result = {
  jobId,
  promptId,
  comfyExecutionSuccess: iso(success),
  wsExecutionSuccessReceived: iso(wsSuccessAt?.at),
  wsExecutingNullReceived: iso(wsExecutingNullAt),
  historyFirstSentWithEntry: iso(first?.sentAt),
  historyFirstReceivedWithEntry: iso(first?.receivedAt),
  wsMinusSuccessMs: wsSuccessAt && success ? wsSuccessAt.at - success : null,
  historySentMinusSuccessMs: first && success ? first.sentAt - success : null,
  historyReceivedMinusSuccessMs: first && success ? first.receivedAt - success : null,
  wsBeatsHistoryReceiveByMs: wsSuccessAt && first ? first.receivedAt - wsSuccessAt.at : null,
  pollCount: polls.length,
  avgPollMs: polls.length ? Math.round(polls.reduce((a, p) => a + p.ms, 0) / polls.length) : null,
  maxPollMs: polls.length ? Math.max(...polls.map((p) => p.ms)) : null,
  wsMessageCounts: wsEvents.reduce((a, e) => ((a[e.type] = (a[e.type] ?? 0) + 1), a), {}),
  wsTail: wsEvents.slice(-6).map((e) => ({ type: e.type, at: iso(e.at), node: e.node })),
};
writeFileSync(OUT, JSON.stringify(result, null, 2));
console.log(result);
process.exit(0);
