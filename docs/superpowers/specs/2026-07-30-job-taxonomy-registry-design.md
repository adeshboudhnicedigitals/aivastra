# Job Taxonomy Registry

**Status:** Approved design, not yet implemented. Revised after review — see §10.
**Date:** 2026-07-30

## 1. Problem Statement

"What kind of job is this" is answered by at least eight independently-maintained, string-literal vocabularies scattered across `apps/api`, `apps/dispatcher`, and `apps/admin-web`. None of them import from, or are validated against, any of the others. This has already produced silent drift — the same job is tagged `source: 'catalog'` at insert time (`apps/api/src/modules/jobs/create.ts:726`) and `kind: 'catalogue'` in its own Prometheus counter three lines later (`apps/api/src/modules/jobs/create.ts:754`) — and a real functional gap: the admin Workers page cannot assign a worker to the `merchant` routing pool at all, because that pool's name is missing from both the page's hardcoded checkbox list and the API's Zod validator, even though the dispatcher has routed merchant/kiosk widget jobs through `selectWorker(redis, 'merchant')` for some time.

This document defines a single canonical registry that every one of those call sites derives from instead of reimplementing.

## 2. Current State (verified against code, not assumed)

Two genuinely distinct concepts exist today, both legitimately, and this design keeps them distinct rather than collapsing them:

- **Job source** — *what created the job* (a business/analytics-facing distinction). Stored in `jobs.source` (`packages/db/src/schema/jobs.ts:36`, freeform `text`, nullable). Written at 11 call sites across `apps/api/src/modules/{jobs,dev,merchant,shopify,kiosk}`, currently spelling **11 distinct values**: `catalog`, `tryon`, `catalog_video`, `saree`, `saree_mannequin`, `shopify`, `merchant_catalog`, `merchant_catalog_saree_mannequin`, `merchant_tryon`, `kiosk`, `api`.
- **Worker routing pool** — *which admin-managed worker capability a job needs at a given processing phase* (an infra-facing distinction; the only thing `workers.allowed_job_types` and `selectWorker()` actually compare against). Called with **5 raw string literals** at **7 sites** in `apps/dispatcher/src/job/processor.ts` (6) and `mannequin-phase.ts` (1): `catalogue`, `tryon`, `saree` (×3 call sites), `merchant`, `shopify`.

**A source does not map to exactly one pool.** `merchant_catalog` jobs are explicitly documented as "an ordinary `jobs.userId`-owned studio job — NOT a `merchantId`-owned job" (`apps/api/src/modules/merchant/create-job.ts:28-30`), so they skip widget routing and run the plain catalogue path (`processor.ts:423`, pool `catalogue`); when the garment type requires it, the *same job* also runs `runMannequinPhase` first (`processor.ts:307`), which independently claims pool `saree` (`mannequin-phase.ts:66`). The dispatcher already routes correctly today — each processing function claims the specific pool its own phase needs, never by reading `jobs.source` — so this design does not introduce a source→pool mapping (see §4, and why one was rejected in §9).

`api` is written by **three**, not two, distinct dev-API job creators (§5), and `jobs.source` values are independently re-hardcoded a fourth time on the dispatcher side, not just the API side: `apps/dispatcher/src/stream/sweeper.ts:15` (`const VIDEO_SOURCE = 'catalog_video'`).

Independently drifted copies found by direct inspection:

