# Shopify routing-aware enablement + hardened full-sync accuracy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "effectively enabled for Try-On" and "resolves to a basket" the same gate everywhere a merchant or shopper sees an enabled count or button (Finding 1), and make the full-sync deletion reconciliation immune to a mid-pass `products/delete` webhook race (Finding 2).

**Architecture:** Extract the per-product routing scan already living in `funnel-rules.routes.ts` into a shared `countUnroutedProducts` helper in `funnel-resolution.ts`; have `funnel-rules.routes.ts` itself, `activation.routes.ts`, and `me.routes.ts` all call it, subtracting `unroutedEnabled` from their existing enabled-counts. Harden `customer.routes.ts`'s `/enabled` route to additionally require a resolved basket once a product has synced. Separately, in `products.sync.ts`, factor the id-only pagination loop into a `fetchLiveProductIds` closure and run it a second time, fresh, at the end of a full sync, reconciling deletions against that instead of the stale in-pass id list, self-healing any id the detailed pass missed.

**Tech Stack:** Fastify 5, Drizzle ORM, PostgreSQL 16, Vitest (unit + integration), TypeScript 5.6/ESM.

**Spec:** `docs/superpowers/specs/2026-09-19-shopify-routing-and-sync-accuracy-design.md`

## Global Constraints

- No frontend code changes — every touched stat is already rendered by existing UI from whatever the API returns (spec Finding 1 fix section).
- `countEffectivelyEnabled` (`activation.ts`) and `computeEnabledProductCount` (`me.routes.ts`) stay untouched internally — subtract `unroutedEnabled` at the call site only, never rewrite their SQL (spec: "Alternative considered and rejected").
- Catalogs over `COUNTS_PRODUCT_CAP` (10,000 synced products) fall back to the uncorrected count — never let the routing-aware fix make a giant store's page slow.
- `customer.routes.ts`'s `/enabled` route: skip the routing check entirely when the product has never been synced (no garment row) — only tighten the check once a row exists.
- Do not duplicate `PRODUCT_IDS_PAGE` — the full sync's new final pass reuses the exact query `reconcile` mode already uses.
- Every task that touches behavior updates its covering test(s) in the same task — this repo's tests are the regression guard for `resolveBasketFrom`/`computeEffectiveEnabled` precedence, and per CLAUDE.md a fix ships with its tests, not after.
- `pnpm docker:up` must be running before any test in this plan — confirmed already up (`aivastra-postgres`, `aivastra-redis`, `aivastra-minio`, all healthy) at plan-writing time.
- Run unit tests via `npx vitest run <pattern>` and integration tests via `npx vitest run --config vitest.integration.config.ts <pattern>`, both from `apps/api/`.

---

## Task 1: Extract shared `countUnroutedProducts` helper, refactor `funnel-rules.routes.ts` to use it

**Files:**
- Modify: `apps/api/src/modules/shopify/funnel-resolution.ts` (add `COUNTS_PRODUCT_CAP`, `UnroutedCounts`, `countUnroutedProducts`)
- Modify: `apps/api/src/modules/shopify/funnel-rules.routes.ts:1-12,76-191` (consume the helper, drop the inline loop and now-unused imports)
- Test (regression, run only): `apps/api/test/integration/shopify-merchant-funnel-rules.test.ts`

**Interfaces:**
- Produces (used by Tasks 2 and 3): `countUnroutedProducts(app: FastifyInstance, store: typeof schema.shopifyStores.$inferSelect): Promise<UnroutedCounts>` where
  ```ts
  export interface UnroutedCounts {
    countsOmitted: boolean;
    unrouted: number | null;
    unroutedEnabled: number | null;
    basketCounts: Record<string, number>;
  }
  ```
  `countsOmitted: true` means the store is over `COUNTS_PRODUCT_CAP` synced products; `unrouted`/`unroutedEnabled` are `null` in that case, `basketCounts` is `{}`.
- Also exports: `export const COUNTS_PRODUCT_CAP = 10_000;`

This task has no new behavior of its own — it's a pure extraction, so there's no new test to write first. Instead: run the existing integration test that already covers this exact computation, confirm it passes both before and after the refactor (proving the extraction is behavior-preserving).

- [ ] **Step 1: Confirm the regression test passes before touching anything**

Run: `cd apps/api && npx vitest run --config vitest.integration.config.ts shopify-merchant-funnel-rules.test.ts`
Expected: PASS (all tests, including the `unrouted`/`unroutedEnabled`/`countsOmitted` assertions around lines 268-492).

- [ ] **Step 2: Add the shared helper to `funnel-resolution.ts`**

Add this import at the top of `apps/api/src/modules/shopify/funnel-resolution.ts` (merge into the existing `drizzle-orm` import and add the new one):

```ts
import { schema } from '@aivastra/db';
import { and, count, eq, isNull, ne, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { computeEffectiveEnabled, inCollectionSetSql } from './activation.js';
```

Then append this at the end of the file, after `resolveBasket`:

```ts
// Above this many synced products, a full per-row routing scan is too slow to
// run on every stat/read — the Routing tab, and every "Try-On Enabled" count
// that needs routing precision, fall back to the uncorrected count instead.
export const COUNTS_PRODUCT_CAP = 10_000;

export interface UnroutedCounts {
  countsOmitted: boolean;
  unrouted: number | null;
  unroutedEnabled: number | null;
  /** basketId -> count of products that resolve to it. Only meaningful when
   *  countsOmitted is false. */
  basketCounts: Record<string, number>;
}

/**
 * Per-product routing scan shared by the Routing tab's summary
 * (`funnel-rules.routes.ts`) and every "Try-On Enabled" stat that must
 * exclude effectively-enabled products with no resolvable basket
 * (`activation.routes.ts`, `me.routes.ts`). A synced, enabled product with no
 * pin and no matching rule can never actually complete a try-on —
 * `customer.routes.ts`'s creation path refuses it before enqueue — so none of
 * these surfaces may count it as enabled.
 */
export async function countUnroutedProducts(
  app: FastifyInstance,
  store: typeof schema.shopifyStores.$inferSelect,
): Promise<UnroutedCounts> {
  const [{ total }] = await app.db
    .select({ total: count() })
    .from(schema.shopifyProductGarments)
    .where(
      and(
        eq(schema.shopifyProductGarments.storeId, store.id),
        ne(schema.shopifyProductGarments.status, 'deleted'),
      ),
    );

  if (total > COUNTS_PRODUCT_CAP) {
    return { countsOmitted: true, unrouted: null, unroutedEnabled: null, basketCounts: {} };
  }

  const mode = store.settings.activation?.mode ?? 'selective';
  const ruleSet = await loadRuleSet(app, store.id);
  const products = await app.db
    .select({
      funnelTemplateId: schema.shopifyProductGarments.funnelTemplateId,
      productType: schema.shopifyProductGarments.productType,
      tags: schema.shopifyProductGarments.tags,
      vendor: schema.shopifyProductGarments.vendor,
      collections: schema.shopifyProductGarments.collections,
      title: schema.shopifyProductGarments.title,
      enabled: schema.shopifyProductGarments.enabled,
      excluded: schema.shopifyProductGarments.excluded,
      inEnabledCollection: sql<boolean>`${inCollectionSetSql(schema.shopifyEnabledCollections)}`,
      inExcludedCollection: sql<boolean>`${inCollectionSetSql(schema.shopifyExcludedCollections)}`,
    })
    .from(schema.shopifyProductGarments)
    .where(
      and(
        eq(schema.shopifyProductGarments.storeId, store.id),
        ne(schema.shopifyProductGarments.status, 'deleted'),
      ),
    );

  const basketCounts: Record<string, number> = {};
  let unrouted = 0;
  let unroutedEnabled = 0;
  for (const p of products) {
    const resolved = resolveBasketFrom(ruleSet, p as BasketMatchTarget);
    if (resolved) {
      basketCounts[resolved.basketId] = (basketCounts[resolved.basketId] ?? 0) + 1;
    } else {
      unrouted++;
      const effectivelyEnabled = computeEffectiveEnabled({
        mode,
        individuallyEnabled: p.enabled,
        individuallyExcluded: p.excluded,
        inEnabledCollection: p.inEnabledCollection,
        inExcludedCollection: p.inExcludedCollection,
      });
      if (effectivelyEnabled) unroutedEnabled++;
    }
  }

  return { countsOmitted: false, unrouted, unroutedEnabled, basketCounts };
}
```

