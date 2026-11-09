# Merchant Web 3c Dashboards and Brand Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The merchant admin sees how the stores perform (sessions, try-ons, sold items, conversion, credits) with drill-down branch → staff → device; staff see their own branch and their own numbers; the admin can edit the store URL.

**Architecture:** Three read-only analytics endpoints under `/v1/merchant/analytics/*` computed directly from `instore_sessions`, `session_items` and `jobs` (no rollup tables), scoped server-side by the caller's role; one small brand endpoint pair (`GET`/`PATCH /v1/merchant/brand`); four additive partial indexes on `jobs`. Merchant Web gets KPI cards, an SVG trend chart, a performance page and a settings page, with no charting dependency.

**Tech Stack:** Fastify 5 + Drizzle + raw `sql` for date bucketing (Postgres 16), Vitest integration harness; Next.js 15 / React 19 / TanStack Query / Vitest in `apps/merchant-web`.

**Spec:** `docs/superpowers/specs/2026-11-06-v1-merchant-web-dashboards-design.md`. Parents/conventions: 3a plan `docs/superpowers/plans/2026-11-06-v1-merchant-web-foundation.md`, 3b plan `docs/superpowers/plans/2026-11-07-v1-merchant-web-catalogue.md`.

## Global Constraints

- Nothing may change behaviour for existing customers. New routes only, additive indexes only, no writes to existing tables except the one brand setting; legacy (unattributed) activity is shown, never dropped or rewritten.
- Analytics are read-only, `requireMerchantMember`, and scope is enforced SERVER-SIDE: every query carries `merchant_id = member.merchantId`. Admin → whole merchant (filters optional). Staff → forced to `branchId = own branch`; a staff caller passing another `branchId` or any `staffId` other than their own gets 403.
- Date range: default last 30 days, max 366 days, `from <= to` (400 otherwise); ids are uuids (400 otherwise); `tz` must be a valid IANA name (400 otherwise), default `Asia/Kolkata`. `from`/`to` are calendar dates (`YYYY-MM-DD`) interpreted in `tz`, inclusive: the window is `[from 00:00 tz, to+1 day 00:00 tz)`. Day buckets are `date_trunc('day', ts AT TIME ZONE tz)`.
- Metric definitions (exact): Sessions = `instore_sessions` with `started_at` in window. Try-ons = `session_items.action='tried'` whose SESSION started in window. Sold items = `action='sold' AND voided_at IS NULL`, session started in window. Wishlisted = `action='wishlisted'`, session started in window. Conversion = sold ÷ sessions (0 when no sessions), returned as raw counts plus a ratio. Credits spent (in-store) = `SUM(jobs.credits_charged)` over jobs with `session_id IS NOT NULL` and `jobs.created_at` in window. Unattributed ("Legacy kiosk / other") = jobs with `merchant_id` set and `session_id IS NULL` in window: count and credits. Credits balance = the merchant OWNER's `user_credits.balance` (admin only). Low-credit note uses `LOW_CREDIT_THRESHOLD` exported from `apps/api/src/modules/credits/low-credit-alert-scheduler.ts` (20); do not duplicate the number.
- Unique shoppers and shopper-page clicks are NOT built: the UI shows "Available once WhatsApp sign-in launches", never a fake zero.
- Brand: `PATCH /v1/merchant/brand` body `{ storeUrl: string | null }`, `requireMerchantAdmin`, http(s)-only validation identical to the AiVastra admin route (`AdminMerchantUpdateBody.storeUrl` in `packages/types/src/widget.ts` ~line 461), audited in the same transaction with `recordAudit` (actor role `MERCHANT_ADMIN`). Logo, overlay flag and company name are read-only. No colour / WhatsApp fields.
- No new charting dependency: bars and sparkline in SVG with the `C` token set, no raw hex. Every number has loading / empty / error states; the empty state says "No sessions yet — pair a tablet" and links to `/devices`. Phone-width layout.
- Migrations are generated and applied LOCALLY only (never against staging/production, CLAUDE.md Production safety); rebuild `@aivastra/db` and `@aivastra/types` dist after editing them. Stage explicit paths only; `pnpm-lock.yaml` in the working tree carries unrelated local changes: never stage it; no new npm dependencies (if one is needed, STOP and report).
- Dropdowns `PremiumSelect`; tokens `C`; no `console.log`.

