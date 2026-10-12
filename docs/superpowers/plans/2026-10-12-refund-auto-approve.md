# Refund Auto-Approve Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An admin can switch on auto-approve from the admin panel (plus an editable per-customer daily cap). While on, a customer's refund request that passes the normal eligibility checks is approved the instant it is submitted — same credit, same audit guarantees as the admin button, no admin action.

**Architecture:** A `{ enabled, dailyCap }` setting lives in Redis under `config:refund-auto-approve` (same pattern as `config:image-compression`), defaulting to OFF / cap 5, fail-safe to OFF when unreadable. The admin approve body in `apps/api/src/modules/admin/refund-requests.routes.ts` is extracted into a shared `approveRefundRequestTx` used by both the admin button and the auto path, so the two can never diverge. The auto path runs in a nested transaction (savepoint) inside `createRefundRequest`'s existing transaction: any failure rolls back only the approval, leaving the request `PENDING`. A new `auto_approved` column marks auto rows (cap counting + admin "Auto" badge). Customer actor is recorded in audit with role `AUTO_APPROVE` (`audit_logs.actor_user_id` is NOT NULL and must be a real user — there is no admin to record).

**Tech Stack:** Fastify 5 + `fastify-type-provider-zod`, Drizzle/Postgres, Redis (ioredis), Zod in `packages/types`, Vitest integration harness `buildTestApp` (real Redis, per-file DB index), Vite + React (admin-web), Resend mailer.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-10-12-refund-auto-approve-design.md` (read it first; this plan implements it exactly — no delayed approve, no backlog approval on enable, no per-request credit ceiling, no per-customer lists).
- Branch `feat/refund-auto-approve`; never commit on `dev`. No schema/data changes against production — migration ships via push → CI/CD → `db:migrate:prod`.
- Migration number is expected to be `0223` (`0222` is latest on this branch). Before generating, check whether `origin/dev` gained a migration since; renumber if so (`docs/version-control.md`).
- ESM only, pnpm only. No `console.log` — use `app.log` (pino).
- Request/response shapes are Zod schemas in `packages/types` — the single source of truth.
- Ledger reason stays exactly `REFUND_USER_REQUEST` for auto-approvals too (same shared function).
- Every admin mutation calls `recordAudit(tx, …)` inside the mutation transaction (fail-closed); audit row is written **before** the Redis write lands (image-compression ordering).
- Permissions: `credits.read` to view the toggle, `credits.write` to change it (NOT a new SUPER_ADMIN gate — approving by hand already needs only `credits.write`).
- Admin URL standard (`docs/admin-url-routing-standard.md`): no new URL params; the toggle card keeps local state.
- Integration tests need `pnpm docker:up`. Run one file: `cd apps/api && npx vitest run --config vitest.integration.config.ts <pattern>`.
- Do not commit or push without being asked.

## File Structure

| File | Responsibility |
|---|---|
| `packages/types/src/refund.ts` (+ `index.ts`) | `RefundAutoApproveConfig` / Patch schemas, defaults, `fillRefundAutoApproveDefaults` |
| `packages/db/src/schema/refund-requests.ts` | `autoApproved` column + `(user_id, reviewed_at)` index |
| `packages/db/src/migrations/0223_*.sql` (+ snapshot, journal) | Generated migration |
| `apps/api/src/lib/refund-auto-approve-config.ts` | NEW: fail-safe Redis reader (mirrors `lib/batch-config.ts`) |
| `apps/api/src/modules/jobs/refund-requests.ts` | `approveRefundRequestTx` (extracted shared approve), `notifyRefundDecision` (moved best-effort email), auto-approve inside `createRefundRequest`, customer route post-commit email + metric |
| `apps/api/src/modules/admin/refund-requests.routes.ts` | `adminApproveRefundRequest` reuses shared fn; list returns `autoApproved`; GET/PATCH `/admin/refund-requests/auto-approve` |
| `apps/admin-web/src/types.ts` | `RefundRequest.autoApproved: boolean` |
| `apps/admin-web/src/pages/RefundRequestsPage.tsx` | Toggle card, "Auto" badge, "Auto-approved" detail |
| `apps/api/test/integration/refund-auto-approve.test.ts` | NEW: behaviour + cap + failure + auth tests |
| `docs/progress.md`, the spec | Rollout notes, spec status flip |

---

### Task 1: Types and config reader

**Files:**
- Modify: `packages/types/src/refund.ts`, `packages/types/src/index.ts` (ensure the new names are exported)
- Create: `apps/api/src/lib/refund-auto-approve-config.ts`

**Steps:**

- [ ] In `packages/types/src/refund.ts`, add (mirroring the `fillImageCompressionDefaults` pattern in `packages/types/src/image-compression.ts`, but this shape is flat so no per-key loop is needed):
  - `RefundAutoApproveConfig = z.object({ enabled: z.boolean(), dailyCap: z.number().int().min(1).max(100) })` + type.
  - `RefundAutoApprovePatch = RefundAutoApproveConfig.partial()` + type (PATCH body: partial, merged onto current).
  - `DEFAULT_REFUND_AUTO_APPROVE_CONFIG = { enabled: false, dailyCap: 5 }` (off by default; shipping changes no behaviour).
  - `fillRefundAutoApproveDefaults(stored: unknown): RefundAutoApproveConfig` — returns defaults for missing input, non-objects, unparseable shapes; validates each field independently (a bad `dailyCap` falls back to 5 while keeping a good `enabled`, and vice versa).
- [ ] Create `apps/api/src/lib/refund-auto-approve-config.ts` with `getRefundAutoApproveConfig(app: FastifyInstance): Promise<RefundAutoApproveConfig>` — reads key `config:refund-auto-approve` via `app.redis.get`, `JSON.parse`s, passes through `fillRefundAutoApproveDefaults`; **any** throw (Redis down, bad JSON) returns the defaults (fail-safe = manual approval). Same shape as `getMaxBatchJobs` in `lib/batch-config.ts`.
- [ ] `pnpm --filter @aivastra/types test` (refund.test.ts lives here — extend it with: defaults fill on `undefined`/`{}`/garbage, per-field fallback, Patch rejects `dailyCap` 0 and 101) and `pnpm --filter @aivastra/api typecheck` (or root `pnpm typecheck` if scoped script absent — check `package.json` first, don't infer).

---

### Task 2: Migration — `auto_approved` column

**Files:**
- Modify: `packages/db/src/schema/refund-requests.ts`
- Create (via generator): `packages/db/src/migrations/0223_*.sql` + snapshot + journal entry

**Steps:**

- [ ] Check `git log origin/dev --oneline -- packages/db/src/migrations | head` (fetch first if stale): if dev gained a migration beyond `0222`, the new number shifts — renumber per `docs/version-control.md`.
- [ ] Add to `refundRequests`: `autoApproved: boolean('auto_approved').notNull().default(false)` with a comment (`// True only when the auto-approve path approved this row — what the daily cap counts and the admin "Auto" badge reads. reviewed_by stays NULL for auto rows (no admin involved).`).
- [ ] Add index `byUserReviewed: index('refund_requests_user_reviewed_idx').on(t.userId, t.reviewedAt)` — the daily-cap query filters `(user_id, reviewed_at > now − 24h, auto_approved)`. Plain composite index (the existing `byStatusCreated` shows the convention); do not attempt a partial index unless the repo's Drizzle version is verified to support `.where()` on indexes.
- [ ] Generate with the repo's drizzle-kit script (see `packages/db/package.json` — do not guess the script name), inspect the SQL: expect `ALTER TABLE "refund_requests" ADD COLUMN "auto_approved" boolean DEFAULT false NOT NULL` + `CREATE INDEX`. Backfill note: existing rows default to `false`, which is correct (they were all manual).
- [ ] `pnpm db:migrate` locally and confirm `0223` applies cleanly.

