# Merchant Analytics Dashboard (Step 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merchants see try-on volume, popular garments and Top 10 products on a new Analytics page, fed by a new read-only merchant API route.

**Architecture:** Kiosk try-on jobs start recording `merchantCatalogItemId` in `job_inputs.params`. A new pure query module aggregates a merchant's `COMPLETED` try-on jobs for a range and the equal-length range before it; a thin route exposes it behind `requireMerchant`. A new `(app)/analytics` page in `apps/catalogues-web` renders it. Customer cards render a "Coming soon" state (step 2 is a separate spec).

**Tech Stack:** Fastify 5 + Zod type provider, Drizzle/Postgres, Vitest (integration suite uses the docker-compose Postgres/Redis/MinIO), Next.js 15 + React Query, inline SVG.

Spec: `docs/superpowers/specs/2026-11-05-merchant-analytics-dashboard-design.md`

## Global Constraints

- Merchant id comes from `req.merchantClientId` only, never from the query (tenant boundary).
- Only `jobs.status = 'COMPLETED'` with `jobs.source = JOB_SOURCE.MERCHANT_TRYON` count as try-ons.
- Jobs without `params.merchantCatalogItemId` count toward totals only, never toward rankings. No backfill.
- Ranges: `7d | 30d | 90d`, default `30d`, UTC, previous period = the equal-length window immediately before.
- "Least tried" ranks only items with at least one try-on in range; it is `null` when fewer than 2 products ranked.
- Categories: top 6 plus one "Other" row; `pct` computed server-side.
- Types live in `@aivastra/types` (Zod). No new tables, no migration.
- Web: `C` tokens from `src/components/tokens.ts`, never raw hex; `PremiumSelect` for the range picker, never a raw `<select>`; no new chart dependency; designed for 1920px, must hold at 1440 and 1280.
- Do not run commands against production. Do not commit unless the user asks (CLAUDE.md) — there are no commit steps in this plan.
- Integration tests need `pnpm docker:up` running. Run them with `pnpm --filter @aivastra/api test:integration` (plain `test` excludes them).

## File Structure

| File | Responsibility |
|---|---|
| `packages/types/src/merchant-analytics.ts` (new) | Zod query + response schemas |
| `packages/types/src/index.ts` (modify) | export the new file |
| `apps/api/src/modules/merchant/analytics.ts` (new) | pure ranking helpers + `merchantAnalytics(db, merchantId, range, now)` |
| `apps/api/src/modules/merchant/analytics.routes.ts` (new) | `GET /v1/merchant/analytics` |
| `apps/api/src/modules/merchant/create-tryon-job.ts` (modify) | record `merchantCatalogItemId` in the single-garment path |
| `apps/api/src/modules/merchant/tryon.routes.ts` (modify) | pass the id into that path |
| `apps/api/src/server.ts` (modify) | register the route |
| `apps/api/test/merchant-analytics.test.ts` (new) | ranking helper unit tests |
| `apps/api/test/integration/merchant-analytics.test.ts` (new) | route integration tests |
| `apps/catalogues-web/src/app/(app)/analytics/{api.ts,page.tsx,donut.tsx}` (new) | data hook, page, donut |
| `apps/catalogues-web/src/components/sidebar.tsx` (modify) | merchant-only nav entry |

---

### Task 1: Shared types

**Files:**
- Create: `packages/types/src/merchant-analytics.ts`
- Modify: `packages/types/src/index.ts` (add export, alphabetical, after `./job-taxonomy.js`… place before `./messaging.js`)

**Interfaces:**
- Produces: `MerchantAnalyticsQuery`, `MerchantAnalyticsResponse` (schemas) and same-named inferred types. `range` enum values `'7d' | '30d' | '90d'`.

- [ ] **Step 1: Write the schemas**

```ts
import { z } from 'zod';

export const MERCHANT_ANALYTICS_RANGES = ['7d', '30d', '90d'] as const;

export const MerchantAnalyticsQuery = z.object({
  range: z.enum(MERCHANT_ANALYTICS_RANGES).default('30d'),
});
export type MerchantAnalyticsQuery = z.infer<typeof MerchantAnalyticsQuery>;

const Ranked = z.object({ name: z.string(), tryOns: z.number().int() });

export const MerchantAnalyticsResponse = z.object({
  range: z.object({ from: z.string(), to: z.string(), previousFrom: z.string() }),
  totalTryOns: z.number().int(),
  previousTryOns: z.number().int(),
  // Earliest job that carries a catalog item id; null when none yet. Rankings
  // only cover try-ons since this instant.
  breakdownSince: z.string().nullable(),
  topGarmentType: Ranked.nullable(),
  mostTriedProduct: Ranked.nullable(),
  leastTriedProduct: Ranked.nullable(),
  categories: z.array(Ranked.extend({ pct: z.number() })),
  topProducts: z.array(Ranked.extend({ rank: z.number().int(), itemId: z.string() })),
});
export type MerchantAnalyticsResponse = z.infer<typeof MerchantAnalyticsResponse>;
```

