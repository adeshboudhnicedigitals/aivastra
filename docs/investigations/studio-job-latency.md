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

### 6. Smaller output, lossless only (option D)

Quality comes first, so only lossless re-encodes were tried, on three real outputs (3.7–5.4 MB PNG),
with decoded pixels compared byte for byte against the original. Encode times are from a 16-core
laptop with sharp 0.33; the GPU box's CPU was not measured.

| Re-encode (pixels identical) | Size vs ComfyUI PNG | Encode time | Transfer saved at 1.65 MB/s |
|---|---|---|---|
| PNG, sharp default levels 4–9 | 32–39% **larger** | 0.3–1.4s | none, it is worse |
| PNG, level 9 with adaptive filtering | 13% smaller | 5.7–17s | about 0.4s |
| WebP lossless, effort 4 | 31–34% smaller | 2.4–7.4s | 0.7–1.1s |

ComfyUI's own PNGs are already smaller than anything sharp's PNG encoder produces, so there is no
free PNG recompression. Lossless WebP is the only real saving (about a third), and its encode time
is two to seven times what it saves. Two measurement notes: sharp's PNG `effort` option silently
turns on a 256-colour palette, which is lossy, so the first set of PNG numbers (55–66% smaller) was
invalid and was discarded after the pixel check failed. The only large saving found is lossy WebP
(134 KB at quality 90), which is ruled out by the quality requirement.

`finalizeOutput` (`apps/dispatcher/src/workflow/finalize.ts`) already re-encodes to lossless or
lossy WebP for storage, so the stored format is unaffected either way.

### 7. Submit-prompt stage: ComfyUI validation, theory not yet proven (2026-10-29)

The "submit prompt" stage (2.0-2.5s) is almost entirely `POST /prompt`, not the dispatcher.
Job `c5caac33`: `prompt_submission` 2154 ms = Postgres intent commit 23 ms + `POST /prompt`
2.12 s + receipt update ~12 ms.

Direct timing against w3 (idle, 5 runs each, from the laptop; nothing was queued):

| Request | Time |
|---|---|
| `GET /system_stats` | ~0.31s |
| `POST /prompt`, empty prompt (instant 400) | ~0.30s |
| `POST /prompt`, the real 58-node, 16.7 KB prompt with missing input images (400 at validation) | 2.03-2.13s |

So the network and payload cost ~0.3s and ComfyUI spends ~1.75s validating the prompt before
the run starts.

**Theory (unproven).** `/home/aivastra/com/input` on GPU3 holds 30,461 files (48 GB), 29,859
of them over a day old; `output` holds 8,573 (45 GB). Nothing cleans them up and the disk is
89% full. ComfyUI's `LoadImage` lists and `stat`s the whole input folder (`nodes.py:1742`)
each time it builds its inputs, and the prompt has 6 `LoadImage` nodes. A scan of that folder
takes 130-190 ms on the box, so 6 scans is about 0.8-1.1s, and validation may scan more than
once per node. That is the right size for the 1.75s but was not measured end to end.

**What would prove it.** Move (not delete) the old input files to a side folder on GPU3 and
rerun the rejected-POST timing (`postprobe`-style, same payload). If the theory holds, the POST
drops toward 0.3-0.5s. If it stays near 2s, validation cost is elsewhere (custom node
`VALIDATE_INPUTS`, model-list scans) and this theory is wrong.

**If it holds:** about 1.5s saved per job with no dispatcher change, via a cleanup job on each
GPU box (`aivastra-gpu` repo), such as a cron removing input files older than a day. Keep any
static inputs that option B would reuse out of the cleanup. Other boxes likely share the
problem and it grows with every job.

### 8. Production queueing (read-only, 2026-10-29)

Aggregate query on `tryon_prod` (30 days, created_at to first `COMFY_DISPATCH`): 9,238 jobs
(about 372/day); 47% waited over 15s, 21% over 30s; p50 14.6s, p90 108s, p99 575s. Busiest
hours 278-312 jobs. Only 3 active workers. The fleet saturates at peak, so every second a
job holds a worker (upload, submit, poll lag, download, finalize: about 8-10s of roughly
100-110s total) is lost worker capacity, not just user latency. Caveats: the wait includes
about 3s of dispatcher setup, bulk catalog batches probably dominate the tail, and the
figures were not split by job source.

## Options

The websocket and the upload cache are independent and can ship separately.

| Option | Saves | Developers | Users |
|---|---|---|---|
| A. Websocket completion signal, `/history` kept as fallback | about 2s | Moderate: `comfyui/progress.ts` needs a socket client, reconnect, silence timeout and cancel handling; polling stays so reliability is unchanged | About 2s faster per job |
| B. Skip re-uploading static inputs (stable name per asset hash, upload only if the worker lacks it) | about 1–2.5s | Moderate: per-worker knowledge of what is present, a changed asset needs a new name, worker input folders can be cleaned or a worker replaced | About 1–2.5s faster, less MinIO read |
| C. Fewer or overlapped requests (start the upload while the worker is being selected, send the prompt without waiting for the upload to settle where safe) | up to about 1s | Higher: ordering invariants around ownership and submission | Small |
| D. Smaller output over the wire, lossless only (re-encode on the GPU box) | nothing: the encode costs more than the transfer saves (section 6) | Changes the GPU repo (`aivastra-gpu`) and the finalize step | Slower, not faster |
| E. Faster tunnel / different transport | not shown | Large; HTTP/2 and parallel ranges gave nothing | None demonstrated |
| G. Worker talks to storage directly (presigned pull and push through a custom node or sidecar). Called C in a separate review | Estimate from that review: about 4s or more. Not measured here. Overlaps B for inputs | Largest: 7 boxes and the workflow change in `aivastra-gpu`, w3 must reach storage, presigned URL expiry and size limits | Biggest latency win if the path from w3 to storage is faster than the path through the dispatcher; not shown |
| H. Release the worker before download and finalize. Called D in that review | Estimate: about 3s of throughput per queued job, nothing for a single idle job. Not measured here | Small, dispatcher only; worker accounting and failure paths need care | Only helps when jobs queue behind each other |
| F. RPC protocol to workers | not shown | Large; the cost is the per-request hop and w3's stall, not framing | None demonstrated |

