// Times POST /prompt with payloads that ComfyUI rejects at validation, so nothing is ever queued.
// Env: W3_URL, W3_KEY, PROMPT_FILE (a stored prompt: select contract->'prompt' from execution_attempts). Aborts if the worker is busy. Prints no key.
import { readFileSync } from 'node:fs';

const base = process.env.W3_URL.replace(/\/$/, '');
const H = { 'X-Api-Key': process.env.W3_KEY, 'Content-Type': 'application/json' };
const q = await (await fetch(`${base}/queue`, { headers: H })).json();
if ((q.queue_running?.length ?? 0) + (q.queue_pending?.length ?? 0) > 0) {
  console.log('worker busy, abort');
  process.exit(2);
}
const real = JSON.parse(readFileSync(process.env.PROMPT_FILE ?? 'prompt.json', 'utf8'));
const bad = structuredClone(real);
const loads = Object.keys(bad).filter((k) => bad[k].class_type === 'LoadImage');
for (const k of loads) bad[k].inputs.image = 'definitely_missing_probe.png';
const cases = {
  getSystemStats: () => fetch(`${base}/system_stats`, { headers: H }),
  postEmptyPrompt: () =>
    fetch(`${base}/prompt`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ prompt: {}, client_id: 'probe' }),
    }),
  postRealPromptMissingImages: () =>
    fetch(`${base}/prompt`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ prompt: bad, client_id: 'probe' }),
    }),
};
const out = {};
for (const [name, f] of Object.entries(cases)) {
  const r = [];
  for (let i = 0; i < 5; i++) {
    const t = performance.now();
    const res = await f();
    const txt = await res.text();
    r.push({ status: res.status, ms: Math.round(performance.now() - t), bytes: txt.length });
  }
  out[name] = r;
}
const q2 = await (await fetch(`${base}/queue`, { headers: H })).json();
out.queueAfter = (q2.queue_running?.length ?? 0) + (q2.queue_pending?.length ?? 0);
console.log(JSON.stringify(out));