- [ ] **Step 2: Export it** — add `export * from './merchant-analytics.js';` to `packages/types/src/index.ts` (before `./messaging.js`).

- [ ] **Step 3: Build and verify**

Run: `pnpm --filter @aivastra/types build`
Expected: exits 0, no TS errors.

---

### Task 2: Record the catalog item id on single-garment try-on jobs

**Files:**
- Modify: `apps/api/src/modules/merchant/create-tryon-job.ts` (interface at lines 7-14, params at ~44-47)
- Modify: `apps/api/src/modules/merchant/tryon.routes.ts` (the `createMerchantTryonJob(app, {...})` call, ~line 191)
- Test: `apps/api/test/integration/merchant-tryon.test.ts` (existing — extend)

**Interfaces:**
- Produces: `createMerchantTryonJob` input gains required `merchantCatalogItemId: string`; the job's `job_inputs.params.merchantCatalogItemId` is set. (The two-step path already writes it.)

- [ ] **Step 1: Find the existing success-path test**

Run: `grep -n "it(\|jobInputs" apps/api/test/integration/merchant-tryon.test.ts | head -30`
Pick the test that creates a single-garment job via `POST /v1/merchant/tryon/jobs` and returns 201.

- [ ] **Step 2: Add the failing assertion** to that test, after the 201 is asserted and `jobId` is known:

```ts
const [input] = await app.db
  .select({ params: schema.jobInputs.params })
  .from(schema.jobInputs)
  .where(eq(schema.jobInputs.jobId, jobId));
expect((input.params as Record<string, unknown>).merchantCatalogItemId).toBe(itemId);
```

Use the item id variable that test already posts as `merchantCatalogItemId`, and add `eq` / `schema` imports if the file lacks them.

- [ ] **Step 3: Run it to verify it fails**

Run: `cd apps/api && npx vitest run --config vitest.integration.config.ts merchant-tryon.test`
Expected: FAIL — `undefined` is not the item id.

- [ ] **Step 4: Implement**

In `create-tryon-job.ts`, add to `CreateMerchantTryonJobInput`:

```ts
  merchantCatalogItemId: string;
```

and in the `params` object (~line 44):

```ts
      params: {
        workflowTemplateId: input.workflowTemplateId,
        dispatchTemplateVersion: input.dispatchTemplateVersion ?? null,
        // Analytics groups completed try-ons by this id (modules/merchant/analytics.ts).
        merchantCatalogItemId: input.merchantCatalogItemId,
      },
```

In `tryon.routes.ts`, add `merchantCatalogItemId,` to the object passed to `createMerchantTryonJob` (the variable is already destructured from the body).

- [ ] **Step 5: Verify**

Run: `cd apps/api && npx vitest run --config vitest.integration.config.ts merchant-tryon.test && pnpm --filter @aivastra/api typecheck`
Expected: PASS, typecheck clean. If typecheck flags other callers of `createMerchantTryonJob`, add the id there too (`grep -rn "createMerchantTryonJob(" apps/api/src`).

---

### Task 3: Ranking helpers (pure, unit-tested)

**Files:**
- Create: `apps/api/src/modules/merchant/analytics.ts` (helpers only in this task)
- Test: `apps/api/test/merchant-analytics.test.ts`

**Interfaces:**
- Produces:
  - `interface Counted { name: string; tryOns: number }`
  - `rankCounted(rows: Counted[]): Counted[]` — sorted tryOns desc, name asc.
  - `foldCategories(rows: Counted[], max?: number): Array<Counted & { pct: number }>` — ranks, keeps top `max` (default 6), sums the rest into `{ name: 'Other' }`, `pct` = `Math.round(tryOns / total * 1000) / 10` over the total of **all** input rows; `[]` for no rows.

Unit tests live flat in `apps/api/test/` (the unit config excludes only `test/integration/**`), so the file is `apps/api/test/merchant-analytics.test.ts` and the import is `../src/modules/merchant/analytics`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { foldCategories, rankCounted } from '../../src/modules/merchant/analytics';

describe('rankCounted', () => {
  it('sorts by tryOns desc and breaks ties by name asc', () => {
    expect(
      rankCounted([
        { name: 'b', tryOns: 2 },
        { name: 'a', tryOns: 2 },
        { name: 'c', tryOns: 5 },
      ]).map((r) => r.name),
    ).toEqual(['c', 'a', 'b']);
  });
});

