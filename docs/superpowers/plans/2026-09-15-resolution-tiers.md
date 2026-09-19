# Fixed HD/2K/4K Resolution Tiers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace pixel-threshold auto-classification of Studio output resolution with three fixed, admin-configured HD/2K/4K tiers (long edge in px); the short edge is derived from the aspect ratio by formula for all six ratios.

**Architecture:** A single shared formula (`computeOutputDims`) in `packages/types` replaces the per-ratio admin dimension table. The server trusts the client's tier *selection* (validated enum, checked against `enabled`) but always resolves the actual pixel numbers itself from admin config — same "trust the choice, not the numbers" pattern already used for aspect ratio. Studio's read-only "Auto" badge becomes a real 3-pill selector reused for both preset and custom-ratio paths.

**Tech Stack:** TypeScript, Zod, Fastify, Redis (`config:system` key), React/Next.js (Studio), Vite/React (admin-web), Vitest.

## Global Constraints

- No feature flag, no dual-read period — hard cut-over per this repo's "no compat shims" convention (`CLAUDE.md`).
- Never trust a client-sent pixel number; only a validated enum choice (aspect ratio, resolution tier) — existing invariant, extended not weakened.
- `packages/db/src/index.ts`'s `* as schema` re-export pattern — do not duplicate.
- Import `@aivastra/types`/`@aivastra/db` as `workspace:*`, never by relative path from `packages/`.
- Credit deduct + job insert stay one Postgres transaction — untouched by this plan.
- Comment density/style must match the surrounding file (this codebase comments the *why*).

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/types/src/jobs.ts` | `ASPECT_RATIOS` + `computeOutputDims` (new); widen `aspectRatio` enum to 6 ratios (2 places); `RESOLUTION_COSTS`/`Resolution` unchanged; `resolutionFromDims`/`ASPECT_DIMENSIONS` stay defined, unused by the primary path (dispatcher fallback only) |
| `packages/types/src/admin.ts` | `SystemConfigBody`: `ResolutionConfig` gains `longEdgePx`; drop `maxOutputPx`/`aspectDimensions`; add `merchantCatalogResolution` |
| `packages/types/src/batch.ts` | Widen `aspectRatio` enum to 6 ratios |
| `packages/types/src/dev.ts` | Widen `aspectRatio` enum to 6 ratios |
| `apps/api/src/lib/resolution-config.ts` | `DEFAULT_RESOLUTION_CONFIG` gains `longEdgePx`; new `getResolutionTierConfig`; drop `DEFAULT_MAX_OUTPUT_PX`/`DEFAULT_ASPECT_DIMENSIONS`/`mergeAspectDimensions`/`getAspectDimensions`/`getMaxOutputPx`; add `DEFAULT_MERCHANT_CATALOG_RESOLUTION` |
| `apps/api/src/modules/admin/config.routes.ts` | `GET /v1/config/resolutions`, `GET/PATCH /admin/config` — drop `maxOutputPx`/`aspectDimensions` handling, add `merchantCatalogResolution` default-fill |
| `apps/api/src/modules/jobs/create.ts` | `resolveTryonPlan` — tier-based dims computation, enabled-tier check, updated `TryonPlanCache` |
| `apps/api/src/modules/merchant/create-job.ts` | Tier-based dims computation for the merchant-catalog auto path |
| `apps/admin-web/src/pages/settings/JobCostsTab.tsx` | Add `longEdgePx` input per HD/2K/4K row |
| `apps/admin-web/src/pages/SettingsPage.tsx` | Remove "Max Output Resolution" + "Aspect Ratio Sizes"; add "Merchant Catalog Resolution" dropdown |
| `apps/catalogues-web/.../studio/page.tsx` | Real HD/2K/4K picker; drop local `ASPECT_DIMS`/`ASPECT_PX`/`resolutionFromOutputDims` duplicates |
| Tests | `packages/types` new unit test; `apps/api/test/integration/admin-config.test.ts`, `jobs-create.test.ts`, `saree-mannequin-job.test.ts` updated |

**Verified test-fixture fact:** grepping `apps/api/test` for `resolution: '...'` shows every file already uses `'2K'` (enabled by default) **except** `saree-mannequin-job.test.ts`, which uses `'HD'` seven times. Since `HD.enabled = false` by default, this plan's new "reject a disabled tier" check would 400 those seven tests unless they're updated — Task 4 fixes this.

---

### Task 1: Shared dims formula + widened aspect-ratio enums

**Files:**
- Modify: `packages/types/src/jobs.ts:1-114`
- Modify: `packages/types/src/admin.ts:112-165`
- Modify: `packages/types/src/batch.ts:45`
- Modify: `packages/types/src/dev.ts:149`
- Test: `packages/types/test/jobs.test.ts` (create if it doesn't exist)

**Interfaces:**
- Produces: `ASPECT_RATIOS: Record<string, {w:number;h:number}>`, `computeOutputDims(ratio: string, longEdgePx: number): {width:number;height:number}` (throws `Error` on unknown ratio) — both exported from `@aivastra/types`.
- Produces: `SystemConfigBody.resolutions.{HD,2K,4K}.longEdgePx: number`, `SystemConfigBody.merchantCatalogResolution?: 'HD'|'2K'|'4K'`.
- `CreateTryOnJobRequest.aspectRatio`, the saree-step2 `aspectRatio` field, `CreateBatchJobRequest.aspectRatio`, `DevCatalogGenerateJsonBody.aspectRatio` all become `z.enum(['1:1','2:3','3:4','4:5','9:16','16:9'])`.

- [ ] **Step 1: Check for an existing types test dir, write the failing test**

Run: `ls packages/types/test 2>/dev/null || echo "none"` — if none, create `packages/types/test/jobs.test.ts`.

```ts
import { describe, expect, it } from 'vitest';
import { ASPECT_RATIOS, computeOutputDims } from '../src/jobs.js';

