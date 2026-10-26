# Workflow Comparison Sweeper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A disableable sweeper that replays completed try-on jobs through the `general` try-on workflow on an in-house worker, plus an admin tab showing input images, original result and general result together.

**Architecture:** A `workflow_comparisons` table links a source job to a real, zero-credit replay job owned by a system user, enqueued on `jobs:inhouse`. A collector loop records eligible source jobs; a separate dispatch loop creates one replay job at a time when the in-house lane is idle. The existing dispatcher, retries and result storage run the replay unchanged.

**Tech Stack:** Fastify 5, Drizzle/Postgres, Redis, Vitest (integration tests against docker-compose), Vite + React admin SPA.

**Spec:** `docs/superpowers/specs/2026-10-22-workflow-comparison-sweeper-design.md`

## Global Constraints

- Schema changes only via `pnpm db:generate` locally → push → CI → `db:migrate:prod`. Never write to production by hand.
- Replay jobs: `cost = 0`, no `credit_ledger` row, no `atomicDeduct`; no `merchantId`, `shopifyStoreId` or API key; `lane: 'inhouse'`, `params.inhouse: true`.
- **Never set `primaryWorkerIds` / `fallbackWorkerIds`** on replay jobs (a busy pinned worker fails the job terminally; pool-only requeues).
- Replay jobs reuse the source job's object keys; they never copy input images.
- Freeze `workflowTemplateId` and `dispatchTemplateVersion` on the comparison row at collection time; write both into the replay job's `job_inputs.params`.
- Unique key `(source_job_id, template_id, template_version)`.
- At most one comparison job in flight; dispatch only when no non-comparison in-house job is `QUEUED`/in progress (checked in Postgres) and an in-house worker is healthy and idle.
- Admin mutations write `audit_logs` via `recordAudit(tx, …)` in the same transaction. Dropdowns use `SearchableSelect`. Follow `docs/admin-url-routing-standard.md`.
- No review, verdict, notes, scoring, sampling rate or daily cap. Settings are `enabled`, `backlog_cap`, `retention_days` (default 30).
- Integration tests: `cd apps/api && npx vitest run --config vitest.integration.config.ts <pattern>`; unit tests: `pnpm --filter @aivastra/api test`. `pnpm docker:up` must be running.
- The user authorized the branch → dev → main flow. Consolidate the task-level commit steps into one complete, reviewed feature commit, then use PR/CI promotion; never write directly to production.

## Review Focus

- A source job whose result or input object was already erased/missing → row goes `EXPIRED`/`UNSUPPORTED`, nothing crashes (Task 3, 4).
- Two overlapping collector ticks on the same source job → exactly one row (Task 4).
- Feature switched off while rows are `COLLECTED`, `QUEUED` and running → no new jobs; queued/running finish; cancel action cancels only queued (Task 5, 6).
- No in-house worker configured/healthy → no replay job is created (not a 3-hour queued job) (Task 5).
- `general` category missing or its template inactive → collector pauses and records nothing rather than pinning a null template (Task 4).

---

### Task 1: Table, enum values and job source

**Files:**
- Create: `packages/db/src/schema/workflow-comparisons.ts`; export it from `packages/db/src/schema/index.ts`
- Modify: `packages/types/src/job-taxonomy.ts` (add `COMPARISON: 'comparison'` to `JOB_SOURCE`); every exhaustive map `pnpm typecheck` flags (known: `packages/types/src/image-compression.ts`, `apps/api/src/lib/queue-capacity-config.ts`, admin job-taxonomy registry/test)
- Generated: next available `packages/db/src/migrations/NNNN_*.sql` + journal via `pnpm db:generate`
- Test: `apps/api/test/integration/workflow-comparisons-schema.test.ts`