describe('foldCategories', () => {
  it('returns [] for no rows', () => {
    expect(foldCategories([])).toEqual([]);
  });

  it('computes pct over the full total', () => {
    expect(
      foldCategories([
        { name: 'Saree', tryOns: 3 },
        { name: 'Kurta', tryOns: 1 },
      ]),
    ).toEqual([
      { name: 'Saree', tryOns: 3, pct: 75 },
      { name: 'Kurta', tryOns: 1, pct: 25 },
    ]);
  });

  it('folds everything past the top 6 into Other', () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({ name: `c${i}`, tryOns: 8 - i }));
    const out = foldCategories(rows);
    expect(out).toHaveLength(7);
    expect(out[6]).toMatchObject({ name: 'Other', tryOns: 2 + 1 });
    expect(out.reduce((n, r) => n + r.tryOns, 0)).toBe(36);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/api && npx vitest run merchant-analytics`
Expected: FAIL — module has no such exports.

- [ ] **Step 3: Implement**

```ts
export interface Counted {
  name: string;
  tryOns: number;
}

/** Stable ordering: most tried first, ties by name so reloads never reshuffle. */
export function rankCounted<T extends Counted>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.tryOns - a.tryOns || a.name.localeCompare(b.name));
}

export function foldCategories(
  rows: Counted[],
  max = 6,
): Array<Counted & { pct: number }> {
  const ranked = rankCounted(rows);
  const total = ranked.reduce((n, r) => n + r.tryOns, 0);
  if (total === 0) return [];
  const kept = ranked.slice(0, max);
  const rest = ranked.slice(max);
  if (rest.length > 0) {
    kept.push({ name: 'Other', tryOns: rest.reduce((n, r) => n + r.tryOns, 0) });
  }
  return kept.map((r) => ({ ...r, pct: Math.round((r.tryOns / total) * 1000) / 10 }));
}
```

- [ ] **Step 4: Verify pass**

Run: `cd apps/api && npx vitest run merchant-analytics`
Expected: PASS (4 tests).

---

### Task 4: Aggregation query + route

**Files:**
- Modify: `apps/api/src/modules/merchant/analytics.ts` (append)
- Create: `apps/api/src/modules/merchant/analytics.routes.ts`
- Modify: `apps/api/src/server.ts` (import near line 101; register near line 466)
- Test: `apps/api/test/integration/merchant-analytics.test.ts`

**Interfaces:**
- Consumes: `rankCounted`, `foldCategories`, `Counted` (Task 3); `MerchantAnalyticsQuery`, `MerchantAnalyticsResponse` (Task 1); `params.merchantCatalogItemId` (Task 2).
- Produces: `merchantAnalytics(db: DB, merchantId: string, rangeKey: '7d'|'30d'|'90d', now: Date): Promise<MerchantAnalyticsResponse>`; route `GET /v1/merchant/analytics`.

- [ ] **Step 1: Write the failing integration tests**

Reuse the harness exactly as `merchant-tryon-history.test.ts` does (`createMerchant`, `authHeader`, `startContainers`, `buildTestApp`). Seeding helpers:

```ts
import { JOB_SOURCE } from '@aivastra/types';

async function seedGarmentType(app: TestApp, label: string) {
  const [g] = await app.db
    .insert(schema.garmentSubcategories)
    .values({ genderSlug: 'women', slug: label.toLowerCase(), label })
    .returning();
  return g;
}

async function seedItem(
  app: TestApp,
  merchantId: string,
  garmentTypeId: string,
  subName: string,
  label: string,
) {
  const [sub] = await app.db
    .insert(schema.merchantCatalogSubcategories)
    .values({ merchantId, category: 'women', name: subName, garmentSubcategoryId: garmentTypeId })
    .returning();
  const [item] = await app.db
    .insert(schema.merchantCatalogItems)
    .values({
      merchantId,
      subcategoryId: sub.id,
      label,
      actualPricePaise: 100,
      offerPricePaise: 100,
      r2Key: `k/${label}`,
      thumbnailKey: `t/${label}`,
    })
    .returning();
  return item;
}

async function seedTryon(
  app: TestApp,
  o: { merchantId: string; userId: string; itemId?: string; status?: string; daysAgo: number },
) {
  const [job] = await app.db
    .insert(schema.jobs)
    .values({
      merchantId: o.merchantId,
      userId: o.userId,
      customerPhotoKey: 'merchant-inputs/p.jpg',
      status: o.status ?? 'COMPLETED',
      source: JOB_SOURCE.MERCHANT_TRYON,
      createdAt: new Date(Date.now() - o.daysAgo * 86_400_000),
    })
    .returning();
  await app.db.insert(schema.jobInputs).values({
    jobId: job.id,
    params: o.itemId ? { merchantCatalogItemId: o.itemId } : {},
  });
}
```

(If `jobs`/`job_inputs` inserts need extra not-null columns, mirror the history test's `seedJob` and `createMerchantTryonJob` inserts; `as any` casts are accepted in this repo for these inserts.)

Tests (all `GET /v1/merchant/analytics?range=30d` with `authHeader`):

```ts
it('counts only completed try-ons and compares with the previous period', async () => {
  const { merchant, merchantUser } = await createMerchant(app, 'an-a@example.com');
  const g = await seedGarmentType(app, 'Saree-a');
  const item = await seedItem(app, merchant.id, g.id, 'Silk', 'Silk Border Saree');
  const base = { merchantId: merchant.id, userId: merchantUser.id };
  await seedTryon(app, { ...base, itemId: item.id, daysAgo: 1 });
  await seedTryon(app, { ...base, itemId: item.id, daysAgo: 2 });
  await seedTryon(app, { ...base, itemId: item.id, daysAgo: 3, status: 'FAILED' });
  await seedTryon(app, { ...base, itemId: item.id, daysAgo: 40 }); // previous 30d window
  const res = await app.inject({ method: 'GET', url: '/v1/merchant/analytics?range=30d', headers: await authHeader(merchantUser.id) });
  expect(res.statusCode).toBe(200);
  const body = res.json();
  expect(body.totalTryOns).toBe(2);
  expect(body.previousTryOns).toBe(1);
  expect(body.topProducts).toEqual([
    { rank: 1, itemId: item.id, name: 'Silk Border Saree', tryOns: 2 },
  ]);
  expect(body.topGarmentType).toEqual({ name: 'Saree-a', tryOns: 2 });
  expect(body.categories).toEqual([{ name: 'Silk', tryOns: 2, pct: 100 }]);
  expect(body.leastTriedProduct).toBeNull(); // only one product ranked
});