---

### Task 3: Shared approve + auto-approve in the create path (core)

**Files:**
- Modify: `apps/api/src/modules/jobs/refund-requests.ts` (most work), `apps/api/src/modules/admin/refund-requests.routes.ts` (thinner caller)

**Why here:** `admin/refund-requests.routes.ts` already imports from `jobs/refund-requests.ts`. The shared function MUST live in `jobs/refund-requests.ts` — putting it in the admin file and importing it from the jobs file would create an import cycle.

**Steps:**

- [ ] Move/export the `Actor` type (`{ userId: string; role: string }`) into `jobs/refund-requests.ts` and import it in the admin routes file.
- [ ] Extract the transaction body of `adminApproveRefundRequest` into:
  `approveRefundRequestTx(tx: DbTransaction, row: RefundRequestRow, opts: { actor: Actor; adminNote: string | null; autoApproved: boolean; action: 'refund_request.approve' | 'refund_request.auto_approve'; request?: FastifyRequest })`
  which performs, in order: `job_outputs.downloaded_at` re-check (409 `ALREADY_DOWNLOADED`), job lock + `COMPLETED` re-check (409), `hasRegeneratedChild` re-check (409), ledger-net re-check `-net >= row.credits` (409), `applyRefundTx(tx, …, 'REFUND_USER_REQUEST')` (409 when falsy), `UPDATE … SET status='APPROVED', adminNote, reviewedBy: autoApproved ? null : actor.userId, reviewedAt: now, autoApproved, WHERE id AND status='PENDING'`, then `recordAudit`. Returns `{ id, credits, userId }`. It does NOT touch metrics or email (those are post-commit, per caller).
  - `DbTransaction` type is already imported in the jobs file; `FastifyRequest` type needs adding for the optional `request` passthrough (present for admin calls, absent for auto — `recordAudit` must accept it optional; verify its signature before wiring).
  - `applyRefundTx` import moves to the jobs file (from `../credits/ledger.js`); `recordAudit` import moves too (from `../admin/audit.js`) — verify `admin/audit.js` has no import back into jobs/ (cycle check) before doing this.
