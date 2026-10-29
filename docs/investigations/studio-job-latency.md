# Studio job latency: where the non-GPU time goes

Measured 2026-10-29 on the local stack against worker w3 (gpu3), Studio (catalogues-web) jobs.
Tooling: per-stage timing in the dispatcher (`job stage timing` logs and a `TIMING` row in
`job_events`, shown on the admin job detail page), `scripts/job-timeline.mts`,
`scripts/xfer-bench.mjs`. Branch `feat/job-timing-trace`.

## Summary

A Studio job spends about 90% of its time in ComfyUI. The other 8–10s is four stages that do not
generate anything. This document records what each costs, why, and what could be changed.

| Stage | Typical | Cause (measured) |
|---|---|---|
| Upload inputs to ComfyUI | 1.8–3.1s | 4.83 MB per job, 99.6% of it static catalog assets re-sent every time |
| Submit the prompt | 2.2s (about 0.9s on the critical path) | one request over the Cloudflare to w3 hop, about 0.3–0.35s floor per request; ComfyUI starts running before the response returns |
| Noticing completion | 3.1–3.3s | w3 holds the `/history` reply about 2s right after finishing; the poll interval is not the cause |
| Download the output | 2.2–2.9s | w3's side of the path delivers about 1.65–2 MB/s (same from the production VPS), so a 3.9–5.3 MB PNG costs 2.3–3.2s |

Reference job `a540deb0` (88.63s): claim 0.11s, upload 1.82s, submit 2.17s, ComfyUI 80.05s,
completion noticed +3.08s, download 2.35s, finalize 0.35s.

## Findings

### 1. Completion is noticed late because of `/history`, not because of the 3s poll

The dispatcher polls `/history/{promptId}` every `POLL_INTERVAL_MS` (3000). A 200ms poller running
beside it received the entry at the same instant as the dispatcher (+3.237s vs +3.235s, and
+3.67s vs +3.64s on the earlier run). w3 answers `/history` slowly for about 2s right after a run
ends.

A websocket opened with the dispatcher's own `clientId` (`av:<jobId>:<attempt>:main`) receives
`execution_success` earlier. Times are after ComfyUI's own `execution_success` timestamp:

| Job | Websocket frame | `/history` response | Websocket earlier by | Dispatcher recorded |
|---|---|---|---|---|
| `6a759111` | +1.29s | +3.24s | 1.94s | 3.24s |
| `e918d9d0` | +1.28s | +3.33s | 2.05s | 3.26s |
| `266153d8` | +1.29s | +3.17s | 1.88s | 3.09s |

The websocket offset is tight (1.28–1.29s), so most of it is probably a fixed clock and network
offset. The 1.9–2.05s difference is measured on one clock and is not affected by skew. The `executed`
frame for the save node arrives with `execution_success`, so the output filename is available
without a `/history` call.

### 2. Upload re-sends static assets every job

Job `266153d8` uploaded 4.83 MB: pose 147 KB, face 30 KB, garment 21 KB, background 1.27 MB, shoe
1.63 MB, lower 1.73 MB. Only the garment is new each job.

| Test against w3 | Time |
|---|---|
| All 6 in parallel (as the dispatcher does) | 1.1s, 2.6s, 3.7s |
| All 6 one after another | 4.7s, 5.4s |
| Garment only (21 KB) | 0.27–0.66s |
| 1 KB file (per-request floor) | 0.27–0.35s |
| One 5 MB file | 0.59s, 0.66s, 0.80s, 3.2s, 3.9s, 4.7s |

Parallel upload is already the right design. Upload time is bimodal: the same 5 MB took 0.6–0.8s or
3–4s, and in one five-run test the fast and slow runs alternated. Cause unknown.

The stage `input_read_and_upload` also includes the MinIO/R2 reads of each input, so skipping a
static file avoids both the read and the upload.

### 3. Download is bandwidth-bound; protocol and parallelism did not help

| Test (3.89 MB PNG) | Time |
|---|---|
| Plain GET, as the dispatcher does | 2.2s, 2.8s, 2.9s (headers after 0.64–0.82s) |
| 4 parallel range requests | 2.2s, 2.2s, 2.7s |
| 2 parallel range requests | 2.2s, 2.5s, 2.6s |
| HTTP/2 vs HTTP/1.1 (16 MB window) | 2.4–3.7s vs 2.2–3.3s |
| `/view?preview=webp;90` | 134 KB, 2.0s (lossy, server-side encode cost cancels the gain) |

With the default flow-control window HTTP/2 was clearly slower (3.9–5.0s), which is a client
setting, not a protocol result.

The same test from the production VPS (section 5) gives the same speed, so the limit is not the
laptop's link.

### 4. Per-request latency to w3

`/system_stats` total time: about 0.35s from the laptop and from the production VPS, 0.085s from
GPU3 itself. The Cloudflare to w3 hop costs about 0.27s per request, so the laptop numbers are a
fair guide to production latency. Every extra call (lookup, view, upload) pays this before any data
moves.

### 5. VPS transfer test

Run from the production VPS (`srv1120341`) on 2026-10-29, w3 idle, same 3.89 MB output:

