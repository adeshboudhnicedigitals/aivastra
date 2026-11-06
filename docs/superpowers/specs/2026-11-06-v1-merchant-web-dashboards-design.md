# v1.0 step 3c: Merchant Web — dashboards and brand settings

Sub-project 3c of `docs/superpowers/specs/2026-11-06-v1-merchant-web-design.md` (step 3, HLD §3.1,
§5.5). Depends on 3a (shell, auth) and step 2 data. Status: draft for review, 2026-11-06.

## Compatibility rule (binding)

Read-only analytics over data that already exists, plus one small merchant-writable setting.
Nothing existing changes: new routes under `/v1/merchant/analytics/*` and `/v1/merchant/brand`,
additive indexes only. Legacy (unattributed) activity is shown, never dropped or rewritten.

## Goal

The merchant admin sees how the stores perform; staff see their own branch and their own numbers.

## Metrics (exact definitions)

All over a date range (default last 30 days, max 366), bucketed by day in a timezone parameter
(default `Asia/Kolkata`). "Attributed" means `jobs.session_id` is set; legacy email-login kiosk and
Studio-style jobs have no session.

| Metric | Source | Definition |
|---|---|---|
| Sessions | `instore_sessions` | count with `started_at` in range |
| Try-ons | `session_items` | count `action='tried'` joined to sessions in range |
| Sold items | `session_items` | count `action='sold'` and `voided_at IS NULL` |
| Conversion | derived | sold items ÷ sessions (0 if no sessions); shown as a percentage, with the raw counts beside it |
| Wishlisted | `session_items` | count `action='wishlisted'` |
| Credits spent (in-store) | `jobs.credits_charged` | sum over attributed jobs in range |
| Credits balance | `user_credits` | merchant owner's current balance (read-only; low-credit note when under a threshold already used by the low-credit email loop) |
| Unique shoppers, shopper-page clicks | — | arrive with step 5; the UI shows "available once WhatsApp sign-in launches", never a fake zero |
| Unattributed try-ons | `jobs` with merchant_id and no session | shown as one separate "Legacy kiosk / other" line so totals reconcile with the credit ledger |

Drill-down: merchant → branch → staff → device. A *sold* item is attributed to the staff who made
it; a session to its device and branch.

## API (new, read-only)

- `GET /v1/merchant/analytics/summary?from&to&tz&branchId&staffId&deviceId` → totals above.
- `GET /v1/merchant/analytics/timeseries?…&bucket=day` → per-day sessions, try-ons, sold.
- `GET /v1/merchant/analytics/breakdown?…&by=branch|staff|device` → per-entity rows.
- All gated by `requireMerchantMember`. **Scope is enforced server-side:** admin → whole merchant
  (filters optional); staff → forced to `branchId = own branch`, and the *staff* figures only count
  their own sessions/sales; a staff caller passing another branch or staff id gets 403. Every query
  also carries `merchant_id = member.merchantId`.
- Validation: range ≤ 366 days, `from ≤ to`, ids are uuids (400 otherwise), `tz` must be a valid IANA name.
- Computed directly from `instore_sessions`, `session_items`, `jobs` (no rollup tables until volume
  requires them, per the HLD).

## Index migration (deferred from step 2)

The `jobs` attribution columns (`branch_id`, `device_id`, `session_id`, `staff_id`) are unindexed.
3c adds partial indexes `WHERE x IS NOT NULL` (the pattern of `jobs_shopify_shopper_idx`). A plain
`CREATE INDEX` on the production `jobs` table takes a write lock for the build. Decision for the
plan, before deploy: measure the production `jobs` row count (read-only) and either (a) accept the
brief lock in a quiet window, or (b) run `CREATE INDEX CONCURRENTLY` out-of-band (drizzle migrations
run in a transaction and cannot). The migration is generated and applied locally only; the deploy
path is push → CI/CD → `db:migrate:prod`. Also add `instore_sessions (merchant_id, branch_id, started_at)`
and `session_items (session_id, action)` if the query plans need them (verified with `EXPLAIN` at plan time).

## Screens (Merchant Web)

| Route | Admin | Staff |
|---|---|---|
| `/` Overview (replaces 3a's counts block, keeps it below) | KPI cards: sessions, try-ons, sold, conversion, credits spent, balance; range picker (today / 7d / 30d / custom); trend chart; branch table | Same cards for own branch; "my sales" for themselves |
| `/performance` | Tabs: Branches · Staff · Devices; each a sortable table with the same metrics, row click drills down | hidden (their view is the Overview) |
| `/settings` (brand) | See below | hidden |

Charts: simple bars / sparkline built with SVG + the token set; **no new charting dependency**
(YAGNI; revisit if a real need appears). Every number has loading / empty / error states; empty
state explains "no sessions yet — pair a tablet" with a link to `/devices`. Phone-width layout.

## Brand settings

Kept deliberately small, because logo/overlay already drive the Android app and delivered images:
- **Merchant-writable:** `store_url` (the "Buy online" link target for the shopper page, step 5):
  `PATCH /v1/merchant/brand` `{ storeUrl: string|null }`, `requireMerchantAdmin`, http(s)-only
  validation identical to the admin route's, audited in the same transaction. The AiVastra admin
  can still edit it.
- **Read-only here:** logo preview, "overlay logo on results" flag, company name. Changing the logo
  stays an AiVastra admin action in 3c (it changes what existing kiosks show).
- **Not built:** colours and WhatsApp copy — no consumer exists until step 5; adding fields now
  would be speculative.
- Plan limits (staff per branch, device quota) shown read-only, as in 3a.

## Out of scope
CSV / export; scheduled reports and emails; per-shopper views and unique shoppers (step 5); a
charting library; rollup tables; editing logo/colours/WhatsApp copy; goals and targets.

## Testing
- API integration, tests first: each metric against a seeded dataset with hand-computed expected
  values (including voided sales excluded, legacy unattributed line, day bucketing at the IST
  boundary, empty range); scope tests — staff cannot read another branch or staff, cross-merchant
  returns only own data; validation (range, uuid, tz) → 400.
- Index migration: SQL contains only `CREATE INDEX` statements.
- Brand: admin edits `storeUrl` (audited), staff 403, bad scheme 400, null clears.
- UI: typecheck / lint / build; manual browser checklist with real step 2 data (create sessions via
  the device routes with curl) for admin and staff, phone width, empty states.
- Legacy guard: existing `merchant-*` and `unlimited-plan-offer` suites unchanged.

## Open questions
- Index build strategy for production `jobs` (above).
- Timezone: store `Asia/Kolkata` per merchant, or default for all? Default for now (all merchants are in India).
- Should staff see their *branch totals* or only their own sales? HLD says both ("own branch + own
  numbers"); the spec shows both.
- Credits low-balance threshold: reuse the existing low-credit email value, or a Merchant Web setting?
