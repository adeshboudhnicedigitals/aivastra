# Shopify Basket Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route each Shopify storefront try-on to a workflow chosen by the product's own metadata, instead of the single global default every product uses today.

**Architecture:** A *basket* is an Aivastra-owned `shopify_funnel_templates` row bound to one ComfyUI workflow. *Funnel rules* map a product's Shopify metadata (`product_type`, `tags`, `vendor`, `collections`) to a basket, in three tiers: a per-product manual pin, then store rules, then Aivastra global rules (which a store may individually suppress), then the global default basket. Resolution is a pure function computed on read — nothing is materialized onto the product row — and the resolved workflow is pinned into `job_inputs.params` at enqueue exactly as today.

**Tech Stack:** TypeScript 5.6 ESM, Fastify 5 + `fastify-type-provider-zod`, Drizzle ORM on PostgreSQL 16, Vitest, React + Polaris (`apps/shopify`), React + Vite (`apps/admin-web`).

**Spec:** `docs/superpowers/specs/2026-09-02-shopify-basket-routing-design.md`

## Global Constraints

- **Branch:** all work lands on `feature/shopify-basket-routing` (already created off `dev`). PR targets `dev`.
- **Never run schema or data changes against production or `tryon_prod`.** Migrations are generated locally and ship push → CI/CD → `db:migrate:prod`.
- **Two production reads are prerequisites to Task 1** — see Task 1, Step 1. Reads against production are permitted; writes are not.
- **The feature must be inert on deploy.** No migration seeds any funnel rule. With zero global rules, resolution falls through to the existing default basket and every live store behaves exactly as it does today.
- **`workflowTemplateId` must never reach a merchant-facing payload.** Merchant routes return basket `id`/`slug`/`label` only.
- **Every admin (`/admin/*`) mutation writes `audit_logs` via `recordAudit(tx, …)` inside the mutation's own transaction**, after the write and before commit.
- **No `console.log`.** Use the `app.log` child loggers already bound in each module.
- **Import `@aivastra/db` as `workspace:*`**, never by relative path into `packages/`.
- **Never inline-mutate a workflow template** — `structuredClone` then patch. (No task here touches templates, but the dispatcher contract is unchanged and must stay that way.)
- **Integration tests must be run one file at a time.** The full-suite shared-rate-limiter cascade documented at `docs/progress.md:2604` is pre-existing and will otherwise mask real failures.
- **Every commit message ends with these two trailers:**
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01K3jhDzM9v8Z7exXFTo5XiE
  ```
- **Limits, enforced by Zod route schemas:** ≤20 conditions per rule, ≤50 rules per store, condition `value` ≤200 chars, product-count summary omitted above 10,000 products.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/db/src/schema/shopify.ts` | *Modify* — `shopify_funnel_rules` nullable `store_id`, drop `mode`, partial unique index; add `shopify_store_disabled_funnel_rules` |
| `packages/db/src/migrations/0185_*.sql` | *Create* — generated DDL plus the `funnel_assignment_source` backfill |
| `apps/api/src/modules/shopify/funnel-resolution.ts` | *Create* — the pure precedence rule (`matchesCondition`, `resolveBasketFrom`) plus its DB wrappers (`loadRuleSet`, `resolveBasket`). **The one place basket precedence lives** |
| `apps/api/src/modules/shopify/funnel-rules.routes.ts` | *Create* — merchant rule CRUD, suppression toggle, basket list |
| `apps/api/src/modules/shopify/customer.routes.ts` | *Modify* — delete `resolveWorkflowTemplate` (line 191), call `resolveBasket` |
| `apps/api/src/modules/shopify/products.routes.ts` | *Modify* — basket on the list response, pin on the PATCH body |
| `apps/api/src/modules/admin/shopify-funnel-rules.routes.ts` | *Create* — global rule CRUD, audited |
| `apps/api/src/modules/admin/shopify-funnels.routes.ts` | *Modify* — cascade counts on the delete confirmation |
| `apps/api/src/server.ts` | *Modify* — register the two new route modules |
| `apps/shopify/src/pages/RoutingPage.tsx` | *Create* — merchant rules UI |
| `apps/shopify/src/components/AppNavMenu.tsx`, `src/App.tsx` | *Modify* — Routing nav entry + route |
| `apps/shopify/src/pages/ManagePage.tsx` | *Modify* — Basket column in the Individual Products tab |
| `apps/admin-web/src/pages/ShopifyFunnelsPage.tsx` | *Modify* — Global rules card |

Resolution logic lives in exactly one file. Route modules consume it; no route re-derives precedence. This mirrors `apps/api/src/modules/shopify/activation.ts`, whose comment — *"the one place the activation precedence rule is allowed to live"* — applies verbatim here.

---

### Task 1: Schema and migration

**Files:**
- Modify: `packages/db/src/schema/shopify.ts:271-290` (`shopifyFunnelRules`)
- Create: `packages/db/src/migrations/0185_*.sql` (name generated by drizzle-kit)
- Test: `apps/api/test/integration/shopify-funnel-schema.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `schema.shopifyFunnelRules` with `storeId: string | null` and no `mode`; `schema.shopifyStoreDisabledFunnelRules` with columns `storeId: string`, `ruleId: string`, `createdAt: Date`.

- [ ] **Step 1: Run the two production read-only checks**

These gate the migration. The partial unique index is only safe to add on an empty table, and existing pins need a backfill.

```bash
# Against production, READ ONLY. Never write.
psql "$PROD_DATABASE_URL" -c "select count(*) from shopify_funnel_rules;"
psql "$PROD_DATABASE_URL" -c "select count(*) from shopify_product_garments where funnel_template_id is not null;"
```

Expected: the first returns `0`. **If it does not, stop and report** — a non-empty table means duplicate global rules per basket are already possible and the index needs a dedupe step first. The second may return any number; those rows get the Step 5 backfill.

- [ ] **Step 2: Write the failing schema test**

Create `apps/api/test/integration/shopify-funnel-schema.test.ts`:

```ts
import { schema } from '@aivastra/db';
import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TestDb, createTestDb, dropTestDb } from './helpers/containers.js';

describe('shopify funnel rule schema', () => {
  let db: TestDb;
  let workflowId: string;
  let basketId: string;

  beforeAll(async () => {
    db = await createTestDb();
    const [wf] = await db.client
      .insert(schema.workflowTemplates)
      .values({
        slug: `funnel-schema-${Date.now()}`,
        label: 'Funnel schema test workflow',
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
    workflowId = wf.id;
    const [basket] = await db.client
      .insert(schema.shopifyFunnelTemplates)
      .values({
        slug: `funnel-schema-basket-${Date.now()}`,
        label: 'Upper',
        workflowTemplateId: workflowId,
      })
      .returning();
    basketId = basket.id;
  });

  afterAll(async () => {
    await dropTestDb(db);
  });

  it('accepts a global rule with a null storeId', async () => {
    const [rule] = await db.client
      .insert(schema.shopifyFunnelRules)
      .values({
        storeId: null,
        funnelTemplateId: basketId,
        conditions: [{ field: 'tags', operator: 'contains', value: 'shirt' }],
        priority: 10,
      })
      .returning();
    expect(rule.storeId).toBeNull();
  });

  it('rejects a second global rule for the same basket', async () => {
    await expect(
      db.client.insert(schema.shopifyFunnelRules).values({
        storeId: null,
        funnelTemplateId: basketId,
        conditions: [{ field: 'vendor', operator: 'equals', value: 'acme' }],
        priority: 20,
      }),
    ).rejects.toThrow();
  });

  it('finds global rules by null storeId', async () => {
    const rows = await db.client
      .select()
      .from(schema.shopifyFunnelRules)
      .where(and(isNull(schema.shopifyFunnelRules.storeId), eq(schema.shopifyFunnelRules.funnelTemplateId, basketId)));
    expect(rows).toHaveLength(1);
  });
});
```

> If `createTestDb` / `dropTestDb` are named differently in `apps/api/test/integration/helpers/containers.ts`, use that file's actual exports — read it before writing this test rather than assuming these names.

- [ ] **Step 3: Run the test to verify it fails**

Run from `apps/api`: `npx vitest run --config vitest.integration.config.ts shopify-funnel-schema`
Expected: FAIL — inserting `storeId: null` violates the NOT NULL constraint.

- [ ] **Step 4: Edit the schema**

In `packages/db/src/schema/shopify.ts`, replace the `shopifyFunnelRules` table (lines 271-290) with:

```ts
export const shopifyFunnelRules = pgTable(
  'shopify_funnel_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Null means a global, Aivastra-authored rule that applies to every store.
    // Non-null is a store's own rule, which always resolves before any global
    // one — see resolveBasketFrom in modules/shopify/funnel-resolution.ts.
    storeId: uuid('store_id').references(() => shopifyStores.id, { onDelete: 'cascade' }),
    funnelTemplateId: uuid('funnel_template_id')
      .notNull()
      .references(() => shopifyFunnelTemplates.id, { onDelete: 'cascade' }),
    conditions: jsonb('conditions').$type<FunnelRuleCondition[]>().notNull().default([]),
    priority: integer('priority').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uq: unique().on(t.storeId, t.funnelTemplateId),
    // Postgres treats NULLs as distinct, so `uq` above does NOT constrain the
    // global tier at all — without this, unlimited duplicate global rules per
    // basket are insertable and resolution order becomes arbitrary.
    singleGlobalPerBasket: uniqueIndex('shopify_funnel_rules_one_global_per_basket_idx')
      .on(t.funnelTemplateId)
      .where(sql`${t.storeId} is null`),
  }),
);

