# TEMPORARY handoff — WhatsApp catalog bot (updated 2026-10-16)

> Temporary. Exists only so the work can be resumed on another machine. Delete this
> file once the branch is picked up again (the durable record is `docs/progress.md`,
> the spec and the plans). Contains no secrets.

## Where everything is

- **Branch:** `feat/whatsapp-catalog-bot` — the single branch carrying all of it (plans
  1–4, the pose-selection change, spec and plans). The per-plan local branches were
  merged into it and deleted on 2026-10-14; nothing is lost without them.
- **Specs:** `docs/superpowers/specs/2026-10-12-whatsapp-catalog-bot-design.md` (main) and
  `docs/superpowers/specs/2026-10-14-whatsapp-pose-selection-design.md` (amends D43/D44/D45).
- **Plans:** `docs/superpowers/plans/2026-10-13-whatsapp-bot-{1..5}-*.md` and
  `docs/superpowers/plans/2026-10-14-whatsapp-pose-selection.md`.
- **Latest status:** the top WhatsApp entries in `docs/progress.md`.

## Done (local verification only — nothing deployed)

| Plan | State | Migration |
|---|---|---|
| 1 Connect and identity | implemented | `0224_wakeful_ink` (`messaging_accounts`) |
| 2 Conversation engine | implemented | `0225_youthful_stingray` (`messaging_runs`) |
| 3 WhatsApp adapter (webhook, renderer, inbound, delivery, hooks) | implemented up to Task 8's code; Task 8 manual staging steps NOT done | `0226_quick_pestilence` (two ADD COLUMNs) |
| 4 Amazon white-background removal | implemented, merged into the branch | — |
| Pose selection across templates (2026-10-14) | implemented (engine, tests, docs); **not yet tapped through on a real phone** | — |
| 5 Garment recognition on our GPU | implemented (Tasks 2, 3, 4, 4b, 6) and merged into the branch; spike run on w4; **Task 5 (staging/production switch-on) not done**; works locally but misses its time budget on cold or busy workers | `0227_bizarre_namora` (`garment_recognitions`) |

Last measured on this branch (2026-10-14): api typecheck clean; api unit 102 files / 934
passed (run with `--no-file-parallelism`, see below); messaging + whatsapp integration
7 files / 43 passed.

**Test-run gotcha:** parallel vitest runs share one Postgres template database
(`tryon_test_template`) and fail at random ("does not exist" / "being accessed by other
users"). Never run two vitest processes at once; for the full api suite use
`npx vitest run --no-file-parallelism`.

Migration numbers: `origin/main` and `origin/dev` ended at `0223` when this was
pushed. If either gains a `0224+` before this merges, renumber ours
(`docs/version-control.md`).

## What the bot does now (the flow changed on 2026-10-14)

photo → gender → garment type (recognised by Qwen on our GPU when `GARMENT_RECOGNITION_ENABLED=true`: "Looks like X. Is that right?" [Yes] [No, change]; any miss shows the list) → required extra
photos → **pose cards** → Generate. There is no "how many poses" step. The seller sees the
poses of every active template for the garment type (10 cards per page, [More]), taps to
select or un-select (max 20), every tap answers "N selected · X credits" with [Generate]
[Clear]. A pick spanning templates starts one run per template (all groups quoted before
the first charge). Every run is **3:4 at 2K** (falls back to the cheapest enabled tier if
2K is off); the engine re-reads that on every message because a saved session otherwise
kept the old shape for up to 24 h (found 2026-10-14: a chat still on 1:1).

## Meta spike results (plan 3 Task 1) — already applied in code

- Carousel cards **require** a card-level `"type"`; `"cta_url"` is accepted with
  quick-reply buttons. Without it: HTTP 400 "missing: 'type'".
- A carousel tap arrives as `type: "button"`, `button.payload = <reply id>` (not
  `interactive.quick_reply`). The parser treats a `button` payload that decodes as a
  reply id as a reply, else as a template button.
- Production presigned MinIO links load in carousels (T3 = yes).
- Upload-then-send-by-media-id works. Images over **5 MB** fail with `(#100) Invalid
  parameter` ("File too large"); `channels/whatsapp/media.ts` re-encodes them.
- Payloads now also carry `from_user_id` / `contacts[].user_id` beside `wa_id`.
  Future identity risk if Meta stops sending `wa_id` for username-only users.
- Meta's dashboard "Check test webhooks" panel (Use cases → Connect on WhatsApp →
  Step 1. Try it out) shows inbound payloads for the test number without any
  callback URL — easiest way to inspect tap shapes.

