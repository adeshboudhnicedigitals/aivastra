# TEMPORARY handoff — WhatsApp catalog bot (2026-10-13)

> Temporary. Exists only so the work can be resumed on another machine. Delete this
> file once the branch is picked up again (the durable record is `docs/progress.md`,
> the spec and the plans). Contains no secrets.

## Where everything is

- **Branch:** `feat/whatsapp-catalog-bot` — the single branch carrying all of it, a
  straight line on top of `docs/whatsapp-catalog-bot-design` (spec + 5 plans).
  The per-plan local branches (`feat/whatsapp-bot-1-…`, `-2-…`, `-3-…`) are its
  ancestors and were not pushed; nothing is lost without them.
- **Spec:** `docs/superpowers/specs/2026-10-12-whatsapp-catalog-bot-design.md`
- **Plans:** `docs/superpowers/plans/2026-10-13-whatsapp-bot-{1..5}-*.md`
- **Latest status:** the top WhatsApp entries in `docs/progress.md`.

## Done (local verification only — nothing deployed)

| Plan | State | Migration |
|---|---|---|
| 1 Connect and identity | implemented | `0224_wakeful_ink` (`messaging_accounts`) |
| 2 Conversation engine (five-step flow, recognition client) | implemented | `0225_youthful_stingray` (`messaging_runs`) |
| 3 WhatsApp adapter (webhook, renderer, inbound, delivery, hooks) | implemented up to Task 8's code; Task 8 manual staging steps NOT done | `0226_quick_pestilence` (two ADD COLUMNs) |
| 4 Amazon white-background removal | **not started** (independent of the others) | — |
| 5 Garment recognition on our GPU | **not started**; Task 1 is a manual GPU spike that gates the rest | — |

Last measured on this branch: api typecheck clean; api unit 99 files / 910 passed;
api integration 168 files / 1271 passed. Lint: only the pre-existing
`noNonNullAssertion` diagnostics in untouched `admin/*`.

Migration numbers: `origin/main` and `origin/dev` ended at `0223` when this was
pushed. If either gains a `0224+` before this merges, renumber ours
(`docs/version-control.md`).

## Meta spike results (plan 3 Task 1) — already applied in code

- Carousel cards **require** a card-level `"type"`; `"cta_url"` is accepted with
  quick-reply buttons. Without it: HTTP 400 "missing: 'type'".
- A carousel tap arrives as `type: "button"`, `button.payload = <reply id>` (not
  `interactive.quick_reply`). The parser treats a `button` payload that decodes as a
  reply id as a reply, else as a template button.
- Production presigned MinIO links load in carousels (T3 = yes).
- Upload-then-send-by-media-id works.
- Payloads now also carry `from_user_id` / `contacts[].user_id` beside `wa_id`.
  Future identity risk if Meta stops sending `wa_id` for username-only users.
- Local dev: carousel images need a public URL — plan is a `cloudflared tunnel --url`
  in front of local MinIO with `R2_PUBLIC_PRESIGN_BASE` pointed at it.
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

## Local end-to-end test (2026-10-13/14) — where it stopped

Local stack ran against the Meta test number with two `cloudflared` quick tunnels
(api `:4000` for the webhook, MinIO `:9000` with `--http-host-header 127.0.0.1:9000` so
presigned signatures still match; `R2_PUBLIC_PRESIGN_BASE` pointed at it). Quick-tunnel
URLs change on every restart — update Meta's callback URL and `.env` each time, and put
`R2_PUBLIC_PRESIGN_BASE` back to `http://127.0.0.1:9000` when done.

Reached: inbound webhook → stream → consumer → connect link → account linked → photo →
gender → garment type → pose count → the 1-look pick message. **Stopped right before the
"Select" tap**, so no job has been created or delivered locally yet.

What it took (none of this was in the plans):

