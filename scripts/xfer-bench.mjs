// Upload/download transfer experiments against one ComfyUI worker. Needs only node >= 20
// (curl optional). Env: W3_URL, W3_KEY, PROMPT_ID (a finished prompt whose output we can /view).
// Uploads random bytes as bwtest_*.jpg (overwrite=true, never touches job inputs). Prints no key.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = process.env.W3_URL.replace(/\/$/, '');
const key = process.env.W3_KEY;
const promptId = process.env.PROMPT_ID;
const H = { 'X-Api-Key': key };
const ms = (t) => Math.round(performance.now() - t);
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const out = {};

// Do not disturb a live generation: bail out if the worker is busy.
const q = await (await fetch(`${base}/queue`, { headers: H })).json();
if ((q.queue_running?.length ?? 0) + (q.queue_pending?.length ?? 0) > 0 && !process.env.FORCE) {
  console.log('worker is busy, aborting (set FORCE=1 to override)');
  process.exit(2);
}

async function upload(name, bytes) {
  const t = performance.now();
  const form = new FormData();
  form.append('image', new Blob([bytes], { type: 'image/jpeg' }), name);
  form.append('overwrite', 'true');
  const res = await fetch(`${base}/upload/image`, { method: 'POST', headers: H, body: form });
  await res.text();
  if (!res.ok) throw new Error(`upload ${res.status}`);
  return ms(t);
}
const repeat = async (n, f) => { const r = []; for (let i = 0; i < n; i++) r.push(await f(i)); return r; };

// 0. per-request latency floor
out.latencyMs = await repeat(5, async () => { const t = performance.now(); await (await fetch(`${base}/system_stats`, { headers: H })).arrayBuffer(); return ms(t); });

// 1. uploads, sized like the real Studio job 266153d8 (pose, face, garment, bg, shoe, lower)
const sizes = { pose: 146812, face: 30114, garment: 21162, bg: 1265866, shoe: 1630338, lower: 1734266 };
const files = Object.fromEntries(Object.entries(sizes).map(([k, n]) => [k, randomBytes(n)]));
const names = Object.keys(files);
out.upload = {
  allSixParallel_asDispatcher: await repeat(3, async (i) => { const t = performance.now(); await Promise.all(names.map((k) => upload(`bwtest_${k}_${i}.jpg`, files[k]))); return ms(t); }),
  allSixSequential: await repeat(2, async (i) => { const t = performance.now(); for (const k of names) await upload(`bwtest_${k}_s${i}.jpg`, files[k]); return ms(t); }),
  garmentOnly_21KB: await repeat(3, (i) => upload(`bwtest_g_${i}.jpg`, files.garment)),
  tiny_1KB: await repeat(5, (i) => upload(`bwtest_t_${i}.jpg`, randomBytes(1024))),
  single_5MB: await repeat(2, (i) => upload(`bwtest_5mb_${i}.jpg`, randomBytes(5 * 1024 * 1024))),
};

// 2. downloads of a real finished output
const hist = (await (await fetch(`${base}/history/${promptId}`, { headers: H })).json())[promptId];
const img = Object.values(hist.outputs).flatMap((o) => o.images ?? []).find((i) => i.type === 'output');
const url = `${base}/view?filename=${encodeURIComponent(img.filename)}&type=output&subfolder=${encodeURIComponent(img.subfolder ?? '')}`;
const full = [];
for (let i = 0; i < 3; i++) {
  const t = performance.now();
  const res = await fetch(url, { headers: H });
  const headersAt = ms(t);
  const buf = new Uint8Array(await res.arrayBuffer());
  full.push({ headersMs: headersAt, totalMs: ms(t), bytes: buf.length });
}
const size = full[0].bytes;
const ranged = async (parts) => {
  const t = performance.now();
  const step = Math.ceil(size / parts);
  const rs = await Promise.all(Array.from({ length: parts }, async (_, p) => {
    const a = p * step, b = Math.min(size - 1, a + step - 1);
    const r = await fetch(url, { headers: { ...H, Range: `bytes=${a}-${b}` } });
    return { status: r.status, n: (await r.arrayBuffer()).byteLength };
  }));
  return { ms: ms(t), statuses: [...new Set(rs.map((r) => r.status))], bytes: rs.reduce((s, r) => s + r.n, 0) };
};
out.download = {
  fileBytes: size,
  full_asDispatcher: full,
  range4: await repeat(3, () => ranged(4)),
  range2: await repeat(3, () => ranged(2)),
};
{
  const t = performance.now();
  const r = await fetch(`${url}&preview=${encodeURIComponent('webp;90')}`, { headers: H });
  const b = await r.arrayBuffer();
  out.download.previewWebp90 = { status: r.status, bytes: b.byteLength, ms: ms(t), type: r.headers.get('content-type') };
}

// 3. protocol comparison with curl (HTTP/1.1 is what node's fetch uses)
try {
  const dir = mkdtempSync(join(tmpdir(), 'xfer-'));
  const f5 = join(dir, 'five.bin');
  writeFileSync(f5, randomBytes(5 * 1024 * 1024));
  const curl = (args) => execFileSync('curl', ['-s', '-o', process.platform === 'win32' ? 'NUL' : '/dev/null', '-H', `X-Api-Key: ${key}`, '-w', '%{http_version} ttfb=%{time_starttransfer} total=%{time_total} speed=%{speed_download}', ...args], { encoding: 'utf8' });
  out.curl = {};
  for (const v of ['--http1.1', '--http2']) {
    out.curl[v] = {
      download: await repeat(3, () => curl([v, url])),
      upload5MB: await repeat(2, () => curl([v, '-F', 'image=@' + f5 + ';filename=bwtest_curl.jpg', '-F', 'overwrite=true', `${base}/upload/image`])),
    };
  }
} catch (e) { out.curl = { error: 'curl failed (args withheld)' }; }

console.log(JSON.stringify(out, null, 1));
process.exit(0);