**Interfaces:**
- Produces: `schema.workflowComparisons` with columns `id uuid pk`, `sourceJobId uuid not null → jobs(id) on delete cascade`, `generalJobId uuid null → jobs(id) on delete set null`, `templateId uuid not null → workflow_templates(id)`, `templateVersion integer not null`, `status text not null` (one of `COLLECTED|QUEUED|RUNNING|COMPLETED|FAILED|UNSUPPORTED|EXPIRED|CANCELLED`), `unsupportedReason text null`, `sourceSource text null`, `sourceTemplateId uuid null`, `createdAt`, `updatedAt`; unique index on `(sourceJobId, templateId, templateVersion)`; index on `(status, createdAt)`.
- Exports `COMPARISON_STATUS` const + `ComparisonStatus` type from `@aivastra/types` (new `packages/types/src/comparison.ts`).

- [x] **Step 1: Write failing test** `inserting the same (source, template, version) twice violates the unique key; a different version succeeds` using the integration harness (`containers.ts` + a seeded job).
- [x] **Step 2: Run it** — Expected: FAIL (`schema.workflowComparisons` undefined).
- [x] **Step 3: Add schema, `COMPARISON_STATUS`, `JOB_SOURCE.COMPARISON`; run `pnpm db:generate`**; inspect the SQL for only this table.
- [x] **Step 4: Run `pnpm typecheck`**, add an explicit `comparison` entry to each exhaustive map it flags (compression: treat like `api_tryon`; queue-capacity: excluded from customer capacity counts).
- [x] **Step 5: Run the test and `pnpm --filter @aivastra/api test:integration admin-job-taxonomy`** — Expected: PASS.
- [ ] **Step 6: Commit** `feat(comparison): workflow_comparisons table and comparison job source`.

### Task 2: Settings and admin settings routes

**Files:**
- Create: `apps/api/src/modules/comparison/settings.ts`, `apps/api/src/modules/admin/comparison.routes.ts` (register in `apps/api/src/server.ts` beside `adminGarmentRecognitionsRoutes`)
- Test: `apps/api/test/integration/admin-comparison-settings.test.ts`

**Interfaces:**
- Produces in `settings.ts`: `type ComparisonSettings = { enabled: boolean; backlogCap: number; retentionDays: number; enabledSince: string | null }`; `DEFAULT_COMPARISON_SETTINGS = { enabled: false, backlogCap: 200, retentionDays: 30, enabledSince: null }`; `getComparisonSettings(app): Promise<ComparisonSettings>`; `saveComparisonSettings(app, patch: Partial<Pick<ComparisonSettings,'enabled'|'backlogCap'|'retentionDays'>>): Promise<ComparisonSettings>` which sets `enabledSince = now` on a false→true change and stores JSON at Redis key `config:workflow-comparison` (same mechanism as `config:system` in `config.routes.ts`).
- Routes: `GET /admin/comparison/settings` (`config.read`), `PATCH /admin/comparison/settings` (`config.write`, zod body: `enabled` boolean, `backlogCap` int 1–5000, `retentionDays` int 1–365), PATCH writes an audit row.

