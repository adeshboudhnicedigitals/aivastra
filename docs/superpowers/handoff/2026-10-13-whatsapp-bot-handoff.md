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

## Next, in order

1. **Manual, Meta side:** regenerate the temporary access token (one was pasted into a
   chat); cancel the stray Facebook Login "Create a Configuration" wizard; submit the
   `catalog_images_ready` template (Utility, `en`, body "Your Aivastra catalog images
   are ready.", one quick-reply button "Show images") and record its approval.
2. Review / PR `feat/whatsapp-catalog-bot` → `dev`; migrations ride CI/CD.
3. Staging env on the VPS: `MESSAGING_WHATSAPP_ENABLED=true`, `WHATSAPP_DISPLAY_NUMBER`,
   `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`,
   `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_RESULTS_TEMPLATE` (`WHATSAPP_GRAPH_VERSION` has a
   default). Extend `scripts/staging/check-staging-env.sh` if needed. Secrets only on the
   VPS — never in chat or the repo.
4. Point the Meta callback URL at staging (`/v1/whatsapp/webhook`), subscribe `messages`,
   and run plan 3 Task 8 Step 6's walkthrough; record results in `docs/progress.md`.
5. Not yet browser-checked: plan 1's connect page, Settings panel and studio chip.
6. Plan 4 (any time) and plan 5 (spike first) — same subagent-driven prompt pattern as
   plans 1–3, each on its own branch from `feat/whatsapp-catalog-bot`.
7. Before production: production number + display-name approval, system-user permanent
   token, business verification of Nice Interactive.

## How the plans were executed

Each plan ran in a separate OpenCode session in subagent-driven mode: a fresh subagent per
task, two-stage review (spec, then code quality with an independent test re-run),
fail-then-pass TDD, one commit per task, no push. A Claude Code session wrote the
spec/plans, checked each plan's result against the spec, and ran the Meta spike.