| Location | What it lists | Drift found |
|---|---|---|
| `apps/admin-web/src/pages/WorkersPage.tsx:6-32` | `JobType` union + `JOB_TYPES` array + label map | Missing `merchant` entirely — no admin UI can express it |
| `apps/api/src/modules/admin/workers.routes.ts:94,166` | Two separate `z.enum([...])` literals (POST + PATCH body) | Same omission — `merchant` is rejected by validation even if the frontend gap were fixed independently |
| `apps/api/src/modules/jobs/{create,createSaree,createSareeMannequin}.ts` (5 sites) | `jobsCreatedTotal.inc({ kind: '...' })` | `kind: 'catalogue'` vs `source: 'catalog'` for the identical job, in the identical function |
| `apps/admin-web/src/lib/data.ts:43-57` (`jobTypeBadge`) | Label/color map keyed by job-record kind | Contains 10 keys, one short of the 11 real `jobs.source` values — `catalog_video` has no entry, so catalog-video jobs fall through to the raw `\|\| ['', t]` fallback and render an unstyled badge showing the raw string instead of a real label |
| `apps/api/src/modules/admin/job-type.ts` (`jobTypeSql`) | `COALESCE` fallback for pre-`source`-column rows | Bare string literals `'tryon'`/`'catalog'` inside a raw `sql` template, not typed against anything |
| `apps/api/src/modules/jobs/create.ts:637` (`createJob`) | `opts?.source?: string` parameter, default `?? 'catalog'` at line 726 | Untyped `string` accepts any value from any caller; the fallback default is a bare literal |
| `apps/api/src/modules/admin/credit-analysis.routes.ts:8` | `const SOURCES = ['catalog','tryon','saree','kiosk','shopify']` | A fifth independent list (deliberately a curated filter subset, not all 11 — see §7 — but its members are hand-typed, not referenced) |
| `apps/dispatcher/src/stream/sweeper.ts:15` | `const VIDEO_SOURCE = 'catalog_video'` | Sixth independent hardcode, and the only one on the dispatcher side |

`apps/admin-web` has zero workspace-package dependencies today (confirmed: not listed in `apps/admin-web/package.json` `dependencies`/`devDependencies`, and it has no test script or test runner dependency at all; `SareePage.tsx:9` explicitly notes its types "mirror the `@aivastra/types` ... schemas but are inlined"). This is an existing, deliberate boundary — this design does not cross it (see §8 for how that constrains verification of the admin-web badge map).

## 3. Design Principle

**One registry, two levels, no invented third thing — nothing else hardcodes any part of it.**

The fine-grained taxonomy (job source) and the coarse split (worker pool) are both legitimate and stay separate — they answer different questions for different audiences (analytics vs. infra routing). What was wrong was never the two-level split; it was that both levels were being reinvented per-file instead of declared once. This design centralizes the *declaration*, not the *distinction* — and, per §9, deliberately does not centralize a *relationship* between the two levels, because none exists that a static table can correctly express.

## 4. The Registry

