# Studio job latency: session handoff (2026-10-29)

Read `studio-job-latency.md` first (findings, options A-H, measurements). This file is the
state of the investigation and what to do next. Branch: `feat/job-timing-trace` (not merged).

## Goal

Trace one Studio (catalogues-web) catalog job end to end and shave the ~8-10s of non-GPU time:
upload inputs (1.5-2.5s), submit prompt (2.0-2.5s), completion noticed late (~3s), download
(2.2-2.7s). Discussion and measurement only; the dispatcher has no behaviour change beyond
the timing trace.

## What exists in the repo

- Dispatcher stage timing (`job stage timing` logs + a `TIMING` row in `job_events`), admin
  jobs detail timing panel, `scripts/job-timeline.mts` (commit `c17d6ab6`).
- `scripts/xfer-bench.mjs` (upload/download benchmark), `scripts/ws-probe.mjs` (websocket vs
  `/history`), `scripts/post-prompt-probe.mjs` (rejected `POST /prompt` timing).
- `docs/investigations/studio-job-latency.md` with every measurement.

## Conclusions so far

| Item | Result |
|---|---|
| A. websocket instead of polling `/history` | Saves ~2s, measured (ws arrives +1.3s, `/history` +3.2s). Recommended as a hybrid with a `/history` fallback. First find out why CLAUDE.md calls polling "deliberate" (not found in `comfyui/progress.ts`). |
| B. skip re-uploading static assets | Saves ~1.4s (99.6% of the 4.8 MB per job is static). Quality-neutral. Not started. |
| Download (~2.3s) | Capped ~1.4-1.65 MB/s by the 248 ms dispatcher-host to GPU3 path. Not Cloudflare, HTTP/2, parallel ranges or BBR (tested, no gain). Faster tunnel, RPC and G (storage direct) will not help. |
| C/D lossless output re-encode | Loses (encode time exceeds the saving). |
| RPC | At most ~0.3-0.6s, needs custom software on GPU boxes. Dropped. |
| H. release worker before download/finalize | Frees ~2.5s of worker time per job. Production saturates (doc section 8), so it is worth having. Needs a `released` flag so the `finally` in `processTryonJob` does not double-release (`releaseWorker` can free a newly claimed BUSY worker). Run the overlap test first. |
| Submit stage (2.1s) | 2.12s is `POST /prompt` itself; ComfyUI validation takes ~1.75s. THEORY (unproven): GPU3's ComfyUI `input` folder has 30,461 files (48 GB) and `LoadImage` lists the folder once per node (6 nodes). |

## Next steps, in order

1. **Prove the input-folder theory on w3.** Move (do not delete) input files older than a day
   to a side folder on GPU3, rerun `scripts/post-prompt-probe.mjs` (needs `PROMPT_FILE`, a
   stored prompt: `select contract->'prompt' from execution_attempts where job_id = ...`).
   Expect ~2.05s to fall toward 0.3-0.5s. If it does not, validation cost is elsewhere.
   If it holds, add a cleanup cron per GPU box in the `aivastra-gpu` repo, and keep any
   static inputs that B would reuse out of it. GPU3's disk was 89% full.
2. Implement A (hybrid websocket) and B (static input reuse) after the user's go-ahead.
3. Overlap test for H on w3 (replay two stored prompts, download job 1's output while job 2
   generates), then implement H with the release flag.
4. Open questions: 47-150s generation spread for the same workflow; `/history` stalling ~2s
   after a run; upload bimodality (0.6s vs 3-4s); the `be786fbe` 383s anomaly; whether
   anything outside our stack was using w3.

## Access (kept out of the repo on purpose)

Hosts, SSH users, key locations and the GPU3 edge layout are not recorded here. GPU3's nginx
layout differs from `aivastra-gpu` `provision/edge/install.sh`; note the real layout in
`aivastra-gpu/boxes/gpu3.md`. Ask the user for the SSH details on the new machine. GPU3 had
no known sudo password. Production database access was read-only through the VPS.

State left on the boxes: GPU3 runs `bbr`+`fq` at runtime (revert: set
`net.ipv4.tcp_congestion_control=cubic` and `net.core.default_qdisc=pfifo_fast` with
`sysctl -w`). The local dispatcher was run with `NODE_ENV=production LOG_LEVEL=info`
(JSON logs) so the timeline script works; use normal dev logs otherwise.

## Pending user actions (not done by the assistant)

- The w3 API key was rotated after it leaked into a transcript. The local DB is updated;
  production and staging `workers` rows still need the new key, then restart the production
  dispatcher (production cannot route to w3 until then).
- On GPU3: delete the two nginx config backups made during rotation, clear shell history of
  the key, remove `bwtest_*` files from w3's ComfyUI `input` folder.
- Add the GPU3 layout note to `docs/progress.md`.

## CLAUDE.md rules that apply

Never print a credential value; no production writes (reads fine); do not commit or push
unless asked; GPU boxes run ComfyUI only; decisions get a developers-vs-users tradeoff table
with a recommendation.