it('counts legacy jobs without an item id in totals but not rankings', async () => {
  const { merchant, merchantUser } = await createMerchant(app, 'an-b@example.com');
  await seedTryon(app, { merchantId: merchant.id, userId: merchantUser.id, daysAgo: 1 });
  const res = await app.inject({ method: 'GET', url: '/v1/merchant/analytics', headers: await authHeader(merchantUser.id) });
  const body = res.json();
  expect(body.totalTryOns).toBe(1);
  expect(body.topProducts).toEqual([]);
  expect(body.mostTriedProduct).toBeNull();
  expect(body.breakdownSince).toBeNull();
});

it("never includes another merchant's jobs", async () => {
  const a = await createMerchant(app, 'an-c@example.com');
  const b = await createMerchant(app, 'an-d@example.com');
  const g = await seedGarmentType(app, 'Kurta-c');
  const bItem = await seedItem(app, b.merchant.id, g.id, 'Cotton', 'B Kurta');
  await seedTryon(app, { merchantId: b.merchant.id, userId: b.merchantUser.id, itemId: bItem.id, daysAgo: 1 });
  const res = await app.inject({ method: 'GET', url: '/v1/merchant/analytics', headers: await authHeader(a.merchantUser.id) });
  const body = res.json();
  expect(body.totalTryOns).toBe(0);
  expect(body.topProducts).toEqual([]);
});

it('ranks most and least tried across several products and honours the range', async () => {
  const { merchant, merchantUser } = await createMerchant(app, 'an-e@example.com');
  const g = await seedGarmentType(app, 'Blazer-e');
  const hot = await seedItem(app, merchant.id, g.id, 'Formal', 'Hot Blazer');
  const cold = await seedItem(app, merchant.id, g.id, 'Formal', 'Cold Blazer');
  const base = { merchantId: merchant.id, userId: merchantUser.id };
  await seedTryon(app, { ...base, itemId: hot.id, daysAgo: 1 });
  await seedTryon(app, { ...base, itemId: hot.id, daysAgo: 2 });
  await seedTryon(app, { ...base, itemId: cold.id, daysAgo: 3 });
  await seedTryon(app, { ...base, itemId: cold.id, daysAgo: 20 }); // outside 7d
  const res = await app.inject({ method: 'GET', url: '/v1/merchant/analytics?range=7d', headers: await authHeader(merchantUser.id) });
  const body = res.json();
  expect(body.mostTriedProduct).toEqual({ name: 'Hot Blazer', tryOns: 2 });
  expect(body.leastTriedProduct).toEqual({ name: 'Cold Blazer', tryOns: 1 });
  expect(body.totalTryOns).toBe(3);
});

it('rejects an unknown range and unauthenticated callers', async () => {
  const { merchantUser } = await createMerchant(app, 'an-f@example.com');
  const bad = await app.inject({ method: 'GET', url: '/v1/merchant/analytics?range=1y', headers: await authHeader(merchantUser.id) });
  expect(bad.statusCode).toBe(400);
  const anon = await app.inject({ method: 'GET', url: '/v1/merchant/analytics' });
  expect(anon.statusCode).toBe(401);
});
```

Wrap in `describe('merchant analytics', ...)` with the same `beforeAll`/`afterAll` as the history test.

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/api && npx vitest run --config vitest.integration.config.ts merchant-analytics`
Expected: FAIL — 404 on the route.

- [ ] **Step 3: Implement the query** — append to `analytics.ts` (add imports at top):

