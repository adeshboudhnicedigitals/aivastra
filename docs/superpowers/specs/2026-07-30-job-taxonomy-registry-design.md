# Job Taxonomy Registry

**Status:** Approved design, not yet implemented.
**Date:** 2026-07-30

## 1. Problem Statement

"What kind of job is this" is answered by at least six independently-maintained, string-literal vocabularies scattered across `apps/api`, `apps/dispatcher`, and `apps/admin-web`. None of them import from, or are validated against, any of the others. This has already produced silent drift — the same job is tagged `source: 'catalog'` at insert time (`apps/api/src/modules/jobs/create.ts:726`) and `kind: 'catalogue'` in its own Prometheus counter three lines later (`apps/api/src/modules/jobs/create.ts:754`) — and a real functional gap: the admin Workers page cannot assign a worker to the `merchant` routing pool at all, because that pool's name is missing from both the page's hardcoded checkbox list and the API's Zod validator, even though the dispatcher has routed merchant/kiosk widget jobs through `selectWorker(redis, 'merchant')` for some time.

This document defines a single canonical registry — two related enums plus the one mapping between them — that every one of those six call sites derives from instead of reimplementing.

## 2. Current State (verified against code, not assumed)

Two genuinely distinct concepts exist today, both legitimately, and this design keeps them distinct rather than collapsing them:

- **Job source** — *what created the job* (a business/analytics-facing distinction). Stored in `jobs.source` (`packages/db/src/schema/jobs.ts:36`, freeform `text`, nullable). Written at 10 call sites across `apps/api/src/modules/{jobs,dev,merchant,shopify,kiosk}`, currently spelling **11 distinct values**: `catalog`, `tryon`, `catalog_video`, `saree`, `saree_mannequin`, `shopify`, `merchant_catalog`, `merchant_catalog_saree_mannequin`, `merchant_tryon`, `kiosk`, `api`.
- **Worker routing pool** — *which admin-managed worker capability a job needs* (an infra-facing distinction; the only thing `workers.allowed_job_types` and `selectWorker()` actually compare against). Called with **5 raw string literals** at 8 sites in `apps/dispatcher/src/job/processor.ts` and `mannequin-phase.ts`: `catalogue`, `tryon`, `saree` (×3 call sites), `merchant`, `shopify`.