## Rulings carried into this plan (controller decisions on the spec's open questions)

- Timezone: `Asia/Kolkata` default for every merchant, overridable per request via `tz`; no per-merchant setting.
- Staff see BOTH their branch totals and their own sales ("own branch + own numbers", HLD): the summary response for a staff caller includes `mine: { sessions, tried, sold }` (rows where `staff_id` = the caller).
- Low-credit threshold: reuse `LOW_CREDIT_THRESHOLD`.
- Staff do NOT receive the credits balance (a merchant-wide wallet figure, not a branch figure): `creditsBalance` is `null` for staff and the UI hides the card. Credits spent for the staff's own branch IS shown.
- All time-series and metric windows use the SESSION start for sessions/tried/sold/wishlisted and `jobs.created_at` for credits; this is stated in the UI help text ("Sales are counted on the day the visit started").
- `by=staff` breakdown for a staff caller returns only the caller's own row; `by=device` only their branch's devices; `by=branch` only their branch.
- Index strategy: add the four partial indexes on `jobs` (`branch_id`, `device_id`, `session_id`, `staff_id`, each `WHERE col IS NOT NULL`) as one additive migration, local only. The production lock decision is a HUMAN pre-deploy step recorded in `docs/progress.md`: a plain `CREATE INDEX` blocks writes to `jobs` for the duration of the build. Default: accept the brief lock in a quiet window if `SELECT reltuples::bigint FROM pg_class WHERE relname='jobs'` shows under about 5 million rows; otherwise create the four indexes `CONCURRENTLY` out-of-band first (same names, `IF NOT EXISTS`) and let the migration no-op. Do not add the two optional `instore_sessions`/`session_items` indexes unless `EXPLAIN` in Task 2 proves they are needed.

## Review Focus

- A staff token must never read another branch's, another staff's, or another merchant's numbers (403 for explicit foreign ids; own-branch data only otherwise; cross-merchant ids return no data).
- Day bucketing at the IST boundary: a session starting 23:59 and 00:01 IST on adjacent days lands in two different buckets; a window `from=to` is one full local day.
- Voided sales excluded; sales without a staff id (kiosk mode cannot sell) not attributed to anyone; an empty window returns zeros (not nulls/NaN) and the conversion is 0 when there are no sessions.
- Credits totals reconcile: in-store credits + legacy line equals the sum of `jobs.credits_charged` for the merchant in the window.
- Window validation: 367 days → 400; `from > to` → 400; invalid tz → 400; malformed uuid → 400.
- The chart and tables handle a single data point, all-zero data and very large numbers without NaN/overflow.

## File Structure

| File | Responsibility |
|---|---|
| `packages/db/src/schema/jobs.ts` (modify) + migration `packages/db/src/migrations/0259_*.sql` + meta | four partial indexes on `jobs` |
| `packages/types/src/merchant-analytics.ts` (create), `index.ts` (export) | Zod query schemas + response types for analytics and brand |
| `apps/api/src/modules/merchant/analytics/{params.ts,scope.ts,queries.ts,routes.ts}` (create) | window/tz parsing, role scoping, SQL aggregates, routes |
| `apps/api/src/modules/merchant/brand.routes.ts` (create) + `server.ts` wiring | brand GET/PATCH |
| `apps/api/test/integration/merchant-analytics.test.ts`, `merchant-brand.test.ts` (create) | API tests with hand-computed fixtures |
| `apps/merchant-web/src/lib/{analytics.ts,date-range.ts,chart-scale.ts,table-sort.ts}` (create) | client fetchers and pure helpers (unit tested) |
| `apps/merchant-web/src/components/analytics/*` (create) | KpiCard, RangePicker, TrendChart, BreakdownTable |
| `apps/merchant-web/src/app/(app)/{page.tsx (modify), performance/page.tsx, settings/page.tsx}` | screens |
| `apps/merchant-web/src/components/shell.tsx` (modify) | nav: Performance, Settings (admin only) |
| `docs/progress.md` (modify) | records |

---

### Task 1: Index migration for `jobs` attribution columns

**Files:** Modify `packages/db/src/schema/jobs.ts`; Create migration via `pnpm db:generate` (local only) → `packages/db/src/migrations/0259_*.sql`, `meta/0259_snapshot.json`, `meta/_journal.json` update (format with `npx biome format --write` on snapshot + journal).