- [ ] Move the private `notifyUser` email helper from the admin routes file into an exported `notifyRefundDecision(app, userId, decision)` in `jobs/refund-requests.ts` (same best-effort try/catch, same `sendRefundDecisionEmail` call); admin approve/reject routes call it instead. Behaviour unchanged — existing email tests guard this.
- [ ] Rewrite `adminApproveRefundRequest` as: lock + fetch row, `PENDING` check (stays in the wrapper — it needs the row before delegating), `tx => approveRefundRequestTx(tx, row, { actor, adminNote: body.adminNote || null, autoApproved: false, action: 'refund_request.approve', request })`, then `creditsRefundedTotal.inc(result.credits)` after commit (unchanged position).
- [ ] In `createRefundRequest`, after the eligibility checks pass and the row is inserted (still inside the same `app.db.transaction` callback):
  1. `const cfg = await getRefundAutoApproveConfig(app)` (Redis read — not part of the pg tx; safe to call inside the callback. Fail-safe inside the reader covers Redis-down).
  2. If `!cfg.enabled`, return the PENDING shape as today.
  3. Else count: `SELECT count(*) FROM refund_requests WHERE user_id = ? AND auto_approved = true AND reviewed_at > now() - interval '24 hours'` (drizzle `sql` template, `tx` scope). If count `>= cfg.dailyCap`, return PENDING (cap hit — a human reviews).
  4. Else run the approval in a **nested transaction** (`tx.transaction(async (sp) => approveRefundRequestTx(sp, insertedRow, { actor: { userId, role: 'AUTO_APPROVE' }, adminNote: 'Auto-approved', autoApproved: true, action: 'refund_request.auto_approve' }))`). Drizzle's node-postgres driver implements nested `transaction()` as `SAVEPOINT spN` / `RELEASE` / `ROLLBACK TO SAVEPOINT` (verified in `node_modules` driver source) — confirm the nested-call form, do not hand-roll `SAVEPOINT` SQL.
  5. Wrap step 4 in try/catch: on any throw, `app.log.warn({ err, jobId, userId }, 'auto-approve failed, leaving request PENDING')` and return the PENDING shape. The outer create transaction still commits — **the customer's request never fails because of auto-approve**.
  6. On success, return the row shape with `status: 'APPROVED'` (and the existing fields). Add an `autoApproved: boolean` field to the return so the route knows.