- [x] **Step 1: Failing tests:** defaults when nothing stored (`enabled === false`); PATCH `{enabled:true}` sets `enabledSince` non-null and writes one `audit_logs` row; PATCH `{enabled:true}` again leaves `enabledSince` unchanged; `backlogCap: 0` → 400; caller without `config.write` → 403.
- [x] **Step 2: Run** — FAIL.
- [x] **Step 3: Implement** settings module and routes per interfaces.
- [x] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(comparison): admin settings`.

### Task 3: Eligibility classifier (pure)

**Files:**
- Create: `apps/api/src/modules/comparison/eligibility.ts`
- Test: `apps/api/test/comparison-eligibility.test.ts` (unit)

**Interfaces:**
- Produces: `type SourceJobShape = { source: string | null; status: string; merchantId: string | null; shopifyStoreId: string | null; customerPhotoKey: string | null; resultKey: string | null; templateId: string | null; inputs: { upperGarmentKey: string | null; faceId: string | null; backgroundId: string | null; poseId: string | null; params: Record<string, unknown> | null } }`; `type Eligibility = { eligible: true; personKey: string; garmentKey: string } | { eligible: false; reason: ComparisonUnsupportedReason }`; `COMPARISON_UNSUPPORTED_REASONS` = `NOT_COMPLETED | NO_RESULT | IS_COMPARISON | ALREADY_GENERAL | FACE_POSE_BG_JOB | NON_TRYON_KIND | NO_PERSON_IMAGE | NO_GARMENT_IMAGE`; `classifySourceJob(job: SourceJobShape, generalTemplateId: string): Eligibility`.
- Rules (mirror `processJob` routing in `apps/dispatcher/src/job/processor.ts` ~215–330): not `COMPLETED` → `NOT_COMPLETED`; no `resultKey` → `NO_RESULT`; `source === JOB_SOURCE.COMPARISON` → `IS_COMPARISON`; `templateId === generalTemplateId` → `ALREADY_GENERAL`; any of `faceId/backgroundId/poseId` → `FACE_POSE_BG_JOB`; `params.kind` set (video, regenerate, fabric_to_garment, saree_mannequin…) → `NON_TRYON_KIND`; person = `params.personKey` ?? `customerPhotoKey`, missing → `NO_PERSON_IMAGE`; missing `upperGarmentKey` → `NO_GARMENT_IMAGE`.
- **Builder must first confirm** how widget (merchant/Shopify) jobs store their garment and person keys by reading `processWidgetJob` (~line 2696) and the Shopify/merchant creators, and adjust the person/garment extraction; record the finding in a comment.

- [x] **Step 1: Failing tests,** one per reason plus: direct tryon job with `params.personKey` + `upperGarmentKey` → eligible with those keys; widget job with `customerPhotoKey` → eligible; `kind: 'video'` → `NON_TRYON_KIND`.
- [x] **Step 2: Run** — FAIL. **Step 3: Implement. Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(comparison): source job eligibility`.

### Task 4: Collector

**Files:**
- Create: `apps/api/src/modules/comparison/collector.ts`, `apps/api/src/modules/comparison/general-template.ts`
- Test: `apps/api/test/integration/comparison-collector.test.ts`

**Interfaces:**
- Consumes: `getComparisonSettings`, `classifySourceJob`, `schema.workflowComparisons`.
- Produces: `resolveGeneralTemplate(db): Promise<{ templateId: string; version: number } | null>` (active `tryon_categories` row with slug `general` joined to an **active** `workflow_templates` row; else `null`); `runCollectorTick(app, opts?: { batch?: number }): Promise<{ collected: number; unsupported: number; skipped: 'disabled' | 'no_general' | 'backlog_full' | null }>`; `startComparisonCollector(app, intervalMs = 60_000): () => void` (same `setInterval` + re-entrancy guard shape as `startRecognitionSweeper`).
- Behaviour: do nothing unless `enabled`; do nothing and return `skipped: 'no_general'` if no general template; stop when `COLLECTED` count ≥ `backlogCap`; select `COMPLETED` jobs with `completed_at > enabledSince`, not already having a row for the frozen `(template, version)`, oldest first; insert row `COLLECTED` (eligible) or `UNSUPPORTED` + reason with `ON CONFLICT DO NOTHING` on the unique key; record `sourceSource` and `sourceTemplateId` (from `job_inputs.params.workflowTemplateId` or the latest `COMFY_DISPATCH` event payload, per CLAUDE.md "Most job-creation paths…").