**Interfaces:** Produces four partial indexes: `jobs_branch_idx` on `(branch_id) WHERE branch_id IS NOT NULL`, `jobs_device_idx` on `(device_id)`, `jobs_session_idx` on `(session_id)`, `jobs_staff_idx` on `(staff_id)`, each with the same `WHERE <col> IS NOT NULL` predicate (pattern of `jobs_shopify_shopper_idx` in the same file; read it).

- [ ] **Step 1:** Add the four indexes to the `jobs` table definition. Confirm `DATABASE_URL` is `127.0.0.1`/`tryon_dev` (print host and db only) before any command. Run `pnpm db:generate`; the generated SQL must contain ONLY `CREATE INDEX` statements (4), nothing else; the file number must be 0259 (report otherwise).
- [ ] **Step 2:** `pnpm db:migrate` locally; verify with `docker exec aivastra-postgres psql -U tryon -d tryon_dev -Atc "select indexname from pg_indexes where tablename='jobs' and indexname in ('jobs_branch_idx','jobs_device_idx','jobs_session_idx','jobs_staff_idx') order by 1"` (4 rows).
- [ ] **Step 3:** `pnpm --filter @aivastra/db build`; run `node --experimental-strip-types scripts/ci/check-migration-index.mts` as the repo documents (read its header for usage) and report; run the legacy guard `cd apps/api && npx vitest run --config vitest.integration.config.ts merchant-catalog merchant-tryon device-tryon` and compare to the counts before the migration (record both).
- [ ] **Step 4:** commit `feat(db): partial indexes on jobs attribution columns`.

---

### Task 2: Analytics query layer, scope and `summary` endpoint

**Files:** Create `packages/types/src/merchant-analytics.ts` (+ export from `packages/types/src/index.ts`), `apps/api/src/modules/merchant/analytics/{params.ts,scope.ts,queries.ts,routes.ts}`, `apps/api/test/integration/merchant-analytics.test.ts`; Modify `apps/api/src/server.ts` (register `merchantAnalyticsRoutes`).