```ts
import type { DB } from '@aivastra/db';
import { schema } from '@aivastra/db';
import { JOB_SOURCE, type MerchantAnalyticsResponse } from '@aivastra/types';
import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';

const RANGE_DAYS = { '7d': 7, '30d': 30, '90d': 90 } as const;
const DAY_MS = 86_400_000;

interface ResolvedItem {
  name: string;
  category: string;
  garmentType: string | null;
}

async function resolveItems(
  db: DB,
  merchantId: string,
  ids: string[],
): Promise<Map<string, ResolvedItem>> {
  const out = new Map<string, ResolvedItem>();
  if (ids.length === 0) return out;

  // Scoped to the merchant: an id in a job's params is never trusted to name
  // another tenant's row.
  const own = await db
    .select({
      id: schema.merchantCatalogItems.id,
      name: schema.merchantCatalogItems.label,
      category: schema.merchantCatalogSubcategories.name,
      garmentType: schema.garmentSubcategories.label,
    })
    .from(schema.merchantCatalogItems)
    .innerJoin(
      schema.merchantCatalogSubcategories,
      eq(schema.merchantCatalogSubcategories.id, schema.merchantCatalogItems.subcategoryId),
    )
    .leftJoin(
      schema.garmentSubcategories,
      eq(schema.garmentSubcategories.id, schema.merchantCatalogSubcategories.garmentSubcategoryId),
    )
    .where(
      and(
        eq(schema.merchantCatalogItems.merchantId, merchantId),
        inArray(schema.merchantCatalogItems.id, ids),
      ),
    );
  for (const r of own) out.set(r.id, r);

  // Admin demo items share the id namespace (see resolve-tryon-garment.ts).
  const rest = ids.filter((id) => !out.has(id));
  if (rest.length > 0) {
    const demo = await db
      .select({
        id: schema.demoCatalogItems.id,
        name: schema.demoCatalogItems.label,
        category: schema.demoCatalogSubcategories.name,
        garmentType: schema.garmentSubcategories.label,
      })
      .from(schema.demoCatalogItems)
      .innerJoin(
        schema.demoCatalogSubcategories,
        eq(schema.demoCatalogSubcategories.id, schema.demoCatalogItems.subcategoryId),
      )
      .leftJoin(
        schema.garmentSubcategories,
        eq(schema.garmentSubcategories.id, schema.demoCatalogSubcategories.garmentSubcategoryId),
      )
      .where(inArray(schema.demoCatalogItems.id, rest));
    for (const r of demo) out.set(r.id, r);
  }
  return out;
}

const sumBy = (rows: Array<{ key: string | null; tryOns: number }>): Counted[] => {
  const m = new Map<string, number>();
  for (const r of rows) if (r.key) m.set(r.key, (m.get(r.key) ?? 0) + r.tryOns);
  return [...m].map(([name, tryOns]) => ({ name, tryOns }));
};

export async function merchantAnalytics(
  db: DB,
  merchantId: string,
  rangeKey: keyof typeof RANGE_DAYS,
  now: Date,
): Promise<MerchantAnalyticsResponse> {
  const span = RANGE_DAYS[rangeKey] * DAY_MS;
  const to = now;
  const from = new Date(to.getTime() - span);
  const previousFrom = new Date(from.getTime() - span);

  const base = and(
    eq(schema.jobs.merchantId, merchantId),
    eq(schema.jobs.source, JOB_SOURCE.MERCHANT_TRYON),
    eq(schema.jobs.status, 'COMPLETED'),
  );
  const itemId = sql<string | null>`${schema.jobInputs.params}->>'merchantCatalogItemId'`;

  const countIn = async (a: Date, b: Date) => {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.jobs)
      .where(and(base, gte(schema.jobs.createdAt, a), lt(schema.jobs.createdAt, b)));
    return row.n;
  };
  const [totalTryOns, previousTryOns] = await Promise.all([
    countIn(from, to),
    countIn(previousFrom, from),
  ]);

  // jobs is narrowed by (merchant_id, created_at) first; the params extraction
  // only runs on that set — same pattern as shopify/analytics.ts.
  const grouped = await db
    .select({ itemId, tryOns: sql<number>`count(*)::int` })
    .from(schema.jobs)
    .innerJoin(schema.jobInputs, eq(schema.jobInputs.jobId, schema.jobs.id))
    .where(
      and(
        base,
        gte(schema.jobs.createdAt, from),
        lt(schema.jobs.createdAt, to),
        sql`${itemId} is not null`,
      ),
    )
    .groupBy(sql`1`);

  const [since] = await db
    .select({ at: sql<Date | null>`min(${schema.jobs.createdAt})` })
    .from(schema.jobs)
    .innerJoin(schema.jobInputs, eq(schema.jobInputs.jobId, schema.jobs.id))
    .where(and(base, sql`${itemId} is not null`));

  const resolved = await resolveItems(
    db,
    merchantId,
    grouped.map((g) => g.itemId as string),
  );

  // An item deleted since the try-on no longer resolves; it is left out of
  // every breakdown rather than shown under a made-up name.
  const rows = grouped
    .map((g) => ({ ...g, item: resolved.get(g.itemId as string) }))
    .filter((g): g is typeof g & { item: ResolvedItem } => g.item !== undefined);

  const products = rankCounted(
    rows.map((r) => ({ name: r.item.name, tryOns: r.tryOns, itemId: r.itemId as string })),
  );
  const garmentTypes = rankCounted(sumBy(rows.map((r) => ({ key: r.item.garmentType, tryOns: r.tryOns }))));

  return {
    range: {
      from: from.toISOString(),
      to: to.toISOString(),
      previousFrom: previousFrom.toISOString(),
    },
    totalTryOns,
    previousTryOns,
    breakdownSince: since?.at ? new Date(since.at).toISOString() : null,
    topGarmentType: garmentTypes[0] ?? null,
    mostTriedProduct: products[0] ? { name: products[0].name, tryOns: products[0].tryOns } : null,
    leastTriedProduct:
      products.length > 1
        ? {
            name: products[products.length - 1].name,
            tryOns: products[products.length - 1].tryOns,
          }
        : null,
    categories: foldCategories(sumBy(rows.map((r) => ({ key: r.item.category, tryOns: r.tryOns })))),
    topProducts: products.slice(0, 10).map((p, i) => ({ rank: i + 1, ...p })),
  };
}
```