describe('computeOutputDims', () => {
  it('puts the long edge on width for a landscape ratio (16:9)', () => {
    expect(computeOutputDims('16:9', 3200)).toEqual({ width: 3200, height: 1800 });
  });

  it('puts the long edge on height for a portrait ratio (2:3)', () => {
    expect(computeOutputDims('2:3', 3200)).toEqual({ width: 2133, height: 3200 });
  });

  it('keeps width and height equal for a square ratio (1:1)', () => {
    expect(computeOutputDims('1:1', 3200)).toEqual({ width: 3200, height: 3200 });
  });

  it('handles the portrait 9:16 ratio (no longer a client-only special case)', () => {
    expect(computeOutputDims('9:16', 4096)).toEqual({ width: 2304, height: 4096 });
  });

  it('throws on an unknown ratio', () => {
    expect(() => computeOutputDims('7:3', 2688)).toThrow('Unknown aspect ratio: 7:3');
  });

  it('every ratio used by CreateTryOnJobRequest has a formula entry', () => {
    for (const r of ['1:1', '2:3', '3:4', '4:5', '9:16', '16:9']) {
      expect(ASPECT_RATIOS[r]).toBeDefined();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `packages/types`): `npx vitest run test/jobs.test.ts`
Expected: FAIL — `computeOutputDims`/`ASPECT_RATIOS` not exported yet (or test file/dir doesn't resolve).

- [ ] **Step 3: Add `ASPECT_RATIOS` + `computeOutputDims` to `jobs.ts`**

Insert immediately after the existing `resolutionFromDims` function (`packages/types/src/jobs.ts:24-30`), leaving `ASPECT_DIMENSIONS`/`resolutionFromDims` themselves untouched (dispatcher fallback still uses them, see plan header):

```ts
/**
 * Ratio parts for every aspect ratio the platform supports. The larger part
 * (w vs h) tells computeOutputDims() which physical dimension gets the tier's
 * long-edge value — landscape/square ratios put it on width, portrait ratios
 * put it on height.
 */
export const ASPECT_RATIOS: Record<string, { w: number; h: number }> = {
  '1:1': { w: 1, h: 1 },
  '2:3': { w: 2, h: 3 },
  '3:4': { w: 3, h: 4 },
  '4:5': { w: 4, h: 5 },
  '9:16': { w: 9, h: 16 },
  '16:9': { w: 16, h: 9 },
};

/**
 * Derives a job's output pixel dimensions from an aspect ratio and the
 * admin-configured long-edge value for the requested resolution tier — the
 * single formula that replaced the old per-ratio admin dimension table (one
 * admin-set number per tier, not nine).
 */
export function computeOutputDims(
  ratio: string,
  longEdgePx: number,
): { width: number; height: number } {
  const r = ASPECT_RATIOS[ratio];
  if (!r) throw new Error(`Unknown aspect ratio: ${ratio}`);
  return r.w >= r.h
    ? { width: longEdgePx, height: Math.round((longEdgePx * r.h) / r.w) }
    : { width: Math.round((longEdgePx * r.w) / r.h), height: longEdgePx };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/jobs.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Widen the four `aspectRatio` enums**

`packages/types/src/jobs.ts:111` (inside `CreateTryOnJobRequest`) and `packages/types/src/jobs.ts:243` (inside `CreateSareeMannequinJobRequest`'s `step2`):
```ts
  aspectRatio: z.enum(['1:1', '2:3', '3:4', '4:5', '9:16', '16:9']),
```
(replace both instances of `z.enum(['1:1', '2:3', '3:4', '4:5'])`, leave the adjacent `resolution: z.enum(['HD', '2K', '4K'])` untouched)

`packages/types/src/batch.ts:45` (inside `CreateBatchJobRequest`) — same replacement.

`packages/types/src/dev.ts:149` (inside `DevCatalogGenerateJsonBody`) — same replacement.

- [ ] **Step 6: Update `SystemConfigBody` in `admin.ts`**

Replace `packages/types/src/admin.ts:112-165`:
```ts
const ResolutionConfig = z.object({
  enabled: z.boolean(),
  creditCost: z.number().int().positive().max(1_000),
  // Long edge, in px, for this resolution tier — the short edge is derived
  // from the requested aspect ratio via computeOutputDims(). Replaces the old
  // single platform-wide maxOutputPx + per-ratio aspectDimensions table: an
  // admin now configures exactly one number per tier.
  longEdgePx: z.number().int().min(512).max(4096),
});

export const SystemConfigBody = z.object({
  resolutions: z
    .object({
      HD: ResolutionConfig.optional(),
      '2K': ResolutionConfig.optional(),
      '4K': ResolutionConfig.optional(),
    })
    .optional(),
  // Ceiling on jobs per Studio batch submission (createBatch.ts) — same number
  // GET /v1/catalogues?batchId uses to size its row cap, so the two stay in sync.
  maxBatchJobs: z.number().int().min(1).max(2000).optional(),
  // Ceiling on QUEUED jobs across source IN ('catalog','saree','saree_mannequin') —
  // see assertQueueCapacity in apps/api/src/lib/queue-capacity-config.ts. Exists so
  // a burst of submissions the current worker pool can't drain is rejected up front
  // instead of accepted and left to queue indefinitely.
  maxQueueDepth: z.number().int().min(1).max(5000).optional(),
  // Admin-fixed inputs for merchant catalogue-manager's constrained "flat garment
  // -> catalogue image" generation. Keyed by category so studio-style face/background
  // variety per gender is preserved without per-merchant or per-item picking.
  merchantCatalogDefaults: z
    .record(
      z.enum(['men', 'women', 'boys', 'girls']),
      z.object({
        faceId: z.string().uuid(),
        backgroundId: z.string().uuid(),
        lowerCatalogId: z.string().uuid().optional(),
        shoeCatalogId: z.string().uuid().optional(),
      }),
    )
    .optional(),
  merchantCatalogAspectRatio: z.enum(['1:1', '2:3', '3:4', '4:5']).optional(),
  // The resolution tier used by the merchant-catalog auto-generation path, which
  // (unlike Studio) has no per-job tier picker — one admin-fixed default for the
  // whole path, same pattern as merchantCatalogAspectRatio above.
  merchantCatalogResolution: z.enum(['HD', '2K', '4K']).optional(),
  tryon: z
    .object({
      creditCost: z.number().int().positive().max(1_000),
    })
    .optional(),
  sareeMannequinDev: z
    .object({
      creditCost: z.number().int().positive().max(1_000),
    })
    .optional(),
  pixverseVideoPricing: z
    .object({
      // Credits per second of video, added on top of the quality base below.
      perSecondRate: z.number().min(0).max(100),
      qualityBase: z
        .object({
          '360p': z.number().int().positive().max(1_000),
          '540p': z.number().int().positive().max(1_000),
          '720p': z.number().int().positive().max(1_000),
          '1080p': z.number().int().positive().max(1_000),
        })
        .partial(),
    })
    .optional(),
```
(everything from `tryon:` onward — `sareeMannequinDev`, `pixverseVideoPricing`, and whatever follows them, e.g. `shopify`/`uploadLimits`/`seller` — is unchanged; only remove `maxOutputPx` and `aspectDimensions`, which is everything between `merchantCatalogAspectRatio` and `tryon` in the original file)

- [ ] **Step 7: Typecheck the package**

Run: `pnpm --filter @aivastra/types typecheck` (or `pnpm typecheck` from repo root if the package has no standalone script — check `packages/types/package.json`)
Expected: no errors (nothing outside this package has been touched yet, so any error here is self-contained).

- [ ] **Step 8: Commit**

```bash
git add packages/types/src/jobs.ts packages/types/src/admin.ts packages/types/src/batch.ts packages/types/src/dev.ts packages/types/test/jobs.test.ts
git commit -m "feat(types): add computeOutputDims formula, widen aspectRatio to 6 ratios, add longEdgePx/merchantCatalogResolution config fields"
```

---

### Task 2: `resolution-config.ts` — new defaults and tier-config getter

**Files:**
- Modify: `apps/api/src/lib/resolution-config.ts:1-124`

**Interfaces:**
- Consumes: `Resolution`, `RESOLUTION_COSTS` from `@aivastra/types` (already imported).
- Produces: `DEFAULT_RESOLUTION_CONFIG: Record<Resolution, {enabled, creditCost, longEdgePx}>`, `DEFAULT_MERCHANT_CATALOG_RESOLUTION: Resolution`, `getResolutionTierConfig(app, resolution): Promise<{enabled, creditCost, longEdgePx}>`. Removes `DEFAULT_MAX_OUTPUT_PX`, `DEFAULT_ASPECT_DIMENSIONS`, `mergeAspectDimensions`, `getAspectDimensions`, `getMaxOutputPx`.

No dedicated unit test file exists for this module today (it's exercised via `admin-config.test.ts`, updated in Task 3) — this task's own verification is the typecheck + Task 3's integration tests.

- [ ] **Step 1: Drop the now-unused `ASPECT_DIMENSIONS` import**

Replace `apps/api/src/lib/resolution-config.ts:1-11`:
```ts
import {
  computePixverseVideoCost,
  PIXVERSE_VIDEO_COST,
  type PixverseQuality,
  type PixverseVideoPricingConfig,
  RESOLUTION_COSTS,
  type Resolution,
  SAREE_MANNEQUIN_DEV_COST,
  SIMPLE_TRYON_COST,
} from '@aivastra/types';
```
(only `ASPECT_DIMENSIONS` is removed from this list — every other named import is still used elsewhere in the file, untouched by this task)

- [ ] **Step 2: Replace the defaults block**

Replace `apps/api/src/lib/resolution-config.ts:17-50`:
```ts
export const DEFAULT_RESOLUTION_CONFIG: Record<
  Resolution,
  { enabled: boolean; creditCost: number; longEdgePx: number }
> = {
  HD: { enabled: false, creditCost: RESOLUTION_COSTS.HD, longEdgePx: 1536 },
  '2K': { enabled: true, creditCost: RESOLUTION_COSTS['2K'], longEdgePx: 2688 },
  '4K': { enabled: true, creditCost: RESOLUTION_COSTS['4K'], longEdgePx: 4096 },
};

// Used by the merchant-catalog auto-generation path (apps/api/src/modules/merchant/
// create-job.ts), which has no per-job tier picker. 2688 (2K's default longEdgePx
// above) matches the output size every existing merchant-catalog job already
// produces today, so a fresh deploy changes nothing until an admin retunes it.
export const DEFAULT_MERCHANT_CATALOG_RESOLUTION: Resolution = '2K';
```
(this deletes `DEFAULT_MAX_OUTPUT_PX`, `DEFAULT_ASPECT_DIMENSIONS`, and `mergeAspectDimensions` — the `ASPECT_DIMENSIONS` import from `@aivastra/types` on line 1-11 is no longer used by this file and must be removed from the import block)

- [ ] **Step 3: Replace `getMaxOutputPx`/`getAspectDimensions` with `getResolutionTierConfig`**

Replace `apps/api/src/lib/resolution-config.ts:109-144` (the `getResolutionCreditCost` doc comment through the end of `getAspectDimensions`) — **keep `getResolutionCreditCost` itself** (still used by the PixVerse video-lane pricing path, unaffected by this feature), only replace what comes after it:

```ts
/**
 * Reads the admin-configured HD/2K/4K tier config — enabled, credit cost, and
 * long-edge pixel value — from the same `config:system` Redis key. One Redis
 * read replaces what used to be two separate lookups (getAspectDimensions or
 * getMaxOutputPx, then getResolutionCreditCost) now that a tier's price and
 * its output size are both properties of the same admin-configured object.
 * Falls back to DEFAULT_RESOLUTION_CONFIG if nothing is stored yet, or the
 * entry is missing/malformed.
 */
export async function getResolutionTierConfig(
  app: FastifyInstance,
  resolution: Resolution,
): Promise<{ enabled: boolean; creditCost: number; longEdgePx: number }> {
  try {
    const raw = await app.redis.get(CONFIG_KEY);
    const cfg = raw ? JSON.parse(raw) : {};
    const stored = cfg.resolutions?.[resolution];
    const fallback = DEFAULT_RESOLUTION_CONFIG[resolution];
    return {
      enabled: typeof stored?.enabled === 'boolean' ? stored.enabled : fallback.enabled,
      creditCost: typeof stored?.creditCost === 'number' ? stored.creditCost : fallback.creditCost,
      longEdgePx: typeof stored?.longEdgePx === 'number' ? stored.longEdgePx : fallback.longEdgePx,
    };
  } catch {
    return DEFAULT_RESOLUTION_CONFIG[resolution];
  }
}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @aivastra/api typecheck`
Expected: errors in every file that still imports `getAspectDimensions`/`getMaxOutputPx`/`DEFAULT_MAX_OUTPUT_PX`/`DEFAULT_ASPECT_DIMENSIONS`/`mergeAspectDimensions` — that's `config.routes.ts`, `create.ts`, `merchant/create-job.ts`, fixed in Tasks 3-5. Confirm the *only* errors are unresolved imports in those three files (nothing else), then proceed — this task's own code is correct even though the package doesn't fully compile until Task 5 lands.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/resolution-config.ts
git commit -m "feat(api): replace maxOutputPx/aspectDimensions config with per-tier longEdgePx"
```

---

### Task 3: `config.routes.ts` — GET/PATCH `/admin/config` and `/v1/config/resolutions`

**Files:**
- Modify: `apps/api/src/modules/admin/config.routes.ts:1-139`
- Modify: `apps/api/test/integration/admin-config.test.ts:156-187`

**Interfaces:**
- Consumes: `DEFAULT_RESOLUTION_CONFIG`, `DEFAULT_MERCHANT_CATALOG_RESOLUTION` from Task 2.
- Produces: `GET /v1/config/resolutions` → `{ resolutions }` (no `maxOutputPx`/`aspectDimensions`); `GET /admin/config` → same `cfg.resolutions` default-fill plus `cfg.merchantCatalogResolution` default-fill; `PATCH /admin/config` accepts the new `SystemConfigBody` shape.

- [ ] **Step 1: Write the failing test — replace the aspectDimensions merge test**

The existing test at `apps/api/test/integration/admin-config.test.ts:156-187` exercises `mergeAspectDimensions`'s partial-merge behavior, which no longer exists (nothing about `resolutions` needs special per-key merge logic — `JobCostsTab.tsx` always PATCHes the full 3-tier object, confirmed in Task 6). Replace that whole `it(...)` block with:

```ts
  it('GET /admin/config default-fills resolution longEdgePx, and PATCH persists a full-object override', async () => {
    const getRes = await app.inject({ method: 'GET', url: '/admin/config', headers: adminAuth });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().resolutions).toEqual({
      HD: { enabled: false, creditCost: 25, longEdgePx: 1536 },
      '2K': { enabled: true, creditCost: 35, longEdgePx: 2688 },
      '4K': { enabled: true, creditCost: 40, longEdgePx: 4096 },
    });

    const patchRes = await app.inject({
      method: 'PATCH',
      url: '/admin/config',
      headers: { ...adminAuth, 'content-type': 'application/json' },
      payload: JSON.stringify({
        resolutions: {
          HD: { enabled: true, creditCost: 20, longEdgePx: 1200 },
          '2K': { enabled: true, creditCost: 35, longEdgePx: 2688 },
          '4K': { enabled: true, creditCost: 40, longEdgePx: 4096 },
        },
      }),
    });
    expect(patchRes.statusCode).toBe(200);

    const getRes2 = await app.inject({ method: 'GET', url: '/admin/config', headers: adminAuth });
    expect(getRes2.json().resolutions.HD).toEqual({ enabled: true, creditCost: 20, longEdgePx: 1200 });
  });

  it('GET /admin/config default-fills merchantCatalogResolution, and PATCH persists an override', async () => {
    const getRes = await app.inject({ method: 'GET', url: '/admin/config', headers: adminAuth });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().merchantCatalogResolution).toBe('2K');

    const patchRes = await app.inject({
      method: 'PATCH',
      url: '/admin/config',
      headers: { ...adminAuth, 'content-type': 'application/json' },
      payload: JSON.stringify({ merchantCatalogResolution: '4K' }),
    });
    expect(patchRes.statusCode).toBe(200);

    const getRes2 = await app.inject({ method: 'GET', url: '/admin/config', headers: adminAuth });
    expect(getRes2.json().merchantCatalogResolution).toBe('4K');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `apps/api`, containers up via `pnpm docker:up` first): `npx vitest run --config vitest.integration.config.ts admin-config`
Expected: FAIL — `getRes.json().resolutions.HD` has no `longEdgePx` yet; `merchantCatalogResolution` is `undefined`.

- [ ] **Step 3: Update the route handlers**

Replace `apps/api/src/modules/admin/config.routes.ts:13-22` (the resolution-config import block):
```ts
import {
  DEFAULT_MERCHANT_CATALOG_RESOLUTION,
  DEFAULT_PIXVERSE_VIDEO_PRICING,
  DEFAULT_RESOLUTION_CONFIG,
  DEFAULT_SAREE_MANNEQUIN_DEV_CONFIG,
  DEFAULT_SELLER_CONFIG,
  DEFAULT_SHOPIFY_TRIAL_CONFIG,
  DEFAULT_TRYON_CONFIG,
} from '../../lib/resolution-config.js';
```

Replace `apps/api/src/modules/admin/config.routes.ts:39-47` (`GET /v1/config/resolutions`):
```ts
  // Public — used by the web pricing page and Studio's resolution picker (no auth required)
  app.get('/v1/config/resolutions', async () => {
    const raw = await app.redis.get(KEY);
    const cfg = raw ? JSON.parse(raw) : {};
    return { resolutions: cfg.resolutions ?? DEFAULT_RESOLUTION_CONFIG };
  });
```

Replace `apps/api/src/modules/admin/config.routes.ts:60-65` (the `resolutions`/`maxOutputPx`/`aspectDimensions` lines inside `GET /admin/config`):
```ts
    cfg.resolutions = cfg.resolutions ?? DEFAULT_RESOLUTION_CONFIG;
    cfg.merchantCatalogResolution = cfg.merchantCatalogResolution ?? DEFAULT_MERCHANT_CATALOG_RESOLUTION;
```

Remove the `aspectDimensions`-specific merge block inside `PATCH /admin/config` (`apps/api/src/modules/admin/config.routes.ts:109-121`) entirely — the `const next = { ...cur, ...body };` line right above it (line 108) already handles `resolutions` and `merchantCatalogResolution` correctly as plain shallow-replaced keys, since (per Task 6) the client always sends the full 3-tier `resolutions` object, never a partial one.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.integration.config.ts admin-config`
Expected: PASS (all tests in the file, including the two new ones and everything untouched — `uploadLimits`, `pixverseVideoPricing`, `shopify`, `maxBatchJobs`).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/admin/config.routes.ts apps/api/test/integration/admin-config.test.ts
git commit -m "feat(api): serve/persist per-tier longEdgePx and merchantCatalogResolution via /admin/config"
```

---

### Task 4: `resolveTryonPlan` — tier-based computation, enabled-tier enforcement

**Files:**
- Modify: `apps/api/src/modules/jobs/create.ts:1-36,161-215,234-256,270-321,825-831`
- Modify: `apps/api/test/integration/saree-mannequin-job.test.ts` (7 occurrences of `resolution: 'HD'`)
- Test: `apps/api/test/integration/jobs-create.test.ts` (new tests appended)

**Interfaces:**
- Consumes: `computeOutputDims`, `Resolution` from `@aivastra/types`; `getResolutionTierConfig` from Task 2.
- Produces: `TryonPlanCache.resolutionTiers: Map<Resolution, {enabled,creditCost,longEdgePx}>` (replaces `maxOutputPx?`, `resolutionCosts`, `aspectDimensions`). `resolveTryonPlan`'s second (saree-step2) body-type overload gains `resolution: Resolution`.

- [ ] **Step 1: Write the failing tests in `jobs-create.test.ts`**

Append to the `describe('jobs-create', ...)` block, reusing the file's existing `registerUser`/`seedFaceAndLook`/`seedCreditPlan`/`bindUploadKey`/`grantCredits` helpers (already defined at the top of the file):

```ts
  it('rejects a job requesting a disabled resolution tier', async () => {
    await seedCreditPlan('free');
    const { token, userId } = await registerUser('disabled-tier@x.com');
    await grantCredits(userId, 100);
    const { faceId, backgroundId, poseId } = await seedFaceAndLook('dt');
    const garmentKey = `inputs/${userId}/garment.jpg`;
    await bindUploadKey(userId, garmentKey);

    // HD is disabled by default (DEFAULT_RESOLUTION_CONFIG.HD.enabled = false) —
    // no config:system override needed to exercise this.
    const res = await app.inject({
      method: 'POST',
      url: '/v1/jobs/tryon',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        inputs: { upperGarmentKey: garmentKey, faceId, looks: [{ poseId, backgroundId }] },
        aspectRatio: '1:1',
        resolution: 'HD',
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('BAD_RESOLUTION');
  });

  it('computes output dims from the requested tier\'s longEdgePx via the aspect ratio formula', async () => {
    await seedCreditPlan('free');
    const { token, userId } = await registerUser('tier-dims@x.com');
    await grantCredits(userId, 100);
    const { faceId, backgroundId, poseId } = await seedFaceAndLook('td');
    const garmentKey = `inputs/${userId}/garment.jpg`;
    await bindUploadKey(userId, garmentKey);

    // 2:3 is portrait (h > w) — long edge (4096, 4K's default) lands on height.
    const res = await app.inject({
      method: 'POST',
      url: '/v1/jobs/tryon',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        inputs: { upperGarmentKey: garmentKey, faceId, looks: [{ poseId, backgroundId }] },
        aspectRatio: '2:3',
        resolution: '4K',
      },
    });
    expect(res.statusCode).toBe(201);
    const { jobIds } = res.json();
    const [inputs] = await app.db
      .select()
      .from(schema.jobInputs)
      .where(eq(schema.jobInputs.jobId, jobIds[0]));
    expect(inputs?.params).toMatchObject({ outputWidth: 2731, outputHeight: 4096, resolution: '4K' });
  });

  it('clamps custom output dims to the SELECTED tier\'s longEdgePx, not a fixed global ceiling', async () => {
    await seedCreditPlan('free');
    const { token, userId } = await registerUser('tier-clamp@x.com');
    await grantCredits(userId, 100);
    const { faceId, backgroundId, poseId } = await seedFaceAndLook('tc');
    const garmentKey = `inputs/${userId}/garment.jpg`;
    await bindUploadKey(userId, garmentKey);

    const bodyFor = (resolution: 'HD' | '2K' | '4K') => ({
      inputs: { upperGarmentKey: garmentKey, faceId, looks: [{ poseId, backgroundId }] },
      aspectRatio: '1:1',
      resolution,
      params: { outputWidth: 4000, outputHeight: 4000 },
    });

    // 2K's default longEdgePx (2688) is below the requested 4000 — clamped down.
    const res2k = await app.inject({
      method: 'POST',
      url: '/v1/jobs/tryon',
      headers: { authorization: `Bearer ${token}` },
      payload: bodyFor('2K'),
    });
    expect(res2k.statusCode).toBe(201);
    const [inputs2k] = await app.db
      .select()
      .from(schema.jobInputs)
      .where(eq(schema.jobInputs.jobId, res2k.json().jobIds[0]));
    expect(inputs2k?.params).toMatchObject({ outputWidth: 2688, outputHeight: 2688 });

    // Same requested 4000x4000, but 4K's default longEdgePx (4096) is above it —
    // not clamped at all, proving the ceiling tracks the selected tier, not a
    // single global number.
    const res4k = await app.inject({
      method: 'POST',
      url: '/v1/jobs/tryon',
      headers: { authorization: `Bearer ${token}` },
      payload: bodyFor('4K'),
    });
    expect(res4k.statusCode).toBe(201);
    const [inputs4k] = await app.db
      .select()
      .from(schema.jobInputs)
      .where(eq(schema.jobInputs.jobId, res4k.json().jobIds[0]));
    expect(inputs4k?.params).toMatchObject({ outputWidth: 4000, outputHeight: 4000 });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `apps/api`): `npx vitest run --config vitest.integration.config.ts jobs-create`
Expected: FAIL — today's server ignores `body.resolution` entirely, so the disabled-tier request currently succeeds (201, not 400), and dims come from the old `ASPECT_DIMENSIONS`/`maxOutputPx` path, not from a tier's `longEdgePx`.

- [ ] **Step 3: Update imports**

Replace `apps/api/src/modules/jobs/create.ts:5-29`:
```ts
import {
  type CreateCatalogVideoJobRequest,
  computeOutputDims,
  type CreateSimpleTryonRequest,
  type CreateTryOnJobRequest,
  JOB_SOURCE,
  type JobSource,
  PIXVERSE_CUSTOM_VIDEO_PROMPT,
  type PixverseQuality,
  type Resolution,
  type SareeStep2Inputs,
} from '@aivastra/types';
import { aliasedTable, and, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import { isCatalogVideoAllowed } from '../../lib/catalog-video-access.js';
import { AppError } from '../../lib/errors.js';
import { assertQueueCapacity } from '../../lib/queue-capacity-config.js';
import {
  getPixverseVideoCreditCost,
  getResolutionTierConfig,
  getTryonCreditCost,
} from '../../lib/resolution-config.js';
```
(dropped `resolutionFromDims`, `getAspectDimensions`, `getMaxOutputPx`; added `computeOutputDims`, `getResolutionTierConfig`; `getResolutionCreditCost` is no longer imported here — it was only used for the block this task rewrites)

- [ ] **Step 4: Update `TryonPlanCache`**

Replace `apps/api/src/modules/jobs/create.ts:193-214`:
```ts
export interface TryonPlanCache {
  faces: Map<string, boolean>;
  backgrounds: Map<string, boolean>;
  poses: Map<string, boolean>;
  catalogItems: Map<string, boolean>;
  garmentTypes: Map<string, boolean>;
  resolutionTiers: Map<Resolution, { enabled: boolean; creditCost: number; longEdgePx: number }>;
}

export function createTryonPlanCache(): TryonPlanCache {
  return {
    faces: new Map(),
    backgrounds: new Map(),
    poses: new Map(),
    catalogItems: new Map(),
    garmentTypes: new Map(),
    resolutionTiers: new Map(),
  };
}
```

- [ ] **Step 5: Add `resolution` to the saree-step2 inline body type**

In `resolveTryonPlan`'s signature (`apps/api/src/modules/jobs/create.ts:234-246`), the second union member is missing `resolution` even though the client (Studio's `step2Body`) already sends it and the Zod schema (`CreateSareeMannequinJobRequest.step2`, Task 1) already requires it — only this internal TS type was out of sync:
```ts
  body:
    | z.infer<typeof CreateTryOnJobRequest>
    | {
        catalogueId?: string;
        inputs: z.infer<typeof SareeStep2Inputs>;
        params?: z.infer<typeof CreateTryOnJobRequest>['params'];
        userHint?: string;
        aspectRatio: string;
        resolution: Resolution;
        platform?: string;
      },
```

- [ ] **Step 6: Replace the dims/cost computation block**

Replace `apps/api/src/modules/jobs/create.ts:270-321`:
```ts
  // S1: the client's aspect ratio and resolution tier are both validated
  // choices (Zod already constrains resolution to HD|2K|4K), but every pixel
  // number and credit cost is still resolved server-side — never trust a
  // client-sent width/height or cost. See computeOutputDims in
  // packages/types/src/jobs.ts.
  const resolution: Resolution = body.resolution;
  const tierConfig =
    opts.cache?.resolutionTiers.get(resolution) ??
    (await (async () => {
      const value = await getResolutionTierConfig(app, resolution);
      opts.cache?.resolutionTiers.set(resolution, value);
      return value;
    })());
  if (!tierConfig.enabled) {
    throw new AppError(
      'BAD_RESOLUTION',
      400,
      `resolution "${resolution}" is not currently enabled`,
    );
  }
  const customW = body.params?.outputWidth;
  const customH = body.params?.outputHeight;
  const isCustomDims = !!(customW && customH);
  // Custom dims (Studio's "custom" aspect option) are clamped to the
  // SELECTED tier's longEdgePx — pick 4K, the ceiling is 4K's px value, not a
  // single platform-wide number. Named ratios never take this branch; their
  // dims are always exactly computeOutputDims(ratio, tierConfig.longEdgePx).
  const outputDims = (() => {
    if (!isCustomDims) return computeOutputDims(aspectRatio, tierConfig.longEdgePx);
    const requestedDims = { width: customW, height: customH };
    const requestedLongEdge = Math.max(requestedDims.width, requestedDims.height);
    if (requestedLongEdge <= tierConfig.longEdgePx) return requestedDims;
    return requestedDims.width >= requestedDims.height
      ? {
          width: tierConfig.longEdgePx,
          height: Math.round(tierConfig.longEdgePx * (requestedDims.height / requestedDims.width)),
        }
      : {
          width: Math.round(tierConfig.longEdgePx * (requestedDims.width / requestedDims.height)),
          height: tierConfig.longEdgePx,
        };
  })();
  const COST = tierConfig.creditCost;
```
(this removes the `getAspectDimensions`/`getMaxOutputPx`/`resolutionFromDims` calls and the `opts.cache?.aspectDimensions`/`opts.cache?.maxOutputPx`/`opts.cache?.resolutionCosts` cache reads entirely — `aspectRatio` on line 266, just above this block, is untouched)

- [ ] **Step 7: Update the stale comment in the params snapshot**

Replace the comment at `apps/api/src/modules/jobs/create.ts:825-827` (just above `outputWidth: outputDims.width,`):
```ts
        // Always the server-computed dims — computeOutputDims(aspectRatio,
        // tierConfig.longEdgePx), or a custom request clamped to the selected
        // tier's longEdgePx (see above). This is what the dispatcher patches
        // the workflow with.
```

- [ ] **Step 8: Fix the saree-mannequin test fixtures**

In `apps/api/test/integration/saree-mannequin-job.test.ts`, replace all 7 occurrences of `resolution: 'HD'` with `resolution: '2K'`. These tests exercise the saree-mannequin job-creation *flow*, not resolution-tier behavior — `'HD'` was an inert placeholder value while the server ignored `resolution` entirely; now that the server enforces `enabled`, and `HD` is disabled by default, these must use an enabled tier to keep asserting `201`/`PENDING_MANNEQUIN` rather than incidentally start asserting a 400.

Run: `grep -n "resolution: 'HD'" apps/api/test/integration/saree-mannequin-job.test.ts` to confirm all 7 line numbers before editing, then replace each.

- [ ] **Step 9: Run tests to verify everything passes**

Run: `npx vitest run --config vitest.integration.config.ts jobs-create`
Expected: PASS (3 new tests + all pre-existing tests in the file).

Run: `npx vitest run --config vitest.integration.config.ts saree-mannequin-job`
Expected: PASS (all tests, previously-HD ones now using `'2K'`).

Run: `npx vitest run --config vitest.integration.config.ts jobs-create-looks jobs-create-mannequin jobs-create-background-ownership batch-jobs queue-capacity pose-presets e2e`
Expected: PASS — these already send `resolution: '2K'`, unaffected by this task's logic change; this is a regression check.

- [ ] **Step 10: Typecheck**

Run: `pnpm --filter @aivastra/api typecheck`
Expected: only remaining errors (if any) are in `merchant/create-job.ts`, fixed next in Task 5.

- [ ] **Step 11: Commit**

```bash
git add apps/api/src/modules/jobs/create.ts apps/api/test/integration/jobs-create.test.ts apps/api/test/integration/saree-mannequin-job.test.ts
git commit -m "feat(api): resolveTryonPlan computes dims from the selected resolution tier, rejects disabled tiers"
```

---

### Task 5: Merchant-catalog auto-generation path

**Files:**
- Modify: `apps/api/src/modules/merchant/create-job.ts:1-16,25,113,238-246`

**Interfaces:**
- Consumes: `computeOutputDims`, `Resolution` from `@aivastra/types`; `getResolutionTierConfig`, `DEFAULT_MERCHANT_CATALOG_RESOLUTION` from Task 2.
- Produces: same `outputDims`/`resolution`/`cost` local variables as before (unused elsewhere outside this file — no interface change for callers).

No new test in this task — `apps/api/test/integration` has no existing coverage of this specific function's dims/cost derivation (verified: no `outputWidth`/`outputHeight` assertions anywhere in `apps/api/test`), and adding merchant-catalog job-creation integration coverage from scratch (seeding `merchantCatalogDefaults`, a merchant user, etc.) is a larger, separate undertaking outside this plan's scope. This task is verified by typecheck + the full existing suite staying green (regression check in Step 3).

- [ ] **Step 1: Update imports**

Replace `apps/api/src/modules/merchant/create-job.ts:1-14`:
```ts
import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { computeOutputDims, JOB_SOURCE, type Resolution } from '@aivastra/types';
import { aliasedTable, and, eq, ilike } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../../lib/errors.js';
import {
  DEFAULT_MERCHANT_CATALOG_RESOLUTION,
  getResolutionTierConfig,
  getTryonCreditCost,
} from '../../lib/resolution-config.js';
import { atomicDeduct } from '../credits/ledger.js';
import { assertMerchantUploadKey } from './upload-guard.js';
```
(dropped `resolutionFromDims`, `DEFAULT_ASPECT_DIMENSIONS`, `getAspectDimensions`, `getResolutionCreditCost`; added `computeOutputDims`, `DEFAULT_MERCHANT_CATALOG_RESOLUTION`, `getResolutionTierConfig`)

- [ ] **Step 2: Add `merchantCatalogResolution` to the config interface and read it**

Update `MerchantCatalogDefaults` (`apps/api/src/modules/merchant/create-job.ts:18-25`) to add one field:
```ts
interface MerchantCatalogDefaults {
  merchantCatalogDefaults?: Partial<
    Record<
      'men' | 'women' | 'boys' | 'girls',
      { faceId: string; backgroundId: string; lowerCatalogId?: string; shoeCatalogId?: string }
    >
  >;
  merchantCatalogAspectRatio?: string;
  merchantCatalogResolution?: Resolution;
```

Immediately after `const aspectRatio = cfg.merchantCatalogAspectRatio ?? '2:3';` (`apps/api/src/modules/merchant/create-job.ts:113`), add:
```ts
  const resolutionTier = cfg.merchantCatalogResolution ?? DEFAULT_MERCHANT_CATALOG_RESOLUTION;
```

- [ ] **Step 3: Replace the dims/resolution/cost computation**

Replace `apps/api/src/modules/merchant/create-job.ts:238-246`:
```ts
  // No custom-dims path exists here (aspectRatio is always one of the fixed
  // named ratios — see merchantCatalogAspectRatio in admin config); resolution
  // is likewise fixed platform-wide (merchantCatalogResolution) since this
  // path has no per-job tier picker. Both dims and cost come from the same
  // admin-configured tier object resolveTryonPlan uses for interactive jobs.
  const tierConfig = await getResolutionTierConfig(app, resolutionTier);
  const outputDims = computeOutputDims(aspectRatio, tierConfig.longEdgePx);
  const resolution: Resolution = resolutionTier;
  const cost = tierConfig.creditCost;
```
(note: this path does **not** check `tierConfig.enabled` — unlike `resolveTryonPlan`, there is no end-user request to reject; an admin who disables the tier they configured here for merchant-catalog generation should fix the config, not have every merchant sync silently start failing. This is a deliberate difference from Task 4, not an oversight.)

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @aivastra/api typecheck`
Expected: no errors anywhere in `apps/api`.

- [ ] **Step 5: Run the full API test suite as a regression check**

Run (from `apps/api`, containers up): `pnpm test` then `pnpm test:integration`
Expected: PASS (unit + integration). This confirms nothing else in `apps/api` silently depended on the removed `getAspectDimensions`/`getMaxOutputPx`/`resolutionFromDims` exports.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/merchant/create-job.ts
git commit -m "feat(api): merchant-catalog jobs use the admin-configured merchantCatalogResolution tier"
```

---

### Task 6: Admin UI — `longEdgePx` per tier (`JobCostsTab.tsx`)

**Files:**
- Modify: `apps/admin-web/src/pages/settings/JobCostsTab.tsx:1-18,28-39,51-62,96-153`

**Interfaces:**
- Produces: `resolutions` state shape becomes `Record<string, {enabled, creditCost, longEdgePx}>`; PATCH payload's `resolutions` key carries the new field.

This is a manually-verified UI change (admin-web has no component test harness in this repo) — verification is `pnpm --filter @aivastra/admin typecheck` plus a manual check via `pnpm --filter @aivastra/admin dev` per Task 8's "test the golden path in a browser" requirement, done together with Task 7 since they're both on the same Settings page.

- [ ] **Step 1: Widen the `resolutions` state type and default**

Replace `apps/admin-web/src/pages/settings/JobCostsTab.tsx:12-18`:
```ts
  const [resolutions, setResolutions] = useState<
    Record<string, { enabled: boolean; creditCost: number; longEdgePx: number }>
  >({
    HD: { enabled: false, creditCost: 10, longEdgePx: 1536 },
    '2K': { enabled: true, creditCost: 25, longEdgePx: 2688 },
    '4K': { enabled: true, creditCost: 40, longEdgePx: 4096 },
  });
```

Replace the fetch type at `apps/admin-web/src/pages/settings/JobCostsTab.tsx:29-30`:
```ts
    apiFetch<{
      resolutions?: Record<string, { enabled: boolean; creditCost: number; longEdgePx: number }>;
```
(rest of the `useEffect` body — lines 31-49 — is unchanged; `setResolutions(cfg.resolutions)` already forwards whatever shape the server sends)

- [ ] **Step 2: Add the `longEdgePx` input to each tier row**

Insert a new input right after the existing credit-cost input's closing `</div>` for the `creditCost` field but before the row's own closing `</div>`, inside the `.map((res) => {...})` block (`apps/admin-web/src/pages/settings/JobCostsTab.tsx:96-152`). Replace the row's JSX (lines 99-150) with:
```tsx
                    <div
                      key={res}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '10px 12px',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--r)',
                        background: 'var(--surface-2)',
                      }}
                    >
                      <Switch
                        checked={cfg.enabled}
                        onChange={(v) =>
                          setResolutions((prev) => ({
                            ...prev,
                            [res]: { ...cfg, enabled: v },
                          }))
                        }
                      />
                      <span className="setting-lbl" style={{ width: 32 }}>
                        {res}
                      </span>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          marginLeft: 'auto',
                        }}
                      >
                        <input
                          className="input"
                          type="number"
                          min={1}
                          max={1000}
                          style={{ width: 80, textAlign: 'right' }}
                          value={cfg.creditCost}
                          disabled={saving || !cfg.enabled}
                          onChange={(e) =>
                            setResolutions((prev) => ({
                              ...prev,
                              [res]: { ...cfg, creditCost: Number(e.target.value) },
                            }))
                          }
                        />
                        <span style={{ fontSize: 13, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                          credits / image
                        </span>
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                        }}
                      >
                        <input
                          className="input"
                          type="number"
                          min={512}
                          max={4096}
                          style={{ width: 80, textAlign: 'right' }}
                          value={cfg.longEdgePx}
                          disabled={saving}
                          onChange={(e) =>
                            setResolutions((prev) => ({
                              ...prev,
                              [res]: { ...cfg, longEdgePx: Number(e.target.value) },
                            }))
                          }
                        />
                        <span style={{ fontSize: 13, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                          px, long edge
                        </span>
                      </div>
                    </div>
```
(the `.filter`/`.map` wrapper and `const cfg = resolutions[res] ?? { enabled: false, creditCost: 0 }` line at 97 need `longEdgePx: 0` added to that fallback object too: `resolutions[res] ?? { enabled: false, creditCost: 0, longEdgePx: 0 }`)

Also update the section description at `apps/admin-web/src/pages/settings/JobCostsTab.tsx:91-93`:
```tsx
              <div className="setting-desc" style={{ marginBottom: 12 }}>
                Credit cost and output long-edge (px) per resolution. The short edge is derived
                from the requested aspect ratio. Disable a resolution to hide it from Studio and
                the pricing page.
              </div>
```

- [ ] **Step 3: Add a save-time validation guard**

The `save` function (`apps/admin-web/src/pages/settings/JobCostsTab.tsx:51-73`) has no client-side validation today (the server's Zod schema is the real gate) — add one so a bad value gets a toast instead of a raw 400. Replace the start of `save`:
```ts
  const save = async () => {
    const badTier = Object.entries(resolutions).find(
      ([, cfg]) =>
        !Number.isInteger(cfg.longEdgePx) || cfg.longEdgePx < 512 || cfg.longEdgePx > 4096,
    );
    if (badTier) {
      toast({
        kind: 'error',
        title: 'Invalid resolution tier',
        body: `${badTier[0]}: long edge must be an integer between 512 and 4096px.`,
      });
      return;
    }
    setSaving(true);
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @aivastra/admin typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/admin-web/src/pages/settings/JobCostsTab.tsx
git commit -m "feat(admin): add per-tier long-edge px input to Resolution Pricing"
```

---

### Task 7: Admin UI — remove old fields, add Merchant Catalog Resolution (`SettingsPage.tsx`)

**Files:**
- Modify: `apps/admin-web/src/pages/SettingsPage.tsx:1,255-359,446-489,843-946,1394-1436`

**Interfaces:**
- Consumes: nothing new from other tasks (self-contained UI removal + one new dropdown).
- Produces: `saveSysConfig`'s PATCH payload drops `maxOutputPx`/`aspectDimensions`, gains `merchantCatalogResolution`.

- [ ] **Step 1: Remove the now-unused import**

Replace `apps/admin-web/src/pages/SettingsPage.tsx:1`:
```ts
```
(delete the line entirely — `import { ASPECT_DIMENSIONS, resolutionFromDims } from '@aivastra/types';` is no longer used anywhere in this file once Steps 2-4 land; if any other import on line 1's original line is needed by a linter for module augmentation, `pnpm --filter @aivastra/admin typecheck` in Step 6 will surface it)

- [ ] **Step 2: Remove `maxOutputPx`/`aspectDimensions` state, add `merchantCatalogResolution` state**

Replace `apps/admin-web/src/pages/SettingsPage.tsx:265-272`:
```ts
  const [maxBatchJobs, setMaxBatchJobs] = useState(200);
  const [maxQueueDepth, setMaxQueueDepth] = useState(50);
  const [merchantCatalogResolution, setMerchantCatalogResolution] = useState<'HD' | '2K' | '4K'>(
    '2K',
  );
```
(this deletes the `maxOutputPx`/`aspectDimensions` `useState`s and the comment above them)

- [ ] **Step 3: Update the config-loading `useEffect`**

Replace the fetch type and handler body at `apps/admin-web/src/pages/SettingsPage.tsx:322-359` (only the relevant lines — leave `seller`, `merchantCatalogDefaults`, `merchantCatalogAspectRatio`, `uploadLimits` handling untouched):
```ts
  useEffect(() => {
    apiFetch<{
      maxBatchJobs?: number;
      maxQueueDepth?: number;
      seller?: {
        gstin?: string;
        legalName?: string;
        address?: string;
        pan?: string;
        tan?: string;
        udyamRegNo?: string;
      };
      merchantCatalogDefaults?: Record<
        string,
        { faceId: string; backgroundId: string; lowerCatalogId?: string; shoeCatalogId?: string }
      >;
      merchantCatalogAspectRatio?: string;
      merchantCatalogResolution?: 'HD' | '2K' | '4K';
      uploadLimits?: Record<string, number>;
    }>('/admin/config')
      .then((cfg) => {
        if (cfg.maxBatchJobs) setMaxBatchJobs(cfg.maxBatchJobs);
        if (cfg.maxQueueDepth) setMaxQueueDepth(cfg.maxQueueDepth);
        if (cfg.merchantCatalogResolution) setMerchantCatalogResolution(cfg.merchantCatalogResolution);
        if (cfg.seller) {
          setSellerGstin(cfg.seller.gstin ?? '');
          setSellerLegalName(cfg.seller.legalName ?? '');
          setSellerAddress(cfg.seller.address ?? '');
          setSellerPan(cfg.seller.pan ?? '');
          setSellerTan(cfg.seller.tan ?? '');
```
(the `if (cfg.maxOutputPx) setMaxOutputPx(...)` and `if (cfg.aspectDimensions) setAspectDimensions(...)` lines are removed; everything from `setSellerTan` onward in the original `.then()` body is unchanged — only splice out the two `maxOutputPx`/`aspectDimensions` lines and the two type fields)

- [ ] **Step 4: Update `saveSysConfig`'s payload**

Replace `apps/admin-web/src/pages/SettingsPage.tsx:462-478`:
```ts
      await apiFetch('/admin/config', {
        method: 'PATCH',
        body: JSON.stringify({
          maxBatchJobs,
          maxQueueDepth,
          seller: {
            gstin: sellerGstin.trim(),
            legalName: sellerLegalName.trim(),
            address: sellerAddress.trim(),
            pan: sellerPan.trim(),
            tan: sellerTan.trim(),
            udyamRegNo: sellerUdyamRegNo.trim(),
          },
          merchantCatalogDefaults: sanitizedMerchantCatalogDefaults,
          merchantCatalogAspectRatio,
          merchantCatalogResolution,
```
(deleted `maxOutputPx,` and `aspectDimensions,`; everything from `uploadLimits:` onward, further down in the original payload object, is unchanged)

- [ ] **Step 5: Remove the "Max Output Resolution" and "Aspect Ratio Sizes" JSX sections; add "Merchant Catalog Resolution"**

Delete `apps/admin-web/src/pages/SettingsPage.tsx:843-946` entirely (both the "Max Output Resolution" `<div>` block, lines 843-877, and the "Aspect Ratio Sizes" `<div>` block, lines 879-946) — what remains directly above is the `{sysLoading ? (...) : (<>` opening, and directly below is the "Max Batch Size" section (originally starting at line 948), which becomes the first item in this card.

Add the new dropdown immediately after the existing "Aspect ratio" `SearchableSelect` for `merchantCatalogAspectRatio` (`apps/admin-web/src/pages/SettingsPage.tsx:1394-1409`, inside the Merchant Catalog Defaults block):
```tsx
                  <div style={{ maxWidth: 200 }}>
                    <div className="setting-lbl" style={{ marginBottom: 4 }}>
                      Aspect ratio
                    </div>
                    <SearchableSelect
                      options={[
                        { id: '1:1', label: '1:1' },
                        { id: '2:3', label: '2:3' },
                        { id: '3:4', label: '3:4' },
                        { id: '4:5', label: '4:5' },
                      ]}
                      value={merchantCatalogAspectRatio}
                      disabled={sysSaving}
                      onChange={(v) => setMerchantCatalogAspectRatio(v)}
                    />
                  </div>
                  <div style={{ maxWidth: 200 }}>
                    <div className="setting-lbl" style={{ marginBottom: 4 }}>
                      Resolution
                    </div>
                    <SearchableSelect
                      options={[
                        { id: 'HD', label: 'HD' },
                        { id: '2K', label: '2K' },
                        { id: '4K', label: '4K' },
                      ]}
                      value={merchantCatalogResolution}
                      disabled={sysSaving}
                      onChange={(v) => setMerchantCatalogResolution(v as 'HD' | '2K' | '4K')}
                    />
                  </div>
                </div>
```
(this replaces the original closing `</div>` at line 1410 with the new dropdown followed by that same closing `</div>`)

- [ ] **Step 6: Update the save-button validation guard**

Replace `apps/admin-web/src/pages/SettingsPage.tsx:1412-1436`:
```tsx
                <div className="setting-actions">
                  <button
                    className="btn primary"
                    onClick={saveSysConfig}
                    disabled={
                      sysSaving ||
                      !Number.isInteger(maxBatchJobs) ||
                      maxBatchJobs < 1 ||
                      maxBatchJobs > 2000 ||
                      !Number.isInteger(maxQueueDepth) ||
                      maxQueueDepth < 1 ||
                      maxQueueDepth > 5000
                    }
                  >
                    {sysSaving ? 'Saving…' : 'Save'}
                  </button>
```
(dropped the `maxOutputPx`/`aspectDimensions` conditions from the `disabled` expression)

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @aivastra/admin typecheck`
Expected: no errors.

- [ ] **Step 8: Manual verification in the browser**

Run: `pnpm docker:up` (if not already running), `pnpm --filter @aivastra/api dev` and `pnpm --filter @aivastra/admin dev` in separate terminals.
Open the admin panel → Settings → System: confirm "Max Output Resolution" and "Aspect Ratio Sizes" are gone, "Merchant Catalog Resolution" appears next to "Merchant Catalog Aspect Ratio" and saves correctly (check via `GET /admin/config` in the Network tab or a quick `curl`).
Open Settings → Credits → Job Costs: confirm each HD/2K/4K row now shows a third "px, long edge" input and saves correctly.

- [ ] **Step 9: Commit**

```bash
git add apps/admin-web/src/pages/SettingsPage.tsx
git commit -m "feat(admin): remove Max Output Resolution/Aspect Ratio Sizes, add Merchant Catalog Resolution"
```

---

### Task 8: Studio — real HD/2K/4K picker

**Files:**
- Modify: `apps/catalogues-web/src/app/(app)/studio/page.tsx:1,219-241,462-465,497-566,4358-4523,4583-4589`

**Interfaces:**
- Consumes: `computeOutputDims`, `type Resolution` from `@aivastra/types` (already a workspace dependency).
- Produces: `resolution` becomes a real `useState<Resolution | null>` (was a derived `const`); all downstream consumers (`BatchMode` props at line ~2096/2104, `step2Body` at ~1409-1410/1512-1514/1548-1550, `canGenerate`/`generateBlocker`) keep working unchanged since they only ever read `resolution` by value, not by how it's computed.

This is a manually-verified UI change (no component test harness for `apps/catalogues-web`) — verification is `pnpm --filter @aivastra/web typecheck` plus a manual browser check per this repo's "test the golden path" rule for frontend changes.

- [ ] **Step 1: Remove the local duplicate constants/function, import the shared ones**

Replace `apps/catalogues-web/src/app/(app)/studio/page.tsx:211-241`:
```ts
const ALL_ASPECTS = ['1:1', '2:3', '3:4', '4:5', '9:16', '16:9'];
// Fallback long-edge px per tier, used only until /v1/config/resolutions
// resolves — the server (DEFAULT_RESOLUTION_CONFIG in
// apps/api/src/lib/resolution-config.ts) is authoritative.
const RESOLUTION_LONG_EDGE_PX_FALLBACK: Record<Resolution, number> = {
  HD: 1536,
  '2K': 2688,
  '4K': 4096,
};
```
(this deletes the old `ASPECT_DIMS`, `ASPECT_PX`, and `resolutionFromOutputDims` — the per-ratio pixel table and derivation function are both replaced by the shared `computeOutputDims` formula, imported below)

Add to the existing `'use client'` file's top-of-file import block (find the line importing from `@aivastra/types` if one exists, otherwise add a new import near the other top-level imports — check `apps/catalogues-web/src/app/(app)/studio/page.tsx:1-20` for the current import list before placing this):
```ts
import { computeOutputDims, type Resolution } from '@aivastra/types';
```

- [ ] **Step 2: Add `resolution` as real state**

Replace `apps/catalogues-web/src/app/(app)/studio/page.tsx:462-465`:
```ts
  const [platform, setPlatform] = useState('Amazon');
  const [aspect, setAspect] = useState(BRAND_CONFIG.Amazon?.default ?? '1:1');
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const [customRatio, setCustomRatio] = useState('');
  const [customWStr, setCustomWStr] = useState('');
```

- [ ] **Step 3: Rewrite the resolution-config query block and dims derivation**

Replace `apps/catalogues-web/src/app/(app)/studio/page.tsx:497-566`:
```ts
  const { data: resolutionConfigData } = useQuery<{
    resolutions: Record<string, { enabled: boolean; creditCost: number; longEdgePx: number }>;
  }>({
    queryKey: ['resolution-configs'],
    queryFn: () => api.get('/v1/config/resolutions'),
    staleTime: 10 * 60 * 1000,
  });
  const resolutionConfig = resolutionConfigData?.resolutions ?? {
    HD: { enabled: true, creditCost: 25, longEdgePx: RESOLUTION_LONG_EDGE_PX_FALLBACK.HD },
    '2K': { enabled: true, creditCost: 35, longEdgePx: RESOLUTION_LONG_EDGE_PX_FALLBACK['2K'] },
    '4K': { enabled: true, creditCost: 40, longEdgePx: RESOLUTION_LONG_EDGE_PX_FALLBACK['4K'] },
  };

  // Default-select the first enabled tier once config loads, same pattern as
  // the platform/aspect default-selection effect above — never leaves the
  // picker permanently empty, but never overrides a user's own pick either.
  useEffect(() => {
    if (resolution || !resolutionConfigData) return;
    const firstEnabled = (['2K', '4K', 'HD'] as const).find(
      (r) => resolutionConfig[r]?.enabled !== false,
    );
    if (firstEnabled) setResolution(firstEnabled);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolutionConfigData]);

  const tierPx = resolution
    ? (resolutionConfig[resolution]?.longEdgePx ?? RESOLUTION_LONG_EDGE_PX_FALLBACK[resolution])
    : undefined;

  // Custom dimension validation — computed at component level so handleSubmit
  // and canGenerate can both reference them without re-deriving inside the
  // render IIFE. Bounded by the SELECTED tier's longEdgePx, not a single
  // global ceiling — switching tiers re-validates against the new bound.
  const customWNum = Number(customWStr);
  const customHNum = Number(customHStr);
  const customWErr =
    customWStr !== '' &&
    (Number.isNaN(customWNum) || customWNum < 768 || (!!tierPx && customWNum > tierPx));
  const customHErr =
    customHStr !== '' &&
    (Number.isNaN(customHNum) || customHNum < 768 || (!!tierPx && customHNum > tierPx));
  const customDimsReady =
    aspect !== 'custom' ||
    (!!customRatio && !!customWStr && !!customHStr && !customWErr && !customHErr);
  const customParams =
    aspect === 'custom' && customDimsReady
      ? { outputWidth: customWNum, outputHeight: customHNum }
      : {};

  const outputDims: { w: number; h: number } | null = (() => {
    if (aspect === 'custom') {
      return customDimsReady && customWNum > 0 && customHNum > 0
        ? { w: customWNum, h: customHNum }
        : null;
    }
    if (!tierPx) return null;
    const dims = computeOutputDims(effectiveAspect, tierPx);
    return { w: dims.width, h: dims.height };
  })();
```
(this deletes the old `maxOutputPx`, `effectiveAspectPx`, `effectiveAspectDims` derivations and the old `const resolution = outputDims ? resolutionFromOutputDims(...) : null;` lines — `resolution` is now the `useState` from Step 2, not derived here)

- [ ] **Step 4: Replace the "Output Resolution" section with a real picker**

Replace `apps/catalogues-web/src/app/(app)/studio/page.tsx:4358-4431`:
```tsx
              <section className="studio-section-card" style={sectionCardStyle}>
                <SectionHead title="Output Resolution" stepNumber={stepNumberOf('resolution')} />
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  {(
                    [
                      { key: 'HD' as const, label: 'HD' },
                      { key: '2K' as const, label: '2K' },
                      { key: '4K' as const, label: '4K' },
                    ] as const
                  )
                    .filter((r) => resolutionConfig[r.key]?.enabled !== false)
                    .map((r) => {
                      const credits = resolutionConfig[r.key]?.creditCost ?? RESOLUTION_COSTS[r.key];
                      const active = resolution === r.key;
                      return (
                        <button
                          type="button"
                          key={r.key}
                          onClick={() => setResolution(r.key)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '8px 16px',
                            borderRadius: 99,
                            border: active ? `1.5px solid ${C.pink}` : `1.5px solid ${C.border2}`,
                            background: active ? 'rgba(245,92,122,0.04)' : C.white,
                            boxSizing: 'border-box',
                            cursor: 'pointer',
                          }}
                        >
                          <div
                            style={{
                              width: 16,
                              height: 16,
                              borderRadius: '50%',
                              border: active ? `5px solid ${C.pink}` : `1.5px solid #BDBDBD`,
                              background: C.white,
                              flexShrink: 0,
                              boxSizing: 'border-box',
                            }}
                          />
                          <span
                            style={{ fontSize: 14, fontWeight: 600, color: active ? C.pink : C.text }}
                          >
                            {r.label}
                          </span>
                          <span
                            style={{ fontSize: 13, color: active ? C.pink : C.mid, fontWeight: 400 }}
                          >
                            ({credits} credits)
                          </span>
                        </button>
                      );
                    })}
                </div>
              </section>
```
(the section is no longer wrapped in `{resolution && (...)}` — it's an always-visible picker now, not a derived-and-maybe-null badge; each pill is a real `<button>` with `onClick`, replacing the inert `<div>`s; the "Auto" badge in `right={...}` is removed)

- [ ] **Step 5: Update the dimension-hint text**

Replace `apps/catalogues-web/src/app/(app)/studio/page.tsx:4583-4589` (inside the "Custom Ratio" inline options, the `Min 768px · Max ...px` hint):
```tsx
                {aspect === 'custom' && customRatio && (
                  <p
                    style={{
                      fontSize: 11,
                      color: customWErr || customHErr ? '#F55C7A' : C.light,
                      margin: '8px 0 0',
                    }}
                  >
                    {customWErr || customHErr
                      ? `${(customWErr && customWNum < 768) || (customHErr && customHNum < 768) ? 'Min 768px' : `Max ${tierPx ?? 4096}px`}`
                      : `Min 768px · Max ${tierPx ?? 4096}px`}
                  </p>
                )}
```

Find the "Dimension hint" block just below (originally `{effectiveAspectDims[aspect]}`, around the same area — check the file for `Dimension hint` comment) and replace it:
```tsx
                {/* ── Dimension hint ── */}
                {aspect !== 'custom' && tierPx && (
                  <div style={{ marginTop: 8, fontSize: 11, color: C.light }}>
                    {computeOutputDims(aspect, tierPx).width} × {computeOutputDims(aspect, tierPx).height} px
                  </div>
                )}
```

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @aivastra/web typecheck`
Expected: no errors. If `ASPECT_RATIOS`/`computeOutputDims`/`Resolution` aren't resolving, confirm Task 1 was committed and `pnpm install` has re-linked the workspace package.

- [ ] **Step 7: Manual verification in the browser**

Run: `pnpm docker:up`, `pnpm --filter @aivastra/api dev`, `pnpm --filter @aivastra/web dev`.
Open Studio, walk through: pick a garment type → upload → face → background → poses → Publishing Platform → **Output Resolution** (confirm it's now clickable, selecting HD/2K/4K changes the active pill) → **Aspect Ratio** (confirm the dimension hint changes when you switch resolution tier, and again when you switch ratio) → for "Custom Ratio", confirm typing a width above the selected tier's px gets flagged, and switching tiers re-validates the same typed value. Submit one generation end-to-end and confirm it completes (or at minimum queues) — this exercises the full `computeOutputDims` path server-side too.

- [ ] **Step 8: Commit**

```bash
git add "apps/catalogues-web/src/app/(app)/studio/page.tsx"
git commit -m "feat(web): Output Resolution becomes a real HD/2K/4K picker driving output dims via computeOutputDims"
```

---

### Task 9: Full regression pass

**Files:** none (verification only)

- [ ] **Step 1: Typecheck everything**

Run: `pnpm typecheck`
Expected: no errors across the monorepo.

- [ ] **Step 2: Lint everything**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 3: Full unit + integration suite**

Run: `pnpm --filter @aivastra/api test` then `pnpm --filter @aivastra/api test:integration` (containers up via `pnpm docker:up`)
Expected: PASS.

Run: `pnpm --filter @aivastra/types test` (the new `jobs.test.ts` from Task 1, plus anything pre-existing).
Expected: PASS.

- [ ] **Step 4: Dispatcher regression check**

Run (from `apps/dispatcher`): `npx vitest run workflow/patcher.test.ts`
Expected: PASS, unchanged — confirms the untouched `ASPECT_DIMENSIONS`-based fallback branch still behaves identically (this plan never modified `apps/dispatcher`).

- [ ] **Step 5: Build everything**

Run: `pnpm build`
Expected: succeeds for every package/app.

- [ ] **Step 6: Final commit (if Step 1-5 required any fixups)**

```bash
git add -A
git commit -m "chore: fix typecheck/lint fallout from resolution-tiers rollout"
```
(only if there was fallout to fix — if everything was already clean, skip this commit)

---

## Self-Review Notes

- **Spec coverage:** every section of `docs/superpowers/specs/2026-09-15-resolution-tiers-design.md` maps to a task — shared formula (Task 1), config schema (Tasks 1-2), server trust boundary (Task 4), merchant-catalog path (Task 5), admin UI (Tasks 6-7), Studio UI (Task 8), rollout (hard cut-over, no task needed — it's the absence of a migration step), testing (folded into each task's TDD steps plus Task 9).
- **Discovered during planning, not in the original spec:** the admin UI split across two files (`JobCostsTab.tsx` for `enabled`/`creditCost`/now `longEdgePx`, `SettingsPage.tsx` for the removed fields + new dropdown) rather than one "Resolution Tiers" section as the spec sketched — corrected in Tasks 6-7 based on reading the actual component boundaries. The spec's intent (all three tier properties admin-editable, old fields gone) is preserved; only the file split changed.
- **Discovered during planning:** `saree-mannequin-job.test.ts` hardcodes the now-disabled-by-default `'HD'` tier seven times — would have broken invisibly if Task 4 didn't include the fixture fix.