**Interfaces:**
- Produces: `AnalyticsQuery` Zod schema `{ from?: YYYY-MM-DD, to?: YYYY-MM-DD, tz?: string, branchId?: uuid, staffId?: uuid, deviceId?: uuid }`; `parseWindow(q, now): { from: string, to: string, tz: string, startUtc: Date, endUtc: Date }` (throws `AppError('VALIDATION', 400, …)` for range > 366 days, `from > to`, invalid tz via `Intl.DateTimeFormat(undefined, {timeZone})` try/catch); `resolveScope(member, q): { merchantId, branchId?, staffId?, deviceId?, isStaff, memberStaffId }` (staff: forces `branchId = member.branchId`, 403 `FORBIDDEN` if q.branchId or q.deviceId belongs to another branch... precisely: q.branchId present and != own → 403; q.staffId present and != own staffId → 403; q.deviceId present is checked to belong to the staff's branch, else 403); `GET /v1/merchant/analytics/summary` → `{ window: {from,to,tz}, sessions, tried, sold, wishlisted, conversion: { sold, sessions, ratio }, creditsSpent, creditsBalance: number | null, lowCreditThreshold: number, lowCredit: boolean, unattributed: { jobs, credits }, mine?: { sessions, tried, sold } }` (`mine` present only for staff callers; `creditsBalance` null for staff; `unattributed` null for staff because legacy jobs have no branch).

- [ ] **Step 1: Failing tests** in `merchant-analytics.test.ts` (harness as `merchant-org.test.ts`; helpers `createTestMerchant/Branch/Staff/Device` in `test/helpers/merchant.ts`; extend with a local `seedSession`/`seedItem`/`seedJob` helper in the test file inserting rows directly with chosen `started_at`/`created_at`): seed a merchant with two branches, two staff, two devices, a hand-computed dataset (document the expected numbers in comments): sessions across 3 IST days including one at 23:59 IST and one at 00:01 IST of the next day (use UTC instants 18:29Z and 18:31Z), tried/wishlisted/sold items, one VOIDED sale, one sale by staff A and one by staff B, jobs with `credits_charged` 2 and 3 attributed to sessions and a legacy job (no session) of 5. Cases: totals equal the hand-computed values; voided sale excluded; conversion ratio and zero-session ratio 0; empty window → zeros; legacy line separate and `creditsSpent + unattributed.credits` equals the merchant's total job credits in the window; `from=to` is one local IST day; admin balance equals the owner's `user_credits.balance` and `lowCredit` true when under 20; staff caller: totals limited to own branch, `mine` counts only their own rows, `creditsBalance` null, `unattributed` null; staff with `branchId` of the other branch → 403; staff with another `staffId` → 403; a second merchant's data never appears (seed one and assert); validation: 367-day range, `from > to`, bad uuid, bad tz → 400; unauthenticated / non-member → 401/403; deactivated staff → 403.
- [ ] **Step 2:** run `cd apps/api && npx vitest run --config vitest.integration.config.ts merchant-analytics` → FAIL.
- [ ] **Step 3: Implement.** Build the SQL with Drizzle `sql` templates and bound parameters only (no string interpolation of user input); `AT TIME ZONE ${tz}` with tz validated; one query per aggregate group is fine. Window filters use `started_at >= startUtc AND started_at < endUtc` (compute UTC instants from the local dates in SQL or in JS via the tz offset; prove correctness with the IST boundary test). Run `EXPLAIN (ANALYZE, BUFFERS)` on the sessions and items aggregates against a locally seeded 50k-row dataset (scratchpad script) and record whether the existing indexes suffice in the report; only add an index (a new migration 0260) if a plan does a seq scan on a large table that an index would fix, and say so.
- [ ] **Step 4:** tests pass; `pnpm --filter @aivastra/types build`; `pnpm --filter @aivastra/api typecheck` (full output); `pnpm biome check apps/api packages/types --diagnostic-level=error`; legacy `merchant-` suites pass with unchanged counts.
- [ ] **Step 5:** commit `feat(merchant): analytics summary endpoint`.

---

### Task 3: `timeseries` and `breakdown` endpoints

**Files:** Modify `apps/api/src/modules/merchant/analytics/{queries.ts,routes.ts}`, `packages/types/src/merchant-analytics.ts`; Test `apps/api/test/integration/merchant-analytics.test.ts`.

**Interfaces:**
- Consumes: `parseWindow`, `resolveScope` (Task 2).
- Produces: `GET /v1/merchant/analytics/timeseries?…&bucket=day` → `{ window, points: [{ date: 'YYYY-MM-DD', sessions, tried, sold }] }` with EVERY local day in the window present (zero-filled), ordered ascending; `GET /v1/merchant/analytics/breakdown?…&by=branch|staff|device` → `{ by, rows: [{ id, name, sessions, tried, sold, wishlisted, conversion: { sold, sessions, ratio }, creditsSpent }] }`. Names: branch name, staff displayName (from users), device name. Rows for entities with no activity in the window are still listed (zeros) for admin; staff caller gets only own-scope rows (rulings above). `bucket` other than `day` → 400; `by` missing/invalid → 400.

- [ ] **Step 1: Failing tests** using the Task 2 fixture: timeseries points for the 3-day IST dataset match hand values, zero-fills a day with no data, the 23:59/00:01 IST sessions land in adjacent buckets; `from=to` yields exactly one point; breakdown by branch/staff/device matches hand values (sold attributed to the staff who sold, sessions to device and branch); entities with zero activity listed with zeros; staff caller by=staff returns only own row, by=branch only own branch, by=device only own branch's devices, foreign ids 403; a deactivated branch's historic data still appears; invalid `by`/`bucket` → 400.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement with grouped SQL; keep the response numbers integers. **Step 4:** tests, typecheck, biome, legacy guard as in Task 2. **Step 5:** commit `feat(merchant): analytics timeseries and breakdown endpoints`.

---

### Task 4: Brand endpoints

**Files:** Create `apps/api/src/modules/merchant/brand.routes.ts`, `apps/api/test/integration/merchant-brand.test.ts`; Modify `apps/api/src/server.ts`, `packages/types/src/merchant-analytics.ts` (add `MerchantBrandUpdateBody`).

**Interfaces:**
- Produces: `GET /v1/merchant/brand` (`requireMerchantMember`) → `{ companyName, storeUrl: string | null, logoUrl: string | null, logoOverlayEnabled: boolean, staffLimitPerBranch, deviceQuotaPerMonth }` where `logoUrl` is built exactly as `/v1/auth/device-login`'s `logoUrl` is (read `apps/api/src/modules/auth/routes.ts`; reuse the helper if one exists, never expose the raw key); `PATCH /v1/merchant/brand` (`requireMerchantAdmin`) body `MerchantBrandUpdateBody = { storeUrl: string | null }` using the SAME validation as `AdminMerchantUpdateBody.storeUrl` (export a shared `storeUrlSchema` from `packages/types/src/widget.ts` and reuse it in both; the admin body's behaviour must not change) → returns the same shape as GET; audit action `merchant.brand_update` in the same transaction with `before`/`after` `{ storeUrl }`.