## Departures from the plans worth knowing in review

- Webhook: bad / missing signature → **401** (plan said 200-ack); HMAC is checked on the
  raw body before parsing, tests prove it.
- Delivery uses `headObject().contentType` (results may be webp).
- One commit's author is `opencode` (agent tooling) rather than the git user.
- Plan 2 spec loose end fixed in plan 3: delivery state lives in `messaging_runs`, not
  `job_inputs.params.channel`.

## Local end-to-end setup (works as of 2026-10-14)

- **Fixed public URLs** (named Cloudflare tunnel `aivastra-wa-dev`; do not touch the
  other tunnel in that account, `comfyui-w8`): `wa-dev-api.aivastra.com` → api `:4000`
  (Meta callback `https://wa-dev-api.aivastra.com/v1/whatsapp/webhook`),
  `wa-dev-minio.aivastra.com` → MinIO `:9000` with `httpHostHeader 127.0.0.1:9000` so
  presigned signatures stay valid. One-time `make whatsapp-tunnel-setup`, then
  `make whatsapp-tunnel` each session (script `scripts/local-sync/whatsapp-dev-tunnel.ps1`).
  `.env`: `R2_PUBLIC_PRESIGN_BASE=https://wa-dev-minio.aivastra.com`; put it back to
  `http://127.0.0.1:9000` when not testing.
- **Cloudflare (zone `aivastra.com`, state outside the repo):** Hotlink Protection
  (error 1011) blocked image paths on `wa-dev-minio` when the Referer was another host
  (the studio, Meta). Fixed with a custom rule `wa-dev-minio: skip hotlink`
  (`http.host eq "wa-dev-minio.aivastra.com"`) that must sit **above** the existing
  "options skip" rule, which skips the remaining custom rules for OPTIONS/PUT.
- **Web studio CSP** (`apps/catalogues-web/src/lib/csp.ts`) allows the tunnel host in dev
  only, so studio images load while the tunnel is the presign base.
- **Meta:** the app must be subscribed to the WABA (`POST /{waba-id}/subscribed_apps`;
  test WABA `1595318551521211`) — saving the callback URL is not enough. Temporary
  tokens last ~1–2 h (a send failing with 401 = expired); a System User token is the fix.
- **Local data:** the six local garment-type slugs were aligned to production's
  (`full-sleeve-shirt-men`, …). Types with active templates locally: men
  `full-sleeve-shirt-men`, women `full-sleeve-shirt-women` and `half-sleeve-shirt`, two
  templates each.
- A workflow that has a footwear node but no `shoe_node_id` fails the job
  (`two_piece_full_pose_10_09_2026`, job `f6714104`): set the shoe node to `1280` in admin
  and set a default shoe on the garment type.

First local run (2026-10-14) delivered one image plus the closing message and refunded
the failed one. Fixed during it, each with a test that failed first: log redaction of
token-like query params, blank `WHATSAPP_GRAPH_VERSION`, template-editor `thumbnailUrl`
and pose-label clashes, resolution fallback, single-look pick as one image-header message,
the `reportUnavailable` log ("whatsapp: garment type not offered" with
`no_face`/`no_template`/`no_eligible_looks`), the 5 MB image fit.

## Plan 5: garment recognition (2026-10-15)