- [ ] In the `POST /v1/jobs/:id/refund-request` route: after `createRefundRequest` resolves, if `created.autoApproved`, do `creditsRefundedTotal.inc(created.credits)` and `await notifyRefundDecision(app, req.userId, { approved: true, credits: created.credits, adminNote: 'Auto-approved' })` (best-effort inside the helper; route stays 201 either way). Import the metric from `@aivastra/observability` as the admin file does.
- [ ] No changes to `getRefundStatuses`, `hasActiveRefundRequest`, `hasApprovedRefundRequest`, regenerate/download gates, or catalogues-web: an auto-approved row reads `APPROVED` through the existing status machinery, so tiles update on refetch with no extra work.

---

### Task 4: Admin GET/PATCH config + list field

**Files:**
- Modify: `apps/api/src/modules/admin/refund-requests.routes.ts`

**Steps:**

- [ ] `GET /admin/refund-requests/auto-approve` with `requirePermission('credits.read')`: return `fillRefundAutoApproveDefaults(JSON.parse(raw ?? '{}'))` (same read path as the GET in `image-compression.routes.ts`).
- [ ] `PATCH /admin/refund-requests/auto-approve` with `requirePermission('credits.write')`, `schema: { body: RefundAutoApprovePatch }`: read current raw → `before = fill…`, `after = { …before, …body }` (merge, not overwrite — PATCH is partial); `await app.db.transaction(tx => recordAudit(tx, { actor: { userId: req.userId, role: req.adminRole! }, action: 'refund_auto_approve.update', resourceType: 'system_config', resourceId: 'refund_auto_approve', before, after, request: req }))` FIRST, then `await app.redis.set(KEY, JSON.stringify(after))`; return `after`. Same ordering as the image-compression PATCH (config never lands without its audit entry).
- [ ] List endpoint (`GET /admin/refund-requests`): add `autoApproved: R.autoApproved` to the select. Response type gains the field — update `apps/admin-web/src/types.ts` `RefundRequest` with `autoApproved: boolean` (Task 5 does the UI; the type change is listed here so neither task forgets it — do it in whichever task lands first, not both).
- [ ] Zod wiring: the PATCH body schema is the shared `RefundAutoApprovePatch` (invalid `dailyCap` 0/101 → 400 automatically via `fastify-type-provider-zod`, same as other admin routes).

---

### Task 5: Admin-web UI — toggle card, badge, detail

**Files:**
- Modify: `apps/admin-web/src/pages/RefundRequestsPage.tsx`, `apps/admin-web/src/types.ts` (if not done in Task 4)

**Steps:**