New file, `packages/types/src/job-taxonomy.ts` — chosen over a new package because `packages/types` already is, per `CLAUDE.md`, "the single source of truth for request/response shapes," and both enums here are exactly that: plain data contracts, not runtime classes (unlike `AppError`, which is why the sibling error-code drift documented in `docs/error-handling-plan.md` was scoped to a *new* `packages/errors` package instead — same underlying problem, different fix per the nature of what's drifting).

```ts
import { z } from 'zod';

export const JOB_SOURCE = {
  CATALOG: 'catalog',
  TRYON: 'tryon',
  CATALOG_VIDEO: 'catalog_video',
  SAREE: 'saree',
  SAREE_MANNEQUIN: 'saree_mannequin',
  SHOPIFY: 'shopify',
  MERCHANT_CATALOG: 'merchant_catalog',
  MERCHANT_CATALOG_SAREE_MANNEQUIN: 'merchant_catalog_saree_mannequin',
  MERCHANT_TRYON: 'merchant_tryon',
  KIOSK: 'kiosk',
  API_TRYON: 'api_tryon',
  API_SAREE_MANNEQUIN: 'api_saree_mannequin',
  API_CATALOG: 'api_catalog',
} as const;
export type JobSource = (typeof JOB_SOURCE)[keyof typeof JOB_SOURCE];
export const jobSourceSchema = z.enum(
  Object.values(JOB_SOURCE) as [JobSource, ...JobSource[]],
);

export const WORKER_POOL = {
  CATALOGUE: 'catalogue',
  TRYON: 'tryon',
  SAREE: 'saree',
  SHOPIFY: 'shopify',
  MERCHANT: 'merchant',
} as const;
export type WorkerPool = (typeof WORKER_POOL)[keyof typeof WORKER_POOL];
export const workerPoolSchema = z.enum(
  Object.values(WORKER_POOL) as [WorkerPool, ...WorkerPool[]],
);
```

No `SOURCE_TO_POOL` mapping exists in this registry — see §9 for why one was drafted, then rejected.

`JOB_SOURCE` has 13 values: the 11 found in §2, minus `api` (split, see §5), plus `api_tryon` / `api_saree_mannequin` / `api_catalog`. 11 − 1 + 3 = 13.

## 5. The `api` Split (three-way)

`jobs.source = 'api'` is written by **three** dev-API job creators, verified by tracing each to its dispatcher routing:

| Creator | job_inputs shape (verified) | Dispatcher route | Pool |
|---|---|---|---|
| `apps/api/src/modules/dev/create-job.ts` `createDevTryonJob` (line 155: `upperGarmentKey`, `params.personKey`, no `faceId`) | no `faceId`/`backgroundId`/`poseId`, `params.personKey` set | `processor.ts`'s `!faceId && !backgroundId && !poseId && rawParams.personKey` branch → `processTryonDirectJob` | `tryon` |
| `apps/api/src/modules/dev/create-saree-mannequin-job.ts` (line 73: `params: { kind: 'saree_mannequin', ... }`) | `params.kind === 'saree_mannequin'` | `processor.ts`'s `rawParams.kind === 'saree_mannequin'` branch → `processSareeMannequinJob` | `saree` |
| `apps/api/src/modules/dev/catalog.routes.ts:292` (calls the shared `createJob()`, same function studio uses) | real `faceId`/`garmentTypeId`, resolved via `resolveTryonPlan` — a genuine catalogue-shaped job | `processor.ts`'s regular-job path (all three of `faceId`/`backgroundId`/`poseId` present) | `catalogue` |

Each of the three maps to exactly one pool with no conditional branching — unlike `merchant_catalog` (§2), this split is clean. This mirrors the naming the codebase already uses for its other two/three-stage families (`saree` vs `saree_mannequin`, `merchant_catalog` vs `merchant_catalog_saree_mannequin`), so `api_tryon` / `api_saree_mannequin` / `api_catalog` is consistent with existing convention, not a new one.

**Read-side blast radius.** `source = 'api'` is also used as a broad "any dev-API job" filter in three places that are not job-creation code:

- `apps/api/src/modules/dev/routes.ts:397` (`GET /v1/dev/jobs/:id` ownership scoping)
- `apps/api/src/modules/dev/catalog.routes.ts:349` (catalogue ownership scoping)
- `apps/api/src/modules/merchant/api-keys.routes.ts:132` (usage-stats query)

All three change from `eq(schema.jobs.source, 'api')` to `inArray(schema.jobs.source, [JOB_SOURCE.API_TRYON, JOB_SOURCE.API_SAREE_MANNEQUIN, JOB_SOURCE.API_CATALOG])`. `createDevJobCore` (`create-job.ts:16-40`) changes to accept `source: JobSource` as a required parameter instead of hardcoding `source: 'api'` internally; its two callers (`createDevTryonJob`, `createDevSareeMannequinJob`) pass `JOB_SOURCE.API_TRYON` / `JOB_SOURCE.API_SAREE_MANNEQUIN`. `dev/catalog.routes.ts:292` passes `JOB_SOURCE.API_CATALOG` directly to `createJob`'s (now-typed) `opts.source`.

## 6. Migration for Historical `source = 'api'` Rows

Switching the three read filters in §5 to match only the three new values would make every dev-API job created *before* this change invisible to its own status/catalogue/usage endpoints. A backfill migration is required before (or atomically with) the code change ships.

**Classification signals**, verified against the shapes in §5's table, applied in specificity order:

```sql
-- 1. Most specific: saree-mannequin jobs carry a distinctive params.kind
UPDATE jobs SET source = 'api_saree_mannequin'
WHERE source = 'api'
  AND id IN (SELECT job_id FROM job_inputs WHERE params->>'kind' = 'saree_mannequin');

-- 2. Catalogue jobs are the only api-sourced shape with a resolved face
UPDATE jobs SET source = 'api_catalog'
WHERE source = 'api'
  AND id IN (SELECT job_id FROM job_inputs WHERE face_id IS NOT NULL);

-- 3. Everything else was tryon-direct (personKey-shaped, or a job with no
--    job_inputs row at all — see the test-fixture note below)
UPDATE jobs SET source = 'api_tryon'
WHERE source = 'api';
```

**Verification**, mirroring the precedent already used in this repo's design docs (`docs/superpowers/specs/2026-07-16-garment-taxonomy-architecture-design.md` §11, "verified before Phase 3 begins by a read-only comparison query"): before running, record `SELECT count(*) FROM jobs WHERE source = 'api'`; after running, confirm that count is 0 and that `count(api_tryon) + count(api_saree_mannequin) + count(api_catalog)` (post-migration) equals the pre-migration count.

**Deploy ordering.** This repo has no blue-green or feature-flag infrastructure to stage the migration separately from the code (`CLAUDE.md`'s only documented path is `db:generate` → PR → CI/CD → `db:migrate:prod`, run before the app restarts on new code) — so no separate dual-read/rollback window is introduced; the migration and the writer/reader code change ship in the same deploy, migration first, per that existing pipeline order. This is a deliberate scope boundary: inventing phased-rollout infrastructure that doesn't exist elsewhere in the codebase, for one migration, would be disproportionate.

**Test fixtures.** `apps/api/test/merchant-api-keys.test.ts:181,210` and `apps/api/test/dev-read-routes.test.ts:59` insert bare `source: 'api'` rows directly, with no `job_inputs` row at all (verified — neither test creates one). Under the signals above these fall through to the `api_tryon` default, which is a safe but arbitrary classification since both tests exercise generic ownership/status logic, not tryon-specific behavior. Update both to insert `JOB_SOURCE.API_TRYON` directly rather than relying on the migration's fallback (these are new test writes, not historical data — they should state their intent, not depend on backfill precedence).

## 7. Consumers — from "own hardcoded list" to "derive from registry"

| # | File | Before | After |
|---|---|---|---|
| 1 | `apps/dispatcher/src/job/processor.ts` (6 sites), `mannequin-phase.ts` (1 site) | `selectWorker(redis, 'catalogue')` etc., raw string literals | `selectWorker(redis, WORKER_POOL.CATALOGUE)` etc. — each call site keeps claiming the pool its own phase needs, exactly as today; only the value's origin changes from a string literal to a typed constant. No call site derives its pool from `jobs.source` (see §9) |
| 2 | `apps/api/src/modules/admin/workers.routes.ts:94,166` | Two independent `z.enum(['catalogue','tryon','saree','shopify'])` | `z.array(workerPoolSchema)` — fixes the `merchant` validation gap directly |
| 3 | `apps/api/src/modules/jobs/create.ts` (×3), `createSaree.ts`, `createSareeMannequin.ts` — `jobsCreatedTotal.inc({ kind: '...' })` | Ad-hoc string per call site | `jobsCreatedTotal.inc({ kind: JOB_SOURCE.CATALOG })` etc. — fixes the `catalog`/`catalogue` metric mismatch |
| 4 | `apps/api/src/modules/admin/job-type.ts` (`jobTypeSql`) | Bare `'tryon'`/`'catalog'` literals in a `sql` template | Interpolate `JOB_SOURCE.TRYON`/`JOB_SOURCE.CATALOG` into the template instead |
| 5 | `apps/api/src/modules/jobs/create.ts:626-726` (`createJob`) | `opts?: { ...; source?: string }`, defaults to bare `'catalog'` | `opts?: { ...; source?: JobSource }`, defaults to `JOB_SOURCE.CATALOG` |
| 6 | `apps/api/src/modules/admin/credit-analysis.routes.ts:8` | `const SOURCES = ['catalog','tryon','saree','kiosk','shopify']` | `const SOURCES = [JOB_SOURCE.CATALOG, JOB_SOURCE.TRYON, JOB_SOURCE.SAREE, JOB_SOURCE.KIOSK, JOB_SOURCE.SHOPIFY]` — stays a curated 5-of-13 filter subset (unchanged behavior — `kiosk`/`shopify` here are derived conditions, not literal `source` equality, see the existing `sourceCondition` switch), values now referenced not retyped |
| 7 | `apps/dispatcher/src/stream/sweeper.ts:15` | `const VIDEO_SOURCE = 'catalog_video'` | `const VIDEO_SOURCE = JOB_SOURCE.CATALOG_VIDEO` |
| 8 | New route: `GET /admin/workers/job-types` | — | Returns `Object.values(WORKER_POOL)`, same read-role guard as `GET /admin/workers` (`requireAdmin(['SUPER_ADMIN','MODERATOR','SUPPORT','ADMIN'])`) |
| 9 | New route: `GET /admin/jobs/sources` | — | Returns `Object.values(JOB_SOURCE)` — the API-contract exposure §8 resolves the admin-web boundary with |
| 10 | `apps/admin-web/src/pages/WorkersPage.tsx` | Hardcoded `JobType` union, `JOB_TYPES`, `JOB_TYPE_LABELS` | Fetch `/admin/workers/job-types` on mount (same `apiFetch`/`toast` pattern already used elsewhere on this page); `allowedJobTypes` becomes `string[]`; labels rendered via a small local capitalize-fallback rather than a hand-maintained map, since the server is now the only source of the *set* of values |
| 11 | `apps/admin-web/src/lib/data.ts` (`jobTypeBadge`) | Hardcoded label/color map, unchecked against reality | See §8 — labels/colors stay local, but the map's completeness is now covered by an API-side (not admin-web-side) test, plus a runtime fallback warning |
| 12 | `apps/api/src/modules/dev/create-job.ts`, `create-saree-mannequin-job.ts`, `dev/routes.ts:397`, `dev/catalog.routes.ts:349`, `merchant/api-keys.routes.ts:132` | Hardcoded `source: 'api'` / `eq(source, 'api')` | Per §5 |
| 13 | `apps/api/test/merchant-api-keys.test.ts`, `apps/api/test/dev-read-routes.test.ts` | Bare `source: 'api'` in seeded fixtures | `source: JOB_SOURCE.API_TRYON` (per §6) |

## 8. Admin-Web Badge Map — Resolving the Boundary Contradiction

`admin-web` has no test runner today (`apps/admin-web/package.json` has no `test` script and no test-framework dependency), and this design deliberately does not give it a `@aivastra/types` import (§2). A unit test that asserts `jobTypeBadge`'s keys against `JOB_SOURCE` would require both — contradicting the boundary in the same change that states it. Introducing a test runner into `admin-web` solely for this one assertion is disproportionate new infrastructure for what it buys.

Resolution, using the alternative the boundary itself suggests — expose the contract, test the contract where test infrastructure already exists:

- The new `GET /admin/jobs/sources` route (§7, item 9) is the authoritative, fetchable list.
- An **API-side** test (existing vitest infra, `apps/api/test/`) asserts the route returns exactly the 13 `JOB_SOURCE` values — this is real, running coverage of the registry's completeness, just not of `admin-web`'s presentation map specifically.
- `jobTypeBadge` keeps its existing `m[t] || ['', t]` fallback behavior unchanged (no admin-web logic change beyond what §7 item 11 already implies), but the fallback branch gains a `console.warn` in that branch so an unrecognized key is visible in the browser console during real use — a cheap, immediate signal that doesn't require new test infrastructure in a package that has none.
- No test script or test dependency is added to `apps/admin-web` by this design.

## 9. Rejected Alternative: `SOURCE_TO_POOL` Mapping

An earlier draft of this spec included `SOURCE_TO_POOL: Record<JobSource, WorkerPool | null>`, a static one-source-to-one-pool table, and suggested dispatcher call sites derive their pool from it. Rejected on two grounds, found during review:

1. **It's factually wrong for `merchant_catalog`** (§2) — that source can claim two different pools for the same job, sequentially, conditional on `job_inputs.params.needsMannequinStep`, which a static `Record<JobSource, WorkerPool>` cannot express without either lying (picking one) or becoming array-valued.
2. **Even array-valued, nothing would consume it.** Every real dispatch call site already knows exactly which pool its own phase needs — that's how the dispatcher works today, correctly, and this design doesn't change dispatcher behavior, only where the pool-name string constants come from (§7, item 1). A `SOURCE_POOLS: Record<JobSource, WorkerPool[]>` map with no reader would be speculative surface added on spec, which this codebase's own architecture docs argue against (`docs/superpowers/specs/2026-07-16-garment-taxonomy-architecture-design.md` §13: new abstractions are added "only once a second concrete use case exists").

If a real second use case for a source→pool(s) relationship appears later (e.g. an admin dashboard panel), it should be added then, as its own reviewed change, backed by the consumer that actually needs it.

## 10. Explicitly Out of Scope

- **Repo-wide taxonomy audit** (routes, themes, middleware, Postman collections, or the pre-existing error-code drift documented in `docs/error-handling-plan.md`). This spec fixes the job-type instance of the "no central registry" pattern only, per explicit scope decision during design.
- **Merging job source and worker pool into one enum.** Considered and rejected — they answer different questions for different audiences (business/analytics vs. infra capability) and collapsing them would force either the admin Jobs page to show only 5 coarse buckets, or the Workers page to expose 13 fine-grained checkboxes for a routing decision that only has 5 real answers.
- **A source→pool mapping of any shape.** See §9.
- **Changing `jobs.source` from `text` to a DB enum/CHECK constraint.** `garment_shot_type_workflows`/`catalog_items.type` precedent in this codebase already favors Zod-validated free text over DB enums for exactly this kind of admin-adjacent taxonomy (cited in `docs/superpowers/specs/2026-07-16-garment-taxonomy-architecture-design.md:54`, "adding a category later is a one-line change, not a migration"). The registry gives compile-time + runtime (Zod) safety on the application side without adding migration friction to the column itself.
- **Prometheus label cardinality changes** beyond fixing the existing spelling mismatch — no new labels added.
- **New rollout/staging infrastructure** (blue-green, feature flags) for the §6 migration — none exists elsewhere in this codebase; the existing migrate-then-deploy pipeline is used as-is.
- **A test runner for `apps/admin-web`.** See §8 — the boundary is resolved via an API contract test instead.

## 11. Verification

- `pnpm --filter @aivastra/types typecheck` (new file compiles, both Zod enums are non-empty tuples)
- `pnpm --filter @aivastra/api test` — full suite green, plus new/updated tests: `POST /admin/workers` accepts `merchant` (regression test for the fixed gap), `GET /admin/workers/job-types` returns all 5 pools, `GET /admin/jobs/sources` returns all 13 sources, the three `source = 'api'` read-side filters find all three dev-API job kinds after the split, the §6 backfill migration classifies a seeded `saree_mannequin`/`catalog`/`tryon`-shaped legacy `api` row correctly
- `pnpm --filter @aivastra/dispatcher test` — existing integration suites (`shopify.test.ts`, `saree-mannequin.test.ts`, `merchant-catalog-mannequin.test.ts`, sweeper tests, etc.) pass unchanged, since registry values are byte-identical to today's literals
- Manual: Workers page → Add Worker → `merchant` checkbox present and savable; Jobs page badges unchanged for existing job records; browser console shows a warning if any job's badge falls through (should not occur post-migration)