Recommendation: A and B first (about 3.3–4s of the 8–10s). D is the only download lever the VPS test
leaves open, because the limit is w3's outbound bandwidth: next, measure that bandwidth on GPU3 and
the size of a lossless WebP for a real output before deciding.

### Assessment of G and H against the measurements

- **G does not shorten the output path.** The limit is the 248 ms distance between GPU3 and the VPS,
  not Cloudflare or the box. A push from w3 to storage on the VPS sends from GPU3 over that same path
  in the same direction as today's download, so it would run at the same 1.4–2 MB/s. G would only help
  if storage sat close to GPU3, which moves the problem to the dispatcher and the user's fetch.
- **G's input side is mostly B.** Once static inputs stop being re-sent, the remaining input bytes
  are the 21 KB garment, so G adds almost nothing there. Its "4s or more" counts the 1.4s that B
  already gets plus the 2.3–3.2s download, and the download part is the unproven one.
- **G keeps quality and removes the dispatcher from the byte path.** `finalizeOutput` would read
  the original from storage on the same host instead of from w3.
- **H matches the code's shape.** The worker stays busy from selection to finish, so the GPU sits
  idle during the download and finalize (about 2.7–3.1s). It does not shorten a single job.
- **H needs a failure check.** Today a failed download retries only the download. After an early
  release the output must still be on w3's disk when the retry runs, and the next job's traffic
  competes with it.

### Where the download limit comes from (measured 2026-10-29, w3 idle)

GPU3 checks, same 3.89 MB output:

| Path | Result |
|---|---|
| ComfyUI direct on the box (`127.0.0.1:8339`) | 5 ms, about 700 MB/s |
| nginx on the box | 26 ms, about 145 MB/s |
| The box's own public hostname (through Cloudflare) | 0.12–0.15s, 25–32 MB/s |
| Box to Cloudflare, 8 MB upload | 22–32 MB/s |
| Cloudflare to box, 10 MB download | 14–58 MB/s |

From the production VPS:

| Path | Result |
|---|---|
| Ping VPS to GPU3 | **248 ms** round trip, 0% loss |
| Download through Cloudflare | 2.31–2.36s, about 1.65 MB/s (response starts after 0.56–0.84s) |
| Download straight to the origin, no Cloudflare | 2.73s, 2.78s, 4.91s, about 1.4 MB/s (0.25s to connect, response starts after 1.0s) |
| Small request straight to the origin | 0.75–0.80s (connect 0.25s plus TLS plus response) |
| Straight to the origin with 1, 2, 4, 8 parallel streams | 2.8s, 2.5s, 2.35s, 2.1s |
| Through Cloudflare with 1, 4, 8 streams | 2.36s, 2.68s, 2.12s |

Conclusions:
- **The box, its software and its line are not the limit.** w3 serves itself and Cloudflare at
  25 MB/s or more.
- **Cloudflare is not the limit and does not slow it.** Going straight to the origin is slower
  (about 1.4 MB/s, and every new connection pays about 0.75s of handshake), so a different tunnel
  or a direct path would not help.
- **Distance is the limit.** The VPS and GPU3 are 248 ms apart. One TCP stream over that path moves
  about 1.4–2 MB/s, and eight parallel streams only reach about 3.5 MB/s. About 1s of each download
  is waiting for the response to start; the rest is moving bytes.
- **GPU3 sends with `cubic`** (`bbr` is not in its available list; `reno cubic` only), the `pfifo_fast`
  queue and a 4 MB send-buffer ceiling.

### BBR on GPU3 (tested, no gain)

GPU3 was switched to `bbr` + `fq` (confirmed with `sysctl`), then the VPS download was rerun against
the same 3.9 MB output:

| Path | cubic (before) | bbr (after) |
|---|---|---|
| Cloudflare, 1 stream | 2.31-2.36s | 2.25-2.96s (about 1.3-1.7 MB/s) |
| Direct to origin, 1 stream | 2.73-2.78s (4.91s once) | 2.78-2.85s (about 1.4 MB/s) |
| Direct, 8 streams | 2.1s | 2.07-2.15s |

The 248 ms RTT is unchanged. Congestion control is not the limit, so the ceiling is the path and
only sending fewer bytes or moving them closer will help. Revert (runtime only) with
`sudo sysctl -w net.ipv4.tcp_congestion_control=cubic net.core.default_qdisc=pfifo_fast`.

## Open questions

- ComfyUI generation time for the same workflow varied from 47s to 150s across today's jobs
  (46.7s, 61.5s, 80.1s, 93.2s, 150.5s), more than all the transfer stages combined. Cause not
  established; w3 was seen busy with a job from outside the local stack.

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