Note: `rows` are merged per item id already (one row per id), so `products` has one entry per item.

- [ ] **Step 4: Implement the route** — `analytics.routes.ts`:

```ts
import { MerchantAnalyticsQuery } from '@aivastra/types';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../../lib/errors.js';
import { merchantAnalytics } from './analytics.js';

export async function merchantAnalyticsRoutes(app: FastifyInstance) {
  app.get(
    '/v1/merchant/analytics',
    { preHandler: app.requireMerchant, schema: { querystring: MerchantAnalyticsQuery } },
    async (req) => {
      const merchantId = req.merchantClientId;
      if (!merchantId) throw new AppError('UNAUTH', 401, 'missing merchant');
      const { range } = req.query as MerchantAnalyticsQuery;
      return merchantAnalytics(app.db, merchantId, range, new Date());
    },
  );
}
```

Register in `server.ts`: `import { merchantAnalyticsRoutes } from './modules/merchant/analytics.routes.js';` beside the other merchant imports, and `await app.register(merchantAnalyticsRoutes);` after `await app.register(merchantMeRoutes);`.

- [ ] **Step 5: Verify**

Run: `cd apps/api && npx vitest run --config vitest.integration.config.ts merchant-analytics && npx vitest run merchant-analytics && pnpm --filter @aivastra/api typecheck && pnpm exec biome check src/modules/merchant`
Expected: all PASS, typecheck and lint clean. If Fastify rejects the unauthenticated test with a different code than 401, assert what `requireMerchant` actually returns for a missing token (read `apps/api/src/plugins/portal-auth.ts`) — do not loosen the isolation test.

---

### Task 5: Web Analytics page

**Files:**
- Create: `apps/catalogues-web/src/app/(app)/analytics/api.ts`
- Create: `apps/catalogues-web/src/app/(app)/analytics/donut.tsx`
- Create: `apps/catalogues-web/src/app/(app)/analytics/page.tsx`
- Modify: `apps/catalogues-web/src/components/sidebar.tsx`

**Interfaces:**
- Consumes: `MerchantAnalyticsResponse` (Task 1), route `GET /v1/merchant/analytics?range=` (Task 4), `isMerchantGateError` from `@/lib/api`.
- No web test runner exists in this app (no vitest, no test files), so verification is typecheck + lint + a manual browser pass; do not add a test framework for this.

- [ ] **Step 1: `api.ts`**

```ts
import type { MerchantAnalyticsResponse } from '@aivastra/types';
import { api } from '@/lib/api';

export type AnalyticsRange = '7d' | '30d' | '90d';

export function getMerchantAnalytics(range: AnalyticsRange): Promise<MerchantAnalyticsResponse> {
  return api.get<MerchantAnalyticsResponse>(`/v1/merchant/analytics?range=${range}`);
}
```

- [ ] **Step 2: `donut.tsx`** (inline SVG; colors from tokens only, distinguished by lightness steps via opacity so it works in both themes)

```tsx
import { C } from '@/components/tokens';

const R = 70;
const CIRC = 2 * Math.PI * R;
const OPACITIES = [1, 0.8, 0.62, 0.48, 0.36, 0.26, 0.18];

export function Donut({
  slices,
  centerValue,
  centerLabel,
}: {
  slices: { name: string; pct: number }[];
  centerValue: string;
  centerLabel: string;
}) {
  let offset = 0;
  return (
    <svg
      width="200"
      height="200"
      viewBox="0 0 200 200"
      role="img"
      aria-label={slices.map((s) => `${s.name} ${s.pct}%`).join(', ')}
    >
      <circle cx="100" cy="100" r={R} fill="none" stroke={C.border} strokeWidth="26" />
      {slices.map((s, i) => {
        const len = (s.pct / 100) * CIRC;
        const el = (
          <circle
            key={s.name}
            cx="100"
            cy="100"
            r={R}
            fill="none"
            stroke={C.pink}
            strokeOpacity={OPACITIES[i] ?? 0.18}
            strokeWidth="26"
            strokeDasharray={`${len} ${CIRC - len}`}
            strokeDashoffset={-offset}
            transform="rotate(-90 100 100)"
          />
        );
        offset += len;
        return el;
      })}
      <text x="100" y="98" textAnchor="middle" fontSize="26" fontWeight="700" fill={C.text}>
        {centerValue}
      </text>
      <text x="100" y="120" textAnchor="middle" fontSize="12" fill={C.mid}>
        {centerLabel}
      </text>
    </svg>
  );
}
```