- **Model/path:** Qwen2.5-VL-7B (4-bit, `keep_model_loaded`) through the `AILab_QwenVL` ComfyUI node;
  api `classify.ts` → `classify:requests` stream → dispatcher classify lane → `classify:result:{id}`.
  Not a job: no credits, no `jobs` row. Every request leaves a `garment_recognitions` row
  (D54), shown in admin → Garment recognitions, deleted after 30 days.
- **Spike (w4, 21 men's photos):** Qwen 15/21, CLIP B/32 12/21, CLIP L/14 10/21. Misses are the
  confusable types (tanktop/vest, trouser/formal/track, jeans/baggyjeans, one-piece suit). Kit:
  `%LOCALAPPDATA%\Temp\opencode\whatsapp-plan5-spike\`. `max_tokens` minimum is 64.
- **Decisions changed since the plan:** the confirm step ("Looks like X?") replaced "Detected: X";
  `classify` is an **ordinary worker pool** (D52 revised: an empty allowed list includes it; list only
  `classify` to dedicate a worker); the api waits **12 s** (was 8 s, D48/D50/D53).
- **Local test (2026-10-15):** 6 recognitions on w4/w7, all correct. Times: 31.8 s and 40.3 s cold,
  6.6/7.0/8.8 s warm, 17.1 s on a half-loaded model, one `no_worker` while the dispatcher marked
  workers unhealthy just after a restart. ComfyUI's history showed 11.5 s of GPU execution for the
  17.1 s run; network is about 0.37 s per round trip, so the time is GPU/model state, not network.
  w4 also runs real try-on jobs, which probably unload the model. Not proven.
- **Local setup gotchas:** `GARMENT_RECOGNITION_ENABLED=true` in `.env` (it was found blank, then
  reverted once; cause unknown); apply migration `0227` locally; upload the classify workflow in admin
  → Workflows ("Garment recognition (WhatsApp)", API-format JSON); restart api and dispatcher. Worker
  URLs with a trailing slash 404 if probed by hand (`//system_stats`); the dispatcher strips it.
- **Not done:** Task 5 on staging/production; the idle-unload measurement (Step 1b); a dedicated
  `classify` worker; the SSH install of the node on the extra GPU box (connection refused on the
  given port, nothing installed).

## Always-resident recognition service + admin page (2026-10-16, uncommitted)

- **Service:** `aivastra-gpu/pipeline/classify-service/` on gpu8 (`ubuntu@50.35.188.73 -p 32152`,
  key `~/.ssh/aivastra_gpu_dev`), systemd `classify` (127.0.0.1:8400) + `classify-tunnel`
  → `https://gpu8-classify.aivastra.com`. Qwen2.5-VL-7B bf16, always loaded: 108–302 ms per
  request (ComfyUI path was 6–40 s). Men's 23-image check: 17/23; misses are the confusable
  pairs (tank top/vest, jeans/baggy, trouser/formal, one/two piece suit, shirt/t-shirt).
  Details and open items: `docs/progress.md` 2026-10-16.
- **Admin:** sidebar "Classify Service" (`/classify-service`: Overview with a Connection form,
  Requests, Logs). URL + key are saved in the new table `classify_service_config` (migration
  `0228_dashing_yellowjacket`, local only so far); the dispatcher re-reads it every ~10 s, env
  vars are the fallback. Nothing from 2026-10-16 is committed (both repos).
- **Decided:** no extra logging of rejected keys; the online/offline health badge is enough.

### Pending decision (user confirms 2026-10-17): WhatsApp page + chat transcripts

Idea: rename the page to **WhatsApp** (`/whatsapp`) with sub-views **Conversations** and
**Recognition** (today's Overview / Requests / Logs move under Recognition; old
`/classify-service` URLs redirect), so admins can read chats and see how the bot behaves.

Blocker found: **the bot stores no conversation history.** Only `messaging_accounts`,
`messaging_runs`, `garment_recognitions` (30 d) and a Redis session (24 h, current step only).
Meta's API cannot return old messages. A Conversations view needs a new store.

| Option | Cost |
|---|---|
| **A (recommended)** new `messaging_messages` table: direction, type, text/button id, media key, bot state before/after, timestamps; sweeper deletes after 30 days (like recognitions); writes in `inbound.ts` / `send.ts`, best-effort so a failed write never blocks a reply | 1 migration + writes + sweeper + admin view; message text kept 30 d and visible to staff |
| B Redis log, last ~200 messages per number, 48–72 h TTL | no schema; lost on flush; too short to debug |
| C no transcript, rebuild from runs + recognitions + session | no message text, cannot show mid-chat behaviour |

Two things need the user's yes before any code: (1) storing message text for 30 days and showing
it to admins; (2) a consent-copy line in `engine/copy.ts` and the connect page, because the
approved 2026-10-13 wording covers number + photos only (suggested: "we keep your chat
messages for 30 days to help with support and improve the bot"). Also decide the permission
for the Conversations view (reuse `jobs.read` or add a new one).

## Open

- Real-phone check of the pose-selection flow, including WhatsApp accepting the
  [More]+[Generate]+[Clear] button message (three buttons, the maximum) on a type with
  more than 10 poses.
- Production has no active catalogue templates, so the bot cannot offer any type there
  until admin activates some.
- The paid "images are ready" template is sent per run when the 24 h window is closed (a
  `batch_id` on `messaging_runs` would fix it).
- A retry matches failed images by pose id, so a pose shared by two templates with
  different backgrounds is retried in both.
- Pick cards show the raw pose label (template uploads are named after the file); consider
  `displayName`.
- Admin copy in the pose "Map to garment types" dialog still says poses show on every
  garment type by default (stale since #523's opt-in change).
- `make sync-prod-snapshot` needs the operator to set up the `DEV_SNAPSHOT_*` variables.
- Admin workflow-save check for unmapped LoadImage nodes (not requested yet).

## Next, in order

1. **Manual, Meta side:** submit the `catalog_images_ready` template (Utility, `en`, body
   "Your Aivastra catalog images are ready.", one quick-reply button "Show images") and
   record its approval. Consider a System User token.
2. Real-phone walk-through of the new flow (see Open), including the recognition confirm step.
3. Review / PR `feat/whatsapp-catalog-bot` → `dev`; migrations ride CI/CD.
4. Staging env on the VPS: `MESSAGING_WHATSAPP_ENABLED=true`, `WHATSAPP_DISPLAY_NUMBER`,
   `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`,
   `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_RESULTS_TEMPLATE` (`WHATSAPP_GRAPH_VERSION` has a
   default). Extend `scripts/staging/check-staging-env.sh` if needed. Secrets only on the
   VPS — never in chat or the repo.
5. Point the Meta callback URL at staging (`/v1/whatsapp/webhook`), subscribe `messages`,
   **and `POST /{waba-id}/subscribed_apps`**, then run plan 3 Task 8 Step 6's walkthrough;
   record results in `docs/progress.md`.
6. Not yet browser-checked: plan 1's Settings panel and studio chip. (The connect page
   worked in the 2026-10-13 local run.)
7. Plan 5 Task 5: dedicate a worker (`classify` only) or accept shared workers, measure the idle
   unload time, and decide between a keep-warm ping, a longer budget, or an own always-loaded VLM
   service on a separate box (tradeoff discussed 2026-10-15; the recommendation was the dedicated
   worker first). Optionally merge the confusable garment types or add per-type prompt hints.
8. Before production: production number + display-name approval, system-user permanent
   token, business verification of Nice Interactive.

## How the plans were executed

Each plan ran in a separate OpenCode session in subagent-driven mode: a fresh subagent per
task, two-stage review (spec, then code quality with an independent test re-run),
fail-then-pass TDD, one commit per task, no push. A Claude Code session wrote the
spec/plans, checked each plan's result against the spec, and ran the Meta spike.