- [ ] **Step 1: Failing tests:** admin PATCH sets `storeUrl`, returns it, writes ONE audit row (role `MERCHANT_ADMIN`, resource id = merchant id, filtered by resource id); `null` clears it; `javascript:`/`data:`/`ftp:` and an over-long URL → 400; staff PATCH → 403; staff GET → 200 with the same read-only fields; the AiVastra admin route still accepts and rejects the same values (existing `admin-merchants` tests unchanged and passing); another merchant's brand never returned; a failed audit write rolls the update back (simulate by an invalid actor/FK or by stubbing `recordAudit` as the existing audit tests do — read how `audit` fail-closed is tested in the repo and copy that approach; if no pattern exists, say so and skip with a note).
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** tests, `admin-merchant` suites, typecheck, biome. **Step 5:** commit `feat(merchant): brand settings endpoints`.

---

### Task 5: Merchant Web analytics client, helpers and Overview

**Files:** Create `apps/merchant-web/src/lib/{analytics.ts,date-range.ts,chart-scale.ts}` and tests `{date-range,chart-scale}.test.ts`, `src/components/analytics/{KpiCard.tsx,RangePicker.tsx,TrendChart.tsx,BreakdownTable.tsx}`; Modify `src/app/(app)/page.tsx`.

**Interfaces:**
- Consumes: the three analytics endpoints (Tasks 2-3), `apiFetch`, `useSession`, `PremiumSelect`, `C`.
- Produces (pure, unit tested): `rangeFor(preset: 'today'|'7d'|'30d', now: Date, tz: string): { from: string; to: string }` (inclusive local dates); `isValidCustomRange(from, to): string | null` (error text or null; max 366 days, from <= to); `scaleSeries(values: number[], height: number): number[]` (bar heights; all-zero → zeros, single point OK, never NaN); `formatRatio(sold: number, sessions: number): string` (e.g. "12.5%", "0%" when no sessions); `formatCredits(n: number): string`. Hooks `useAnalyticsSummary(range, scope)`, `useTimeseries`, `useBreakdown` over TanStack Query with the range in the query key.
- Overview (`/`): range picker (Today / 7 days / 30 days / Custom with two date inputs and validation), KPI cards (Sessions, Try-ons, Sold, Conversion with raw counts beside it, Credits spent, Credits balance with a low-credit note when `lowCredit`), a "Legacy kiosk / other" line (admin only), "Shopper sign-in metrics: available once WhatsApp sign-in launches" placeholder card, an SVG bar trend chart of sessions/try-ons/sold (legend, accessible `<title>`/table fallback), and for admin a branch table (breakdown `by=branch`). Staff: same cards for own branch plus a "My sales" card from `mine`. The 3a counts block (branches/staff/devices/plan limits) stays BELOW the new content unchanged. Empty state: "No sessions yet — pair a tablet" linking to `/devices`.

- [ ] **Step 1: Failing tests** for the pure helpers: `rangeFor` for each preset across the IST date boundary (e.g. `now` = 2026-11-06T19:00Z is already 07 Nov in IST), `isValidCustomRange` (367 days, from>to, equal dates ok), `scaleSeries` (all zeros, single point, max maps to full height, huge numbers), `formatRatio(0,0)` = "0%", `formatRatio(1,3)` = "33.3%".
- [ ] **Step 2:** FAIL. **Step 3:** implement helpers, then components and the page. **Step 4:** `pnpm --filter @aivastra/merchant-web test`, `typecheck` (FULL output), `lint`, `build`, `pnpm biome check apps/merchant-web --diagnostic-level=error`. **Step 5:** commit `feat(merchant-web): overview dashboard`.

---

### Task 6: Performance and Settings pages, nav