- [ ] **Step 3: `page.tsx`**

```tsx
'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { PremiumSelect } from '@/components/ui/premium-select';
import { ComingSoon } from '@/components/ui/coming-soon';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { C } from '@/components/tokens';
import { TopBar } from '@/components/topbar';
import { isMerchantGateError } from '@/lib/api';
import { type AnalyticsRange, getMerchantAnalytics } from './api';
import { Donut } from './donut';

const RANGES = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
];

const card: React.CSSProperties = {
  background: C.card,
  border: `1px solid ${C.border}`,
  borderRadius: 12,
  padding: 24,
};

const fmt = new Intl.NumberFormat('en-IN');

function changeLabel(current: number, previous: number): string {
  if (previous === 0) return current === 0 ? '—' : 'New';
  const pct = Math.round(((current - previous) / previous) * 100);
  return `${pct >= 0 ? '+' : ''}${pct}%`;
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={card}>
      <div style={{ fontSize: 13, color: C.mid }}>{label}</div>
      <div style={{ fontSize: 30, fontWeight: 700, color: C.text, marginTop: 8 }}>{value}</div>
      {sub ? <div style={{ fontSize: 13, color: C.mid, marginTop: 4 }}>{sub}</div> : null}
    </div>
  );
}

export default function AnalyticsPage() {
  const [range, setRange] = useState<AnalyticsRange>('30d');
  const q = useQuery({ queryKey: ['merchant-analytics', range], queryFn: () => getMerchantAnalytics(range) });
  const d = q.data;
  const days = range === '7d' ? 7 : range === '90d' ? 90 : 30;

  return (
    <div>
      <TopBar
        title="Analytics"
        subtitle="How customers use your try-on kiosk"
        right={
          <PremiumSelect
            value={range}
            onChange={(v) => setRange(v as AnalyticsRange)}
            options={RANGES}
            ariaLabel="Date range"
            minWidth={170}
          />
        }
      />
      <div style={{ maxWidth: 1680, margin: '0 auto', padding: '24px 32px 48px', display: 'grid', gap: 24 }}>
        {q.isLoading ? (
          <div style={{ display: 'grid', gap: 24 }}>
            <Skeleton h={120} r={12} />
            <Skeleton h={320} r={12} />
          </div>
        ) : q.isError ? (
          <ErrorState
            compact
            title={isMerchantGateError(q.error) ? 'Merchant account required' : 'Could not load analytics'}
            message={q.error instanceof Error ? q.error.message : undefined}
            onRetry={() => q.refetch()}
          />
        ) : d ? (
          <>
            <section
              aria-label="Overview"
              style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}
            >
              <Stat
                label="Total Virtual Try-Ons"
                value={fmt.format(d.totalTryOns)}
                sub={`${changeLabel(d.totalTryOns, d.previousTryOns)} vs previous ${days} days`}
              />
              <Stat
                label="Most Tried Garment"
                value={d.topGarmentType?.name ?? '—'}
                sub={d.topGarmentType ? `${fmt.format(d.topGarmentType.tryOns)} Try-Ons` : undefined}
              />
              <Stat
                label="Most Tried Product"
                value={d.mostTriedProduct?.name ?? '—'}
                sub={d.mostTriedProduct ? `${fmt.format(d.mostTriedProduct.tryOns)} Try-Ons` : undefined}
              />
              <Stat
                label="Least Tried Product"
                value={d.leastTriedProduct?.name ?? '—'}
                sub={d.leastTriedProduct ? `${fmt.format(d.leastTriedProduct.tryOns)} Try-Ons` : undefined}
              />
            </section>

            {d.totalTryOns === 0 ? (
              <div style={{ ...card, textAlign: 'center', color: C.mid }}>
                No try-ons yet. They appear here once customers use the kiosk app.
              </div>
            ) : (
              <>
                {d.breakdownSince ? (
                  <p style={{ margin: 0, fontSize: 13, color: C.mid }}>
                    Product breakdown covers try-ons since{' '}
                    {new Date(d.breakdownSince).toLocaleDateString('en-IN', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                    .
                  </p>
                ) : null}
                <div
                  style={{ display: 'grid', gap: 24, gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))' }}
                >
                  <section style={card} aria-label="Garment categories">
                    <h2 style={{ fontSize: 16, fontWeight: 700, color: C.text, margin: '0 0 16px' }}>
                      Most Tried Garment Category
                    </h2>
                    <div style={{ display: 'flex', gap: 32, alignItems: 'center', flexWrap: 'wrap' }}>
                      <Donut
                        slices={d.categories}
                        centerValue={fmt.format(d.categories.reduce((n, c) => n + c.tryOns, 0))}
                        centerLabel="Try-Ons"
                      />
                      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10, minWidth: 200 }}>
                        {d.categories.map((c) => (
                          <li key={c.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 24, fontSize: 14, color: C.text }}>
                            <span>{c.name}</span>
                            <span style={{ color: C.mid }}>{c.pct}%</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </section>

                  <section style={card} aria-label="Top products">
                    <h2 style={{ fontSize: 16, fontWeight: 700, color: C.text, margin: '0 0 16px' }}>
                      Top 10 Popular Products
                    </h2>
                    <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 12 }}>
                      {d.topProducts.map((p) => (
                        <li key={p.itemId} style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                          <span style={{ width: 28, fontWeight: 700, color: C.mid }}>{p.rank}</span>
                          <span style={{ flex: 1, color: C.text, fontSize: 14 }}>{p.name}</span>
                          <span style={{ color: C.mid, fontSize: 13 }}>{fmt.format(p.tryOns)} Try-Ons</span>
                        </li>
                      ))}
                    </ol>
                  </section>
                </div>
              </>
            )}

            <section aria-label="Customers">
              <ComingSoon
                title="Customer data is coming soon"
                message="Total customers, repeat customers and collected phone numbers will appear here once the kiosk can capture them."
              />
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}
```