- [ ] **Step 3: Rewrite `funnel-rules.routes.ts` to consume it**

Replace the import block at the top of `apps/api/src/modules/shopify/funnel-rules.routes.ts` (lines 1-7):

```ts
import { schema } from '@aivastra/db';
import { and, asc, count, eq, isNull, ne, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { computeEffectiveEnabled, inCollectionSetSql } from './activation.js';
import { type BasketMatchTarget, loadRuleSet, resolveBasketFrom } from './funnel-resolution.js';
```

with:

```ts
import { schema } from '@aivastra/db';
import { and, asc, count, eq, isNull, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { countUnroutedProducts } from './funnel-resolution.js';
```

Then remove the `const COUNTS_PRODUCT_CAP = 10_000;` line (originally line 12) — it now lives in `funnel-resolution.ts`.

Then replace the entire `app.get('/v1/shopify/funnel-rules', ...)` handler body (originally lines 76-191) with:

```ts
  app.get('/v1/shopify/funnel-rules', auth, async (req) => {
    const store = req.shopifyStore as typeof schema.shopifyStores.$inferSelect;

    const [rows, suppressed, unroutedCounts] = await Promise.all([
      app.db
        .select()
        .from(schema.shopifyFunnelRules)
        // The store's own rules plus the whole global tier. Suppression is not
        // filtered here — the merchant UI must still SHOW a disabled global
        // rule, with its switch off, or there is no way to turn it back on.
        .where(
          or(
            eq(schema.shopifyFunnelRules.storeId, store.id),
            isNull(schema.shopifyFunnelRules.storeId),
          ),
        ),
      app.db
        .select({ ruleId: schema.shopifyStoreDisabledFunnelRules.ruleId })
        .from(schema.shopifyStoreDisabledFunnelRules)
        .where(eq(schema.shopifyStoreDisabledFunnelRules.storeId, store.id)),
      countUnroutedProducts(app, store),
    ]);

    const suppressedIds = new Set(suppressed.map((s) => s.ruleId));
    const mine = rows.filter((r) => r.storeId === store.id);
    const globals = rows.filter((r) => r.storeId === null);

    return {
      storeRules: mine.map((r) => ({
        id: r.id,
        funnelTemplateId: r.funnelTemplateId,
        conditions: r.conditions,
        priority: r.priority,
      })),
      globalRules: globals.map((r) => ({
        id: r.id,
        funnelTemplateId: r.funnelTemplateId,
        conditions: r.conditions,
        priority: r.priority,
        disabled: suppressedIds.has(r.id),
      })),
      counts: unroutedCounts.basketCounts,
      countsOmitted: unroutedCounts.countsOmitted,
      // null (not 0) when countsOmitted, matching counts' own omitted state —
      // a bare 0 would misreport "fully routed" for a catalog never scanned.
      unrouted: unroutedCounts.unrouted,
      unroutedEnabled: unroutedCounts.unroutedEnabled,
    };
  });
```

The rest of the file (POST/PATCH/DELETE/PUT routes below it) is unchanged.

- [ ] **Step 4: Typecheck and run the regression test again**

Run: `cd apps/api && npx tsc --noEmit` (or `pnpm --filter @aivastra/api typecheck` from repo root)
Expected: no errors — confirms no leftover references to the removed imports/`COUNTS_PRODUCT_CAP`.

Run: `cd apps/api && npx vitest run --config vitest.integration.config.ts shopify-merchant-funnel-rules.test.ts`
Expected: PASS, identical to Step 1 — proves the extraction preserved behavior exactly.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/shopify/funnel-resolution.ts apps/api/src/modules/shopify/funnel-rules.routes.ts
git commit -m "$(cat <<'EOF'
refactor(shopify): extract countUnroutedProducts helper from funnel-rules.routes

Moves the per-product routing scan into funnel-resolution.ts so
activation.routes.ts and me.routes.ts can reuse it in the next tasks to fix
their own routing-blind enabled counts, instead of hand-duplicating the loop
a third and fourth time.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: ManagePage "Try-On Enabled" stat excludes unrouted products

**Files:**
- Modify: `apps/api/src/modules/shopify/activation.routes.ts:1-99` (subtract `unroutedEnabled` in `summaryCounts`)
- Test: `apps/api/test/shopify-activation-routes.test.ts`

**Interfaces:**
- Consumes: `countUnroutedProducts` from Task 1 (`apps/api/src/modules/shopify/funnel-resolution.ts`).

- [ ] **Step 1: Update the test to pin product 1's basket and add an unrouted case, then watch it fail**

Replace the seed block in `apps/api/test/shopify-activation-routes.test.ts` (lines 1-73) with:

```ts
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { upsertShopifyStore } from '../src/modules/shopify/auth.routes.js';
import { buildTestApp, type TestApp } from './helpers/api.js';
import { type Containers, startContainers } from './helpers/containers.js';
import { signSessionToken } from './helpers/shopify-session.js';

const API_SECRET = 'test-secret';
const API_KEY = 'test-key';
let c: Containers;
let app: TestApp;
let storeId: string;
let token: string;
let basketId: string;

beforeAll(async () => {
  c = await startContainers();
  app = await buildTestApp(c, {
    SHOPIFY_TOKEN_ENC_KEY: Buffer.alloc(32, 3).toString('base64'),
    SHOPIFY_API_SECRET: API_SECRET,
    SHOPIFY_API_KEY: API_KEY,
  });
  const store = await upsertShopifyStore(
    app,
    {
      shopifyShopId: 88,
      shopDomain: 'a.myshopify.com',
      myshopifyDomain: 'a.myshopify.com',
      name: 'A',
      email: 'a@a.com',
    },
    'tok',
    'read_products',
  );
  storeId = store.id;
  token = signSessionToken('a.myshopify.com', API_SECRET, API_KEY);

  // A basket this test's routed products pin to, so "effectively enabled" and
  // "resolves to a basket" both hold — the routing-aware fix under test only
  // subtracts products missing this pin.
  const [workflow] = await app.db
    .insert(schema.workflowTemplates)
    .values({
      slug: `activation-test-${Date.now()}`,
      label: 'Activation test workflow',
      jsonContent: {},
      poseNodeId: '2',
      upperNodeIds: ['4'],
      garmentPhasePromptNode: '6',
      workflowType: 'tryon',
      tryonPersonNodeId: '10',
      tryonGarmentNodeId: '11',
      tryonOutputNodeId: '12',
    })
    .returning();
  const [basket] = await app.db
    .insert(schema.shopifyFunnelTemplates)
    .values({
      slug: `activation-basket-${Date.now()}`,
      label: 'Activation test basket',
      workflowTemplateId: workflow.id,
    })
    .returning();
  basketId = basket.id;

  await app.db.insert(schema.shopifyProductGarments).values([
    {
      storeId,
      shopifyProductId: 1,
      shopifyVariantId: null,
      r2Key: 'x',
      title: 'One',
      status: 'active',
      enabled: true,
      funnelTemplateId: basketId,
      funnelAssignmentSource: 'manual',
    },
    {
      storeId,
      shopifyProductId: 2,
      shopifyVariantId: null,
      r2Key: 'y',
      title: 'Two',
      status: 'failed',
      enabled: false,
      failedReason: 'bad image',
    },
    {
      storeId,
      shopifyProductId: 3,
      shopifyVariantId: null,
      r2Key: 'z',
      title: 'Three',
      status: 'active',
      enabled: false,
      excluded: true,
    },
    {
      // Effectively enabled (individually enabled, not excluded) but pinned
      // to no basket and matched by no rule — must NOT count as "Try-On
      // Enabled", since a shopper's attempt on it would dead-end before
      // enqueue (customer.routes.ts refuses it for no resolvable basket).
      storeId,
      shopifyProductId: 4,
      shopifyVariantId: null,
      r2Key: 'w',
      title: 'Four',
      status: 'active',
      enabled: true,
    },
  ]);
});
afterAll(async () => {
  await app?.close();
  await c?.stop();
});
```

Update the existing test's assertion (originally lines 75-95) — `syncedProductCount` moves from 3 to 4, and add a new comment explaining the unrouted exclusion:

```ts
describe('GET /v1/shopify/activation', () => {
  it('returns mode and summary counts, including failed-to-sync independent of enabled state', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/shopify/activation',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.mode).toBe('selective');
    expect(body.counts.failedToSync).toBe(1);
    // Selective mode: product 1 is individually enabled AND resolves to a
    // basket (pinned). Product 4 is individually enabled but resolves to no
    // basket — routing-aware enablement excludes it. Product 3 is excluded.
    // So exactly one product counts.
    expect(body.counts.tryonEnabledProducts).toBe(1);
    // 4 rows seeded above, regardless of status/enabled/excluded.
    expect(body.counts.syncedProductCount).toBe(4);
    // No real Shopify access token in this test, so the live productsCount
    // lookup fails and falls back to null rather than throwing.
    expect(body.counts.totalProductCount).toBeNull();
  });
});
```

Run: `cd apps/api && npx vitest run shopify-activation-routes.test.ts`
Expected: FAIL — `tryonEnabledProducts` currently returns 2 (products 1 and 4 both effectively enabled), not the expected 1, because the route doesn't yet know about routing.

- [ ] **Step 2: Wire the subtraction into `summaryCounts`**

In `apps/api/src/modules/shopify/activation.routes.ts`, change the import (line 5):

```ts
import { countEffectivelyEnabled } from './activation.js';
```

to:

```ts
import { countEffectivelyEnabled } from './activation.js';
import { countUnroutedProducts } from './funnel-resolution.js';
```

Then replace lines 84-87:

```ts
  // Effective enablement, not the `enabled` column: a product turned on by
  // global mode or by an enabled collection counts here, and an excluded one
  // never does. See countEffectivelyEnabled for why this is SQL.
  const tryonEnabledProducts = await countEffectivelyEnabled(app, store);
```

with:

```ts
  // Effective enablement, not the `enabled` column: a product turned on by
  // global mode or by an enabled collection counts here, and an excluded one
  // never does. See countEffectivelyEnabled for why this is SQL.
  //
  // Then subtract products that are effectively enabled but resolve to no
  // basket (no pin, no matching store/global rule) — those can never actually
  // complete a try-on (customer.routes.ts refuses them before enqueue), so
  // counting them here would overstate what "Try-On Enabled" means. Left
  // uncorrected (unroutedCounts.countsOmitted) for catalogs over the routing
  // scan's product cap, same degradation the Routing tab already accepts.
  const [rawTryonEnabledProducts, unroutedCounts] = await Promise.all([
    countEffectivelyEnabled(app, store),
    countUnroutedProducts(app, store),
  ]);
  const tryonEnabledProducts = unroutedCounts.countsOmitted
    ? rawTryonEnabledProducts
    : rawTryonEnabledProducts - (unroutedCounts.unroutedEnabled ?? 0);
```

- [ ] **Step 3: Run the test again, confirm it passes**

Run: `cd apps/api && npx vitest run shopify-activation-routes.test.ts`
Expected: PASS.

- [ ] **Step 4: Update the caption per spec**