// A merchant switching off one Aivastra global rule for their store alone.
// Keyed on rule_id rather than funnel_template_id so it keeps its meaning if
// global rules ever go multi-per-basket. Cascading from both sides means
// deleting a global rule cleans up every store's suppression of it.
export const shopifyStoreDisabledFunnelRules = pgTable(
  'shopify_store_disabled_funnel_rules',
  {
    storeId: uuid('store_id')
      .notNull()
      .references(() => shopifyStores.id, { onDelete: 'cascade' }),
    ruleId: uuid('rule_id')
      .notNull()
      .references(() => shopifyFunnelRules.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.storeId, t.ruleId] }),
  }),
);
```

Add `primaryKey` to the `drizzle-orm/pg-core` import at the top of the file if it is not already imported. The `mode` column is dropped by omission — no code reads it.

- [ ] **Step 5: Generate the migration and append the backfill**

```bash
pnpm db:generate
```

Then open the generated `packages/db/src/migrations/0185_*.sql` and append:

```sql
--> statement-breakpoint
-- Rows with a pin predate this feature and can only have come from the admin
-- reassign-on-basket-delete path (admin/shopify-funnels.routes.ts). Without
-- this, the Manage page renders a "Pinned" badge with no explanation of who
-- set it.
UPDATE "shopify_product_garments"
SET "funnel_assignment_source" = 'admin_reassign'
WHERE "funnel_template_id" IS NOT NULL
  AND "funnel_assignment_source" IS NULL;
```

Confirm the generated file appears in `packages/db/src/migrations/meta/_journal.json`. If drizzle-kit picked an index other than `0185`, that is fine — the journal is authoritative.

- [ ] **Step 6: Run the test to verify it passes**

Run from `apps/api`: `npx vitest run --config vitest.integration.config.ts shopify-funnel-schema`
Expected: PASS, 3 tests. The harness runs migrations against a fresh database, so a green run also proves the migration applies cleanly.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/schema/shopify.ts packages/db/src/migrations apps/api/test/integration/shopify-funnel-schema.test.ts
git commit -m "$(cat <<'EOF'
feat(db): global funnel rules and per-store rule suppression

Makes shopify_funnel_rules.store_id nullable (null = an Aivastra global
rule), drops the never-read `mode` column, and adds a partial unique index
so the global tier is actually constrained — the existing composite unique
does not constrain it, since Postgres treats NULLs as distinct.

Adds shopify_store_disabled_funnel_rules so a merchant can switch off one
global rule for their store alone, and backfills funnel_assignment_source
for pins written by the admin reassign-on-delete path.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01K3jhDzM9v8Z7exXFTo5XiE
EOF
)"
```

---

### Task 2: The pure resolver

This task is the heart of the feature and touches no database. Everything else is plumbing around it.

**Files:**
- Create: `apps/api/src/modules/shopify/funnel-resolution.ts`
- Test: `apps/api/test/shopify-funnel-resolution.test.ts` (unit — **not** under `test/integration/`)

**Interfaces:**
- Consumes: `FunnelRuleCondition` from `@aivastra/db`.
- Produces:
  - `type BasketSource = 'manual' | 'rule' | 'default'`
  - `interface BasketMatchTarget { funnelTemplateId, productType, tags, vendor, collections }`
  - `interface BasketRule { ruleId, basketId, priority, conditions }`
  - `interface BasketInfo { id, label, workflowTemplateId, workflowTemplateVersion, isActive }`
  - `interface BasketRuleSet { storeRules, globalRules, baskets, defaultBasketId }`
  - `interface ResolvedBasket { basketId, label, workflowTemplateId, workflowTemplateVersion, source }`
  - `function matchesCondition(condition, target): boolean`
  - `function resolveBasketFrom(ruleSet, target): ResolvedBasket | null`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/shopify-funnel-resolution.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  type BasketMatchTarget,
  type BasketRuleSet,
  matchesCondition,
  resolveBasketFrom,
} from '../src/modules/shopify/funnel-resolution.js';

const SAREE = 'b-saree';
const UPPER = 'b-upper';
const FALLBACK = 'b-fallback';

function baskets(overrides: Partial<Record<string, boolean>> = {}) {
  return new Map([
    [SAREE, { id: SAREE, label: 'Saree', workflowTemplateId: 'wf-saree', workflowTemplateVersion: 3, isActive: overrides[SAREE] ?? true }],
    [UPPER, { id: UPPER, label: 'Upper', workflowTemplateId: 'wf-upper', workflowTemplateVersion: 1, isActive: overrides[UPPER] ?? true }],
    [FALLBACK, { id: FALLBACK, label: 'Default', workflowTemplateId: 'wf-default', workflowTemplateVersion: null, isActive: overrides[FALLBACK] ?? true }],
  ]);
}

function ruleSet(partial: Partial<BasketRuleSet> = {}): BasketRuleSet {
  return {
    storeRules: [],
    globalRules: [],
    baskets: baskets(),
    defaultBasketId: FALLBACK,
    ...partial,
  };
}

function product(partial: Partial<BasketMatchTarget> = {}): BasketMatchTarget {
  return {
    funnelTemplateId: null,
    productType: null,
    tags: null,
    vendor: null,
    collections: null,
    ...partial,
  };
}

describe('matchesCondition', () => {
  it('matches product_type case-insensitively on equals', () => {
    const target = product({ productType: 'Shirt' });
    expect(matchesCondition({ field: 'product_type', operator: 'equals', value: 'shirt' }, target)).toBe(true);
    expect(matchesCondition({ field: 'product_type', operator: 'equals', value: 'shirtz' }, target)).toBe(false);
  });

  it('trims whitespace around equals comparisons', () => {
    expect(
      matchesCondition({ field: 'product_type', operator: 'equals', value: ' shirt ' }, product({ productType: 'Shirt' })),
    ).toBe(true);
  });

  it('matches product_type on substring for contains', () => {
    const target = product({ productType: 'Silk Saree' });
    expect(matchesCondition({ field: 'product_type', operator: 'contains', value: 'saree' }, target)).toBe(true);
  });

  it('matches vendor case-insensitively', () => {
    expect(matchesCondition({ field: 'vendor', operator: 'equals', value: 'acme' }, product({ vendor: 'ACME' }))).toBe(true);
  });

  it('matches any tag for equals and contains', () => {
    const target = product({ tags: ['Festive', 'Saree'] });
    expect(matchesCondition({ field: 'tags', operator: 'equals', value: 'saree' }, target)).toBe(true);
    expect(matchesCondition({ field: 'tags', operator: 'equals', value: 'sar' }, target)).toBe(false);
    expect(matchesCondition({ field: 'tags', operator: 'contains', value: 'sar' }, target)).toBe(true);
  });

  it('matches any collection', () => {
    const target = product({ collections: ['Festive Sarees'] });
    expect(matchesCondition({ field: 'collections', operator: 'contains', value: 'saree' }, target)).toBe(true);
  });

  it('never matches and never throws on null or empty columns', () => {
    const empty = product({ tags: [], collections: [] });
    expect(matchesCondition({ field: 'product_type', operator: 'contains', value: 'x' }, empty)).toBe(false);
    expect(matchesCondition({ field: 'vendor', operator: 'equals', value: 'x' }, empty)).toBe(false);
    expect(matchesCondition({ field: 'tags', operator: 'contains', value: 'x' }, empty)).toBe(false);
    expect(matchesCondition({ field: 'collections', operator: 'equals', value: 'x' }, empty)).toBe(false);
  });
});