Every source maps to exactly one pool (or, for `catalog_video`, to no ComfyUI pool at all — it's a PixVerse job and never claims a worker). That mapping exists today only as institutional knowledge spread across the two processor files; it is not written down anywhere as data.

Independently drifted copies found by direct inspection:

| Location | What it lists | Drift found |
|---|---|---|
| `apps/admin-web/src/pages/WorkersPage.tsx:6-32` | `JobType` union + `JOB_TYPES` array + label map | Missing `merchant` entirely — no admin UI can express it |
| `apps/api/src/modules/admin/workers.routes.ts:94,166` | Two separate `z.enum([...])` literals (POST + PATCH body) | Same omission — `merchant` is rejected by validation even if the frontend gap were fixed independently |
| `apps/api/src/modules/jobs/{create,createSaree,createSareeMannequin}.ts` (5 sites) | `jobsCreatedTotal.inc({ kind: '...' })` | `kind: 'catalogue'` vs `source: 'catalog'` for the identical job, in the identical function |
| `apps/admin-web/src/lib/data.ts:43-57` (`jobTypeBadge`) | Label/color map keyed by job-record kind | Contains 10 keys, one short of the 11 real `jobs.source` values — `catalog_video` has no entry, so catalog-video jobs fall through to the raw `\|\| ['', t]` fallback and render an unstyled badge showing the raw string instead of a real label |
| `apps/api/src/modules/admin/job-type.ts` (`jobTypeSql`) | `COALESCE` fallback for pre-`source`-column rows | Bare string literals `'tryon'`/`'catalog'` inside a raw `sql` template, not typed against anything |

`apps/admin-web` has zero workspace-package dependencies today (confirmed: not listed in `apps/admin-web/package.json` `dependencies`/`devDependencies`; `SareePage.tsx:9` explicitly notes its types "mirror the `@aivastra/types` ... schemas but are inlined"). This is an existing, deliberate boundary — this design does not cross it. `admin-web` continues to get taxonomy data over HTTP, the same way it gets every other list (faces, poses, catalog items) today.

## 3. Design Principle

**One registry, two levels, one mapping — nothing else hardcodes any part of it.**

The fine-grained taxonomy (job source) and the coarse split (worker pool) are both legitimate and stay separate — they answer different questions for different audiences (analytics vs. infra routing). What was wrong was never the two-level split; it was that both levels, and the relationship between them, were being reinvented per-file instead of declared once. This design centralizes the *declaration* and *mapping*, not the *distinction*.

## 4. The Registry

New file, `packages/types/src/job-taxonomy.ts` — chosen over a new package because `packages/types` already is, per `CLAUDE.md`, "the single source of truth for request/response shapes," and both enums here are exactly that: plain data contracts, not runtime classes (unlike `AppError`, which is why the sibling error-code drift documented in `docs/error-handling-plan.md` was scoped to a *new* `packages/errors` package instead — same underlying problem, different fix per the nature of what's drifting).

```ts
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
} as const;
export type JobSource = (typeof JOB_SOURCE)[keyof typeof JOB_SOURCE];

export const WORKER_POOL = {
  CATALOGUE: 'catalogue',
  TRYON: 'tryon',
  SAREE: 'saree',
  SHOPIFY: 'shopify',
  MERCHANT: 'merchant',
} as const;
export type WorkerPool = (typeof WORKER_POOL)[keyof typeof WORKER_POOL];

// The one place the source -> pool relationship is declared. null = this
// source never claims a ComfyUI worker (catalog_video is PixVerse-only).
export const SOURCE_TO_POOL: Record<JobSource, WorkerPool | null> = {
  catalog: 'catalogue',
  tryon: 'tryon',
  catalog_video: null,
  saree: 'saree',
  saree_mannequin: 'saree',
  shopify: 'shopify',
  merchant_catalog: 'merchant',
  merchant_catalog_saree_mannequin: 'merchant',
  merchant_tryon: 'merchant',
  kiosk: 'merchant',
  api_tryon: 'tryon',
  api_saree_mannequin: 'saree',
};

export const jobSourceSchema = z.enum([
  /* Object.values(JOB_SOURCE), spelled out for zod's literal-tuple requirement */
]);
export const workerPoolSchema = z.enum([
  /* Object.values(WORKER_POOL), spelled out */
]);
```

`JOB_SOURCE` gains two values relative to today's 11: `api` is split into `API_TRYON` / `API_SAREE_MANNEQUIN` (see §5) — net 12 values.

## 5. The `api` Split

`jobs.source = 'api'` is written by two different dev-API job creators today — `apps/api/src/modules/dev/create-job.ts` (dev tryon jobs) and `apps/api/src/modules/dev/create-saree-mannequin-job.ts` (dev saree-mannequin jobs) — both routed through the shared `createDevJobCore` helper, which hardcodes `source: 'api'` internally (`create-job.ts:40`). Because these two job kinds need different worker pools (`tryon` vs `saree`), a single `api` source cannot map to one pool in `SOURCE_TO_POOL`. This mirrors the pattern the codebase already uses for its other two-stage families (`saree` vs `saree_mannequin`, `merchant_catalog` vs `merchant_catalog_saree_mannequin`), so splitting `api` into `api_tryon` / `api_saree_mannequin` is consistent with existing naming, not a new convention.

This has read-side blast radius — `source = 'api'` is also used as a broad "any dev-API job" filter in three places that are not job-creation code:

- `apps/api/src/modules/dev/routes.ts:397` (`GET /v1/dev/jobs/:id` ownership scoping)
- `apps/api/src/modules/dev/catalog.routes.ts:349` (catalogue ownership scoping)
- `apps/api/src/modules/merchant/api-keys.routes.ts:132` (usage-stats query)

All three change from `eq(schema.jobs.source, 'api')` to `inArray(schema.jobs.source, [JOB_SOURCE.API_TRYON, JOB_SOURCE.API_SAREE_MANNEQUIN])`. `createDevJobCore` changes to accept `source: JobSource` as a required parameter instead of hardcoding it, and its two callers pass their respective value.

## 6. Consumers — from "own hardcoded list" to "derive from registry"

| # | File | Before | After |
|---|---|---|---|
| 1 | `apps/dispatcher/src/job/processor.ts` (6 sites), `mannequin-phase.ts` (1 site) | `selectWorker(redis, 'catalogue')` etc., raw string literals | `selectWorker(redis, WORKER_POOL.CATALOGUE)`. Where the job's `source` is already loaded in scope (e.g. `processWidgetJob`, which currently hardcodes `'merchant'` at line 1644 regardless of whether the job is `kiosk`/`merchant_catalog`/`merchant_tryon`), prefer `selectWorker(redis, SOURCE_TO_POOL[source])` so a future new source auto-routes without a new call site |
| 2 | `apps/api/src/modules/admin/workers.routes.ts:94,166` | Two independent `z.enum(['catalogue','tryon','saree','shopify'])` | `z.array(workerPoolSchema)` — fixes the `merchant` validation gap directly |
| 3 | `apps/api/src/modules/jobs/create.ts` (×3), `createSaree.ts`, `createSareeMannequin.ts` — `jobsCreatedTotal.inc({ kind: '...' })` | Ad-hoc string per call site | `jobsCreatedTotal.inc({ kind: JOB_SOURCE.CATALOG })` etc. — fixes the `catalog`/`catalogue` metric mismatch |
| 4 | `apps/api/src/modules/admin/job-type.ts` (`jobTypeSql`) | Bare `'tryon'`/`'catalog'` literals in a `sql` template | Interpolate `JOB_SOURCE.TRYON`/`JOB_SOURCE.CATALOG` into the template instead |
| 5 | New route: `GET /admin/workers/job-types` | — | Returns `Object.values(WORKER_POOL)`, same read-role guard as `GET /admin/workers` (`requireAdmin(['SUPER_ADMIN','MODERATOR','SUPPORT','ADMIN'])`) |
| 6 | `apps/admin-web/src/pages/WorkersPage.tsx` | Hardcoded `JobType` union, `JOB_TYPES`, `JOB_TYPE_LABELS` | Fetch `/admin/workers/job-types` on mount (same `apiFetch`/`toast` pattern already used elsewhere on this page); `allowedJobTypes` becomes `string[]`; labels rendered via a small local capitalize-fallback rather than a hand-maintained map, since the server is now the only source of the *set* of values |
| 7 | `apps/admin-web/src/lib/data.ts` (`jobTypeBadge`) | Hardcoded label/color map, unchecked against reality | Labels/colors **stay** local (legitimate presentation data — colors are not a backend concern) — but add a unit test asserting the map's key set is a superset of the 12 canonical `JOB_SOURCE` values, so a future 13th source can't silently fall through to `\|\| ['', t]` unnoticed |
| 8 | `apps/api/src/modules/dev/create-job.ts`, `create-saree-mannequin-job.ts`, `dev/routes.ts:397`, `dev/catalog.routes.ts:349`, `merchant/api-keys.routes.ts:132` | Hardcoded `source: 'api'` / `eq(source, 'api')` | Per §5 |

## 7. Explicitly Out of Scope

- **Repo-wide taxonomy audit** (routes, themes, middleware, Postman collections, or the pre-existing error-code drift documented in `docs/error-handling-plan.md`). This spec fixes the job-type instance of the "no central registry" pattern only, per explicit scope decision during design.
- **Merging job source and worker pool into one enum.** Considered and rejected — they answer different questions for different audiences (business/analytics vs. infra capability) and collapsing them would force either the admin Jobs page to show only 5 coarse buckets, or the Workers page to expose 12 fine-grained checkboxes for a routing decision that only has 5 real answers. Keeping them separate, with one explicit mapping, is the correct shape; the bug was the absence of that one mapping, not the presence of two levels.
- **Changing `jobs.source` from `text` to a DB enum/CHECK constraint.** `garment_shot_type_workflows`/`catalog_items.type` precedent in this codebase already favors Zod-validated free text over DB enums for exactly this kind of admin-adjacent taxonomy (cited in `docs/superpowers/specs/2026-07-16-garment-taxonomy-architecture-design.md:54`, "adding a category later is a one-line change, not a migration"). The registry gives compile-time + runtime (Zod) safety on the application side without adding migration friction to the column itself.
- **Prometheus label cardinality changes** beyond fixing the existing spelling mismatch — no new labels added.

## 8. Verification

- `pnpm --filter @aivastra/types typecheck` (new file compiles, Zod enums are non-empty)
- `pnpm --filter @aivastra/api test` — full suite green, plus new/updated tests: `POST /admin/workers` accepts `merchant` (regression test for the fixed gap), `GET /admin/workers/job-types` returns all 5 pools, the three `source = 'api'` read-side filters still find both dev-API job kinds after the split
- `pnpm --filter @aivastra/dispatcher test` — existing integration suites (`shopify.test.ts`, `saree-mannequin.test.ts`, `merchant-catalog-mannequin.test.ts`, etc.) pass unchanged, since registry values are byte-identical to today's literals
- `apps/admin-web` unit test: `jobTypeBadge`'s key set is a superset of `JOB_SOURCE` values
- Manual: Workers page → Add Worker → `merchant` checkbox present and savable; Jobs page badges unchanged for existing job records