**Files:** Create `apps/merchant-web/src/lib/table-sort.ts` (+ `table-sort.test.ts`), `src/app/(app)/performance/page.tsx`, `src/app/(app)/settings/page.tsx`; Modify `src/components/shell.tsx`.

**Interfaces:**
- Produces: `sortRows<T>(rows: T[], key: keyof T, dir: 'asc'|'desc'): T[]` (stable, numbers numeric, strings locale, never mutates input); `/performance` (admin only, staff redirected to `/` the same way the Branches page does): range picker + tabs Branches · Staff · Devices, each a sortable table of the breakdown columns, row click on a branch sets a branch filter and switches to Staff/Devices tabs filtered to it (drill-down branch → staff → device via query params `branchId`/`staffId`); `/settings` (admin only, staff redirected): read-only company name, logo preview (`<img>` of `logoUrl` or a placeholder), overlay flag, plan limits; editable `storeUrl` with client validation mirroring the server (http/https, ≤500 chars, empty = clear → sends `null`), save via `PATCH /v1/merchant/brand`, success toast, error toast with the API message; a note that logo changes are done by AiVastra. Nav: Performance and Settings, both `adminOnly`.

- [ ] **Step 1: Failing tests** for `sortRows` (numeric vs string, stability for ties, desc, immutability) and a pure `validateStoreUrl(v: string): string | null` helper with cases (empty ok → clear, `http://x.com`, `https://x.com/a`, `javascript:alert(1)` rejected, `ftp://x` rejected, 501 chars rejected).
- [ ] **Step 2:** FAIL. **Step 3:** implement helpers and pages (follow `branches/page.tsx` for the admin redirect, ListState, toasts). **Step 4:** test, typecheck (full), lint, build, biome. **Step 5:** commit `feat(merchant-web): performance and settings pages`.

---

### Task 7: Verification and records

**Files:** Modify `docs/progress.md`.

- [ ] **Step 1: Verify at API/BFF level** (no real browser). Local `tryon_dev` only (print host/db only; never passwords). Start the API and `pnpm --filter @aivastra/merchant-web dev` yourself if the user's stack is not running, stop them afterwards. Use the seeded 3a/3b accounts (`mw-verify-admin@example.test`, `mw-verify-staff1@example.test`, merchant "MW Verify Co"; passwords may need re-setting locally as the 3b verification did). Create real step-2 data through the device routes with curl (pair a device, start a kiosk/assisted session, tried via a stubbed path if try-on needs ComfyUI: insert `session_items`/jobs rows directly via psql for items the routes cannot create without GPU, and say which). Then curl: admin summary/timeseries/breakdown values match a direct `psql` aggregate for the same window; staff summary is branch-scoped with `mine`; staff with a foreign `branchId` → 403; invalid range/tz → 400; brand PATCH round-trip and audit row; page routes `/`, `/performance`, `/settings` return 200 with a session and redirect to `/login` without; staff can load `/settings`'s API GET but PATCH is 403.
- [ ] **Step 2:** `docs/progress.md` (newest entry on top, same style as the 3a/3b entries): what shipped, what was verified, NOT RUN (browser checklist: KPI cards, range picker incl. custom, trend chart, drill-down, phone width, empty state, settings save), out-of-repo/human items: **production `jobs` index decision** (reltuples check and the CONCURRENTLY alternative from the plan), migration 0259 numbering vs `origin/dev`, CORS note (3a), and the follow-ups (CSV export, per-merchant timezone, unique shoppers with step 5, rollups when volume requires).
- [ ] **Step 3:** commit `docs: merchant-web 3c progress`.

---

## Self-review notes

- Spec coverage: metrics and definitions (Task 2-3), scope enforcement (Task 2-3 tests), validation (Task 2), index migration (Task 1), Overview/Performance/Settings (Tasks 5-6), brand (Task 4), testing section (hand-computed fixtures, scope tests, brand tests, legacy guard), out-of-scope respected (no CSV, no charting lib, no rollups, no logo edit).
- Deliberate deviations from the spec text: staff do not see the credits balance; `by=*` for staff returns only own rows; the two optional extra indexes are skipped unless EXPLAIN demands.
- Names consistent across tasks: `parseWindow`, `resolveScope`, `AnalyticsQuery`, `MerchantBrandUpdateBody`, `rangeFor`, `scaleSeries`, `sortRows`, `validateStoreUrl`.