- [x] **Step 1: Failing tests:** disabled → inserts nothing; enabled + completed direct job → one `COLLECTED` row with frozen template/version; face/pose job → `UNSUPPORTED` with `FACE_POSE_BG_JOB`; job completed before `enabledSince` → ignored; `backlogCap: 1` with two eligible jobs → one row; **two concurrent `runCollectorTick` calls on the same job → exactly one row**; no `general` category (or inactive template) → `skipped: 'no_general'`, zero rows; replay job (source `comparison`) never collected.
- [x] **Step 2: Run** — FAIL. **Step 3: Implement. Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(comparison): collector`.

### Task 5: Replay job creation and dispatch tick

**Files:**
- Create: `apps/api/src/modules/comparison/system-user.ts`, `create-replay-job.ts`, `dispatcher-tick.ts`
- Modify: `apps/api/src/main.ts` (start both loops after `app.listen`, next to `startRecognitionSweeper`)
- Test: `apps/api/test/integration/comparison-dispatch.test.ts`

**Interfaces:**
- Produces: `ensureComparisonSystemUser(db): Promise<string>` (upsert a fixed-email user, e.g. `comparison-system@aivastra.internal`, `passwordHash: null`, not banned; confirm required `users` columns in `packages/db/src/schema/users.ts`); `createReplayJob(app, p: { systemUserId: string; personKey: string; garmentKey: string; templateId: string; templateVersion: number }): Promise<{ jobId: string }>` — one transaction inserting `jobs` (`status: 'QUEUED'`, `queueStream: 'inhouse'`, `creditsCharged: 0`, `source: JOB_SOURCE.COMPARISON`, `watermark: false`, no merchant/shopify/api key) and `job_inputs` (`upperGarmentKey`, `params: { personKey, workflowTemplateId, dispatchTemplateVersion, inhouse: true }`), then `XADD jobs:inhouse` (same fields as `createDevJobCore`); on XADD failure mark the job `FAILED` (`ENQUEUE_FAIL`) with no ledger writes. Do not call `createDevJobCore`/`atomicDeduct`/`assertMerchantJobRateLimit`.
- `isInhouseWorkerIdle(app): Promise<boolean>`: an active `workers` row whose `allowedJobTypes` includes `inhouse`, with `worker:health:{id}` present and registry status `IDLE` (registry key in `apps/dispatcher/src/worker/registry.ts`).
- `runDispatchTick(app): Promise<{ dispatched: boolean; skipped: 'disabled' | 'busy' | 'no_worker' | 'empty' | null }>` and `startComparisonDispatcher(app, intervalMs = 30_000): () => void`. Rule: enabled; no `workflow_comparisons` row in `QUEUED`/`RUNNING`; no non-comparison job with `queue_stream = 'inhouse'` in `QUEUED/PREPROCESSING/GENERATING/UPLOADING`; `isInhouseWorkerIdle`; then take the oldest `COLLECTED` row, create the replay job, set row `QUEUED` with `generalJobId`.
- A second small reconcile in the same tick: mirror replay-job status onto the row (`PREPROCESSING/GENERATING/UPLOADING` → `RUNNING`, `COMPLETED` → `COMPLETED`, `FAILED` → `FAILED`, `CANCELLED` → `CANCELLED`).

- [x] **Step 1: Failing tests:** replay job has `creditsCharged 0`, zero `credit_ledger` rows for it, `source 'comparison'`, no `merchantId`, and `params` has no `primaryWorkerIds`; disabled → none created; a `QUEUED` manual in-house job → `skipped: 'busy'`; a comparison already `QUEUED` → `busy`; no in-house worker → `no_worker` and **no job row created**; happy path creates exactly one job and sets row `QUEUED`; reconcile moves a completed replay job's row to `COMPLETED`.
- [x] **Step 2: Run** — FAIL. **Step 3: Implement and wire `main.ts`. Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(comparison): zero-credit replay jobs and dispatch loop`.

### Task 6: Cancel queued and retention sweep

**Files:**
- Create: `apps/api/src/modules/comparison/retention.ts`; add `POST /admin/comparison/cancel-queued` to `apps/api/src/modules/admin/comparison.routes.ts`
- Modify: `apps/api/src/main.ts` (start `startComparisonRetention`, 1h)
- Test: `apps/api/test/integration/comparison-retention.test.ts`

**Interfaces:**
- Produces: `runRetentionTick(app): Promise<{ expired: number; deleted: number }>`: `COLLECTED` rows older than `retentionDays` → `EXPIRED`; rows in a terminal status older than `retentionDays` → delete their output objects (`jobOutputs.resultKey`/`thumbnailKey` via `app.storage.deleteObject`), delete the replay job (cascades inputs/outputs; **never delete the source job or its objects**), delete the row. `cancelQueuedComparisons(app, actorId): Promise<{ cancelled: number }>`: for rows `QUEUED` whose job is still `QUEUED`, reuse the existing admin cancel path in `admin/jobs.routes.ts` (`/admin/jobs/:id/cancel`, ~line 626; extract its core into a shared function if needed) and set the row `CANCELLED`; running ones untouched. Route: `config.write`, audit row.

