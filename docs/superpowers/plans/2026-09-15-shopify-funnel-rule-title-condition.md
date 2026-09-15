# Shopify Funnel Rule "Product Title" Condition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** add `title` as a fifth selectable condition field for Shopify funnel
rules — usable identically in merchant store rules and admin-authored global
rules — reusing the existing case-insensitive string-match path exactly as
`vendor` works today.

**Architecture:** `title` is a plain string field, structurally identical to
`vendor`. It rides the existing `matchesText` comparator in
`resolveBasketFrom` with no new operators and no new matching semantics. Six
call sites hardcode today's 4-field union (`product_type | tags | vendor |
collections`) and each needs the literal `'title'` added; one of those six
(the merchant counts query) also needs a new column in its `select`.

**Tech Stack:** TypeScript, Drizzle ORM (untyped `jsonb` column — no
migration), Zod, Vitest, React + Polaris (`apps/shopify`), React +
`SearchableSelect` (`apps/admin-web`).

## Global Constraints

- No new operators: `title` supports exactly `equals` (labeled "is") and
  `contains`, matching every existing field. No `not_equals`,
  `not_contains`, or `starts_with`.
- No changes to `product_type`, `tags`, `vendor`, or `collections` matching
  behavior.
- Case-insensitive matching, reusing `matchesText` — do not write a new
  comparator.
- In both field-picker dropdowns (merchant `RoutingPage.tsx` and admin
  `ShopifyFunnelsPage.tsx`), "Product title" is listed **first**; the
  existing four keep their current relative order after it.
- `emptyCondition()` in both frontend files keeps defaulting new condition
  rows to `product_type` — do not change the default.
- No database migration. `shopify_funnel_rules.conditions` is untyped
  `jsonb`; the field union exists only in TypeScript/Zod.
- No backfill. `shopify_product_garments.title` is already populated by
  product sync for every store today.
- Spec: `docs/superpowers/specs/2026-09-15-shopify-funnel-rule-title-condition-design.md`.

---

### Task 1: Core matching support — schema type, resolver, unit tests

**Files:**
- Modify: `packages/db/src/schema/shopify.ts:82-86`
- Modify: `apps/api/src/modules/shopify/funnel-resolution.ts:8-14, 79-90`
- Modify: `apps/api/src/modules/shopify/funnel-rules.routes.ts:132-138`
- Test: `apps/api/test/shopify-funnel-resolution.test.ts`

**Interfaces:**
- Consumes: nothing from another task in this plan (this is the foundation
  task).
- Produces: `schema.FunnelRuleCondition['field']` now includes `'title'`.
  `BasketMatchTarget` (exported from `funnel-resolution.ts`) now requires a
  `title: string | null` property — every caller that constructs or casts to
  a `BasketMatchTarget` must supply it. `matchesCondition` now handles
  `field: 'title'` by comparing `target.title`.

  Three call sites in this codebase cast a query row to `BasketMatchTarget`
  (verified via `Grep` — see the design doc's "Sites that change" table):
  `funnel-rules.routes.ts`, `products.routes.ts`, `customer.routes.ts`.
  `products.routes.ts` and `customer.routes.ts` already select/return
  `title` today (needed for display), so their casts keep compiling
  unchanged. `funnel-rules.routes.ts`'s counts-scan `select` does **not**
  select `title` today — once `BasketMatchTarget` requires it, that cast
  stops being a valid type assertion (the row type would no longer be a
  structural superset of the target interface, which is what makes `as`
  legal here without going through `unknown`). **This task's own Step 3
  therefore includes adding `title` to that one `select`, even though the
  Zod/API-surface work for the `title` field belongs to Task 2** — Task 1
  must leave the repo typechecking cleanly on its own, and this one line is
  a hard compile dependency of the `BasketMatchTarget` change, not an
  optional follow-up. Task 2 still owns making `field: 'title'` legal to
  *write* through the public routes (the Zod enums) and adds the
  integration test that proves the end-to-end path works.

- [ ] **Step 1: Write the failing test**

  Open `apps/api/test/shopify-funnel-resolution.test.ts`. First, add
  `title: null,` to the `product()` helper's default object so every test
  that doesn't care about title still compiles once `BasketMatchTarget`
  requires the field:

  ```typescript
  function product(partial: Partial<BasketMatchTarget> = {}): BasketMatchTarget {
    return {
      funnelTemplateId: null,
      productType: null,
      tags: null,
      vendor: null,
      collections: null,
      title: null,
      ...partial,
    };
  }
  ```

  Then add two new `it` blocks inside the existing `describe('matchesCondition', ...)`
  block, right after the `'matches vendor case-insensitively'` test (around
  line 91), mirroring that test's shape:

  ```typescript
  it('matches title case-insensitively', () => {
    expect(
      matchesCondition(
        { field: 'title', operator: 'equals', value: 'silk saree' },
        product({ title: 'Silk Saree' }),
      ),
    ).toBe(true);
  });

  it('matches title on substring for contains', () => {
    expect(
      matchesCondition(
        { field: 'title', operator: 'contains', value: 'saree' },
        product({ title: 'Premium Silk Saree - Red' }),
      ),
    ).toBe(true);
  });
  ```

  Finally, extend the existing `'never matches and never throws on null or
  empty columns'` test (around line 113-127) to also cover `title`. Change:

  ```typescript
  it('never matches and never throws on null or empty columns', () => {
    const empty = product({ tags: [], collections: [] });
    expect(
      matchesCondition({ field: 'product_type', operator: 'contains', value: 'x' }, empty),
    ).toBe(false);
    expect(matchesCondition({ field: 'vendor', operator: 'equals', value: 'x' }, empty)).toBe(
      false,
    );
    expect(matchesCondition({ field: 'tags', operator: 'contains', value: 'x' }, empty)).toBe(
      false,
    );
    expect(matchesCondition({ field: 'collections', operator: 'equals', value: 'x' }, empty)).toBe(
      false,
    );
  });
  ```

  to:

  ```typescript
  it('never matches and never throws on null or empty columns', () => {
    const empty = product({ tags: [], collections: [] });
    expect(
      matchesCondition({ field: 'product_type', operator: 'contains', value: 'x' }, empty),
    ).toBe(false);
    expect(matchesCondition({ field: 'vendor', operator: 'equals', value: 'x' }, empty)).toBe(
      false,
    );
    expect(matchesCondition({ field: 'tags', operator: 'contains', value: 'x' }, empty)).toBe(
      false,
    );
    expect(matchesCondition({ field: 'collections', operator: 'equals', value: 'x' }, empty)).toBe(
      false,
    );
    expect(matchesCondition({ field: 'title', operator: 'contains', value: 'x' }, empty)).toBe(
      false,
    );
  });
  ```

