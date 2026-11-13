# Analytics Phase 1: Events Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One append-only `analytics_events` table, fed by every in-store interaction the server
already sees plus a batch endpoint the tablet will use, rolled up into 15-minute buckets that
future CRM, cart and inventory metrics read from. First consumer: a peak-hours heatmap.

**Architecture:** Server-side events are written inside the same transaction as the source write
(session, item, sale, void). Try-on outcomes are not emitted at all: the rollup derives them from
`jobs`, so the dispatcher is not touched. A background loop in the api process recomputes only the
buckets that changed since its watermark. Existing `/v1/merchant/analytics/*` endpoints stay on
their source-table queries. A parity test proves the rollups agree with them before any switch.

**Tech Stack:** Fastify 5 + Drizzle (Postgres 16), Zod in `packages/types`, Vitest integration
harness (`apps/api/test/helpers/containers.ts`), Next.js 15 merchant-web for the heatmap.

**Spec:** `docs/superpowers/specs/2026-11-12-instore-crm-analytics-design.md` §7 (events), §9 (POS
and mobile readiness).

## Decisions this plan makes (confirm before executing)

The spec said events are "written alongside the source write" and the "current dashboard rebuilt on
rollups". Reading the code changed four things:

| # | Decision | Why |
|---|---|---|
| D1 | **Try-on outcomes come from `jobs`, not from dispatcher-emitted events.** The rollup reads `jobs.status / created_at / completed_at` for session-attributed jobs (`session_id is not null`) | Every terminal outcome goes through `settleComfyJob` (`apps/dispatcher/src/job/settlement.ts`), one transaction fencing status, refund and lease. An analytics insert there would sit in the money path of every paid job. `jobs` already holds the fact, so deriving it costs nothing and keeps the dispatcher untouched |
| D2 | **Existing summary/timeseries/breakdown endpoints are not switched in phase 1** | `queries.ts` encodes binding definitions: sales counted by session start, voids excluded, credits net of refunds via `credit_ledger`, ITEM_STAFF attribution. Rewriting them on rollups gains no data and risks silent number changes. Phase 1 adds a parity test. The switch is a later, separate change |
| D3 | **Rollup buckets are 15 minutes in UTC, not hours** | India is UTC+5:30. A UTC hour straddles two IST hours, so an hourly UTC rollup cannot produce an IST peak-hours chart. 15 minutes serves every real offset (+5:45 Nepal included) at 4× the rows, which is trivial at this volume |
| D4 | **No partitioning in phase 1** | 100 kiosks × ~200 events/day ≈ 7M rows/year: well within one indexed table. Drizzle cannot generate partitioned tables. Revisit past ~50M rows |

Also: the events table has **no foreign keys** (advisory, like `shopify_widget_events`), so the
insert inside a paid try-on transaction can fail only when the database itself is failing. In that
case the transaction was failing anyway.

## Global Constraints

- Nothing may change behaviour for existing customers. Additive schema only. Every existing
  endpoint returns exactly what it returns today (D2).
- **Events are advisory.** Never read `analytics_events` or `analytics_buckets` for a credit, limit,
  entitlement or authorization decision. Say so in a schema comment (CLAUDE.md invariant style).
- Dimensions (`merchant_id`, `branch_id`, `device_id`) on client events come **from the device
  token**, never from the request body. `session_id` from the body must belong to that device.
- Client-reportable event names are an allowlist. Server-only names (`session_started`, `sale_recorded`,
  …) sent by a client are rejected with 400, mirroring the forgeable/unforgeable split in
  `shopify_widget_events`.
- POS/mobile readiness (spec §9): client events carry a client UUID (dedupe on retry and offline
  upload) and device `occurred_at`. `channel` and event names are extendable text validated by Zod,
  not Postgres enums.