| Test | Production VPS | Laptop |
|---|---|---|
| `/system_stats` | 0.28–0.30s (one 0.52s) | 0.34–0.36s |
| Upload, all 6 in parallel | 1.70s, 1.70s, 1.73s | 1.1s, 2.6s, 3.7s |
| Upload, garment only (21 KB) | 0.28s, 0.28s, 0.28s | 0.27–0.66s |
| Upload, 1 KB | 0.27–0.28s | 0.27–0.35s |
| Upload, one 5 MB file | 1.1s, 1.6s | 0.6s–4.7s |
| Download, plain GET | 8.8s, 2.3s, 2.9s (headers 0.54–0.56s) | 2.2s, 2.8s, 2.9s |
| Download, 4 parallel ranges | 6.5s, 1.8s, 2.2s | 2.2s, 2.2s, 2.7s |
| Download, 2 parallel ranges | 2.0s, 2.1s, 2.1s | 2.2s, 2.5s, 2.6s |
| Download, curl HTTP/1.1 | 2.28–2.38s (1.63–1.71 MB/s) | not available |
| Download, curl HTTP/2 | 2.28–2.39s (1.63–1.70 MB/s) | not available |
| `preview=webp;90` | 134 KB, 1.8s | 134 KB, 2.0s |

What it shows:
- **Download is capped at about 1.65–1.7 MB/s from a datacenter too.** Neither more connections nor
  HTTP/2 changes it, and uploading to w3 runs faster than downloading from it. The limit is on w3's
  side (its outbound bandwidth or the tunnel path), so each MB of output costs about 0.6s.
- **The response starts after 0.54–0.57s**, about 0.25s more than a plain request, which is w3
  reading the file.
- **Occasional slow outliers happen** (an 8.8s plain download, a 6.5s ranged one), so a single
  download can be several seconds worse than the usual 2.3s.
- **Upload is steadier from the VPS** (1.70–1.73s for all six) and skipping the static files brings
  it to 0.28s, so the saving from option B is about 1.4s in production.
- **w3 was busy with a job that did not come from the local stack** when the test first ran, and
  went idle after about 90 seconds. That supports w3 being shared, which is one explanation for the
  118s queue wait in `be786fbe`.

## Options

The websocket and the upload cache are independent and can ship separately.

| Option | Saves | Developers | Users |
|---|---|---|---|
| A. Websocket completion signal, `/history` kept as fallback | about 2s | Moderate: `comfyui/progress.ts` needs a socket client, reconnect, silence timeout and cancel handling; polling stays so reliability is unchanged | About 2s faster per job |
| B. Skip re-uploading static inputs (stable name per asset hash, upload only if the worker lacks it) | about 1–2.5s | Moderate: per-worker knowledge of what is present, a changed asset needs a new name, worker input folders can be cleaned or a worker replaced | About 1–2.5s faster, less MinIO read |
| C. Fewer or overlapped requests (start the upload while the worker is being selected, send the prompt without waiting for the upload to settle where safe) | up to about 1s | Higher: ordering invariants around ownership and submission | Small |
| D. Smaller output over the wire (lossless WebP saved by the workflow) | about 0.6s per MB removed; needs a size test on real outputs | Changes the GPU repo (`aivastra-gpu`) and the finalize step | Faster download, same quality if lossless |
| E. Faster tunnel / different transport | not shown | Large; HTTP/2 and parallel ranges gave nothing | None demonstrated |
| F. RPC protocol to workers | not shown | Large; the cost is the per-request hop and w3's stall, not framing | None demonstrated |

Recommendation: A and B first (about 3.3–4s of the 8–10s). D is the only download lever the VPS test
leaves open, because the limit is w3's outbound bandwidth: next, measure that bandwidth on GPU3 and
the size of a lossless WebP for a real output before deciding.

## Open questions

- Why does the dispatcher poll instead of using the websocket? `docs/progress.md` and CLAUDE.md say
  it is deliberate; the reason was not found. Ask before building A.
- What is w3's outbound bandwidth (about 14 Mbit/s as measured through Cloudflare)? Is that the
  box's uplink or the tunnel path? A speed test on GPU3 would separate them.
- Why does w3 answer HTTP slowly for about 2s after a run ends? Unproven: the server loop is busy
  with execution start/finish work.
- Why is upload bimodal (0.6s vs 3–4s)?
- Job `be786fbe` took 383s: it waited about 118s in ComfyUI's queue, then logged
  `execution_interrupted` on node `MaskBoundingBox+` and was retried. Cause not established; it needs
  the gpu3 ComfyUI console log.
- Samples are small (three websocket runs, a few transfer runs per test), taken on one worker.

## How to reproduce

- Per-job timeline: `pnpm tsx --env-file=.env scripts/job-timeline.mts <jobId> [dispatcher.log]`
  (read-only; the dispatcher must log JSON, so `NODE_ENV=production`).
- Transfer test: `W3_URL=… W3_KEY=… PROMPT_ID=<finished prompt> node scripts/xfer-bench.mjs`. It
  uploads random bytes as `bwtest_*.jpg` into the worker's ComfyUI `input` folder (about 30 MB; remove
  with `rm input/bwtest_*` on the box) and refuses to run while the worker is busy. It never prints
  the key.