- **Meta: the app must be subscribed to the WABA.** Saving the callback URL in the
  dashboard is not enough — only Meta's internal "WA DevX Webhook Events 1P App" was
  subscribed, so nothing was delivered. Fixed with `POST /{waba-id}/subscribed_apps`
  (test WABA `1595318551521211`). Staging/production need the same call.
- **Meta: the developer account was blocked** ("unusual activity") mid-session; after
  confirming it, the existing token could read but every send failed `#131005 Access
  denied`. A freshly generated token fixed it. Temporary tokens last ~1–2 h here.
- **Admin data the bot needs** (local DB was near-empty): a catalogue template for the
  gender, mapped to the garment type, with a workflow per pose; and if that workflow has a
  lower node, the garment type needs `default_lower_catalog_id` (D49 hides the look
  otherwise and the bot says the type "isn't available on WhatsApp yet").

Fixed on this branch during the session (each with a test that failed first):

- Request logs no longer carry `hub.verify_token` or other token-like query values
  (`@aivastra/logger` req serializer + `redactUrl`, also in the api error handler).
- Blank `WHATSAPP_GRAPH_VERSION=` (as `.env.example` ships it) no longer aborts startup.
- Catalogue-template editor: pose/background create responses now carry `thumbnailUrl`
  (tiles stayed blank after a successful upload — production has the same bug), and a
  template-scoped pose whose label is taken gets `-2`, `-3` … instead of a 409.
- Bot resolution: falls back to the cheapest enabled tier when the seller's default is
  disabled (HD is off by default; users default to HD).

Open from the session:

- **1-look pick UX:** with a single look the renderer sends an image and a separate
  button message; WhatsApp delivered the button message first. Proposed: one interactive
  button message with an image header. Not done.
- Pick cards show the raw pose label (template uploads are named after the file, e.g. a
  UUID); consider `displayName`.
- When no look survives the rules, the seller gets the generic "not available" text and
  nothing is logged with the reason — a log line would have saved an hour here.
- Admin copy in the pose "Map to garment types" dialog still says poses show on every
  garment type by default (stale since #523's opt-in change).

## Next, in order

1. **Manual, Meta side:** cancel the stray Facebook Login "Create a Configuration" wizard;
   submit the `catalog_images_ready` template (Utility, `en`, body "Your Aivastra catalog
   images are ready.", one quick-reply button "Show images") and record its approval.
   (Access token and verify token were both rotated 2026-10-13.)
2. Finish the local run: tap Select → job → dispatcher/worker → delivery back to WhatsApp.
3. Review / PR `feat/whatsapp-catalog-bot` → `dev`; migrations ride CI/CD.
4. Staging env on the VPS: `MESSAGING_WHATSAPP_ENABLED=true`, `WHATSAPP_DISPLAY_NUMBER`,
   `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`,
   `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_RESULTS_TEMPLATE` (`WHATSAPP_GRAPH_VERSION` has a
   default). Extend `scripts/staging/check-staging-env.sh` if needed. Secrets only on the
   VPS — never in chat or the repo.
5. Point the Meta callback URL at staging (`/v1/whatsapp/webhook`), subscribe `messages`,
   **and `POST /{waba-id}/subscribed_apps`** (see above), then run plan 3 Task 8 Step 6's
   walkthrough; record results in `docs/progress.md`.
6. Not yet browser-checked: plan 1's Settings panel and studio chip. (The connect page
   worked in the 2026-10-13 local run.)
7. Plan 4 (any time) and plan 5 (spike first) — same subagent-driven prompt pattern as
   plans 1–3, each on its own branch from `feat/whatsapp-catalog-bot`.
8. Before production: production number + display-name approval, system-user permanent
   token, business verification of Nice Interactive.

## How the plans were executed

Each plan ran in a separate OpenCode session in subagent-driven mode: a fresh subagent per
task, two-stage review (spec, then code quality with an independent test re-run),
fail-then-pass TDD, one commit per task, no push. A Claude Code session wrote the
spec/plans, checked each plan's result against the spec, and ran the Meta spike.