- Migrations: generate locally (`pnpm db:generate`), never against staging/prod. Next local index
  is `0264`. Renumber upward at merge per `docs/version-control.md` (the server's index is canonical).
- No `console.log`. Commit only when the user asks. Do not push. `apps/admin-mobile` out of scope.

## Review Focus

- A device posting events for another device's session, or another merchant's catalog item: rejected, nothing written.
- The same client event uploaded twice (retry, offline replay): one row.
- `occurred_at` in the future or months old: clamped or rejected per Task 4 rules, never trusted blindly.
- A late event (offline upload of yesterday's events) changes yesterday's buckets on the next tick.
- Sweeper-ended sessions get `session_ended` with `reason: 'idle'`, in the same transaction as `ended_at`.
- Paid try-on transaction: adding the event insert does not change charge, refund or entitlement behaviour (existing `device-tryon` / `merchant-tryon` suites still pass unchanged).
- Rollup tick under concurrency: two api replicas must not double-count (advisory lock).

## File Structure

| File | Responsibility |
|---|---|
| `packages/types/src/analytics-events.ts` (create), `index.ts` (modify) | event catalogue, client allowlist, batch body, heatmap query/response |
| `packages/db/src/schema/analytics.ts` (create), `index.ts` (modify) | `analytics_events`, `analytics_buckets`, `analytics_rollup_state` |
| `packages/db/src/migrations/0264_*.sql` (+ snapshot, journal) | tables, indexes, backfill |
| `apps/api/src/modules/analytics/record.ts` (create) | `recordEvent(tx, …)` / `recordEvents(tx, …)` |
| `apps/api/src/modules/device/routes.ts`, `session-sweeper.ts`, `merchant/create-tryon-job.ts`, `merchant/org-devices.routes.ts` (modify) | server-side emission |
| `apps/api/src/modules/device/events.routes.ts` (create), `server.ts` (modify) | `POST /v1/device/events` |
| `apps/api/src/modules/analytics/rollup.ts` (create), `main.ts` (modify) | `runAnalyticsRollupTick`, `startAnalyticsRollup` |
| `apps/api/src/modules/merchant/analytics/heatmap.ts` (create), `routes.ts` (modify) | `GET /v1/merchant/analytics/heatmap` |
| `apps/api/test/integration/analytics-*.test.ts` (create) | emission, ingestion, rollup, heatmap, parity |
| `apps/merchant-web/src/components/analytics/PeakHoursHeatmap.tsx` (create), `src/app/(app)/page.tsx`, `src/lib/analytics.ts` (modify) | dashboard card |
| `CLAUDE.md`, `docs/progress.md`, spec §7.1 (modify) | records |

---

### Task 1: Event catalogue types

**Files:** Create `packages/types/src/analytics-events.ts`; modify `packages/types/src/index.ts`.

- [x] `ANALYTICS_SERVER_EVENTS`: `session_started`, `session_ended`, `tryon_requested`, `item_wishlisted`, `sale_recorded`, `sale_voided`. Derived at rollup (never stored): `tryon_completed`, `tryon_failed`.
- [x] `ANALYTICS_CLIENT_EVENTS` (allowlist for the tablet): `item_viewed`, `category_viewed`, `identify_shown`, `qr_shown`, `qr_scanned`, `buy_online_click`, `oos_viewed`, `other_branch_shown`. CRM/cart events (`cart_added`, `otp_verified`, …) are added by their own phases. The allowlist is the seam.
- [x] `DeviceEventsBatchBody`: `{ events: Array<{ id: uuid, event: ClientEvent, occurredAt: ISO datetime, sessionId?: uuid, catalogItemId?: uuid, props?: Record<string, string|number|boolean> }> }`, 1–100 events, `props` ≤ 20 keys, values ≤ 200 chars.
- [x] `AnalyticsHeatmapQuery` (extends `AnalyticsQuery` with `metric: 'sessions' | 'tryons'`, default `sessions`) and response `{ window, metric, cells: Array<{ weekday: 0-6, hour: 0-23, value: number }> }`.
- [x] Unit test: allowlist rejects every server event name; batch bounds; props bounds.
- [x] `pnpm --filter @aivastra/types test` and typecheck pass. *(Done 2026-11-12: 7 files / 80 tests, typecheck clean, biome clean.)*

### Task 2: Schema, migration and backfill

**Files:** Create `packages/db/src/schema/analytics.ts`; modify schema `index.ts`; generate `0264`.

- [x] `analytics_events`: `id uuid pk default random`, `client_event_id uuid null`, `event text not null`, `merchant_id uuid not null`, `branch_id`, `device_id`, `staff_id`, `session_id`, `shopper_id`, `catalog_item_id`, `variant_id` (all uuid null, **no FKs**), `channel text null`, `props jsonb not null default '{}'`, `occurred_at timestamptz not null`, `received_at timestamptz not null default now()`. Header comment: advisory-only rule + why no FKs.
- [x] Indexes: `unique (device_id, client_event_id)` (dedupe), `(merchant_id, occurred_at)`, `(received_at)` (rollup watermark scan), `(session_id)` (partial, non-null).
- [x] `analytics_buckets`: `merchant_id, bucket_start (15-min UTC), event, branch_id, device_id, staff_id, channel, count bigint, value_sum bigint, value_count bigint`. `unique nulls not distinct` on all key columns (Postgres 16; Drizzle `.nullsNotDistinct()`). Index `(merchant_id, bucket_start)`.
- [x] `analytics_rollup_state`: single row `id text pk ('default')`, `watermark timestamptz not null`, `updated_at`.
- [x] `pnpm db:generate` locally. Format snapshot + journal with biome (handoff tooling note).
- [x] Hand-append to the generated SQL an **idempotent backfill** from existing rows: `session_started` / `session_ended` from `instore_sessions`, `tryon_requested` / `item_wishlisted` / `sale_recorded` from `session_items` by action, `sale_voided` from `voided_at`, using deterministic ids (`md5(source_id || event)::uuid`) plus `on conflict (id) do nothing`, and seed `analytics_rollup_state.watermark` so the first tick builds every bucket. **Seeded at the epoch, not `-infinity`**: drizzle maps timestamptz to a JS Date, which cannot hold infinity. Before the backfill SQL, a comment block: production row counts must be checked **read-only** first (expected ≈0, since no tablet client exists yet). Wishlist staff = `coalesce(item staff, session staff)`, matching `queries.ts` ITEM_STAFF, and **Task 3's emission must use the same rule**.
- [x] `pnpm db:migrate` locally. `apps/api` `device-schema` test still passes. *(Done 2026-11-12. Local `tryon_dev` was 12 migrations behind `dev` (0252–0263, none destructive) and was brought up first. Backfill verified on seeded rows inside a rolled-back transaction: correct events, second run added 0. Dedupe and NULLS NOT DISTINCT constraints verified the same way. db/api/dispatcher typecheck clean.)*

### Task 3: Server-side emission

**Files:** Create `apps/api/src/modules/analytics/record.ts`; modify `device/routes.ts`, `device/session-sweeper.ts`, `merchant/create-tryon-job.ts`, `merchant/org-devices.routes.ts`. Test: `apps/api/test/integration/analytics-emission.test.ts`.

- [x] `recordEvent(tx, e)` / `recordEvents(tx, es[])`: plain insert with `occurredAt` defaulting to now. Doc comment: same transaction as the source write, advisory only. Plus `recordSaleVoided`, shared by both void paths.
- [x] `POST /v1/device/sessions`: `session_started` (channel = mode) inside the existing tx, after the insert. Inside `withIdempotency`, so a replay writes nothing new.
- [x] `POST /v1/device/sessions/:id/end`: `session_ended` `{ reason: 'done' }`, only when the update returned a row (second end stays a no-op).
- [x] Sweeper: wrap update + `recordEvents` in one transaction. One `session_ended` `{ reason: 'idle' }` per ended id.
- [x] `chargeJob` (attributed path only): `tryon_requested` with job id in `props`, beside the `tried` session_item. Legacy path untouched. Covers both single-step and two-step (saree) try-ons, which share `chargeJob`. `JobAttribution` gained `channel` (session mode); its only construction site is `device/routes.ts`, and `attributionColumns` never writes it to `jobs`.
- [x] Device items route: `item_wishlisted` / `sale_recorded` by action. Staff = the session's staff (= ITEM_STAFF for both). Device delete route + admin void route: `sale_voided` with `{ sessionItemId, voidedBy }`, staff = the seller.
- [x] Tests (`analytics-emission.test.ts`, 14): each route writes exactly one event with the right dimensions. Idempotent replay of session start writes none. Second end writes none. Sweeper writes `idle` once. Refused undo, kiosk sale and a credit-refused try-on write none. A legacy (unattributed) merchant try-on writes none.
- [x] Existing suites unchanged and passing: `device-sessions`, `device-tryon`, `merchant-tryon`, `merchant-quick-tryon`, `merchant-analytics`. *(Done 2026-11-12: integration `device- merchant-tryon merchant-quick-tryon merchant-analytics merchant-org` 16 files / 165 tests pass; unit 121 files / 1,230 tests pass; api typecheck and biome clean.)*

### Task 4: Device event ingestion

**Files:** Create `apps/api/src/modules/device/events.routes.ts`; modify `server.ts`. Test: `analytics-ingest.test.ts`.

- [x] `POST /v1/device/events`, `preHandler: app.requireDevice`, body `DeviceEventsBatchBody`, rate limit 60/min per device (store NAT shares IP limits, per handoff note, so key by device). Key = sha256 of the device token, set as the route-level `keyGenerator` (the limiter runs before auth).
- [x] Dimensions from `req.device` (merchant, branch, device). Branch/staff/channel copied from the session row, not the device (a device moved mid-session keeps its session's branch, same rule as try-on jobs). **Changed in execution, 2026-11-12:** a foreign/unknown session or a non-referenceable item **rejects that event, not the batch** (counted in a new `rejected` response field). A tablet retries a failed batch, so a whole-batch 404 would let one bad event block every later upload. Items: the merchant's own **including soft-deleted** ones (a view before a delete is still history; offline uploads arrive late), then `merchantCanReferenceCatalogItem` for demo items.
- [x] `occurredAt` rules: more than 5 min in the future → clamped to `received_at` with `props.clockSkew = true`. Older than 7 days → event dropped and counted. Response `{ accepted, duplicates, dropped, rejected }`.
- [x] Insert with `on conflict (device_id, client_event_id) do nothing`. `client_event_id` = client `id`.
- [x] Tests (`analytics-ingest.test.ts`, 10): server/derived event name → 400, nothing written. Foreign session / unknown session / other merchant's item → rejected per event, the rest stored. Soft-deleted own item accepted. Replay → all duplicates, and the same id twice in one batch → one row. Dedupe is per device. Skew clamp and 7-day drop. Unpaired/deactivated device → 401. 61st request → 429 while a second device on the same IP still gets 200. *(Done 2026-11-12; `device- analytics-` 11 files / 96 tests pass; types 80 pass; biome clean.)*

### Task 5: Rollup loop

**Files:** Create `apps/api/src/modules/analytics/rollup.ts`; modify `apps/api/src/main.ts`. Test: `analytics-rollup.test.ts`.

- [x] `runAnalyticsRollupTick(app)`: inside one transaction, take `pg_try_advisory_xact_lock(hashtext('analytics-rollup'))` and return early if not acquired (replicas). Read watermark `W`. Set `T = now() - interval '60 seconds'` (commit-skew lag).
- [x] Affected `(merchant_id, bucket_start)` pairs = buckets of `occurred_at` for events with `received_at ∈ [W, T)` ∪ buckets of `completed_at` for jobs with `session_id is not null and completed_at ∈ [W, T)`.
- [x] For those pairs: delete their `analytics_buckets` rows, then insert fresh aggregates. Events: `count(*)` per key. Jobs: `tryon_completed` / `tryon_failed` by terminal status (CANCELLED excluded), `value_sum = sum(ms(completed_at - created_at))` (wait time), attribution from `jobs.branch_id/device_id/staff_id`, channel from the session's mode. Set watermark `T`.
- [x] `startAnalyticsRollup(app, intervalMs = 60_000)`: `setInterval` + re-entrancy guard, exported tick, immediate first tick and `unref`'d timer (the `fleet/rollups.ts` idiom). Wired in `main.ts` after `app.listen`.
- [x] **Added in execution, a trailing safety pass:** the first tick and then one an hour also rebuild the trailing 48h. It's required, not optional, for two cases a watermark-only pass misses: (1) a retried job (`FAILED → QUEUED → COMPLETED`, `apps/dispatcher/src/job/state.ts`) leaves a stale `tryon_failed` in its old bucket; (2) a job whose `completed_at` is earlier than the watermark when it becomes visible (commit delayed past the 60s lag, or dispatcher clock behind the DB).
- [x] No index added to `jobs` (an index build on production `jobs` blocks writes). Every jobs read is narrowed by `session_id is not null`. EXPLAIN on local data (21k jobs, statistics refreshed) uses `jobs_session_idx`. With stale statistics right after migrations it chose `jobs_merchant_created_idx`, so production depends on autovacuum's ANALYZE.
- [x] Tests (`analytics-rollup.test.ts`, 9): 15-min buckets aligned to IST quarter-hours. Kiosk/assisted rows kept apart. A second tick changes nothing. A late event rebuilds only its bucket. Outcomes + wait time derived from jobs, cancelled and session-less excluded. Pre-watermark job caught by the safety pass. Retried job fixed by the safety pass. Three concurrent ticks don't double-count. Watermark advances. *(Done 2026-11-12: 3 consecutive runs green; `analytics- device-` 12 files / 105 tests pass; typecheck and biome clean. Booted the real API against local `tryon_dev`: the first tick moved the watermark from the epoch to listen time − 60s within 3s, no errors logged.)*

### Task 6: Heatmap endpoint and parity test

**Files:** Create `apps/api/src/modules/merchant/analytics/heatmap.ts`; modify `analytics/routes.ts`. Tests: `analytics-heatmap.test.ts`, `analytics-parity.test.ts`.

- [x] `GET /v1/merchant/analytics/heatmap`, `requireMerchantMember`, scope through the existing `resolveScope` (staff forced to own branch, same 403 rules). Window via `parseWindow`.
- [x] Query `analytics_buckets`: `metric=sessions` → `session_started`; `tryons` → `tryon_requested`. Group by `extract(dow/hour from bucket_start at time zone tz)`. Always 168 cells, zero-filled.
- [x] Tests: IST bucketing (a 04:30 UTC session lands at 10:00 IST), staff scoping, foreign branch id returns zeros.
- [x] **Parity test:** seed sessions, tries, wishlists, sales and a void. Assert bucket totals equal `sessionTotals` / `itemTotals` from `queries.ts` for the same window (sold net of voids: `sale_recorded − sale_voided`). This is the gate for any future D2 switch. *(Done 2026-11-12: `analytics-heatmap` 4 tests + `analytics-parity` 1 test across 5 scopes (merchant, each branch, each staff) pass first run, events driven through the real device/admin routes. api typecheck and biome clean.)*

### Task 7: Peak-hours heatmap on the merchant dashboard

**Files:** Create `apps/merchant-web/src/components/analytics/PeakHoursHeatmap.tsx`; modify `src/lib/analytics.ts`, `src/app/(app)/page.tsx`.

- [x] Load the `dataviz` skill before writing chart code.
- [x] `useAnalyticsHeatmap(range, metric)` in `analytics.ts`, same 30s stale time and key style as the others.
- [x] Card "Peak Hours" (weekday × hour grid, sessions/try-ons toggle), colours from `C`/`M` tokens only, loading/empty/error via `ListState`, readable at phone width (horizontal scroll inside the card, not the page).
- [x] Vitest for any pure cell-scaling helper (`chart-scale.ts` pattern). `pnpm --filter @aivastra/merchant-web typecheck lint test` pass. *(Done 2026-11-12: `heat-scale.ts` + 5 tests; merchant-web typecheck/lint/test (107) pass with no warnings in the new files. Rendered against the local API: one fix from it, the screen-reader table widened the page by 657px at 390px because `sr-only` does not clip a `<table>`; moved onto a wrapper div. Sequential one hue per metric (the hue the metric wears in the trend chart) mixed into the card surface; zero is a distinct grey.)*

### Task 8: Records and full verification

- [x] `CLAUDE.md`: add `startAnalyticsRollup` (60s) to the api background-loops table. Add the advisory-only rule for `analytics_events` / `analytics_buckets` to Invariants. Add `analytics_*` tables to the schema map.
- [x] Spec §7.1: replace "written alongside the source write" with D1 (job outcomes derived) and note D2–D4.
- [x] `docs/progress.md`: Done entry with the migration index and the read-only production row-count check result.
- [x] Run: `pnpm --filter @aivastra/api test`, the integration files above plus `device-` `merchant-analytics` `merchant-tryon`, `pnpm -r --filter "!@aivastra/admin-mobile" run typecheck`, `pnpm biome check . --diagnostic-level=error`. Report real output.
- [x] Manual: local stack, seed a session via `/v1/device/*` with curl, wait one tick, see the heatmap cell on the merchant dashboard. *(Done 2026-11-12: see the `docs/progress.md` entry of the same date for the run output and the production read-only check.)*

## Out of scope (later phases)

Mapping Shopify widget events into the same dimensions. Item/category-level buckets (most-tried
items). Switching existing endpoints to buckets (D2). Retention/sweeping of raw events. Tablet
client code. CRM, cart, inventory and consent events (added through the allowlist by their phases).