If `ComingSoon`'s prop set or `PremiumSelect`'s `onChange` signature differ from what is shown, adapt to the component's actual types (read the files; `onChange` is `(value: string | number) => void` and `ComingSoon` takes `title`, `message`, `icon`). Keep tokens-only colors. `ComingSoon` shows a "notify me" control; if it implies a feature that does not exist, render a plain muted card with the same text instead.

- [ ] **Step 4: Sidebar entry** — add to the `NAV` array in `sidebar.tsx`, after the `developers` entry:

```ts
  {
    id: 'analytics',
    href: '/analytics',
    label: 'Analytics',
    icon: 'bar-chart',
    merchantOnly: true,
  },
```

The `bar-chart` icon branch already exists. Then run `grep -n "prefetchRoute\|activeId" apps/catalogues-web/src/components/sidebar.tsx` and, if either keys off a fixed id list, add `analytics` to it.

- [ ] **Step 5: Verify**

Run: `pnpm --filter @aivastra/web typecheck && pnpm exec biome check apps/catalogues-web/src/app/\(app\)/analytics apps/catalogues-web/src/components/sidebar.tsx`
Expected: clean. Fix lint import-order complaints with `pnpm exec biome check --write` on those paths only.

- [ ] **Step 6: Manual check (run it, don't assume)**

With `pnpm docker:up`, `pnpm db:migrate`, and `pnpm --filter @aivastra/api dev` + `pnpm --filter @aivastra/web dev` running, sign in as a merchant user (create via `pnpm db:seed` data or the integration helper's shape), seed a few COMPLETED merchant jobs with `params.merchantCatalogItemId` in the **local** database only, and open `/analytics` at 1920, 1440 and 1280 px widths. Confirm: cards fill the row at 1920 without stretching past ~1680px content, wrap at 1280 with no horizontal scroll, the range picker changes the data, the empty state shows for a merchant with no jobs, and a non-merchant user sees the "Merchant account required" error. Report anything not exercised.

---

## Final verification (after Task 5)

- [ ] `pnpm typecheck` (builds packages, then typechecks everything) — expect clean.
- [ ] `pnpm exec biome check .` on changed paths — expect clean.
- [ ] `pnpm --filter @aivastra/api test:unit` and the three integration files `merchant-analytics`, `merchant-tryon`, `merchant-tryon-history` — expect all pass.
- [ ] Note in `docs/progress.md` (newest first): what shipped, that product rankings start at the first deploy (no backfill), and that the Customers block is a placeholder pending the step 2 spec.

## Self-review against the spec

- Overview cards, donut, Top 10, change vs previous period: Task 4 (data) + Task 5 (UI).
- Item-id gap and the "since" note: Task 2 + `breakdownSince` in Task 4 + note in Task 5.
- COMPLETED-only, tenant isolation, ties, Other folding, top-10 cap, empty nulls: Task 3 + Task 4 tests.
- Customers block "Coming soon": Task 5.
- 1920 layout with 1280 fallback: Task 5 + manual check.
- Spec deviations to record: "least tried" is `null` when fewer than 2 products ranked (added here to avoid showing the same product twice), and items deleted after a try-on are omitted from breakdowns. Add both lines to the spec's Data section when executing.
- Spec's web render test is replaced by typecheck, lint and the manual check, because `apps/catalogues-web` has no test runner.