- [ ] **Step 2: Run the test to verify it fails**

  Run (from the repo root):

  ```bash
  cd apps/api && npx vitest run test/shopify-funnel-resolution.test.ts
  ```

  Expected: a TypeScript compile error, not a runtime assertion failure —
  something like `Object literal may only specify known properties, and
  'title' does not exist in type 'Partial<BasketMatchTarget>'` (from the new
  `product({ title: ... })` calls) and/or `Type '"title"' is not assignable
  to type '"product_type" | "tags" | "vendor" | "collections"'` (from the new
  `field: 'title'` conditions). This is the correct failure mode for a typed
  codebase — proceed to Step 3.

- [ ] **Step 3: Implement**

  In `packages/db/src/schema/shopify.ts`, change the `FunnelRuleCondition`
  interface (lines 82-86):

  ```typescript
  export interface FunnelRuleCondition {
    field: 'product_type' | 'tags' | 'vendor' | 'collections' | 'title';
    operator: 'equals' | 'contains';
    value: string;
  }
  ```

  In `apps/api/src/modules/shopify/funnel-resolution.ts`, change
  `BasketMatchTarget` (lines 8-14) to add `title`:

  ```typescript
  export interface BasketMatchTarget {
    funnelTemplateId: string | null;
    productType: string | null;
    tags: string[] | null;
    vendor: string | null;
    collections: string[] | null;
    title: string | null;
  }
  ```

  In the same file, change `matchesCondition`'s switch (lines 73-91) to add a
  `title` case, reusing `matchesText` exactly like `product_type`/`vendor`:

  ```typescript
  export function matchesCondition(
    condition: schema.FunnelRuleCondition,
    target: BasketMatchTarget,
  ): boolean {
    const needle = norm(condition.value);
    if (!needle) return false;
    switch (condition.field) {
      case 'product_type':
        return matchesText(target.productType, condition.operator, needle);
      case 'vendor':
        return matchesText(target.vendor, condition.operator, needle);
      case 'title':
        return matchesText(target.title, condition.operator, needle);
      case 'tags':
        return matchesList(target.tags, condition.operator, needle);
      case 'collections':
        return matchesList(target.collections, condition.operator, needle);
      default:
        return false;
    }
  }
  ```

  Finally, in `apps/api/src/modules/shopify/funnel-rules.routes.ts`, add
  `title` to the counts-scan `select` (lines 132-138) — this is the compile
  dependency described above in this task's Interfaces section:

  ```typescript
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
  ```

  `packages/db` compiles to `dist/` and `apps/api` consumes that compiled
  output (`packages/db/package.json`'s `main`/`types` point at `dist/`), so
  rebuild it before running or typechecking `apps/api`:

  ```bash
  pnpm --filter @aivastra/db build
  ```

- [ ] **Step 4: Run the test to verify it passes**

  ```bash
  cd apps/api && npx vitest run test/shopify-funnel-resolution.test.ts
  ```

  Expected: PASS, all tests in the file green (the pre-existing ones
  unaffected, plus the two new `title` tests and the extended null/empty
  test).

- [ ] **Step 5: Typecheck the whole workspace**

  A `BasketMatchTarget`-shaped object is also constructed in
  `apps/api/src/modules/shopify/products.routes.ts` and
  `apps/api/src/modules/shopify/customer.routes.ts` — neither is touched by
  this task (both already select/return `title`), but confirm neither broke,
  alongside the `funnel-rules.routes.ts` select fixed above:

  ```bash
  pnpm --filter @aivastra/api typecheck
  ```

  Expected: PASS — the repo compiles cleanly with this task's changes alone.
  (Task 2 still owns making `field: 'title'` legal to submit through the
  public write routes — that's a Zod/API-surface concern, not a compile
  dependency, which is why it's a separate task.)

- [ ] **Step 6: Commit**

  ```bash
  git add packages/db/src/schema/shopify.ts apps/api/src/modules/shopify/funnel-resolution.ts apps/api/src/modules/shopify/funnel-rules.routes.ts apps/api/test/shopify-funnel-resolution.test.ts
  git commit -m "feat(shopify): add title as a matchable funnel-rule condition field"
  ```

---

### Task 2: Route wiring — merchant + admin Zod schemas, integration test

**Files:**
- Modify: `apps/api/src/modules/shopify/funnel-rules.routes.ts:15`
- Modify: `apps/api/src/modules/admin/shopify-funnel-rules.routes.ts:10`
- Test: `apps/api/test/integration/shopify-merchant-funnel-rules.test.ts`

**Interfaces:**
- Consumes: `schema.FunnelRuleCondition['field']` (now includes `'title'`)
  from Task 1. Also consumes Task 1's fix to `funnel-rules.routes.ts`'s
  counts-scan `select` (already includes `title` as of Task 1) — this task
  does not touch that `select` again.
- Produces: both the merchant (`POST/PATCH /v1/shopify/funnel-rules`) and
  admin (`POST/PATCH /admin/shopify/funnel-rules`) write routes now accept
  `field: 'title'` in a condition instead of rejecting it with a 400.

- [ ] **Step 1: Write the failing test**

  Open `apps/api/test/integration/shopify-merchant-funnel-rules.test.ts`.
  Add a new test at the end of the `describe` block (after the
  `'computes unroutedEnabled from only effectively-enabled unrouted
  products...'` test, before the closing `});` of the describe block). It
  creates its own store (store D, following the same self-contained pattern
  as store C above) so it can never collide with or depend on any other
  test's fixtures, and it reuses the already-seeded `upperBasketId` (a
  different store may have its own rule pointing at a basket another store
  already has a rule for — rules are unique on `(storeId,
  funnelTemplateId)`, not on `funnelTemplateId` alone). It creates the rule
  through the real `POST /v1/shopify/funnel-rules` route (not a raw
  `app.db.insert`) specifically so this test exercises the Zod schema change
  this task makes, not just Task 1's resolver/select-list work:

  ```typescript
  it('accepts a title condition via the create route and matches it in the counts scan', async () => {
    // A fresh store (D), like storeC above. Creating the rule through the
    // real route (not app.db.insert) is deliberate: it's what makes this
    // test depend on THIS task's Zod schema change (field: 'title' must be
    // accepted, not rejected with 400) rather than only on Task 1's
    // resolver/select-list fix, which a direct DB insert would bypass.
    const storeD = await upsertShopifyStore(
      app,
      {
        shopifyShopId: tag + 5,
        shopDomain: `merchant-rules-d-${tag}.myshopify.com`,
        myshopifyDomain: `merchant-rules-d-${tag}.myshopify.com`,
        name: 'Store D',
        email: 'd@d.com',
      },
      'tok',
      'read_products',
    );
    const authD = {
      authorization: `Bearer ${signSessionToken(storeD.shopDomain, API_SECRET, API_KEY)}`,
    };

    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/shopify/funnel-rules',
      headers: authD,
      payload: {
        funnelTemplateId: upperBasketId,
        conditions: [{ field: 'title', operator: 'contains', value: 'zzz-title-match' }],
        priority: 1,
      },
    });
    expect(createRes.statusCode).toBe(200);

    await app.db.insert(schema.shopifyProductGarments).values([
      {
        storeId: storeD.id,
        shopifyProductId: tag + 120,
        r2Key: `shopify-inputs/${storeD.id}/${tag}-d-matched/photo`,
        status: 'active',
        title: 'A zzz-title-match Product',
      },
      {
        storeId: storeD.id,
        shopifyProductId: tag + 121,
        r2Key: `shopify-inputs/${storeD.id}/${tag}-d-unmatched/photo`,
        status: 'active',
        title: 'Something else entirely',
      },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: '/v1/shopify/funnel-rules',
      headers: authD,
    });
    expect(res.json().countsOmitted).toBe(false);
    expect(res.json().counts[upperBasketId]).toBe(1);
    expect(res.json().unrouted).toBe(1);
  });
  ```

- [ ] **Step 2: Run the test to verify it fails**

  Requires local infra running first (`pnpm docker:up` from the repo root,
  if not already up). Run from `apps/api`:

  ```bash
  cd apps/api && npx vitest run --config vitest.integration.config.ts test/integration/shopify-merchant-funnel-rules.test.ts
  ```

  Expected: FAIL at `expect(createRes.statusCode).toBe(200);` — the merchant
  `Condition` Zod schema doesn't yet accept `field: 'title'`, so the route
  returns 400 and the rule is never created (the rest of the test never gets
  a chance to exercise Task 1's already-working resolver/select-list path).

- [ ] **Step 3: Implement**

  In `apps/api/src/modules/shopify/funnel-rules.routes.ts`, change the
  `Condition` schema (line 15):

  ```typescript
  const Condition = z.object({
    field: z.enum(['product_type', 'tags', 'vendor', 'collections', 'title']),
    operator: z.enum(['equals', 'contains']),
    value: z.string().min(1).max(200),
  });
  ```

  In `apps/api/src/modules/admin/shopify-funnel-rules.routes.ts`, change the
  `Condition` schema (line 10) the same way:

  ```typescript
  const Condition = z.object({
    field: z.enum(['product_type', 'tags', 'vendor', 'collections', 'title']),
    operator: z.enum(['equals', 'contains']),
    value: z.string().min(1).max(200),
  });
  ```

- [ ] **Step 4: Run the test to verify it passes**

  ```bash
  cd apps/api && npx vitest run --config vitest.integration.config.ts test/integration/shopify-merchant-funnel-rules.test.ts
  ```

  Expected: PASS — every test in the file green, including the new one.

- [ ] **Step 5: Typecheck**

  ```bash
  pnpm --filter @aivastra/api typecheck
  ```

  Expected: PASS.

- [ ] **Step 6: Commit**

  ```bash
  git add apps/api/src/modules/shopify/funnel-rules.routes.ts apps/api/src/modules/admin/shopify-funnel-rules.routes.ts apps/api/test/integration/shopify-merchant-funnel-rules.test.ts
  git commit -m "feat(shopify): accept title conditions on merchant and admin funnel-rule routes"
  ```

---

### Task 3: Merchant-facing UI — RoutingPage.tsx field picker

**Files:**
- Modify: `apps/shopify/src/pages/RoutingPage.tsx:22-26, 56-61`

**Interfaces:**
- Consumes: nothing from Task 1/2 directly (this is a frontend-only literal
  type + label map change — the merchant SPA calls the API over HTTP with no
  shared types package involvement for this shape).
- Produces: nothing consumed by a later task in this plan.

There is no existing test file for this component (verified via `Grep` for
`RoutingPage`/`FIELD_LABEL`/`FIELD_OPTIONS` across every `*.test.{ts,tsx}` in
the repo — no matches), so this task's verification step is a typecheck, not
a test run. This mirrors how the file's last several changes (recorded in
`docs/progress.md`) were verified.

- [ ] **Step 1: Change the `Condition['field']` union**

  In `apps/shopify/src/pages/RoutingPage.tsx`, change the `Condition`
  interface (lines 22-26):

  ```typescript
  interface Condition {
    field: 'product_type' | 'tags' | 'vendor' | 'collections' | 'title';
    operator: 'equals' | 'contains';
    value: string;
  }
  ```

- [ ] **Step 2: Add "Product title" to `FIELD_LABEL`, first**

  Change `FIELD_LABEL` (lines 56-61). `FIELD_OPTIONS` (lines 63-66) derives
  its order from `Object.keys(FIELD_LABEL)`, so putting `title` first in
  this object literal is the only change needed to make it first in the
  dropdown — no edit to `FIELD_OPTIONS` itself:

  ```typescript
  const FIELD_LABEL: Record<Condition['field'], string> = {
    title: 'Product title',
    product_type: 'Product type',
    tags: 'Tag',
    vendor: 'Vendor',
    collections: 'Collection',
  };
  ```

  Leave `emptyCondition()` (lines 93-95) unchanged — new condition rows must
  keep defaulting to `field: 'product_type'`, per this plan's Global
  Constraints.

- [ ] **Step 3: Typecheck**

  ```bash
  pnpm --filter @aivastra/shopify-admin typecheck
  ```

  Expected: PASS. (This package's `typecheck` script is `tsc -b`.)

- [ ] **Step 4: Manual verification**

  Run the dev server and open the merchant Manage page's Routing tab:

  ```bash
  pnpm --filter @aivastra/shopify-admin dev
  ```

  In the app, go to **Manage → Routing**, click **Add rule**, and confirm:
  - The **Field** dropdown's first option is "Product title".
  - Selecting "Product title" shows both **is** and **contains** options in
    the **Match** dropdown (same as every other field).
  - Saving a rule with a `Product title contains "..."` condition round-trips
    correctly — reopen the rule and the condition still reads "Product title
    contains "...""  in the rule list (`describeConditions`).

  If no browser/dev-server tooling is available in this execution
  environment, note that explicitly in the task report rather than claiming
  this step passed — this mirrors a known, previously-acknowledged gap in
  this repo's session history (no implementer subagent has had browser
  access to date).

- [ ] **Step 5: Commit**

  ```bash
  git add apps/shopify/src/pages/RoutingPage.tsx
  git commit -m "feat(shopify): add Product title to the merchant routing rule field picker"
  ```

---

### Task 4: Admin-facing UI — ShopifyFunnelsPage.tsx field picker

**Files:**
- Modify: `apps/admin-web/src/pages/ShopifyFunnelsPage.tsx:22, 64-69`

**Interfaces:**
- Consumes: nothing from another task in this plan.
- Produces: nothing consumed by a later task in this plan.

Like Task 3, no existing test file covers this component (verified via the
same `Grep`), so verification is a build (this package has no separate
`typecheck` script — `build` runs `tsc -b && vite build`), not a test run.

- [ ] **Step 1: Change the `ConditionField` union**

  In `apps/admin-web/src/pages/ShopifyFunnelsPage.tsx`, change line 22:

  ```typescript
  type ConditionField = 'product_type' | 'tags' | 'vendor' | 'collections' | 'title';
  ```

- [ ] **Step 2: Add "Product title" to `CONDITION_FIELD_LABEL`, first**

  Change `CONDITION_FIELD_LABEL` (lines 64-69). `CONDITION_FIELD_OPTIONS`
  (line 70) derives its order from `Object.keys(CONDITION_FIELD_LABEL)`, so
  — same as Task 3 — putting `title` first here is the only change needed:

  ```typescript
  const CONDITION_FIELD_LABEL: Record<ConditionField, string> = {
    title: 'Product title',
    product_type: 'Product type',
    tags: 'Tag',
    vendor: 'Vendor',
    collections: 'Collection',
  };
  ```

  Leave `emptyCondition()` (lines 79-81) unchanged — new condition rows must
  keep defaulting to `field: 'product_type'`.

- [ ] **Step 3: Build (typecheck + bundle)**

  ```bash
  pnpm --filter @aivastra/admin build
  ```

  Expected: PASS.

- [ ] **Step 4: Manual verification**

  Run the dev server and open the admin Shopify Funnels page:

  ```bash
  pnpm --filter @aivastra/admin dev
  ```

  In the app, go to the Shopify Funnels admin page, open **Add global rule**
  (or edit an existing one), and confirm the same three things as Task 3's
  manual check, using this page's `SearchableSelect` field picker instead of
  Polaris `Select`. If no browser/dev-server tooling is available, note that
  explicitly rather than claiming this step passed.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/admin-web/src/pages/ShopifyFunnelsPage.tsx
  git commit -m "feat(admin): add Product title to the global routing rule field picker"
  ```