- [ ] New card at the top of the page (above the filter card): a switch (checkbox styled as the page's existing controls — check for a toggle/switch pattern in `apps/admin-web/src` first; do not introduce a new component library) labelled "Auto-approve refund requests", a number input "Max per customer per day" (integer 1–100), and hint text "Approved instantly; credits are returned immediately."
- [ ] Data: `GET /admin/refund-requests/auto-approve` on mount via existing `apiFetch`; `PATCH` on change. Toggle-OFF applies immediately. Toggle-ON asks for confirmation first (it moves money without review) — grep `apps/admin-web/src` for an existing confirm/modal pattern and reuse it; only fall back to native `window.confirm` if none exists.
- [ ] Permissions: everyone (i.e. `credits.read`, which the list fetch already requires) sees the state; controls disabled without `hasPermission('credits.write')` (existing `canWrite` pattern). Errors surface through the existing `toast` + `apiErrorMessage` path — never silent.
- [ ] Rows: an "Auto" badge next to the status badge when `r.autoApproved` (reuse the `badge` CSS classes); the detail modal's decided block reads "Auto-approved" when set (adminNote will already be `'Auto-approved'` — display the marker, not just the note text).
- [ ] Keep conventions: no raw `<select>` (none needed), no new URL params, colours from `C` tokens / existing classes only.
- [ ] Verify with `pnpm --filter @aivastra/admin build` (package name per AGENTS.md — confirm in `apps/admin-web/package.json` if the filter fails) and the repo lint. Admin-web has no test runner — build + lint + manual click-through (toggle on/off, cap edit, 403-disabled state) is the verification; say what was clicked in the progress entry.

---

### Task 6: Integration tests

**Files:**
- Create: `apps/api/test/integration/refund-auto-approve.test.ts`
- (No changes to existing test files expected — they guard the refactor.)

**Harness:** model on `apps/api/test/integration/admin-refund-requests.test.ts` (`startContainers`, `buildTestApp`, `vi.mock` mailer, `seedRequest`-style helper creating user + balance + COMPLETED job + `JOB_DISPATCH` debit + `jobOutputs` row). Redis is real per-file (`app.redis.set/del('config:refund-auto-approve', …)`); clear the key in `beforeEach`. Requires `pnpm docker:up`.

**Cases (each asserts DB state, not just HTTP):**

- [ ] OFF (key absent): `POST /v1/jobs/:id/refund-request` → 201 `PENDING`, `auto_approved = false`, balance unchanged, no `REFUND_USER_REQUEST` ledger row, mailer not called.
- [ ] Malformed key (`'not json'`, wrong types): same as OFF (fail-safe).
- [ ] ON (`{ enabled: true, dailyCap: 5 }`): 201 `APPROVED` at once; balance credited once; exactly one `REFUND_USER_REQUEST` row; `auto_approved = true`, `reviewed_by IS NULL`, `adminNote = 'Auto-approved'`; audit row `action = 'refund_request.auto_approve'`, actor = customer, role `AUTO_APPROVE`; mailer called once with approved.
- [ ] Cap boundary (`dailyCap: 2`, three fresh jobs): 1st + 2nd auto-approve, 3rd stays `PENDING` with no credit. Manual approvals do not count: approve one by hand via `adminApproveRefundRequest`, then two auto-approvals still succeed. Stale autos do not count: backdate an auto row's `reviewed_at` > 24h, cap frees up.
- [ ] Ineligible never auto-approves: create still 409s for regenerated-child, downloaded, and net-zero (unlimited-plan-style delta-0) jobs even with the toggle ON.
- [ ] Forced mid-path failure leaves `PENDING`: seed a prior offsetting ledger row (e.g. `REFUND_ADMIN_CANCEL` crediting the job back) so the net re-check fails inside the savepoint → 201 `PENDING`, no credit, no email, outer request row intact.
- [ ] Pre-existing `PENDING` (filed while OFF) is untouched by switching ON (no sweep on PATCH — assert by flipping the key then re-reading the old row).
- [ ] Config endpoints: unauthenticated GET/PATCH → 401; role without `credits.write` PATCH → 403 (mirror the 403 setup in `admin-config.test.ts` / `admin-image-compression.test.ts` — check which helper role they use first); PATCH writes audit row (`refund_auto_approve.update` with before/after); PATCH `{ enabled: true }` preserves the stored cap (merge); `dailyCap` 0 / 101 → 400.
- [ ] Regression: run the existing `refund-requests`, `admin-refund-requests`, `refund-apply-tx` suites unchanged alongside the new file.

---

### Task 7: Verification, docs, rollout notes

**Steps:**

- [ ] `cd apps/api && npx vitest run --config vitest.integration.config.ts refund-auto-approve refund-requests admin-refund-requests refund-apply-tx` — all green.
- [ ] `pnpm --filter @aivastra/api test` (unit-only) — green; confirm the count matches the pre-change baseline if anything looks off.
- [ ] Root `pnpm typecheck` and `pnpm lint` — 0 errors; warnings unchanged from baseline (record both numbers).
- [ ] Flip the spec's `**Status:**` line to `implemented` (keep the date/decisions intact) and append a `docs/progress.md` entry (newest-first, dated 2026-10-12): Redis key, default OFF/cap 5, migration number, the `reviewed_by = NULL` + role-`AUTO_APPROVE` audit fact, and the manual admin-web click-through. Per AGENTS.md, record the config key there because no deploy touches it.
- [ ] Rollout reminder (no action in this plan): migration is additive; safe default OFF means shipping changes no behaviour until an admin flips it; production change flows push → CI/CD → `db:migrate:prod` only.