describe('resolveBasketFrom', () => {
  it('prefers a manual pin over every rule', () => {
    const result = resolveBasketFrom(
      ruleSet({
        globalRules: [{ ruleId: 'r1', basketId: UPPER, priority: 1, conditions: [{ field: 'tags', operator: 'equals', value: 'shirt' }] }],
      }),
      product({ funnelTemplateId: SAREE, tags: ['shirt'] }),
    );
    expect(result).toEqual({
      basketId: SAREE,
      label: 'Saree',
      workflowTemplateId: 'wf-saree',
      workflowTemplateVersion: 3,
      source: 'manual',
    });
  });

  it('falls through a pin to an inactive basket rather than dead-ending', () => {
    const result = resolveBasketFrom(
      ruleSet({ baskets: baskets({ [SAREE]: false }) }),
      product({ funnelTemplateId: SAREE }),
    );
    expect(result?.basketId).toBe(FALLBACK);
    expect(result?.source).toBe('default');
  });

  it('resolves a store rule before a global rule of far better priority', () => {
    const result = resolveBasketFrom(
      ruleSet({
        storeRules: [{ ruleId: 'r-store', basketId: UPPER, priority: 100, conditions: [{ field: 'tags', operator: 'equals', value: 'x' }] }],
        globalRules: [{ ruleId: 'r-global', basketId: SAREE, priority: 1, conditions: [{ field: 'tags', operator: 'equals', value: 'x' }] }],
      }),
      product({ tags: ['x'] }),
    );
    expect(result?.basketId).toBe(UPPER);
    expect(result?.source).toBe('rule');
  });

  it('orders rules within a tier by priority then ruleId', () => {
    const conditions = [{ field: 'tags', operator: 'equals', value: 'x' } as const];
    const result = resolveBasketFrom(
      ruleSet({
        globalRules: [
          { ruleId: 'b', basketId: SAREE, priority: 5, conditions },
          { ruleId: 'a', basketId: UPPER, priority: 5, conditions },
        ],
      }),
      product({ tags: ['x'] }),
    );
    expect(result?.basketId).toBe(UPPER);
  });

  it('skips a rule pointing at an inactive basket', () => {
    const result = resolveBasketFrom(
      ruleSet({
        baskets: baskets({ [SAREE]: false }),
        globalRules: [
          { ruleId: 'r1', basketId: SAREE, priority: 1, conditions: [{ field: 'tags', operator: 'equals', value: 'x' }] },
          { ruleId: 'r2', basketId: UPPER, priority: 2, conditions: [{ field: 'tags', operator: 'equals', value: 'x' }] },
        ],
      }),
      product({ tags: ['x'] }),
    );
    expect(result?.basketId).toBe(UPPER);
  });

  it('treats a rule with no conditions as matching nothing', () => {
    const result = resolveBasketFrom(
      ruleSet({ globalRules: [{ ruleId: 'r1', basketId: UPPER, priority: 1, conditions: [] }] }),
      product({ tags: ['anything'] }),
    );
    expect(result?.basketId).toBe(FALLBACK);
  });

  it('ORs conditions within one rule', () => {
    const rules = ruleSet({
      globalRules: [
        {
          ruleId: 'r1',
          basketId: SAREE,
          priority: 1,
          conditions: [
            { field: 'tags', operator: 'equals', value: 'saree' },
            { field: 'product_type', operator: 'equals', value: 'Saree' },
          ],
        },
      ],
    });
    expect(resolveBasketFrom(rules, product({ tags: ['saree'] }))?.basketId).toBe(SAREE);
    expect(resolveBasketFrom(rules, product({ productType: 'saree' }))?.basketId).toBe(SAREE);
    expect(resolveBasketFrom(rules, product({ vendor: 'saree' }))?.basketId).toBe(FALLBACK);
  });

  it('returns the default basket when nothing matches', () => {
    const result = resolveBasketFrom(ruleSet(), product({ tags: ['unmatched'] }));
    expect(result).toEqual({
      basketId: FALLBACK,
      label: 'Default',
      workflowTemplateId: 'wf-default',
      workflowTemplateVersion: null,
      source: 'default',
    });
  });

  it('returns null when there is no default basket', () => {
    expect(resolveBasketFrom(ruleSet({ defaultBasketId: null }), product())).toBeNull();
  });

  it('returns null when the default basket is inactive', () => {
    expect(resolveBasketFrom(ruleSet({ baskets: baskets({ [FALLBACK]: false }) }), product())).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @aivastra/api test shopify-funnel-resolution`
Expected: FAIL — cannot resolve `../src/modules/shopify/funnel-resolution.js`.

- [ ] **Step 3: Write the resolver**

Create `apps/api/src/modules/shopify/funnel-resolution.ts`:

```ts
import type { FunnelRuleCondition } from '@aivastra/db';

export type BasketSource = 'manual' | 'rule' | 'default';

/** The subset of a shopify_product_garments row that routing reads. */
export interface BasketMatchTarget {
  funnelTemplateId: string | null;
  productType: string | null;
  tags: string[] | null;
  vendor: string | null;
  collections: string[] | null;
}

export interface BasketRule {
  ruleId: string;
  basketId: string;
  priority: number;
  conditions: FunnelRuleCondition[];
}

export interface BasketInfo {
  id: string;
  label: string;
  workflowTemplateId: string;
  workflowTemplateVersion: number | null;
  isActive: boolean;
}

export interface BasketRuleSet {
  /** Store's own rules. Resolved entirely before globalRules. */
  storeRules: BasketRule[];
  /** Aivastra global rules, with this store's suppressions already removed. */
  globalRules: BasketRule[];
  baskets: Map<string, BasketInfo>;
  defaultBasketId: string | null;
}

export interface ResolvedBasket {
  basketId: string;
  label: string;
  workflowTemplateId: string;
  workflowTemplateVersion: number | null;
  source: BasketSource;
}

const norm = (value: string): string => value.trim().toLowerCase();

function matchesText(value: string | null, operator: FunnelRuleCondition['operator'], needle: string): boolean {
  if (!value) return false;
  const haystack = norm(value);
  return operator === 'equals' ? haystack === needle : haystack.includes(needle);
}

function matchesList(values: string[] | null, operator: FunnelRuleCondition['operator'], needle: string): boolean {
  if (!values?.length) return false;
  return values.some((v) => matchesText(v, operator, needle));
}

/**
 * Case-insensitive throughout, deliberately: Shopify tags are free text typed
 * by merchants, so a rule written as `saree` failing to match a tag typed
 * `Saree` would be this feature's largest single source of support tickets.
 */
export function matchesCondition(condition: FunnelRuleCondition, target: BasketMatchTarget): boolean {
  const needle = norm(condition.value);
  if (!needle) return false;
  switch (condition.field) {
    case 'product_type':
      return matchesText(target.productType, condition.operator, needle);
    case 'vendor':
      return matchesText(target.vendor, condition.operator, needle);
    case 'tags':
      return matchesList(target.tags, condition.operator, needle);
    case 'collections':
      return matchesList(target.collections, condition.operator, needle);
    default:
      return false;
  }
}

function byPriorityThenId(a: BasketRule, b: BasketRule): number {
  return a.priority - b.priority || a.ruleId.localeCompare(b.ruleId);
}

function resolved(basket: BasketInfo, source: BasketSource): ResolvedBasket {
  return {
    basketId: basket.id,
    label: basket.label,
    workflowTemplateId: basket.workflowTemplateId,
    workflowTemplateVersion: basket.workflowTemplateVersion,
    source,
  };
}

function activeBasket(ruleSet: BasketRuleSet, basketId: string | null): BasketInfo | null {
  if (!basketId) return null;
  const basket = ruleSet.baskets.get(basketId);
  return basket?.isActive ? basket : null;
}

/**
 * The ONE place basket precedence lives. Every caller — try-on creation, the
 * merchant product list, the Routing page counts — must go through this
 * function rather than re-deriving the rule, exactly as every activation
 * caller goes through computeEffectiveEnabled in activation.ts.
 *
 * Precedence: manual pin, then the store's own rules, then Aivastra global
 * rules, then the default basket. Null means nothing is configured at all,
 * which the try-on path treats as a refusal BEFORE deducting credits.
 */
export function resolveBasketFrom(ruleSet: BasketRuleSet, target: BasketMatchTarget): ResolvedBasket | null {
  // A pin to a basket an admin has since deactivated falls through rather than
  // refusing: dead-ending every pinned product with no merchant-visible cause
  // is worse than a visible downgrade to the rule-derived basket.
  const pinned = activeBasket(ruleSet, target.funnelTemplateId);
  if (pinned) return resolved(pinned, 'manual');

  // Store tier resolves entirely before the global tier — a store rule at
  // priority 100 still beats a global rule at priority 1. Interleaving the two
  // by priority would let a merchant's own rule silently lose to a global rule
  // whose priority they cannot see.
  for (const tier of [ruleSet.storeRules, ruleSet.globalRules]) {
    for (const rule of [...tier].sort(byPriorityThenId)) {
      const basket = activeBasket(ruleSet, rule.basketId);
      if (!basket) continue;
      // An empty condition list matches NOTHING, never everything: read the
      // other way, a half-filled rule form becomes a catalog-wide hijack.
      if (rule.conditions.some((c) => matchesCondition(c, target))) {
        return resolved(basket, 'rule');
      }
    }
  }

  const fallback = activeBasket(ruleSet, ruleSet.defaultBasketId);
  return fallback ? resolved(fallback, 'default') : null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @aivastra/api test shopify-funnel-resolution`
Expected: PASS, 18 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/shopify/funnel-resolution.ts apps/api/test/shopify-funnel-resolution.test.ts
git commit -m "$(cat <<'EOF'
feat(shopify): pure basket precedence resolver

resolveBasketFrom is the one place basket precedence lives, mirroring
computeEffectiveEnabled in activation.ts. Manual pin, then store rules,
then global rules, then the default basket.

Three behaviours are deliberate and covered by tests: the store tier
resolves entirely before the global tier, an empty condition list matches
nothing rather than everything, and a pin to a deactivated basket falls
through instead of dead-ending the product.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01K3jhDzM9v8Z7exXFTo5XiE
EOF
)"
```

---

### Task 3: The DB loader

**Files:**
- Modify: `apps/api/src/modules/shopify/funnel-resolution.ts` (append)
- Test: `apps/api/test/integration/shopify-funnel-loader.test.ts`

**Interfaces:**
- Consumes: `BasketRuleSet`, `resolveBasketFrom` from Task 2.
- Produces:
  - `async function loadRuleSet(app: FastifyInstance, storeId: string): Promise<BasketRuleSet>`
  - `async function resolveBasket(app, storeId, target: BasketMatchTarget): Promise<ResolvedBasket | null>`

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/integration/shopify-funnel-loader.test.ts`. Seed: one basket `saree` with a global rule on tag `saree`, one basket `upper`, a default basket, two stores, and a suppression row for store A.

```ts
it('omits a suppressed global rule for that store only', async () => {
  const forStoreA = await loadRuleSet(app, storeA);
  const forStoreB = await loadRuleSet(app, storeB);
  expect(forStoreA.globalRules.map((r) => r.ruleId)).not.toContain(suppressedRuleId);
  expect(forStoreB.globalRules.map((r) => r.ruleId)).toContain(suppressedRuleId);
});

it('separates store rules from global rules', async () => {
  const set = await loadRuleSet(app, storeA);
  expect(set.storeRules.every((r) => r.ruleId !== globalRuleId)).toBe(true);
  expect(set.globalRules.every((r) => r.ruleId !== storeRuleId)).toBe(true);
});

it('exposes the active default basket id', async () => {
  const set = await loadRuleSet(app, storeA);
  expect(set.defaultBasketId).toBe(defaultBasketId);
});

it('carries the workflow template version onto each basket', async () => {
  const set = await loadRuleSet(app, storeA);
  expect(set.baskets.get(sareeBasketId)?.workflowTemplateVersion).toBe(sareeWorkflowVersion);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `apps/api`: `npx vitest run --config vitest.integration.config.ts shopify-funnel-loader`
Expected: FAIL — `loadRuleSet` is not exported.

- [ ] **Step 3: Implement the loader**

Append to `apps/api/src/modules/shopify/funnel-resolution.ts`:

```ts
/**
 * Loads every basket plus both rule tiers for one store, with this store's
 * suppressions already removed from the global tier.
 *
 * Deliberately NOT cached. This is one small query per REQUEST (not per
 * product) on a path that then runs a GPU job; a Redis cache would need
 * invalidation fanned out to every store on each global-rule edit, for no
 * measured gain. Callers listing many products call this once and then run
 * resolveBasketFrom per row — that split is what keeps the list endpoints
 * free of an N+1.
 */
export async function loadRuleSet(app: FastifyInstance, storeId: string): Promise<BasketRuleSet> {
  const [basketRows, ruleRows] = await Promise.all([
    app.db
      .select({
        id: schema.shopifyFunnelTemplates.id,
        label: schema.shopifyFunnelTemplates.label,
        workflowTemplateId: schema.shopifyFunnelTemplates.workflowTemplateId,
        workflowTemplateVersion: schema.workflowTemplates.version,
        isActive: schema.shopifyFunnelTemplates.isActive,
        isDefault: schema.shopifyFunnelTemplates.isDefault,
      })
      .from(schema.shopifyFunnelTemplates)
      .leftJoin(
        schema.workflowTemplates,
        eq(schema.workflowTemplates.id, schema.shopifyFunnelTemplates.workflowTemplateId),
      ),
    app.db
      .select({
        ruleId: schema.shopifyFunnelRules.id,
        storeId: schema.shopifyFunnelRules.storeId,
        basketId: schema.shopifyFunnelRules.funnelTemplateId,
        priority: schema.shopifyFunnelRules.priority,
        conditions: schema.shopifyFunnelRules.conditions,
        suppressedAt: schema.shopifyStoreDisabledFunnelRules.createdAt,
      })
      .from(schema.shopifyFunnelRules)
      .leftJoin(
        schema.shopifyStoreDisabledFunnelRules,
        and(
          eq(schema.shopifyStoreDisabledFunnelRules.ruleId, schema.shopifyFunnelRules.id),
          eq(schema.shopifyStoreDisabledFunnelRules.storeId, storeId),
        ),
      )
      .where(
        or(eq(schema.shopifyFunnelRules.storeId, storeId), isNull(schema.shopifyFunnelRules.storeId)),
      ),
  ]);

  const baskets = new Map<string, BasketInfo>();
  let defaultBasketId: string | null = null;
  for (const row of basketRows) {
    baskets.set(row.id, {
      id: row.id,
      label: row.label,
      workflowTemplateId: row.workflowTemplateId,
      workflowTemplateVersion: row.workflowTemplateVersion ?? null,
      isActive: row.isActive,
    });
    if (row.isDefault) defaultBasketId = row.id;
  }

  const storeRules: BasketRule[] = [];
  const globalRules: BasketRule[] = [];
  for (const row of ruleRows) {
    const rule: BasketRule = {
      ruleId: row.ruleId,
      basketId: row.basketId,
      priority: row.priority,
      conditions: row.conditions ?? [],
    };
    if (row.storeId) {
      storeRules.push(rule);
    } else if (!row.suppressedAt) {
      // A global rule this store has switched off. Suppression is per-store,
      // so it must be dropped here rather than anywhere shared.
      globalRules.push(rule);
    }
  }

  return { storeRules, globalRules, baskets, defaultBasketId };
}

/** Single-product convenience wrapper. Never use this inside a loop. */
export async function resolveBasket(
  app: FastifyInstance,
  storeId: string,
  target: BasketMatchTarget,
): Promise<ResolvedBasket | null> {
  return resolveBasketFrom(await loadRuleSet(app, storeId), target);
}
```

Add to the file's imports:

```ts
import { schema } from '@aivastra/db';
import { and, eq, isNull, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
```

- [ ] **Step 4: Run the test to verify it passes**

Run from `apps/api`: `npx vitest run --config vitest.integration.config.ts shopify-funnel-loader`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/shopify/funnel-resolution.ts apps/api/test/integration/shopify-funnel-loader.test.ts
git commit -m "$(cat <<'EOF'
feat(shopify): load basket rule sets with per-store suppression

One query per request, not per product: callers listing many products call
loadRuleSet once and run the pure resolveBasketFrom per row. Suppression is
applied here via a left join on the requesting store, so a global rule
switched off by one store stays live for every other.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01K3jhDzM9v8Z7exXFTo5XiE
EOF
)"
```

---

### Task 4: Route try-on through the resolver

**Files:**
- Modify: `apps/api/src/modules/shopify/customer.routes.ts:180-213` (delete `resolveWorkflowTemplate`), and its callsite at line 397
- Test: `apps/api/test/integration/shopify-basket-routing.test.ts`

**Interfaces:**
- Consumes: `resolveBasket` from Task 3.
- Produces: no new exports. `job_inputs.params.workflowTemplateId` now reflects the resolved basket.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/integration/shopify-basket-routing.test.ts`. Model the store, workflow-template and garment seeding on `apps/api/test/shopify-refusal-events.test.ts:70-100`, and the request setup on `apps/api/test/integration/shopify-customer.test.ts`.

```ts
it('runs the basket resolved by a global rule, not the default', async () => {
  // garment tagged "saree"; global rule tags contains "saree" -> saree basket
  const res = await createTryon({ shopifyProductId: sareeProductId });
  expect(res.statusCode).toBe(200);
  const [inputs] = await app.db
    .select()
    .from(schema.jobInputs)
    .where(eq(schema.jobInputs.jobId, res.json().jobId));
  expect(inputs.params.workflowTemplateId).toBe(sareeWorkflowId);
  expect(inputs.params.workflowTemplateId).not.toBe(defaultWorkflowId);
});

it('honours a manual pin over a matching rule', async () => {
  await app.db
    .update(schema.shopifyProductGarments)
    .set({ funnelTemplateId: upperBasketId, funnelAssignmentSource: 'manual' })
    .where(eq(schema.shopifyProductGarments.id, sareeGarmentId));
  const res = await createTryon({ shopifyProductId: sareeProductId });
  const [inputs] = await app.db
    .select()
    .from(schema.jobInputs)
    .where(eq(schema.jobInputs.jobId, res.json().jobId));
  expect(inputs.params.workflowTemplateId).toBe(upperWorkflowId);
});

it('falls back to the default basket when no rule matches', async () => {
  const res = await createTryon({ shopifyProductId: untaggedProductId });
  const [inputs] = await app.db
    .select()
    .from(schema.jobInputs)
    .where(eq(schema.jobInputs.jobId, res.json().jobId));
  expect(inputs.params.workflowTemplateId).toBe(defaultWorkflowId);
});

// The critical one: refusal must happen BEFORE the deduct, not merely happen.
it('refuses without deducting credits or creating a job when nothing resolves', async () => {
  await app.db
    .update(schema.shopifyFunnelTemplates)
    .set({ isDefault: false })
    .where(eq(schema.shopifyFunnelTemplates.isDefault, true));

  const before = await storeBalance(storeId);
  const res = await createTryon({ shopifyProductId: untaggedProductId });

  expect(res.statusCode).toBe(202);
  expect(await storeBalance(storeId)).toBe(before);
  const jobs = await app.db.select().from(schema.jobs).where(eq(schema.jobs.shopifyStoreId, storeId));
  expect(jobs).toHaveLength(0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run from `apps/api`: `npx vitest run --config vitest.integration.config.ts shopify-basket-routing`
Expected: FAIL — every job uses the default workflow, so the first two assertions fail.

- [ ] **Step 3: Replace the resolver callsite**

Delete `resolveWorkflowTemplate` entirely (`customer.routes.ts:180-213`), add the import:

```ts
import { resolveBasket } from './funnel-resolution.js';
```

and replace the block at lines 397-411 with:

```ts
      const resolvedBasket = await resolveBasket(app, storeId, garment);
      if (!resolvedBasket) {
        // No basket resolved AND no active default exists — a system
        // misconfiguration, not anything the merchant did. Refuse here, before
        // the deduct: enqueueing would burn a credit and produce a FAILED row
        // with NO_WORKFLOW_CONFIGURED that no merchant can fix.
        app.log.error(
          { storeId, shopifyProductId, garmentId: garment.id },
          'shopify try-on blocked before enqueue: no basket resolved and no active default',
        );
        return reply
          .code(202)
          .send({ message: 'This product is not available for try-on right now.' });
      }
      const workflowTemplateId = resolvedBasket.workflowTemplateId;
```

`garment` is the full row from the `select()` at line 371, so it already satisfies `BasketMatchTarget` structurally — no extra query and no mapping.

Then update the `job_inputs.params` object (line ~489) so the version comes from the resolved basket:

```ts
              dispatchTemplateVersion: resolvedBasket.workflowTemplateVersion,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run from `apps/api`: `npx vitest run --config vitest.integration.config.ts shopify-basket-routing`
Expected: PASS, 4 tests.

- [ ] **Step 5: Run the existing Shopify suites for regressions**

```bash
cd apps/api
npx vitest run --config vitest.integration.config.ts shopify-customer
npx vitest run --config vitest.integration.config.ts shopify-funnel-loader
pnpm --filter @aivastra/api test shopify-refusal-events
pnpm --filter @aivastra/api test shopify
```
Expected: all pass. `shopify-customer.test.ts` and `shopify-refusal-events.test.ts` both seed a default basket and exercise the unchanged fall-through path — they must stay green without modification. If either needs editing to pass, the resolver has changed default-basket behaviour and that is a regression, not a test to update.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/shopify/customer.routes.ts apps/api/test/integration/shopify-basket-routing.test.ts
git commit -m "$(cat <<'EOF'
feat(shopify): route try-on through basket resolution

Replaces resolveWorkflowTemplate, which returned the single is_default
template and ignored the product entirely, with resolveBasket. The garment
row is already fully selected at this point, so classification costs no
extra query.

Refusal still precedes the credit deduct, and the resolved workflow is
still pinned into job_inputs.params at enqueue — a rule edited mid-flight
cannot change the workflow under a job whose credits are already deducted.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01K3jhDzM9v8Z7exXFTo5XiE
EOF
)"
```

---

### Task 5: Merchant rules API

**Files:**
- Create: `apps/api/src/modules/shopify/funnel-rules.routes.ts`
- Modify: `apps/api/src/server.ts` (import + register beside the other shopify modules near line 396)
- Test: `apps/api/test/integration/shopify-merchant-funnel-rules.test.ts`

**Interfaces:**
- Consumes: `loadRuleSet`, `resolveBasketFrom` from Tasks 2-3.
- Produces: `export async function shopifyFunnelRulesRoutes(app: FastifyInstance)`, registering:
  - `GET /v1/shopify/baskets` → `{ items: { id, slug, label, sortOrder }[] }`
  - `GET /v1/shopify/funnel-rules` → `{ storeRules, globalRules, counts, countsOmitted }`
  - `POST /v1/shopify/funnel-rules` → the created rule
  - `PATCH /v1/shopify/funnel-rules/:id` → the updated rule
  - `DELETE /v1/shopify/funnel-rules/:id` → `{ ok: true }`
  - `PUT /v1/shopify/funnel-rules/:id/disabled` → `{ disabled: boolean }`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/integration/shopify-merchant-funnel-rules.test.ts`. Authenticate with `apps/api/test/helpers/shopify-session.ts`.

```ts
it('never exposes workflowTemplateId on the baskets list', async () => {
  const res = await app.inject({ method: 'GET', url: '/v1/shopify/baskets', headers: authA });
  expect(res.statusCode).toBe(200);
  for (const item of res.json().items) {
    expect(item).not.toHaveProperty('workflowTemplateId');
  }
});

it('creates a store rule and rejects a duplicate for the same basket with 409', async () => {
  const body = { funnelTemplateId: upperBasketId, conditions: [{ field: 'tags', operator: 'equals', value: 'shirt' }], priority: 10 };
  expect((await app.inject({ method: 'POST', url: '/v1/shopify/funnel-rules', headers: authA, payload: body })).statusCode).toBe(200);
  expect((await app.inject({ method: 'POST', url: '/v1/shopify/funnel-rules', headers: authA, payload: body })).statusCode).toBe(409);
});

it('rejects a rule with no conditions', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/shopify/funnel-rules',
    headers: authA,
    payload: { funnelTemplateId: upperBasketId, conditions: [], priority: 0 },
  });
  expect(res.statusCode).toBe(400);
});

it('refuses to patch or delete a global rule', async () => {
  expect((await app.inject({ method: 'PATCH', url: `/v1/shopify/funnel-rules/${globalRuleId}`, headers: authA, payload: { priority: 1 } })).statusCode).toBe(404);
  expect((await app.inject({ method: 'DELETE', url: `/v1/shopify/funnel-rules/${globalRuleId}`, headers: authA })).statusCode).toBe(404);
});

it('refuses to patch another store\'s rule', async () => {
  const res = await app.inject({ method: 'PATCH', url: `/v1/shopify/funnel-rules/${storeBRuleId}`, headers: authA, payload: { priority: 1 } });
  expect(res.statusCode).toBe(404);
});

it('suppresses a global rule for the calling store only', async () => {
  await app.inject({ method: 'PUT', url: `/v1/shopify/funnel-rules/${globalRuleId}/disabled`, headers: authA, payload: { disabled: true } });

  const a = await app.inject({ method: 'GET', url: '/v1/shopify/funnel-rules', headers: authA });
  const b = await app.inject({ method: 'GET', url: '/v1/shopify/funnel-rules', headers: authB });
  expect(a.json().globalRules.find((r) => r.id === globalRuleId).disabled).toBe(true);
  expect(b.json().globalRules.find((r) => r.id === globalRuleId).disabled).toBe(false);
});

it('refuses to suppress the store\'s own rule', async () => {
  const res = await app.inject({ method: 'PUT', url: `/v1/shopify/funnel-rules/${storeARuleId}/disabled`, headers: authA, payload: { disabled: true } });
  expect(res.statusCode).toBe(400);
});

it('returns per-basket counts', async () => {
  const res = await app.inject({ method: 'GET', url: '/v1/shopify/funnel-rules', headers: authA });
  expect(res.json().countsOmitted).toBe(false);
  expect(res.json().counts[defaultBasketId]).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run from `apps/api`: `npx vitest run --config vitest.integration.config.ts shopify-merchant-funnel-rules`
Expected: FAIL — 404 on every route.

- [ ] **Step 3: Implement the routes**

Create `apps/api/src/modules/shopify/funnel-rules.routes.ts`:

```ts
import { schema } from '@aivastra/db';
import { and, asc, count, eq, isNull, ne } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { type BasketMatchTarget, loadRuleSet, resolveBasketFrom } from './funnel-resolution.js';

// Above this many products the Routing page reports countsOmitted rather than
// scanning the catalog — a large store must not turn its own settings page
// into a slow query.
const COUNTS_PRODUCT_CAP = 10_000;

const Condition = z.object({
  field: z.enum(['product_type', 'tags', 'vendor', 'collections']),
  operator: z.enum(['equals', 'contains']),
  value: z.string().min(1).max(200),
});

// min(1): an empty condition list matches nothing at read time anyway, but
// rejecting it on write stops a merchant saving a rule that silently does
// nothing and then wondering why routing ignores it.
const Conditions = z.array(Condition).min(1).max(20);

const CreateRuleBody = z.object({
  funnelTemplateId: z.string().uuid(),
  conditions: Conditions,
  priority: z.number().int().min(0).max(10_000).default(0),
});

const PatchRuleBody = z
  .object({ conditions: Conditions.optional(), priority: z.number().int().min(0).max(10_000).optional() })
  .refine((b) => b.conditions !== undefined || b.priority !== undefined, {
    message: 'at least one of conditions or priority is required',
  });

const DisabledBody = z.object({ disabled: z.boolean() });
const MAX_RULES_PER_STORE = 50;

/** Loads a rule and asserts it belongs to `storeId`. 404 otherwise — a
 *  merchant must not learn that a global or another store's rule exists. */
async function requireOwnRule(app: FastifyInstance, storeId: string, ruleId: string) {
  const [rule] = await app.db
    .select()
    .from(schema.shopifyFunnelRules)
    .where(and(eq(schema.shopifyFunnelRules.id, ruleId), eq(schema.shopifyFunnelRules.storeId, storeId)))
    .limit(1);
  if (!rule) throw new AppError('NOT_FOUND', 404, 'rule not found');
  return rule;
}

export async function shopifyFunnelRulesRoutes(app: FastifyInstance) {
  const auth = { preHandler: app.requireShopifySession };

  // Deliberately omits workflowTemplateId: merchants have no need for workflow
  // identity, and once it is in a payload it is in a support screenshot.
  app.get('/v1/shopify/baskets', auth, async () => {
    const items = await app.db
      .select({
        id: schema.shopifyFunnelTemplates.id,
        slug: schema.shopifyFunnelTemplates.slug,
        label: schema.shopifyFunnelTemplates.label,
        sortOrder: schema.shopifyFunnelTemplates.sortOrder,
      })
      .from(schema.shopifyFunnelTemplates)
      .where(eq(schema.shopifyFunnelTemplates.isActive, true))
      .orderBy(asc(schema.shopifyFunnelTemplates.sortOrder));
    return { items };
  });

  app.get('/v1/shopify/funnel-rules', auth, async (req) => {
    const store = req.shopifyStore as typeof schema.shopifyStores.$inferSelect;

    const [rows, suppressed, [{ total }]] = await Promise.all([
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
      app.db
        .select({ total: count() })
        .from(schema.shopifyProductGarments)
        .where(
          and(
            eq(schema.shopifyProductGarments.storeId, store.id),
            ne(schema.shopifyProductGarments.status, 'deleted'),
          ),
        ),
    ]);

    const suppressedIds = new Set(suppressed.map((s) => s.ruleId));
    const mine = rows.filter((r) => r.storeId === store.id);
    const globals = rows.filter((r) => r.storeId === null);

    let counts: Record<string, number> = {};
    const countsOmitted = total > COUNTS_PRODUCT_CAP;
    if (!countsOmitted) {
      const ruleSet = await loadRuleSet(app, store.id);
      const products = await app.db
        .select({
          funnelTemplateId: schema.shopifyProductGarments.funnelTemplateId,
          productType: schema.shopifyProductGarments.productType,
          tags: schema.shopifyProductGarments.tags,
          vendor: schema.shopifyProductGarments.vendor,
          collections: schema.shopifyProductGarments.collections,
        })
        .from(schema.shopifyProductGarments)
        .where(
          and(
            eq(schema.shopifyProductGarments.storeId, store.id),
            ne(schema.shopifyProductGarments.status, 'deleted'),
          ),
        );
      for (const p of products) {
        const resolved = resolveBasketFrom(ruleSet, p as BasketMatchTarget);
        if (resolved) counts[resolved.basketId] = (counts[resolved.basketId] ?? 0) + 1;
      }
    }

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
      counts,
      countsOmitted,
    };
  });

  app.post('/v1/shopify/funnel-rules', { ...auth, schema: { body: CreateRuleBody } }, async (req) => {
    const store = req.shopifyStore as typeof schema.shopifyStores.$inferSelect;
    const body = req.body as z.infer<typeof CreateRuleBody>;

    const [{ total }] = await app.db
      .select({ total: count() })
      .from(schema.shopifyFunnelRules)
      .where(eq(schema.shopifyFunnelRules.storeId, store.id));
    if (total >= MAX_RULES_PER_STORE) {
      throw new AppError('LIMIT_REACHED', 400, `a store may have at most ${MAX_RULES_PER_STORE} rules`);
    }

    const [basket] = await app.db
      .select({ id: schema.shopifyFunnelTemplates.id })
      .from(schema.shopifyFunnelTemplates)
      .where(
        and(
          eq(schema.shopifyFunnelTemplates.id, body.funnelTemplateId),
          eq(schema.shopifyFunnelTemplates.isActive, true),
        ),
      )
      .limit(1);
    if (!basket) throw new AppError('NOT_FOUND', 404, 'basket not found');

    const [existing] = await app.db
      .select({ id: schema.shopifyFunnelRules.id })
      .from(schema.shopifyFunnelRules)
      .where(
        and(
          eq(schema.shopifyFunnelRules.storeId, store.id),
          eq(schema.shopifyFunnelRules.funnelTemplateId, body.funnelTemplateId),
        ),
      )
      .limit(1);
    if (existing) {
      throw new AppError('CONFLICT', 409, 'you already have a rule for this basket — edit it instead');
    }

    const [created] = await app.db
      .insert(schema.shopifyFunnelRules)
      .values({ storeId: store.id, ...body })
      .returning();
    return created;
  });

  app.patch('/v1/shopify/funnel-rules/:id', { ...auth, schema: { body: PatchRuleBody } }, async (req) => {
    const store = req.shopifyStore as typeof schema.shopifyStores.$inferSelect;
    const { id } = req.params as { id: string };
    await requireOwnRule(app, store.id, id);
    const [updated] = await app.db
      .update(schema.shopifyFunnelRules)
      .set({ ...(req.body as z.infer<typeof PatchRuleBody>), updatedAt: new Date() })
      .where(eq(schema.shopifyFunnelRules.id, id))
      .returning();
    return updated;
  });

  app.delete('/v1/shopify/funnel-rules/:id', auth, async (req) => {
    const store = req.shopifyStore as typeof schema.shopifyStores.$inferSelect;
    const { id } = req.params as { id: string };
    await requireOwnRule(app, store.id, id);
    await app.db.delete(schema.shopifyFunnelRules).where(eq(schema.shopifyFunnelRules.id, id));
    return { ok: true };
  });

  app.put(
    '/v1/shopify/funnel-rules/:id/disabled',
    { ...auth, schema: { body: DisabledBody } },
    async (req) => {
      const store = req.shopifyStore as typeof schema.shopifyStores.$inferSelect;
      const { id } = req.params as { id: string };
      const { disabled } = req.body as z.infer<typeof DisabledBody>;

      const [rule] = await app.db
        .select({ id: schema.shopifyFunnelRules.id })
        .from(schema.shopifyFunnelRules)
        .where(and(eq(schema.shopifyFunnelRules.id, id), isNull(schema.shopifyFunnelRules.storeId)))
        .limit(1);
      // Suppression exists only for the global tier: disabling your own rule
      // is deleting it, and silently accepting this would leave a merchant
      // believing a rule they still see listed is off.
      if (!rule) throw new AppError('BAD_REQUEST', 400, 'only AiVastra default rules can be disabled');

      if (disabled) {
        await app.db
          .insert(schema.shopifyStoreDisabledFunnelRules)
          .values({ storeId: store.id, ruleId: id })
          .onConflictDoNothing();
      } else {
        await app.db
          .delete(schema.shopifyStoreDisabledFunnelRules)
          .where(
            and(
              eq(schema.shopifyStoreDisabledFunnelRules.storeId, store.id),
              eq(schema.shopifyStoreDisabledFunnelRules.ruleId, id),
            ),
          );
      }
      return { disabled };
    },
  );
}
```

Note the `drizzle-orm` import list at the top of the file must include `or`, and drop `ne` if unused.

Register in `apps/api/src/server.ts`, beside the other shopify modules:

```ts
import { shopifyFunnelRulesRoutes } from './modules/shopify/funnel-rules.routes.js';
// ...
await app.register(shopifyFunnelRulesRoutes);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run from `apps/api`: `npx vitest run --config vitest.integration.config.ts shopify-merchant-funnel-rules`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/shopify/funnel-rules.routes.ts apps/api/src/server.ts apps/api/test/integration/shopify-merchant-funnel-rules.test.ts
git commit -m "$(cat <<'EOF'
feat(shopify): merchant funnel rule API

Store rule CRUD plus per-store suppression of AiVastra global rules, and a
baskets list that deliberately omits workflowTemplateId — merchants have no
need for workflow identity.

Ownership guards return 404 rather than 403 for another store's or a global
rule, so a merchant cannot probe for rules that exist outside their store.
Suppression is refused on a store's own rule: disabling one is deleting it,
and accepting it silently would leave a merchant believing a rule they can
still see listed is off.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01K3jhDzM9v8Z7exXFTo5XiE
EOF
)"
```

---

### Task 6: Basket on the product list, pin on the product PATCH

**Files:**
- Modify: `apps/api/src/modules/shopify/products.routes.ts:26-34` (`PatchProductBody`), `:95-119` (list select + mapping), `:136-...` (PATCH handler)
- Test: `apps/api/test/integration/shopify-product-basket.test.ts`

**Interfaces:**
- Consumes: `loadRuleSet`, `resolveBasketFrom` from Tasks 2-3.
- Produces: `GET /v1/shopify/products` items gain `basket: { id, label, source } | null`; `PATCH /v1/shopify/products/:id` accepts `funnelTemplateId?: string | null`.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/integration/shopify-product-basket.test.ts`:

```ts
it('reports the rule-derived basket and its source', async () => {
  const res = await app.inject({ method: 'GET', url: '/v1/shopify/products', headers: auth });
  const item = res.json().items.find((i) => i.shopifyProductId === sareeProductId);
  expect(item.basket).toEqual({ id: sareeBasketId, label: 'Saree', source: 'rule' });
});

it('pins a product and reports source manual', async () => {
  await app.inject({
    method: 'PATCH',
    url: `/v1/shopify/products/${sareeProductId}`,
    headers: auth,
    payload: { funnelTemplateId: upperBasketId },
  });
  const [row] = await app.db
    .select()
    .from(schema.shopifyProductGarments)
    .where(eq(schema.shopifyProductGarments.shopifyProductId, sareeProductId));
  expect(row.funnelTemplateId).toBe(upperBasketId);
  expect(row.funnelAssignmentSource).toBe('manual');

  const res = await app.inject({ method: 'GET', url: '/v1/shopify/products', headers: auth });
  const item = res.json().items.find((i) => i.shopifyProductId === sareeProductId);
  expect(item.basket).toEqual({ id: upperBasketId, label: 'Upper', source: 'manual' });
});

it('clears the pin on null and reverts to rule routing', async () => {
  await app.inject({
    method: 'PATCH',
    url: `/v1/shopify/products/${sareeProductId}`,
    headers: auth,
    payload: { funnelTemplateId: null },
  });
  const [row] = await app.db
    .select()
    .from(schema.shopifyProductGarments)
    .where(eq(schema.shopifyProductGarments.shopifyProductId, sareeProductId));
  expect(row.funnelTemplateId).toBeNull();
  expect(row.funnelAssignmentSource).toBeNull();

  const res = await app.inject({ method: 'GET', url: '/v1/shopify/products', headers: auth });
  const item = res.json().items.find((i) => i.shopifyProductId === sareeProductId);
  expect(item.basket.source).toBe('rule');
});

it('rejects a pin to an unknown basket', async () => {
  const res = await app.inject({
    method: 'PATCH',
    url: `/v1/shopify/products/${sareeProductId}`,
    headers: auth,
    payload: { funnelTemplateId: '00000000-0000-0000-0000-000000000000' },
  });
  expect(res.statusCode).toBe(404);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run from `apps/api`: `npx vitest run --config vitest.integration.config.ts shopify-product-basket`
Expected: FAIL — `item.basket` is undefined.

- [ ] **Step 3: Extend the list endpoint**

In `products.routes.ts`, add to the imports:

```ts
import { type BasketMatchTarget, loadRuleSet, resolveBasketFrom } from './funnel-resolution.js';
```

Extend the `select` at line 96 with the five routing columns:

```ts
          funnelTemplateId: schema.shopifyProductGarments.funnelTemplateId,
          productType: schema.shopifyProductGarments.productType,
          tags: schema.shopifyProductGarments.tags,
          vendor: schema.shopifyProductGarments.vendor,
          collections: schema.shopifyProductGarments.collections,
```

and replace the `items` mapping (lines 110-119) with:

```ts
      // Loaded ONCE for the page, then applied per row. Calling resolveBasket
      // per product would be a query per product on a catalog-sized page.
      const ruleSet = await loadRuleSet(app, store.id);

      const items = await Promise.all(
        rows.map(async (r) => {
          const basket = resolveBasketFrom(ruleSet, r as BasketMatchTarget);
          return {
            shopifyProductId: r.shopifyProductId,
            title: r.title,
            thumbnailUrl: (await app.storage.presignGet(r.r2Key, 3600)).url,
            status: r.status,
            enabled: r.enabled,
            excluded: r.excluded,
            basket: basket && { id: basket.basketId, label: basket.label, source: basket.source },
          };
        }),
      );
```

- [ ] **Step 4: Extend the PATCH endpoint**

Replace `PatchProductBody` (lines 26-34) with:

```ts
const PatchProductBody = z
  .object({
    enabled: z.boolean().optional(),
    excluded: z.boolean().optional(),
    garmentImageUrl: z.string().url().optional(),
    // null clears the pin and returns the product to rule-based routing —
    // the case merchants need most. `.optional()` alone would make an absent
    // key and an explicit null indistinguishable, so `.nullable()` is load-bearing.
    funnelTemplateId: z.string().uuid().nullable().optional(),
  })
  .refine(
    (b) =>
      b.enabled !== undefined ||
      b.excluded !== undefined ||
      b.garmentImageUrl !== undefined ||
      b.funnelTemplateId !== undefined,
    { message: 'at least one of enabled, excluded, garmentImageUrl, or funnelTemplateId is required' },
  );
```

In the handler, destructure `funnelTemplateId` alongside the others and, before the existing update, add:

```ts
      const patch: Record<string, unknown> = {};
      if (funnelTemplateId !== undefined) {
        if (funnelTemplateId === null) {
          patch.funnelTemplateId = null;
          patch.funnelAssignmentSource = null;
        } else {
          const [basket] = await app.db
            .select({ id: schema.shopifyFunnelTemplates.id })
            .from(schema.shopifyFunnelTemplates)
            .where(
              and(
                eq(schema.shopifyFunnelTemplates.id, funnelTemplateId),
                eq(schema.shopifyFunnelTemplates.isActive, true),
              ),
            )
            .limit(1);
          if (!basket) throw new AppError('NOT_FOUND', 404, 'basket not found');
          patch.funnelTemplateId = funnelTemplateId;
          patch.funnelAssignmentSource = 'manual';
        }
      }
```

Merge `patch` into the object passed to the existing `.set({ … })` call in the same handler rather than issuing a second `UPDATE`.

- [ ] **Step 5: Run the tests to verify they pass**

Run from `apps/api`: `npx vitest run --config vitest.integration.config.ts shopify-product-basket`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/shopify/products.routes.ts apps/api/test/integration/shopify-product-basket.test.ts
git commit -m "$(cat <<'EOF'
feat(shopify): expose product baskets and per-product pinning

GET /v1/shopify/products reports each product's resolved basket and how it
was resolved. The rule set is loaded once per page and applied per row, so
this adds no query per product.

PATCH accepts funnelTemplateId: a uuid pins the product, null clears the
pin and returns it to rule-based routing. nullable() rather than optional()
alone is load-bearing — otherwise an absent key and an explicit null are
indistinguishable and the clear case cannot be expressed.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01K3jhDzM9v8Z7exXFTo5XiE
EOF
)"
```

---

### Task 7: Admin global rules API

**Files:**
- Create: `apps/api/src/modules/admin/shopify-funnel-rules.routes.ts`
- Modify: `apps/api/src/server.ts` (register beside `adminShopifyFunnelsRoutes`, line 420)
- Modify: `apps/api/src/modules/admin/shopify-funnels.routes.ts` (cascade counts on the delete-impact response)
- Test: `apps/api/test/integration/shopify-admin-funnel-rules.test.ts`

**Interfaces:**
- Consumes: `requirePermission` from `../admin/guard.js`, `recordAudit`.
- Produces: `export async function adminShopifyFunnelRulesRoutes(app: FastifyInstance)`, registering `GET/POST/PATCH/DELETE /admin/shopify/funnel-rules[/:id]`. `GET` items carry `disabledByStoreCount: number`.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/integration/shopify-admin-funnel-rules.test.ts`, using `apps/api/test/helpers/admin.ts` for an authenticated admin.

```ts
it('creates a global rule with a null storeId', async () => {
  const res = await app.inject({
    method: 'POST', url: '/admin/shopify/funnel-rules', headers: adminAuth,
    payload: { funnelTemplateId: basketId, conditions: [{ field: 'tags', operator: 'contains', value: 'saree' }], priority: 10 },
  });
  expect(res.statusCode).toBe(200);
  const [row] = await app.db.select().from(schema.shopifyFunnelRules).where(eq(schema.shopifyFunnelRules.id, res.json().id));
  expect(row.storeId).toBeNull();
});

it('writes an audit log row in the same transaction', async () => {
  const before = await app.db.select().from(schema.auditLogs);
  await app.inject({
    method: 'POST', url: '/admin/shopify/funnel-rules', headers: adminAuth,
    payload: { funnelTemplateId: secondBasketId, conditions: [{ field: 'vendor', operator: 'equals', value: 'acme' }], priority: 0 },
  });
  const after = await app.db.select().from(schema.auditLogs);
  expect(after.length).toBe(before.length + 1);
});

it('rejects a second global rule for the same basket', async () => {
  const payload = { funnelTemplateId: basketId, conditions: [{ field: 'tags', operator: 'contains', value: 'x' }], priority: 0 };
  await app.inject({ method: 'POST', url: '/admin/shopify/funnel-rules', headers: adminAuth, payload });
  const res = await app.inject({ method: 'POST', url: '/admin/shopify/funnel-rules', headers: adminAuth, payload });
  expect(res.statusCode).toBe(409);
});

it('reports how many stores have disabled each rule', async () => {
  const res = await app.inject({ method: 'GET', url: '/admin/shopify/funnel-rules', headers: adminAuth });
  expect(res.json().items.find((r) => r.id === suppressedRuleId).disabledByStoreCount).toBe(2);
});

it('requires the shopify_funnels.write permission', async () => {
  const res = await app.inject({ method: 'GET', url: '/admin/shopify/funnel-rules', headers: unprivilegedAuth });
  expect(res.statusCode).toBe(403);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run from `apps/api`: `npx vitest run --config vitest.integration.config.ts shopify-admin-funnel-rules`
Expected: FAIL — 404 on every route.

- [ ] **Step 3: Implement the routes**

Create `apps/api/src/modules/admin/shopify-funnel-rules.routes.ts`. Mirror the merchant validation schemas from Task 5, forcing `storeId: null` on insert, and wrap every mutation as:

```ts
    const created = await app.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(schema.shopifyFunnelRules)
        .values({ storeId: null, ...body })
        .returning();
      // Fail-closed per the CLAUDE.md invariant: if this insert throws, the
      // rule insert rolls back with it. A global rule re-routes every store's
      // catalog, so it is exactly the kind of write the audit trail is for.
      await recordAudit(tx, {
        actorAdminUserId: req.adminUserId,
        action: 'shopify_funnel_rule.create',
        targetType: 'shopify_funnel_rule',
        targetId: row.id,
        metadata: { funnelTemplateId: row.funnelTemplateId, conditions: row.conditions, priority: row.priority },
      });
      return row;
    });
```

> Read `recordAudit`'s actual signature in `apps/api/src/modules/admin/` and match it — the field names above follow the `audit_logs` schema but the helper's parameter shape is authoritative.

The `GET` handler joins the suppression count:

```ts
    const items = await app.db
      .select({
        id: schema.shopifyFunnelRules.id,
        funnelTemplateId: schema.shopifyFunnelRules.funnelTemplateId,
        conditions: schema.shopifyFunnelRules.conditions,
        priority: schema.shopifyFunnelRules.priority,
        // A global rule half your merchants have switched off is a rule that
        // is wrong. Without this the signal is invisible from the admin side.
        disabledByStoreCount: count(schema.shopifyStoreDisabledFunnelRules.storeId),
      })
      .from(schema.shopifyFunnelRules)
      .leftJoin(
        schema.shopifyStoreDisabledFunnelRules,
        eq(schema.shopifyStoreDisabledFunnelRules.ruleId, schema.shopifyFunnelRules.id),
      )
      .where(isNull(schema.shopifyFunnelRules.storeId))
      .groupBy(schema.shopifyFunnelRules.id)
      .orderBy(asc(schema.shopifyFunnelRules.priority));
```

Guard every route with `requirePermission('shopify_funnels.write')`, as `shopify-funnels.routes.ts:41` already does. Register in `server.ts` beside `adminShopifyFunnelsRoutes`.

- [ ] **Step 4: Add cascade counts to the basket delete-impact response**

In `apps/api/src/modules/admin/shopify-funnels.routes.ts`, the delete-impact response (around lines 144-190) already reports affected products. Add the rule counts, so the confirmation states what the cascade removes:

```ts
      // shopify_funnel_rules cascades on funnel_template_id (schema/shopify.ts:280),
      // so deleting a basket silently deletes every store's rules for it. State
      // what will be lost before the cascade.
      const [ruleImpact] = await app.db
        .select({
          rules: count(),
          stores: countDistinct(schema.shopifyFunnelRules.storeId),
        })
        .from(schema.shopifyFunnelRules)
        .where(eq(schema.shopifyFunnelRules.funnelTemplateId, id));
```

Return `{ …existing, rulesAffected: ruleImpact.rules, storesAffected: ruleImpact.stores }`. Import `countDistinct` from `drizzle-orm`.

- [ ] **Step 5: Run the tests to verify they pass**

Run from `apps/api`: `npx vitest run --config vitest.integration.config.ts shopify-admin-funnel-rules`
Then the existing admin suite: `pnpm --filter @aivastra/api test shopify-funnel-templates-admin`
Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/admin/shopify-funnel-rules.routes.ts apps/api/src/modules/admin/shopify-funnels.routes.ts apps/api/src/server.ts apps/api/test/integration/shopify-admin-funnel-rules.test.ts
git commit -m "$(cat <<'EOF'
feat(admin): global funnel rule CRUD, audited

Global rules re-route every store's catalog, so each mutation writes
audit_logs through recordAudit inside its own transaction, fail-closed per
the CLAUDE.md invariant.

The list reports how many stores have disabled each rule — a global rule
half the merchants have switched off is a rule that is wrong, and that
signal was otherwise invisible from the admin side. Basket deletion now
also reports the rules and stores its cascade will affect.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01K3jhDzM9v8Z7exXFTo5XiE
EOF
)"
```

---

### Task 8: Merchant Routing page

**Files:**
- Create: `apps/shopify/src/pages/RoutingPage.tsx`
- Modify: `apps/shopify/src/components/AppNavMenu.tsx` (`NAV_ITEMS`), `apps/shopify/src/App.tsx` (import + `<Route>`)

**Interfaces:**
- Consumes: `GET /v1/shopify/baskets`, `GET|POST|PATCH|DELETE /v1/shopify/funnel-rules`, `PUT /v1/shopify/funnel-rules/:id/disabled` from Task 5; `apiFetch` from `../lib/api`.
- Produces: route `/routing`.

- [ ] **Step 1: Add the nav entry and route**

In `AppNavMenu.tsx`, import `RulesIcon` — or another existing `@shopify/polaris-icons` export if that name is absent; check the package's exports rather than guessing — and add to `NAV_ITEMS` after Manage:

```ts
  { path: '/routing', label: 'Routing', icon: RulesIcon },
```

In `App.tsx`, add the import and the route beside the others (line ~126):

```tsx
          <Route path="/routing" element={<RoutingPage />} />
```

- [ ] **Step 2: Build the page**

Create `apps/shopify/src/pages/RoutingPage.tsx`. This skeleton establishes the types and data flow; fill in the three cards and the editor modal using `ManagePage.tsx`'s existing conventions for loading state, error toasts and `apiFetch` rather than inventing new ones.

```tsx
import { Badge, Banner, Button, Card, InlineStack, Page, Spinner, Text } from '@shopify/polaris';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

interface Condition {
  field: 'product_type' | 'tags' | 'vendor' | 'collections';
  operator: 'equals' | 'contains';
  value: string;
}
interface Basket {
  id: string;
  slug: string;
  label: string;
  sortOrder: number;
}
interface StoreRule {
  id: string;
  funnelTemplateId: string;
  conditions: Condition[];
  priority: number;
}
interface GlobalRule extends StoreRule {
  disabled: boolean;
}
interface RulesResponse {
  storeRules: StoreRule[];
  globalRules: GlobalRule[];
  counts: Record<string, number>;
  countsOmitted: boolean;
}

const FIELD_LABEL: Record<Condition['field'], string> = {
  product_type: 'Product type',
  tags: 'Tag',
  vendor: 'Vendor',
  collections: 'Collection',
};

/** "Tag contains "saree" or Product type is "Saree"" — the merchant never
 *  sees the raw condition objects, only this. */
export function describeConditions(conditions: Condition[]): string {
  if (conditions.length === 0) return 'Matches nothing — add a condition';
  return conditions
    .map((c) => `${FIELD_LABEL[c.field]} ${c.operator === 'equals' ? 'is' : 'contains'} "${c.value}"`)
    .join(' or ');
}

export default function RoutingPage() {
  const [baskets, setBaskets] = useState<Basket[]>([]);
  const [rules, setRules] = useState<RulesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [b, r] = await Promise.all([
        apiFetch<{ items: Basket[] }>('/v1/shopify/baskets'),
        apiFetch<RulesResponse>('/v1/shopify/funnel-rules'),
      ]);
      setBaskets(b.items);
      setRules(r);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load routing rules');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const setDisabled = useCallback(
    async (ruleId: string, disabled: boolean) => {
      await apiFetch(`/v1/shopify/funnel-rules/${ruleId}/disabled`, {
        method: 'PUT',
        body: JSON.stringify({ disabled }),
      });
      await load();
    },
    [load],
  );

  const basketLabel = (id: string) => baskets.find((b) => b.id === id)?.label ?? 'Unknown basket';

  if (loading) return <Page title="Routing"><Card><Spinner /></Card></Page>;
  if (error) return <Page title="Routing"><Banner tone="critical">{error}</Banner></Page>;

  return (
    <Page title="Routing" subtitle="Choose which try-on style each product uses.">
      {/* Card 1 — Your rules: rules.storeRules, each with basketLabel(),
          describeConditions(), priority, Edit and Delete. [Add rule] opens the
          editor modal, POSTing to /v1/shopify/funnel-rules. */}

      {/* Card 2 — Default rules (from AiVastra): rules.globalRules, read-only
          except a Switch bound to setDisabled(rule.id, !rule.disabled). Render
          a disabled rule dimmed with a "Off for your store" Badge so it stays
          visible and can be switched back on. */}

      {/* Card 3 — Where your products land: when rules.countsOmitted, render
          "Catalog too large to summarize"; otherwise one entry per basket from
          rules.counts, using basketLabel(). */}
    </Page>
  );
}
```

The rule editor modal edits `conditions[]` as rows of a `field` `Select`, an `operator` `Select`, and a `value` `TextField`, with add and remove buttons plus a priority number field. Enforce the same bounds the API does — at least 1 and at most 20 conditions, `value` at most 200 characters — so a merchant sees the limit before a 400 comes back.

- [ ] **Step 3: Typecheck and lint**

```bash
pnpm --filter @aivastra/shopify typecheck
pnpm lint
```
Expected: exit 0, no new warnings in `apps/shopify`.

- [ ] **Step 4: Verify in the browser**

```bash
pnpm --filter @aivastra/shopify dev
```
Outside the Shopify admin iframe, `window.shopify` is undefined and `App.tsx` supplies the dev `<Navigation>` — so the Routing entry is reachable at `/routing` locally. Confirm: rules list, add a rule, toggle a global rule off and back on, and the counts card.

- [ ] **Step 5: Commit**

```bash
git add apps/shopify/src/pages/RoutingPage.tsx apps/shopify/src/components/AppNavMenu.tsx apps/shopify/src/App.tsx
git commit -m "$(cat <<'EOF'
feat(shopify): merchant Routing page

Its own page rather than a fourth Manage tab: every Manage tab is gated by
isTabEditable because all three are facets of activation mode, and basket
routing applies identically in both modes — a fourth tab would inherit that
gating and be wrong in global mode.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01K3jhDzM9v8Z7exXFTo5XiE
EOF
)"
```

---

### Task 9: Basket column in Individual Products

**Files:**
- Modify: `apps/shopify/src/pages/ManagePage.tsx` (Individual Products tab table)

**Interfaces:**
- Consumes: `basket` on `GET /v1/shopify/products` items and `funnelTemplateId` on `PATCH /v1/shopify/products/:id` (Task 6); `GET /v1/shopify/baskets` (Task 5).

- [ ] **Step 1: Add the column**

Add a **Basket** column to the Individual Products table rendering `item.basket.label` with a `Badge` for `item.basket.source` — `Pinned` for `manual`, `Rule` for `rule`, `Default` for `default`. Include a `Select` of the baskets from `GET /v1/shopify/baskets` that sends `PATCH /v1/shopify/products/:id` with `{ funnelTemplateId }`, plus a "Reset to automatic" action sending `{ funnelTemplateId: null }` — shown only when `source === 'manual'`.

When `item.basket` is `null`, render "Unavailable" rather than an empty cell: null means no basket resolved and no active default, which is the state where try-on is refused.

- [ ] **Step 2: Typecheck and lint**

```bash
pnpm --filter @aivastra/shopify typecheck
pnpm lint
```
Expected: exit 0.

- [ ] **Step 3: Verify in the browser**

With `pnpm --filter @aivastra/shopify dev` running, open Manage → Individual Products. Confirm the badge reads `Rule` for a rule-matched product, changing the select flips it to `Pinned`, and "Reset to automatic" returns it to `Rule`.

- [ ] **Step 4: Commit**

```bash
git add apps/shopify/src/pages/ManagePage.tsx
git commit -m "$(cat <<'EOF'
feat(shopify): basket column and per-product pinning in Manage

Per-product controls belong where the other per-product controls already
live. The source badge distinguishes a pin from a rule match, so a merchant
can see at a glance why a product routes the way it does.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01K3jhDzM9v8Z7exXFTo5XiE
EOF
)"
```

---

### Task 10: Admin global rules UI

**Files:**
- Modify: `apps/admin-web/src/pages/ShopifyFunnelsPage.tsx`

**Interfaces:**
- Consumes: `GET|POST|PATCH|DELETE /admin/shopify/funnel-rules` (Task 7); `apiFetch`, `apiErrorMessage` from `../lib/data`; `ConfirmModal`, `EditDrawer`, `SearchableSelect` already imported by this page.

- [ ] **Step 1: Add the Global rules card**

Beneath the existing baskets table, add a card listing global rules: basket label (resolved from the `items` state already loaded on this page), a condition editor, priority, and `disabledByStoreCount` rendered as "off for N stores". Reuse `EditDrawer` for create/edit and `ConfirmModal` for delete, matching the page's existing patterns.

Extend the existing basket-delete `ConfirmModal` body to state the cascade using `rulesAffected` and `storesAffected` from Task 7 — e.g. "Also deletes 4 routing rules across 3 stores."

- [ ] **Step 2: Typecheck and lint**

```bash
pnpm --filter @aivastra/admin build
pnpm lint
```
`apps/admin-web` has no `typecheck` script (see `docs/progress.md:2590`), so the build is the type gate.
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add apps/admin-web/src/pages/ShopifyFunnelsPage.tsx
git commit -m "$(cat <<'EOF'
feat(admin): global funnel rules UI

Adds global rule management beside the baskets they route to, surfacing the
disabled-by-N-stores count, and states the rule cascade in the basket
delete confirmation.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01K3jhDzM9v8Z7exXFTo5XiE
EOF
)"
```

---

### Task 11: Full verification and documentation

**Files:**
- Modify: `docs/progress.md` (new dated entry at the top), `CLAUDE.md` (Shopify surface section)

- [ ] **Step 1: Run the full gates**

```bash
pnpm typecheck
pnpm lint
pnpm --filter @aivastra/api test
```
Expected: typecheck exit 0; lint exit 0 with no new warnings; the unit suite fully green.

- [ ] **Step 2: Run every touched integration file individually**

```bash
cd apps/api
for f in shopify-funnel-schema shopify-funnel-loader shopify-basket-routing \
         shopify-merchant-funnel-rules shopify-product-basket \
         shopify-admin-funnel-rules shopify-customer; do
  npx vitest run --config vitest.integration.config.ts "$f"
done
```
Expected: every file green. Run them individually — the full-suite rate-limiter cascade (`docs/progress.md:2604`) is pre-existing and would otherwise mask real failures.

- [ ] **Step 3: Confirm the deploy is inert**

```bash
psql "$DATABASE_URL" -c "select count(*) from shopify_funnel_rules where store_id is null;"
```
Expected: `0`. **If this is non-zero, a migration seeded rules and the deploy is not inert** — remove the seed before shipping. With no global rules, every store falls through to the existing default basket and behaves exactly as before.

- [ ] **Step 4: Update CLAUDE.md**

In the **Shopify surface** section, replace any claim that one default template serves every product with a short paragraph: baskets are `shopify_funnel_templates`; `shopify_funnel_rules` routes products to them with `store_id NULL` meaning global; per-store suppression lives in `shopify_store_disabled_funnel_rules`; precedence is pin → store rule → global rule → default and lives **only** in `apps/api/src/modules/shopify/funnel-resolution.ts`; the resolved workflow is still pinned into `job_inputs.params` at enqueue.

- [ ] **Step 5: Append the progress entry**

Add a `## 2026-09-02 — Shopify basket routing` entry at the **top** of `docs/progress.md` with Done / Failed-Not-Done / Open Questions sections. Record the actual verification output from Steps 1-2 — real counts, real failures if any. Carry forward the two spec open questions: the per-store default basket, and the pre-existing basket-CRUD audit gap in `admin/shopify-funnels.routes.ts`.

- [ ] **Step 6: Commit**

```bash
git add docs/progress.md CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: record Shopify basket routing

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01K3jhDzM9v8Z7exXFTo5XiE
EOF
)"
```

---

## Deferred (do not build)

Each was considered and rejected in the spec. Do not add them opportunistically:

- Materializing the resolved basket onto the product row, and any rule-change backfill.
- Redis caching of rule sets.
- Merchant-created baskets; exposing `workflowTemplateId` to any merchant surface.
- AND-composition across condition fields (relaxing the composite unique constraint adds it later with no data migration).
- Image-based classification.
- A per-store default basket — a nullable `settings.defaultFunnelTemplateId` plus one step between tiers 3 and 4, once a merchant asks.
- Widget JS and theme-extension changes. The shopper journey is unchanged and merchants must not need a theme republish.