Find the ManagePage stat caption in `apps/shopify/src` (search for the "Try-On Enabled" stat's subtitle text, currently something like "Enabled individually or via a collection, minus exclusions."):

```bash
grep -rn "Enabled individually or via a collection" apps/shopify/src
```

Update that string to mention routing, e.g.: `"Enabled individually or via a collection, minus exclusions and unrouted products."` (match the exact file's existing quoting/formatting style once located).

- [ ] **Step 5: Typecheck**

Run: `cd apps/api && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/shopify/activation.routes.ts apps/api/test/shopify-activation-routes.test.ts apps/shopify/src
git commit -m "$(cat <<'EOF'
fix(shopify): ManagePage Try-On Enabled stat excludes unrouted products

An effectively-enabled product with no resolvable basket can never actually
complete a try-on (customer.routes.ts refuses it before enqueue), so it was
overstating the count. Subtracts countUnroutedProducts' unroutedEnabled at
the call site rather than touching countEffectivelyEnabled itself, keeping
its own parity test with computeEffectiveEnabled undisturbed.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: DashboardPage "Try-On Enabled" stat excludes unrouted products

**Files:**
- Modify: `apps/api/src/modules/shopify/me.routes.ts:1-77` (subtract `unroutedEnabled` in `computeEnabledProductCount`'s caller)
- Test: `apps/api/test/shopify-me.test.ts`

**Interfaces:**
- Consumes: `countUnroutedProducts` from Task 1.

- [ ] **Step 1: Update both test blocks that assert `enabledProductCount`, then watch them fail**

In `apps/api/test/shopify-me.test.ts`, add a shared basket-pinning helper and use it in the top-level seed. Replace the imports and top of the file (lines 1-65) with:

```ts
import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { upsertShopifyStore } from '../src/modules/shopify/auth.routes.js';
import { buildTestApp, type TestApp } from './helpers/api.js';
import { type Containers, startContainers } from './helpers/containers.js';
import { signSessionToken } from './helpers/shopify-session.js';

const ENC_KEY = Buffer.alloc(32, 11).toString('base64');
const API_SECRET = 'test-secret';
const API_KEY = 'test-key';
let c: Containers;
let app: TestApp;
let storeId: string;
let token: string;

/** Creates a workflow + basket and returns the basket id, for pinning a
 *  product's funnelTemplateId so it resolves and counts as routed. */
async function seedBasket(): Promise<string> {
  const [workflow] = await app.db
    .insert(schema.workflowTemplates)
    .values({
      slug: `me-test-${Date.now()}-${Math.random()}`,
      label: 'Me-route test workflow',
      jsonContent: {},
      poseNodeId: '2',
      upperNodeIds: ['4'],
      garmentPhasePromptNode: '6',
      workflowType: 'tryon',
      tryonPersonNodeId: '10',
      tryonGarmentNodeId: '11',
      tryonOutputNodeId: '12',
    })
    .returning();
  const [basket] = await app.db
    .insert(schema.shopifyFunnelTemplates)
    .values({
      slug: `me-basket-${Date.now()}-${Math.random()}`,
      label: 'Me-route test basket',
      workflowTemplateId: workflow.id,
    })
    .returning();
  return basket.id;
}

beforeAll(async () => {
  c = await startContainers();
  app = await buildTestApp(c, {
    SHOPIFY_TOKEN_ENC_KEY: ENC_KEY,
    SHOPIFY_API_SECRET: API_SECRET,
    SHOPIFY_API_KEY: API_KEY,
  });
  const store = await upsertShopifyStore(
    app,
    {
      shopifyShopId: 66,
      shopDomain: 'm.myshopify.com',
      myshopifyDomain: 'm.myshopify.com',
      name: 'M',
      email: 'm@m.com',
    },
    'tok',
    'read_products',
  );
  storeId = store.id;
  token = signSessionToken('m.myshopify.com', API_SECRET, API_KEY);

  const basketId = await seedBasket();

  await app.db.insert(schema.shopifyProductGarments).values([
    {
      storeId,
      shopifyProductId: 1,
      shopifyVariantId: null,
      r2Key: `shopify-garments/${storeId}/1/garment.jpg`,
      status: 'active',
      enabled: true,
      funnelTemplateId: basketId,
      funnelAssignmentSource: 'manual',
    },
    {
      storeId,
      shopifyProductId: 2,
      shopifyVariantId: null,
      r2Key: `shopify-garments/${storeId}/2/garment.jpg`,
      status: 'processing',
      enabled: false,
    },
    {
      storeId,
      shopifyProductId: 3,
      shopifyVariantId: null,
      r2Key: `shopify-garments/${storeId}/3/garment.jpg`,
      status: 'deleted',
      enabled: true,
    },
  ]);

  for (let i = 0; i < 3; i++) {
    // biome-ignore lint/suspicious/noExplicitAny: Drizzle infers userId as non-null; widget jobs legitimately have null userId
    await (app.db.insert(schema.jobs).values as any)({
      id: randomUUID(),
      userId: null,
      shopifyStoreId: storeId,
      status: 'COMPLETED',
      creditsCharged: 10,
    });
  }
});
afterAll(async () => {
  await app?.close();
  await c?.stop();
});
```

The `describe('GET /v1/shopify/me stats', ...)` block (originally lines 83-113) is unchanged — `enabledProductCount: 1` still holds since product 1 is now pinned.

Add a new test at the end of that same `describe` block (after the `'no longer reports funnel state'` test, before line 113's closing):

```ts
  it('excludes an effectively-enabled product that resolves to no basket', async () => {
    await app.db.insert(schema.shopifyProductGarments).values({
      storeId,
      shopifyProductId: 5,
      shopifyVariantId: null,
      r2Key: `shopify-garments/${storeId}/5/garment.jpg`,
      status: 'active',
      enabled: true,
      // No funnelTemplateId, no funnel rule configured for this store — this
      // product can never resolve a basket, so it must not count.
    });

    const res = await app.inject({
      method: 'GET',
      url: '/v1/shopify/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    // Still 1 (product 1, pinned) — product 5 is effectively enabled but
    // unrouted, so it's excluded exactly like the ManagePage stat.
    expect(res.json().stats.enabledProductCount).toBe(1);

    await app.db
      .delete(schema.shopifyProductGarments)
      .where(eq(schema.shopifyProductGarments.shopifyProductId, 5));
  });
```

Now update the activation-aware describe block (originally lines 197-274) to pin products 10 and 11 to a basket, so the mode-comparison assertions keep testing what they intend:

```ts
describe('GET /v1/shopify/me stats — enabledProductCount is activation-aware', () => {
  it('under global mode counts every non-deleted, non-excluded product regardless of individual `enabled`', async () => {
    const modeStore = await upsertShopifyStore(
      app,
      {
        shopifyShopId: 1001,
        shopDomain: 'global-mode.myshopify.com',
        myshopifyDomain: 'global-mode.myshopify.com',
        name: 'Global Mode Store',
        email: 'gm@test.com',
      },
      'tok',
      'read_products',
    );
    const modeToken = signSessionToken('global-mode.myshopify.com', API_SECRET, API_KEY);
    const modeBasketId = await seedBasket();

    await app.db.insert(schema.shopifyProductGarments).values([
      {
        storeId: modeStore.id,
        shopifyProductId: 10,
        shopifyVariantId: null,
        r2Key: `shopify-garments/${modeStore.id}/10/garment.jpg`,
        status: 'active',
        enabled: true,
        funnelTemplateId: modeBasketId,
        funnelAssignmentSource: 'manual',
      },
      {
        // Not individually enabled — under selective mode this should NOT
        // count; under global mode it SHOULD (global mode enables everything
        // except exclusions). Routed, same as product 10, so routing itself
        // isn't what this test is exercising.
        storeId: modeStore.id,
        shopifyProductId: 11,
        shopifyVariantId: null,
        r2Key: `shopify-garments/${modeStore.id}/11/garment.jpg`,
        status: 'processing',
        enabled: false,
        funnelTemplateId: modeBasketId,
        funnelAssignmentSource: 'manual',
      },
      {
        // Individually excluded — exclusion always wins, even under global
        // mode, so this must never count in either mode.
        storeId: modeStore.id,
        shopifyProductId: 12,
        shopifyVariantId: null,
        r2Key: `shopify-garments/${modeStore.id}/12/garment.jpg`,
        status: 'active',
        enabled: true,
        excluded: true,
      },
      {
        // Deleted — never counts, regardless of mode.
        storeId: modeStore.id,
        shopifyProductId: 13,
        shopifyVariantId: null,
        r2Key: `shopify-garments/${modeStore.id}/13/garment.jpg`,
        status: 'deleted',
        enabled: true,
      },
      {
        // Effectively enabled under global mode (nothing excludes it) but
        // unrouted — must not count in either mode, proving the routing
        // subtraction applies under global mode too, not just selective.
        storeId: modeStore.id,
        shopifyProductId: 14,
        shopifyVariantId: null,
        r2Key: `shopify-garments/${modeStore.id}/14/garment.jpg`,
        status: 'active',
        enabled: false,
      },
    ]);

    const selectiveRes = await app.inject({
      method: 'GET',
      url: '/v1/shopify/me',
      headers: { authorization: `Bearer ${modeToken}` },
    });
    expect(selectiveRes.json().stats.enabledProductCount).toBe(1);

    await app.db
      .update(schema.shopifyStores)
      .set({ settings: { activation: { mode: 'global' } } })
      .where(eq(schema.shopifyStores.id, modeStore.id));

    const globalRes = await app.inject({
      method: 'GET',
      url: '/v1/shopify/me',
      headers: { authorization: `Bearer ${modeToken}` },
    });
    // Products 10 and 11 (both routed) count; product 14 is effectively
    // enabled under global mode too but stays excluded for being unrouted.
    expect(globalRes.json().stats.enabledProductCount).toBe(2);
  });
});
```

Run: `cd apps/api && npx vitest run shopify-me.test.ts`
Expected: FAIL — `enabledProductCount` doesn't yet subtract unrouted products, so the new/changed assertions return the old, higher numbers.

- [ ] **Step 2: Wire the subtraction into `me.routes.ts`**

Change the import at the top of `apps/api/src/modules/shopify/me.routes.ts` (line 1-5):

```ts
import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { and, count, eq, gte, ne, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { computeRunway } from './runway.js';
import { windowStart } from './store-day.js';
```

to:

```ts
import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { and, count, eq, gte, ne, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { countUnroutedProducts } from './funnel-resolution.js';
import { computeRunway } from './runway.js';
import { windowStart } from './store-day.js';
```

Then replace the call site at line 77:

```ts
    const enabledProductCount = await computeEnabledProductCount(app, store);
```

with:

```ts
    // Subtract products that are effectively enabled but resolve to no
    // basket — see activation.routes.ts's summaryCounts for the identical
    // correction and why computeEnabledProductCount itself stays untouched.
    const [rawEnabledProductCount, unroutedCounts] = await Promise.all([
      computeEnabledProductCount(app, store),
      countUnroutedProducts(app, store),
    ]);
    const enabledProductCount = unroutedCounts.countsOmitted
      ? rawEnabledProductCount
      : rawEnabledProductCount - (unroutedCounts.unroutedEnabled ?? 0);
```

- [ ] **Step 3: Run the test again, confirm it passes**

Run: `cd apps/api && npx vitest run shopify-me.test.ts`
Expected: PASS.

- [ ] **Step 4: Typecheck**

Run: `cd apps/api && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/shopify/me.routes.ts apps/api/test/shopify-me.test.ts
git commit -m "$(cat <<'EOF'
fix(shopify): DashboardPage Try-On Enabled stat excludes unrouted products

Same fix as ManagePage's stat (previous commit), applied to me.routes.ts's
independently-duplicated computeEnabledProductCount — its own SQL stays
untouched, the correction happens at the call site via the shared
countUnroutedProducts helper.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Storefront `/enabled` route requires a resolved basket once synced

**Files:**
- Modify: `apps/api/src/modules/shopify/customer.routes.ts:599-641`
- Test: `apps/api/test/integration/shopify-customer.test.ts`

**Interfaces:**
- Consumes: `resolveBasket` (already imported in this file from `./funnel-resolution.js`, used elsewhere at line 363) — reused here, no new export needed.

- [ ] **Step 1: Update the integration tests, then watch the new/changed ones fail**

In `apps/api/test/integration/shopify-customer.test.ts`, within the `describe('GET /v1/shopify/customer/products/:shopifyProductId/enabled', ...)` block (originally lines 515-602):

Change the "individually enabled" test (originally lines 579-590) to pin a basket:

```ts
    it('is enabled under selective mode for an individually enabled, routed product', async () => {
      const store = await seedStore(null);
      await seedGarment(store.id, 904, await seedFunnelTemplate());

      const res = await app.inject({
        method: 'GET',
        url: '/v1/shopify/customer/products/904/enabled',
        headers: { 'x-widget-key': store.storeKey },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ enabled: true, verboseErrors: false });
    });

    it('is disabled once synced when effectively enabled but resolving to no basket', async () => {
      const store = await seedStore(null);
      // enabled: true, no funnelTemplateId pin, and no funnel rule configured
      // for this store — resolveBasket can never resolve for it.
      await seedGarment(store.id, 905);

      const res = await app.inject({
        method: 'GET',
        url: '/v1/shopify/customer/products/905/enabled',
        headers: { 'x-widget-key': store.storeKey },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ enabled: false, verboseErrors: false });
    });

    it('rejects a non-numeric product id', async () => {
```

(This replaces the original "is enabled ... individually enabled product" test with two: the renamed passing case and the new unrouted-disabled case, and keeps the following "rejects a non-numeric product id" test as-is — only its preceding blank line/test boundary moves.)

The "never synced, global mode" test (lines 516-530) and the "excluded despite global mode" test (532-555) and the "disabled, no individual/collection enable" test (557-577) are unchanged — none of them reach the new routing check (first has no garment row at all; the other two are already `enabled: false` before routing would even be considered).

Run: `cd apps/api && npx vitest run --config vitest.integration.config.ts shopify-customer.test.ts`
Expected: FAIL on the new "is disabled once synced when effectively enabled but resolving to no basket" case (route currently returns `enabled: true`), and the renamed "routed product" case should already pass once seeded correctly — but run it now to confirm the *new* case is the one failing, isolating the fix's effect.

- [ ] **Step 2: Fix the route**

In `apps/api/src/modules/shopify/customer.routes.ts`, replace the handler body of the `/products/:shopifyProductId/enabled` route (originally lines 604-640):

```ts
    async (req) => {
      const storeId = req.shopifyStoreId as string;
      const store = req.shopifyStoreRow as typeof schema.shopifyStores.$inferSelect;
      const { shopifyProductId } = req.params as { shopifyProductId: string };
      const productId = Number(shopifyProductId);
      if (!Number.isInteger(productId)) {
        throw new AppError('BAD_REQUEST', 400, 'invalid product id');
      }

      const [garment] = await app.db
        .select({
          enabled: schema.shopifyProductGarments.enabled,
          excluded: schema.shopifyProductGarments.excluded,
        })
        .from(schema.shopifyProductGarments)
        .where(
          and(
            eq(schema.shopifyProductGarments.storeId, storeId),
            eq(schema.shopifyProductGarments.shopifyProductId, productId),
          ),
        )
        .limit(1);

      // Not-yet-synced products have no individual/exclusion state of their
      // own yet — fall through to whatever mode + collection membership say,
      // same as resolveEffectiveEnabled does for a garment that exists.
      const enabled = await resolveEffectiveEnabled(app, store, {
        shopifyProductId: productId,
        enabled: garment?.enabled ?? false,
        excluded: garment?.excluded ?? false,
      });

      // Piggybacks on this call because it's the first request the widget makes
      // on init (see the comment above this route). true only when the env var
      // is exactly 'true' — see SHOPIFY_WIDGET_VERBOSE in env.ts.
      return { enabled, verboseErrors: app.env.SHOPIFY_WIDGET_VERBOSE === true };
    },
```

with:

```ts
    async (req) => {
      const storeId = req.shopifyStoreId as string;
      const store = req.shopifyStoreRow as typeof schema.shopifyStores.$inferSelect;
      const { shopifyProductId } = req.params as { shopifyProductId: string };
      const productId = Number(shopifyProductId);
      if (!Number.isInteger(productId)) {
        throw new AppError('BAD_REQUEST', 400, 'invalid product id');
      }

      const [garment] = await app.db
        .select({
          enabled: schema.shopifyProductGarments.enabled,
          excluded: schema.shopifyProductGarments.excluded,
          funnelTemplateId: schema.shopifyProductGarments.funnelTemplateId,
          productType: schema.shopifyProductGarments.productType,
          tags: schema.shopifyProductGarments.tags,
          vendor: schema.shopifyProductGarments.vendor,
          collections: schema.shopifyProductGarments.collections,
          title: schema.shopifyProductGarments.title,
        })
        .from(schema.shopifyProductGarments)
        .where(
          and(
            eq(schema.shopifyProductGarments.storeId, storeId),
            eq(schema.shopifyProductGarments.shopifyProductId, productId),
          ),
        )
        .limit(1);

      // Not-yet-synced products have no individual/exclusion state of their
      // own yet — fall through to whatever mode + collection membership say,
      // same as resolveEffectiveEnabled does for a garment that exists.
      let enabled = await resolveEffectiveEnabled(app, store, {
        shopifyProductId: productId,
        enabled: garment?.enabled ?? false,
        excluded: garment?.excluded ?? false,
      });

      // Effectively enabled AND already synced (a garment row exists) —
      // additionally require a resolvable basket, matching the actual
      // try-on-creation refusal (see this file's presign/submit path above).
      // A never-synced product (no row) skips this: that path already
      // re-queues a sync and tells the shopper to check back, so promising a
      // working button ahead of any basket data would be wrong in a
      // different way, not righter.
      if (enabled && garment) {
        const resolvedBasket = await resolveBasket(app, storeId, {
          funnelTemplateId: garment.funnelTemplateId,
          productType: garment.productType,
          tags: garment.tags,
          vendor: garment.vendor,
          collections: garment.collections,
          title: garment.title,
        });
        if (!resolvedBasket) enabled = false;
      }

      // Piggybacks on this call because it's the first request the widget makes
      // on init (see the comment above this route). true only when the env var
      // is exactly 'true' — see SHOPIFY_WIDGET_VERBOSE in env.ts.
      return { enabled, verboseErrors: app.env.SHOPIFY_WIDGET_VERBOSE === true };
    },
```

`resolveBasket` is already imported in this file (line 26: `import { resolveBasket } from './funnel-resolution.js';`) since the try-on creation path above uses it — no new import needed.

- [ ] **Step 3: Run the tests again, confirm they pass**

Run: `cd apps/api && npx vitest run --config vitest.integration.config.ts shopify-customer.test.ts`
Expected: PASS, full file (this also re-confirms the try-on creation tests earlier in the file, which exercise the same `resolveBasket` call, are unaffected).

- [ ] **Step 4: Typecheck**

Run: `cd apps/api && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/shopify/customer.routes.ts apps/api/test/integration/shopify-customer.test.ts
git commit -m "$(cat <<'EOF'
fix(shopify): storefront /enabled route requires a resolved basket once synced

The widget's init check only looked at computeEffectiveEnabled, so a synced,
enabled product with no basket pin/rule showed the try-on button and then
dead-ended the shopper's attempt at submission. Never-synced products (no
garment row) are unaffected — that path already re-queues a sync and tells
the shopper to check back.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Full sync's deletion reconciliation uses a fresh final pass, self-heals missed products

**Files:**
- Modify: `apps/api/src/modules/shopify/products.sync.ts:334-554`
- Test: `apps/api/test/shopify-sync.test.ts:305-431`

**Interfaces:**
- Produces: no new exports — `fetchLiveProductIds` is a private closure inside `syncOneTask`, same visibility as the existing `fetchAndSyncOneProduct`.

- [ ] **Step 1: Update the full-sync pagination test to expect the extra id-only pass, then watch it fail**

Replace the entire `describe('syncOneTask — full sync pagination', ...)` block (originally lines 305-431) in `apps/api/test/shopify-sync.test.ts` with:

```ts
describe('syncOneTask — full sync pagination', () => {
  it('threads the cursor across pages, syncs products from both, and reconciles against a fresh final id-only pass', async () => {
    // Isolated store: a full sync now reconciles deletions against every row
    // it finds for the store, and this test's mocked catalog (601, 602 only)
    // would otherwise wrongly mark other tests' unrelated products in the
    // shared `storeId` as deleted.
    const store = await upsertShopifyStore(
      app,
      {
        shopifyShopId: 704,
        shopDomain: 'full-sync.myshopify.com',
        myshopifyDomain: 'full-sync.myshopify.com',
        name: 'Full Sync Store',
        email: 'full-sync@s.com',
      },
      'tok',
      'read_products',
    );

    // Pre-existing row for a product Shopify no longer returns in this sync —
    // simulates a deletion whose products/delete webhook never arrived.
    await app.db.insert(schema.shopifyProductGarments).values({
      storeId: store.id,
      shopifyProductId: 699,
      shopifyVariantId: 0,
      r2Key: 'stale',
      title: 'Gone Product',
      status: 'active',
    });

    let detailedCallCount = 0;
    let idsCallCount = 0;
    const originalFetch = global.fetch;
    global.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (!url.endsWith('/graphql.json')) {
        throw new Error(`unexpected fetch during full sync: ${url}`);
      }
      const body = JSON.parse(String(init?.body)) as {
        query: string;
        variables?: { cursor?: string | null };
      };

      // The fresh final reconciliation pass — same query 'reconcile' mode
      // uses. Returns both live ids in one page (page size 250, well above
      // this test's 2 products), so no self-heal is triggered here (that's
      // covered by the next test).
      if (body.query.includes('ProductIdsPage')) {
        idsCallCount++;
        expect(body.variables?.cursor ?? null).toBeNull();
        return new Response(
          JSON.stringify({
            data: {
              products: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [
                  { id: 'gid://shopify/Product/601' },
                  { id: 'gid://shopify/Product/602' },
                ],
              },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      // The main detailed pass (nested collections field, 25/page).
      detailedCallCount++;
      if (detailedCallCount === 1) {
        expect(body.variables?.cursor ?? null).toBeNull();
        return new Response(
          JSON.stringify({
            data: {
              products: {
                pageInfo: { hasNextPage: true, endCursor: 'p1' },
                nodes: [
                  {
                    id: 'gid://shopify/Product/601',
                    title: 'Page One Product',
                    productType: null,
                    tags: [],
                    vendor: null,
                    featuredImage: null,
                    collections: { nodes: [] },
                  },
                ],
              },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      expect(body.variables?.cursor).toBe('p1');
      return new Response(
        JSON.stringify({
          data: {
            products: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [
                {
                  id: 'gid://shopify/Product/602',
                  title: 'Page Two Product',
                  productType: null,
                  tags: [],
                  vendor: null,
                  featuredImage: null,
                  collections: { nodes: [] },
                },
              ],
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    try {
      await syncOneTask(app, { storeId: store.id, mode: 'full' });
      expect(detailedCallCount).toBe(2);
      expect(idsCallCount).toBe(1);

      const rows = await app.db
        .select()
        .from(schema.shopifyProductGarments)
        .where(
          and(
            eq(schema.shopifyProductGarments.storeId, store.id),
            eq(schema.shopifyProductGarments.shopifyProductId, 601),
          ),
        );
      const [row2] = await app.db
        .select()
        .from(schema.shopifyProductGarments)
        .where(
          and(
            eq(schema.shopifyProductGarments.storeId, store.id),
            eq(schema.shopifyProductGarments.shopifyProductId, 602),
          ),
        );
      expect(rows[0]?.title).toBe('Page One Product');
      expect(row2?.title).toBe('Page Two Product');

      const [staleRow] = await app.db
        .select()
        .from(schema.shopifyProductGarments)
        .where(
          and(
            eq(schema.shopifyProductGarments.storeId, store.id),
            eq(schema.shopifyProductGarments.shopifyProductId, 699),
          ),
        );
      expect(staleRow.status).toBe('deleted');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('self-heals a product present in the fresh final pass but missed by the detailed pass (created mid-sync)', async () => {
    const store = await upsertShopifyStore(
      app,
      {
        shopifyShopId: 705,
        shopDomain: 'self-heal.myshopify.com',
        myshopifyDomain: 'self-heal.myshopify.com',
        name: 'Self Heal Store',
        email: 'self-heal@s.com',
      },
      'tok',
      'read_products',
    );

    const originalFetch = global.fetch;
    global.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (!url.endsWith('/graphql.json')) {
        throw new Error(`unexpected fetch during full sync: ${url}`);
      }
      const body = JSON.parse(String(init?.body)) as { query: string };

      // Fresh final pass sees a product (805) the detailed pass below never
      // returned — simulates it being created on Shopify while the detailed
      // pass was already running.
      if (body.query.includes('ProductIdsPage')) {
        return new Response(
          JSON.stringify({
            data: {
              products: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [
                  { id: 'gid://shopify/Product/801' },
                  { id: 'gid://shopify/Product/805' },
                ],
              },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      // Self-heal fetches the missed product individually.
      if (body.query.includes('OneProduct')) {
        return new Response(
          JSON.stringify({
            data: {
              product: {
                id: 'gid://shopify/Product/805',
                title: 'Mid-Sync Product',
                productType: null,
                tags: [],
                vendor: null,
                featuredImage: null,
                collections: { nodes: [] },
              },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      // Detailed pass only ever saw 801.
      return new Response(
        JSON.stringify({
          data: {
            products: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [
                {
                  id: 'gid://shopify/Product/801',
                  title: 'Existing Product',
                  productType: null,
                  tags: [],
                  vendor: null,
                  featuredImage: null,
                  collections: { nodes: [] },
                },
              ],
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    try {
      await syncOneTask(app, { storeId: store.id, mode: 'full' });

      const [row801] = await app.db
        .select()
        .from(schema.shopifyProductGarments)
        .where(
          and(
            eq(schema.shopifyProductGarments.storeId, store.id),
            eq(schema.shopifyProductGarments.shopifyProductId, 801),
          ),
        );
      const [row805] = await app.db
        .select()
        .from(schema.shopifyProductGarments)
        .where(
          and(
            eq(schema.shopifyProductGarments.storeId, store.id),
            eq(schema.shopifyProductGarments.shopifyProductId, 805),
          ),
        );
      expect(row801?.title).toBe('Existing Product');
      // No featuredImage in the mocked OneProduct response, so the self-heal
      // sync records it as 'failed' (no image to download) rather than
      // 'active' — the point of this test is that the row exists at all
      // (self-healed within this sync run) rather than being silently
      // missing until the next hourly reconcile tick.
      expect(row805?.title).toBe('Mid-Sync Product');
      expect(row805?.status).toBe('failed');
    } finally {
      global.fetch = originalFetch;
    }
  });
});
```

Run: `cd apps/api && npx vitest run shopify-sync.test.ts -t "full sync pagination"`
Expected: FAIL on both — the first because `idsCallCount` stays 0 (no final pass exists yet) and the mock's `ProductIdsPage` branch is never hit; the second because product 805 is never fetched (no self-heal logic yet), so `row805` is `undefined`.

- [ ] **Step 2: Factor `fetchLiveProductIds` and use it in both places**

In `apps/api/src/modules/shopify/products.sync.ts`, insert this new closure right after the closing brace of `fetchAndSyncOneProduct` (originally ending at line 408, immediately before `if (task.mode === 'collection') {` at line 410):

```ts
  // Shared by 'reconcile' mode and the full sync's final reconciliation pass
  // below — both need the store's complete current-Shopify id set via the
  // cheap 250/page id-only query, not the nested-field 25/page one
  // fetchAndSyncOneProduct's callers use for full product data.
  async function fetchLiveProductIds(): Promise<number[]> {
    let cursor: string | null = null;
    const ids: number[] = [];
    do {
      const data: ProductIdsPageData = await shopifyGraphQL<ProductIdsPageData>(
        shop,
        token,
        PRODUCT_IDS_PAGE,
        { cursor },
        { onUnauthorized },
      );
      for (const node of data.products.nodes) {
        ids.push(numericIdFromGid(node.id));
      }
      cursor = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null;
      if (cursor) await new Promise((r) => setTimeout(r, 300)); // throttle
    } while (cursor);
    return ids;
  }

```

Now replace the `'reconcile'` branch's inline pagination loop (originally lines 489-504):

```ts
    let cursor: string | null = null;
    const liveProductIds: number[] = [];
    do {
      const data: ProductIdsPageData = await shopifyGraphQL<ProductIdsPageData>(
        shop,
        token,
        PRODUCT_IDS_PAGE,
        { cursor },
        { onUnauthorized },
      );
      for (const node of data.products.nodes) {
        liveProductIds.push(numericIdFromGid(node.id));
      }
      cursor = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null;
      if (cursor) await new Promise((r) => setTimeout(r, 300)); // throttle
    } while (cursor);
```

with:

```ts
    const liveProductIds = await fetchLiveProductIds();
```

- [ ] **Step 3: Replace the full sync's final reconciliation with a fresh pass + self-heal**

Replace the last two lines of `syncOneTask` (originally lines 548-553):

```ts
  // Every product this pass saw was just upserted above; anything already in
  // the DB that wasn't seen no longer exists on Shopify. Runs on every full
  // sync, including the merchant's manual "Sync now" button, so a deletion
  // that was missed by the webhook is caught the moment they click it, not
  // just on the next hourly reconcile tick.
  await reconcileDeletedProducts(app, store.id, liveProductIds);
}
```

with:

```ts
  // liveProductIds was collected DURING the pass above, which can run for
  // minutes on a large catalog. If a products/delete webhook lands mid-pass
  // for a product whose page was already fetched, this pass's own upsert for
  // that product (a few lines above) unconditionally writes status:'active',
  // silently overwriting the webhook's deletion. Reconciling against a fresh,
  // final id-only pass — collected AFTER the detailed pass completes, same
  // query 'reconcile' mode uses — closes that window down to this final
  // pass's own duration instead of leaving it open until the next hourly
  // reconcile tick.
  const freshLiveProductIds = await fetchLiveProductIds();

  // Self-heal: an id present in the fresh pass but missed by the detailed
  // pass above was created while this sync was running. Same mechanism
  // 'reconcile' mode already uses for newly-discovered products.
  const detailedPassIds = new Set(liveProductIds);
  for (const productId of freshLiveProductIds) {
    if (detailedPassIds.has(productId)) continue;
    await fetchAndSyncOneProduct(productId);
    await new Promise((r) => setTimeout(r, 300)); // throttle, same cadence as the id-page loop above
  }

  // Runs on every full sync, including the merchant's manual "Sync now"
  // button, so a deletion missed by the webhook is caught the moment they
  // click it, not just on the next hourly reconcile tick.
  await reconcileDeletedProducts(app, store.id, freshLiveProductIds);
}
```

- [ ] **Step 4: Run the tests again, confirm they pass**

Run: `cd apps/api && npx vitest run shopify-sync.test.ts`
Expected: PASS, full file (including the `syncProduct` and `product mode` describe blocks above/below, unaffected by this change).

- [ ] **Step 5: Typecheck**

Run: `cd apps/api && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/shopify/products.sync.ts apps/api/test/shopify-sync.test.ts
git commit -m "$(cat <<'EOF'
fix(shopify): full sync reconciles deletions against a fresh final pass

liveProductIds collected during the (possibly minutes-long) detailed pass
could be stale by the time reconcileDeletedProducts ran: a products/delete
webhook landing mid-pass for an already-fetched product got silently
overwritten back to 'active' by that same pass's own upsert, self-correcting
only on the next hourly reconcile tick. A fresh, final id-only pass — reusing
reconcile mode's own PRODUCT_IDS_PAGE query — closes that window down to this
pass's own duration, and also self-heals any product the detailed pass missed
(created mid-sync) via the same per-product fetch reconcile mode already uses.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Full verification pass + progress log entry

**Files:**
- Modify: `docs/progress.md` (append entry)

No code changes in this task — it's the whole-branch confirmation pass plus the durable record, per CLAUDE.md ("State that lives outside the repo... record it in docs/progress.md").

- [ ] **Step 1: Run every unit test touched or adjacent to this work**

Run: `cd apps/api && npx vitest run shopify-activation-routes.test.ts shopify-me.test.ts shopify-sync.test.ts`
Expected: all PASS.

- [ ] **Step 2: Run every integration test touched or that exercises the same shared code**

Run:
```bash
cd apps/api && npx vitest run --config vitest.integration.config.ts \
  shopify-customer.test.ts \
  shopify-merchant-funnel-rules.test.ts \
  shopify-admin-funnel-rules.test.ts \
  shopify-funnel-loader.test.ts \
  shopify-basket-routing.test.ts \
  shopify-refusal-events.test.ts \
  shopify-limits.test.ts \
  shopify-product-basket.test.ts
```
Expected: all PASS — the last several confirm `resolveBasketFrom`/`loadRuleSet`/`resolveBasket` (touched indirectly via the Task 1 extraction and Task 4 route change) still behave identically everywhere else they're used.

- [ ] **Step 3: Full typecheck and lint across the monorepo**

Run (from repo root): `pnpm typecheck && pnpm lint`
Expected: no errors introduced by this branch (pre-existing unrelated failures, if any, are not this task's responsibility — note them rather than fixing them if encountered).

- [ ] **Step 4: Append the progress log entry**

Add this section to the top of the dated entries in `docs/progress.md` (immediately after the header note, before the `## 2026-09-19 — Shopify products/create webhook backfill run` entry already there):

```markdown
## 2026-09-19 — Routing-aware enablement counts + hardened full-sync deletion race

- **Change:** Implemented both findings from
  `docs/superpowers/specs/2026-09-19-shopify-routing-and-sync-accuracy-design.md`.
  1. `computeEffectiveEnabled` and `resolveBasketFrom` are now both required everywhere a
     merchant or shopper sees an "enabled" signal, not just try-on creation: the storefront
     `/enabled` route (`customer.routes.ts`), ManagePage's "Try-On Enabled" stat
     (`activation.routes.ts`), and DashboardPage's independently-duplicated stat
     (`me.routes.ts`) all now exclude products that are effectively enabled but resolve to no
     basket. Mechanism: the per-product routing scan already living in
     `funnel-rules.routes.ts` (for the Routing tab's `unroutedEnabled`) was extracted into a
     shared `countUnroutedProducts` helper in `funnel-resolution.ts`; both stat routes subtract
     its `unroutedEnabled` from their existing SQL-only counts rather than rewriting those
     counts' own logic (`countEffectivelyEnabled` keeps its parity test with
     `computeEffectiveEnabled` undisturbed).
  2. `syncOneTask`'s `full` branch (`products.sync.ts`) no longer reconciles deletions against
     `liveProductIds` collected during the (possibly minutes-long) detailed pass — a
     `products/delete` webhook landing mid-pass for an already-fetched product was getting
     silently overwritten back to `active` by that pass's own upsert. It now runs a fresh,
     final id-only pass (reusing `reconcile` mode's own `PRODUCT_IDS_PAGE` query) after the
     detailed pass completes, reconciles against that, and self-heals any product id the
     detailed pass missed (created mid-sync) the same way `reconcile` mode already does for
     newly-discovered products.
- **Shipped via:** this branch (`chore/shopify-sync-routing-accuracy-audit`), implementation
  plan `docs/superpowers/plans/2026-09-19-shopify-routing-and-sync-accuracy-implementation.md`.
- **Test impact:** updated `shopify-activation-routes.test.ts`, `shopify-me.test.ts`,
  `integration/shopify-customer.test.ts`, and `shopify-sync.test.ts` per the spec's Test impact
  section; added one new self-heal test case to `shopify-sync.test.ts` beyond what the spec
  called out. Full regression sweep across every test touching `resolveBasketFrom`/`loadRuleSet`
  (funnel-rules, funnel-loader, basket-routing, refusal-events, limits, product-basket) confirmed
  unaffected.
- **Deferred (per spec, not in this work):** a "Not routed" link on Manage/Routing opening a
  popup listing actual unrouted product names — agreed to revisit once the count itself is
  accurate.
- **Not addressed here (separately flagged in the prior 2026-09-19 entry):** production's
  `NODE_TLS_REJECT_UNAUTHORIZED=0` and the missing `pnpm backfill:shopify-products-create-webhook`
  script alias — both still open.
```

- [ ] **Step 5: Commit**

```bash
git add docs/progress.md
git commit -m "$(cat <<'EOF'
docs(progress): record routing-aware enablement + full-sync race fixes

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- Finding 1, all three surfaces (storefront `/enabled`, ManagePage stat, DashboardPage stat) — Tasks 2, 3, 4.
- Finding 1's shared-helper extraction / duplication cleanup — Task 1.
- Finding 1's `COUNTS_PRODUCT_CAP` degradation for both new call sites — built into `countUnroutedProducts` itself (Task 1), so Tasks 2/3 inherit it for free.
- Finding 1's caption update — Task 2, Step 4.
- Finding 2, fresh final pass + self-heal — Task 5.
- Finding 2's "not fixing" note (double-click races) — no task needed, explicitly out of scope per spec.
- Test impact section — all four listed files covered (Tasks 2, 3, 4, 5); one extra self-heal case added in Task 5 beyond the spec's explicit list, called out in the Task 6 progress entry.
- "Already fixed upstream" section — confirmed via the earlier commit read (PR #384/#386 already merged to this branch's base); no task duplicates it.
- Deferred "Not routed" popup — explicitly not a task, noted in Task 6's progress entry.

**Placeholder scan:** no TBD/TODO, no "add appropriate handling," no "similar to Task N" — every step has real code or an exact command.

**Type consistency:** `UnroutedCounts`, `countUnroutedProducts`, `COUNTS_PRODUCT_CAP` (Task 1) are referenced with identical names/shapes in Tasks 2 and 3. `fetchLiveProductIds` (Task 5) has no external consumers, so no cross-task signature risk there.