- [x] **Step 1: Failing tests:** old `COLLECTED` row → `EXPIRED`; old `COMPLETED` row → output objects deleted from MinIO, replay job and row gone, **source job and its objects intact**; cancel-queued cancels a `QUEUED` replay and leaves a `RUNNING` one; audit row written.
- [x] **Step 2: Run** — FAIL. **Step 3: Implement. Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(comparison): retention sweep and cancel queued`.

### Task 7: Keep replay jobs out of customer and business reads

**Files:**
- Modify: whichever readers the audit finds. Known candidates to check first: `apps/api/src/modules/admin/credit-analysis.routes.ts`, `apps/api/src/lib/queue-capacity-config.ts`, `apps/api/src/modules/dev/analytics.ts`, `apps/api/src/modules/admin/jobs.routes.ts`, `apps/api/src/modules/admin/job-type.ts`, `packages/observability/src/metrics.ts`, `apps/api/src/modules/jobs/routes.ts`, `apps/api/src/modules/results/routes.ts`, and the messaging/WhatsApp delivery and email senders.
- Test: `apps/api/test/integration/comparison-exclusions.test.ts`

**Interfaces:**
- Consumes: `JOB_SOURCE.COMPARISON`.
- Produces: an audit table appended to `docs/progress.md` (reader, decision: excluded / intentionally included, why). Admin Jobs list may keep showing replay jobs if they are labelled by `jobTypeSql()`; customer-facing and revenue/credit analytics must exclude them.

- [x] **Step 1: Audit** every file above plus `grep -rn "schema.jobs" apps/api/src` for readers aggregating by status/user/day; list each decision.
- [x] **Step 2: Failing tests:** with one completed customer job and one completed replay job, assert the replay job is absent from the customer job list, from credit-analysis totals, from queue-capacity counts, and does not enqueue any webhook (`webhooks:outbound` length unchanged) or WhatsApp delivery.
- [x] **Step 3: Add explicit `source <> 'comparison'` filters** (or the shared helper if the file already has one) where the tests fail.
- [x] **Step 4: Run the new test plus** `admin-credit-analysis`, `admin-job-taxonomy` — PASS.
- [ ] **Step 5: Commit** `feat(comparison): exclude replay jobs from customer and business reads`.

### Task 8: Erasure reaches replay outputs

**Files:**
- Modify: `apps/api/src/modules/shopify/gdpr.ts` (`redactShopperData`, store redaction), `apps/api/src/modules/admin/users.routes.ts` (user delete, ~line 586–623)
- Create: `apps/api/src/modules/comparison/erase.ts`
- Test: `apps/api/test/integration/comparison-erasure.test.ts`

**Interfaces:**
- Produces: `eraseComparisonsForSourceJobs(app, sourceJobIds: string[]): Promise<{ erased: number }>` — for each linked row: delete the replay job's output objects, delete the replay job and the row; for rows not yet dispatched set `EXPIRED`. Must run **before** the source job rows are deleted (the row's FK cascades only the link, not the replay job). Idempotent; a storage failure must leave the row so the existing retry scheduler (`gdpr-retry-scheduler.ts`) can retry.

- [x] **Step 1: Failing tests:** Shopify shopper redaction removes the replay output object and job for that shopper's source job; deleting a user removes replay jobs/outputs of that user's source jobs; `COLLECTED` rows become `EXPIRED`; storage failure leaves the row in place.
- [x] **Step 2: Run** — FAIL. **Step 3: Implement and call from both paths. Step 4: Run** `comparison-erasure` plus existing Shopify GDPR tests — PASS.
- [ ] **Step 5: Commit** `feat(comparison): erase replay data with its source job`.

### Task 9: Admin list and detail API

**Files:**
- Modify: `apps/api/src/modules/admin/comparison.routes.ts`
- Test: `apps/api/test/integration/admin-comparison-list.test.ts`

**Interfaces:**
- Produces: `GET /admin/comparison` (`jobs.read`; query `status?`, `sourceSource?`, opaque `cursor?` encoding `(createdAt,id)`, `limit` 1–100 default 25; keyset on `(createdAt desc, id desc)`) → `{ items: Array<{ id, status, unsupportedReason, sourceSource, sourceJobId, generalJobId, createdAt }>, nextCursor, counts: Record<ComparisonStatus, number>, backlog: { collected, queued, running } }`; `GET /admin/comparison/:id` → `{ id, status, unsupportedReason, template: { id, version, label }, source: { jobId, source, workflowLabel, workerId, durationMs, error }, general: { jobId, workerId, durationMs, error } | null, inputs: { personUrl, garmentUrl }, originalResultUrl, generalResultUrl }` with URLs from `app.storage.presignGet`; 404 for unknown id.

- [x] **Step 1: Failing tests:** list filters by status and source; pagination returns `nextCursor`; `counts` and `backlog` match seeded rows; detail returns presigned URLs for inputs and both results and `general: null` for a `COLLECTED` row; caller without `jobs.read` → 403.
- [x] **Step 2: Run** — FAIL (initially sandbox-blocked local Postgres; after local-service access, fixture setup failed before endpoint assertions; corrected fixtures then exercised the implementation). **Step 3: Implement. Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(comparison): admin list and detail API` (deferred until the full feature is reviewed and ready for the approved branch → dev → main flow).

### Task 10: Admin tab

**Files:**
- Create: `apps/admin-web/src/pages/WorkflowComparisonsPage.tsx`
- Modify: `apps/admin-web/src/App.tsx` (route `/workflow-comparisons`, beside `/classify-service`), the sidebar nav definition (find where `/classify-service` is listed)
- Test: component-level only if the app already has page tests; otherwise manual verification below.

**Interfaces:**
- Consumes: the Task 2 and Task 9 endpoints via `apiFetch`/`apiErrorMessage` from `../lib/data`; `SearchableSelect` for status and source filters.
- Behaviour: settings strip (on/off toggle, backlog cap, retention days, "Cancel queued comparisons" with a confirm that states how many are queued, backlog counts shown even when off); table (source workflow, status, unsupported reason, created); filters and selected row id in the URL query per `docs/admin-url-routing-standard.md`; detail view with the three groups — **Inputs** (person, garment), **Original result**, **General result** — plus template version, workers, timings, error. Errors surface the real backend message (see the `surface-admin-errors` skill).

- [x] **Step 1: Build the page** against the API with loading, empty and error states.
- [x] **Step 2: Run** `pnpm --filter @aivastra/admin build` (runs `tsc -b && vite build`) — passed. Admin lint completed with 17 existing warnings in unrelated files/hooks; none in the new page.
- [ ] **Step 3: Verify in the running admin** (use the `run` skill): toggle on, see a collected row, open its detail, confirm URL state survives reload. Staging-backed verification is deferred to Task 11; not run locally.
- [ ] **Step 4: Commit** `feat(comparison): admin workflow comparisons tab`.

### Task 11: Staging verification and progress log

**Files:**
- Modify: `docs/progress.md` (new dated entry: Done / Failed-Not-Done / Open Questions, including the Task 7 audit table)

- [ ] **Step 1: Deploy to staging via the normal dev-branch flow** (do not run migrations or data changes against production by hand).
- [ ] **Step 2: On staging:** enable the feature, wait for a completed try-on job, confirm one replay job runs on the in-house worker, shows cost 0, appears in the new tab, and does not appear in any customer's history.
- [ ] **Step 3: Record results** in `docs/progress.md`, including anything not verified.
- [ ] **Step 4: Commit** `docs: record workflow comparison rollout`.

---

## Self-review notes

- **Spec coverage:** table/unique key (T1), settings and toggle (T2, T5, T6), eligibility (T3), collector with backlog cap and "no back-fill while off" (T4), zero-credit pool-only replay and dispatch rule (T5), retention and cancel queued (T6), exclusions for credits/webhooks/SSE/analytics/history (T7), erasure for Shopify GDPR and user deletion (T8), list/detail and filters (T9), admin tab (T10), rollout and verification (T11).
- **Spec "paths to handle" not verified:** T3 (widget input shape) and T7 (analytics/customer reads) are audit-first tasks by design.
- **Upload sweeper:** replay jobs reference source keys, which keeps shared garment keys protected; T7 includes confirming `personKey` handling.
