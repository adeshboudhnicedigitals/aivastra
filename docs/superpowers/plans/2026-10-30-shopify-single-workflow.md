# Shopify Single Workflow Implementation Plan (sub-project 1 of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every Shopify try-on runs one admin-selected workflow; baskets, routing rules and per-product pins are removed from code; onboarding page 1 imports with a progress bar and continues.

**Architecture:** The workflow id lives in the admin system config (Redis `config:system`, top-level key `shopifyWorkflowTemplateId`). The API resolves it at job creation and pins it into `job_inputs.params.workflowTemplateId` exactly as today, so the dispatcher is untouched. A release-1 shim falls back to the one workflow that all active funnel templates share, when the config value is unset and that workflow is unambiguous. Funnel tables and the `shopify_product_garments` funnel columns stay in the DB (dormant) until release 2.

**Tech Stack:** Fastify 5 + Zod, Drizzle/Postgres, Redis, Vitest (integration via docker compose), React + Polaris (`apps/shopify`), React + `SearchableSelect` (`apps/admin-web`).

Spec: `docs/superpowers/specs/2026-10-30-shopify-single-workflow-design.md`.

## Spec amendments (decided while planning; the spec is updated in Task 10)

1. Config key is top-level `shopifyWorkflowTemplateId`, **not** `shopify.workflowTemplateId`. `PATCH /admin/config` does a shallow `{...cur, ...body}`, so a body of `shopify: {...}` replaces the whole `shopify` object. `ShopifyCreditsTab` sends `shopify: { trialCredits, packCredits }` and would erase a nested workflow id (and the new picker would erase the credits). A separate top-level key avoids the clobber.
2. `workflows.routes.ts` funnel counts and `workflow-mapping-reassign.ts` funnel handling **stay** in release 1: dormant funnel rows still hold FKs to `workflow_templates`, so deleting a workflow they reference would still fail. They are removed in release 2 with the tables. What release 1 **adds** is protection for the new config pointer (Task 3).
3. The spec's shim ("default basket's workflow") is impossible: migration `0200_tense_maverick.sql` dropped `shopify_funnel_templates.is_default`, and the Drizzle schema has no such column. The shim is instead: when the config value is unset, use the workflow that **all active funnel templates point at**, if there is exactly one distinct workflow; otherwise refuse until the admin chooses. Deterministic, never picks arbitrarily.
4. `analyticsFunnel` / `AnalyticsPage` "funnel" is the **conversion** funnel (views → try-ons), unrelated to baskets. Do not touch it. There is no per-basket analytics breakdown to remove.

## Global Constraints

- Never run schema or migration work against production or `tryon_prod`. This plan has **no migration** (release 1).
- pnpm only. ESM only. Package names: `@aivastra/api`, `@aivastra/admin` (apps/admin-web), `@aivastra/shopify-admin` (apps/shopify).
- No `console.log`; match surrounding comment density, comment the *why*.
- Admin dropdowns use `SearchableSelect` (`apps/admin-web/src/components/SearchableSelect.tsx`); Shopify app uses Polaris. Never a raw `<select>`.
- API tests: `pnpm --filter @aivastra/api test` is unit only. Integration: from `apps/api`, `npx vitest run --config vitest.integration.config.ts <pattern>`; needs `pnpm docker:up` running.
- Secrets: never print a credential value.
- Do not commit or push beyond the per-task commits below. Never `git add -A` / `git add .`, `git stash`, `git checkout`, `git reset`, or `git commit -a` (see Parallel protocol).

## Parallel execution protocol (four plans share branch `feat/shopify-simplification`)

Sub-projects 2 (contact phone), 3 (login required) and 4 (theme block) run at the same time in the same working tree. Rules for every agent:

- **Stage explicit paths only** (`git add <path> <path>`), and commit only files your task lists. Other agents' half-finished edits are in the tree; never stage them.
- **Re-read a file immediately before editing it.** Use `Edit` (exact-string hunks), never rewrite a whole shared file from memory.
- **Shared files** (edit only the hunks your task names): `apps/api/src/modules/shopify/customer.routes.ts` (this plan: Task 2; plan 3: login enforcement; plan 4: `enabled` query source), `apps/api/src/modules/shopify/onboarding.routes.ts` (this plan: Task 5 `/complete`; plan 2: contact; plan 4: theme-seen and deep links), `apps/shopify/src/types.ts`, `apps/shopify/src/lib/onboarding.ts` (this plan owns it), `apps/shopify/src/App.tsx`.
- **Typecheck/test failures in files outside your task are not yours.** Scope runs to your own files; if the failing file belongs to another plan, note it in your report and continue. Run the full-repo gate only in Task 11.
- This plan owns removal of `RoutingPage`, `ManagePage` basket code and `Dashboard` unrouted warnings; plans 2–4 must not touch those sections.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `packages/types/src/admin.ts` | modify | add `shopifyWorkflowTemplateId` to `SystemConfigBody` |
| `apps/api/src/lib/resolution-config.ts` | modify | `getShopifyWorkflowTemplateId(app)` |
| `apps/api/src/modules/admin/config.routes.ts` | modify | GET returns the key |
| `apps/api/src/modules/shopify/workflow.ts` | create | `resolveShopifyWorkflow(app)` (config + shim) |
| `apps/api/src/modules/shopify/customer.routes.ts` | modify | use resolver instead of `resolveBasket` |
| `apps/api/src/modules/admin/workflow-mapping-reassign.ts`, `workflows.routes.ts` | modify | protect the config pointer |
| `apps/api/src/modules/shopify/service.ts`, `routes.ts` | modify | sync status carries `total` and `imported` |
| `apps/api/src/modules/shopify/onboarding.routes.ts` | modify | `/complete` sets global mode on first completion |
| `apps/api/src/modules/shopify/me.routes.ts`, `activation.routes.ts`, `products.routes.ts`, `products.bulk.ts`, `webhook.routes.ts`, `products.sync.ts`, `activation.ts` | modify | strip basket/unrouted code |
| `apps/api/src/modules/shopify/funnel-resolution.ts`, `funnel-rules.routes.ts`, `apps/api/src/modules/admin/shopify-funnel*.routes.ts`, `server.ts` | delete / modify | remove funnel API |
| `apps/admin-web/src/pages/ShopifyWorkflowPage.tsx` | create | the single "Shopify workflow" picker |
| `apps/admin-web/src/pages/ShopifyFunnelsPage.tsx`, `components/BasketImageField.tsx` | delete | |
| `apps/admin-web/src/App.tsx`, `components/Sidebar.tsx` | modify | route + sidebar swap |
| `apps/shopify/src/lib/onboarding.ts` | rewrite | step logic without baskets |
| `apps/shopify/src/pages/OnboardingProductsPage.tsx` | rewrite | import + progress bar + Continue |
| `apps/shopify/src/pages/RoutingPage.tsx`, `components/onboarding/*Stage.tsx`, `lib/baskets.ts`, `lib/productSelection.ts`, `lib/productBaskets.test.ts` | delete | |
| `apps/shopify/src/pages/ManagePage.tsx`, `DashboardPage.tsx`, `App.tsx`, `types.ts` | modify | strip basket UI |

---

### Task 1: Config key and workflow resolver

**Files:**
- Modify: `packages/types/src/admin.ts` (inside `SystemConfigBody`, after the `shopify` object ends)
- Modify: `apps/api/src/lib/resolution-config.ts` (append after `getShopifyTrialCredits`)
- Modify: `apps/api/src/modules/admin/config.routes.ts` (the `GET /admin/config` handler)
- Create: `apps/api/src/modules/shopify/workflow.ts`
- Test: `apps/api/test/integration/shopify-workflow-resolver.test.ts`

**Interfaces:**
- Produces: `getShopifyWorkflowTemplateId(app: FastifyInstance): Promise<string | null>` in `resolution-config.ts`.
- Produces: `resolveShopifyWorkflow(app: FastifyInstance): Promise<ResolvedShopifyWorkflow | null>` in `workflow.ts` where
  `interface ResolvedShopifyWorkflow { workflowTemplateId: string; workflowTemplateVersion: number | null; source: 'config' | 'sole_basket_workflow' }`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/integration/shopify-workflow-resolver.test.ts`:

```ts
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resolveShopifyWorkflow } from '../../src/modules/shopify/workflow.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

const CONFIG_KEY = 'config:system';

describe('resolveShopifyWorkflow', () => {
  let c: Containers;
  let app: TestApp;
  let wfA: string;
  let wfB: string;

  async function seedWorkflow(slug: string, isActive = true) {
    const [wf] = await app.db
      .insert(schema.workflowTemplates)
      .values({
        slug,
        label: slug,
        jsonContent: {},
        poseNodeId: '2',
        upperNodeIds: ['4'],
        garmentPhasePromptNode: '6',
        workflowType: 'tryon',
        tryonPersonNodeId: '10',
        tryonGarmentNodeId: '11',
        tryonOutputNodeId: '12',
        isActive,
      })
      .returning();
    return wf.id;
  }

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
    wfA = await seedWorkflow(`swf-a-${Date.now()}`);
    wfB = await seedWorkflow(`swf-b-${Date.now()}`);
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await c.stop();
  });

  beforeEach(async () => {
    await app.redis.del(CONFIG_KEY);
    await app.db.delete(schema.shopifyFunnelTemplates);
  });

  it('returns the configured workflow', async () => {
    await app.redis.set(CONFIG_KEY, JSON.stringify({ shopifyWorkflowTemplateId: wfA }));
    const r = await resolveShopifyWorkflow(app);
    expect(r).toMatchObject({ workflowTemplateId: wfA, source: 'config' });
    expect(r?.workflowTemplateVersion).toBeTypeOf('number');
  });

  it('returns null when the configured workflow is inactive', async () => {
    const inactive = await seedWorkflow(`swf-off-${Date.now()}`, false);
    await app.redis.set(CONFIG_KEY, JSON.stringify({ shopifyWorkflowTemplateId: inactive }));
    expect(await resolveShopifyWorkflow(app)).toBeNull();
  });

  it('returns null when the configured workflow does not exist', async () => {
    await app.redis.set(
      CONFIG_KEY,
      JSON.stringify({ shopifyWorkflowTemplateId: '00000000-0000-4000-8000-000000000000' }),
    );
    expect(await resolveShopifyWorkflow(app)).toBeNull();
  });

  async function seedBasket(workflowTemplateId: string, isActive = true) {
    await app.db.insert(schema.shopifyFunnelTemplates).values({
      slug: `swf-basket-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      label: 'Basket',
      workflowTemplateId,
      isActive,
    });
  }

  it('shim: unset config uses the workflow every active funnel template shares', async () => {
    await seedBasket(wfB);
    await seedBasket(wfB);
    const r = await resolveShopifyWorkflow(app);
    expect(r).toMatchObject({ workflowTemplateId: wfB, source: 'sole_basket_workflow' });
  });

  it('shim: ignores inactive funnel templates when counting distinct workflows', async () => {
    await seedBasket(wfB);
    await seedBasket(wfA, false);
    expect((await resolveShopifyWorkflow(app))?.workflowTemplateId).toBe(wfB);
  });

  it('shim: refuses when active funnel templates disagree', async () => {
    await seedBasket(wfA);
    await seedBasket(wfB);
    expect(await resolveShopifyWorkflow(app)).toBeNull();
  });

  it('config wins over the funnel templates', async () => {
    await seedBasket(wfB);
    await app.redis.set(CONFIG_KEY, JSON.stringify({ shopifyWorkflowTemplateId: wfA }));
    expect((await resolveShopifyWorkflow(app))?.workflowTemplateId).toBe(wfA);
  });

  it('returns null when nothing is configured and there are no funnel templates', async () => {
    expect(await resolveShopifyWorkflow(app)).toBeNull();
  });
});
```

The teardown calls (`app.close()`, `c.stop()`) match `shopify-basket-routing.test.ts`. Note: `shopify_funnel_templates.is_default` was dropped by migration 0200 and must not be referenced.

- [ ] **Step 2: Run to verify it fails**

Run (from `apps/api`): `npx vitest run --config vitest.integration.config.ts shopify-workflow-resolver`
Expected: FAIL, cannot resolve `../../src/modules/shopify/workflow.js`.

- [ ] **Step 3: Implement**

`packages/types/src/admin.ts`, inside `SystemConfigBody` after the `shopify: z.object({...}).optional(),` block, add:

```ts
  // Chosen from the admin "Shopify workflow" page. A top-level key (not inside
  // `shopify`) because PATCH /admin/config replaces whole top-level objects, so
  // the credits tab's `shopify` write would otherwise erase it.
  shopifyWorkflowTemplateId: z.string().uuid().nullable().optional(),
```

`apps/api/src/lib/resolution-config.ts`, after `getShopifyTrialCredits`:

```ts
/**
 * The single workflow every Shopify try-on runs, as chosen in the admin panel.
 * Null when unset or the stored value is malformed; the caller decides whether
 * that refuses try-on or falls back (see modules/shopify/workflow.ts).
 */
export async function getShopifyWorkflowTemplateId(app: FastifyInstance): Promise<string | null> {
  try {
    const raw = await app.redis.get(CONFIG_KEY);
    const cfg = raw ? JSON.parse(raw) : {};
    const id = cfg.shopifyWorkflowTemplateId;
    return typeof id === 'string' && id.length > 0 ? id : null;
  } catch {
    return null;
  }
}
```

`apps/api/src/modules/admin/config.routes.ts`, in `GET /admin/config`, after the `cfg.shopify = {...};` assignment add:

```ts
    cfg.shopifyWorkflowTemplateId = cfg.shopifyWorkflowTemplateId ?? null;
```

Create `apps/api/src/modules/shopify/workflow.ts`:

```ts
import { schema } from '@aivastra/db';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { getShopifyWorkflowTemplateId } from '../../lib/resolution-config.js';

export interface ResolvedShopifyWorkflow {
  workflowTemplateId: string;
  workflowTemplateVersion: number | null;
  source: 'config' | 'sole_basket_workflow';
}

async function activeWorkflow(app: FastifyInstance, id: string) {
  const [row] = await app.db
    .select({ id: schema.workflowTemplates.id, version: schema.workflowTemplates.version })
    .from(schema.workflowTemplates)
    .where(and(eq(schema.workflowTemplates.id, id), eq(schema.workflowTemplates.isActive, true)))
    .limit(1);
  return row ?? null;
}

/**
 * The one workflow every Shopify try-on runs. Resolved by the API at job
 * creation and pinned into job_inputs.params, so a change made after a job was
 * charged never alters what that job runs.
 *
 * Null means "refuse before the credit deduct": enqueueing would burn a credit
 * on a job that can only fail NO_WORKFLOW_CONFIGURED, which no merchant can fix.
 *
 * RELEASE-1 SHIM: until the admin has chosen a workflow, use the one workflow
 * all active funnel templates share, so deploying this does not refuse every
 * Shopify try-on in the gap before the admin acts. Deleted in release 2 along
 * with the funnel tables.
 */
export async function resolveShopifyWorkflow(
  app: FastifyInstance,
): Promise<ResolvedShopifyWorkflow | null> {
  const configuredId = await getShopifyWorkflowTemplateId(app);
  if (configuredId) {
    // A configured-but-unusable workflow refuses; it must not silently fall
    // back to a different one than the admin chose.
    const wf = await activeWorkflow(app, configuredId);
    return wf
      ? { workflowTemplateId: wf.id, workflowTemplateVersion: wf.version ?? null, source: 'config' }
      : null;
  }

  // Shim: one distinct workflow across all active baskets is unambiguous. More
  // than one means the old routing picked per product, so there is no single
  // answer to infer; refuse until the admin chooses.
  const distinct = await app.db
    .selectDistinct({ workflowTemplateId: schema.shopifyFunnelTemplates.workflowTemplateId })
    .from(schema.shopifyFunnelTemplates)
    .where(eq(schema.shopifyFunnelTemplates.isActive, true));
  if (distinct.length !== 1) return null;
  const wf = await activeWorkflow(app, distinct[0].workflowTemplateId);
  return wf
    ? {
        workflowTemplateId: wf.id,
        workflowTemplateVersion: wf.version ?? null,
        source: 'sole_basket_workflow',
      }
    : null;
}
```

If `schema.workflowTemplates` has no `isActive` column name, use the actual one (`grep -n isActive packages/db/src/schema/*.ts | grep -i workflow`); the admin list endpoint returns `isActive: r.isActive`, so it exists.

- [ ] **Step 4: Run to verify it passes**

Run (from `apps/api`): `npx vitest run --config vitest.integration.config.ts shopify-workflow-resolver`
Expected: 8 passed. Then `pnpm --filter @aivastra/types build` if the API resolves types from `dist` (check how other tasks consume it: `grep -n '"main"\|"types"' packages/types/package.json`).

- [ ] **Step 5: Commit**

```bash
git add packages/types/src/admin.ts apps/api/src/lib/resolution-config.ts apps/api/src/modules/admin/config.routes.ts apps/api/src/modules/shopify/workflow.ts apps/api/test/integration/shopify-workflow-resolver.test.ts
git commit -m "feat(shopify): single admin-selected workflow resolver with release-1 shim"
```

---

### Task 2: Use the resolver in try-on creation and the `enabled` endpoint

**Files:**
- Modify: `apps/api/src/modules/shopify/customer.routes.ts` (import line 27; try-on block ~lines 360-380 and ~467; `enabled` handler ~lines 620-670)
- Test: update `apps/api/test/integration/shopify-basket-routing.test.ts` (rename to `shopify-single-workflow.test.ts`), then fix the other tests that seed baskets for customer flows (`shopify-customer.test.ts`, `shopify-refusal-events.test.ts`, `shopify-limits.test.ts`, `shopify-product-basket.test.ts`)

**Interfaces:**
- Consumes: `resolveShopifyWorkflow` from Task 1.
- Produces: try-on jobs pin `params.workflowTemplateId` = configured workflow; `dispatchTemplateVersion` = its version.

- [ ] **Step 1: Rewrite the routing test as a single-workflow test (failing first)**

`git mv apps/api/test/integration/shopify-basket-routing.test.ts apps/api/test/integration/shopify-single-workflow.test.ts`. Keep its `seedStore`/`seedGarment` helpers and the request plumbing; replace the basket/rule seeding and cases with these three cases (set the workflow with `await app.redis.set('config:system', JSON.stringify({ shopifyWorkflowTemplateId: wf }))`):

1. product with no funnel data and a configured workflow → 200/202-accepted response exactly as the existing "routes to default" case, and the created `job_inputs.params.workflowTemplateId` equals the configured id and `dispatchTemplateVersion` equals the workflow's `version`.
2. two products with different `productType`/tags both pin the **same** configured workflow (proves routing is gone).
3. no config and no funnel templates → HTTP 202 with message `This product is not available for try-on right now.`, **no job row created, no credit deducted** (assert `shopifyStoreCredits` balance unchanged).

Run: `npx vitest run --config vitest.integration.config.ts shopify-single-workflow` → FAIL (still routes by basket).

- [ ] **Step 2: Implement in `customer.routes.ts`**

Replace `import { resolveBasket } from './funnel-resolution.js';` with `import { resolveShopifyWorkflow } from './workflow.js';`.

Try-on creation, replace the `const resolvedBasket = await resolveBasket(...)` through `const workflowTemplateId = resolvedBasket.workflowTemplateId;` block with:

```ts
      const resolvedWorkflow = await resolveShopifyWorkflow(app);
      if (!resolvedWorkflow) {
        // No workflow chosen (or the chosen one is inactive). An admin-fixable
        // state, not a merchant one. Still refuse before the deduct: enqueueing
        // would burn a credit and produce a FAILED row with NO_WORKFLOW_CONFIGURED.
        app.log.warn(
          { storeId, shopifyProductId, garmentId: garment.id },
          'shopify try-on blocked before enqueue: no Shopify workflow configured or it is inactive',
        );
        return reply
          .code(202)
          .send({ message: 'This product is not available for try-on right now.' });
      }
      const workflowTemplateId = resolvedWorkflow.workflowTemplateId;
```

and change `dispatchTemplateVersion: resolvedBasket.workflowTemplateVersion,` to `dispatchTemplateVersion: resolvedWorkflow.workflowTemplateVersion,`. Update the nearby comment "Resolved above and pinned here..." to say "a workflow change mid-flight can't change..." (no "rule").

`enabled` handler: remove `funnelTemplateId`, `productType`, `tags`, `vendor`, `collections`, `title` from the garment `select` (keep `enabled`, `excluded`), and replace the `if (enabled && garment) { const resolvedBasket = ... }` block (including its explanatory comment) with:

```ts
      // Synced and effectively enabled: also require a usable workflow, matching
      // the try-on-creation refusal. A never-synced product (no row) skips this:
      // that path re-queues a sync and tells the shopper to check back.
      if (enabled && garment && !(await resolveShopifyWorkflow(app))) enabled = false;
```

- [ ] **Step 3: Run the new test and fix the older customer tests**

Run: `npx vitest run --config vitest.integration.config.ts shopify-single-workflow` → PASS (3).
Then run `shopify-customer`, `shopify-refusal-events`, `shopify-limits`, `shopify-product-basket`, `shopify-analytics`, `shopify-me`: each seeds funnel baskets/rules to make try-on possible. Replace that seeding with `app.redis.set('config:system', JSON.stringify({ shopifyWorkflowTemplateId: <seeded workflow id> }))` in the same `beforeAll`/`beforeEach`. Delete cases whose only subject is per-product/rule routing (e.g. "unrouted product refused", "pin beats rule"); `shopify-product-basket.test.ts` tests pinning and is deleted in Task 6. Keep every non-routing assertion.
Expected: all pass. Report any failure that is not basket-related instead of editing around it.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/shopify/customer.routes.ts apps/api/test/integration
git commit -m "feat(shopify): run the single configured workflow for every try-on"
```

(`git add apps/api/test/integration` is acceptable here because plans 2–4 add no files under that directory that this task has not seen; if `git status` shows foreign test files, stage by explicit name instead.)

---

### Task 3: Protect the config pointer when a workflow is replaced or deleted

**Files:**
- Modify: `apps/api/src/modules/admin/workflow-mapping-reassign.ts`
- Modify: `apps/api/src/modules/admin/workflows.routes.ts` (delete handler ~line 2140 and the usage/blocking summary ~lines 1548 and 1976)
- Test: `apps/api/test/integration/shopify-workflow-pointer.test.ts`

**Interfaces:**
- Consumes: `getShopifyWorkflowTemplateId` (Task 1), config key `config:system`.
- Produces: `reassignWorkflowMappings` also moves `shopifyWorkflowTemplateId` from `fromId` to `toId`; workflow delete refuses with a clear message while the workflow is the configured Shopify workflow.

- [ ] **Step 1: Read, then write the failing test**

Read `workflow-mapping-reassign.ts` fully (it takes a `tx` and returns counts; the funnel move is step 8 at ~line 163) and the delete handler in `workflows.routes.ts` (~2140-2160, the `funnelCount > 0` refusal). The reassign function runs inside a Postgres transaction but the config is in Redis, so the pointer move must happen **after commit** at the caller (`workflow-change-requests.routes.ts` ~line 264 and the replace route). Find every caller: `grep -rn "reassignWorkflowMappings" apps/api/src`.

Write `shopify-workflow-pointer.test.ts` covering: (a) replacing workflow A with B updates `config:system.shopifyWorkflowTemplateId` from A to B and leaves it alone when it pointed at C; (b) `DELETE /admin/workflows/:id` for the configured workflow returns 409 (or the status the funnel refusal uses) with a message containing "Shopify workflow"; (c) deleting an unrelated workflow still works. Use the admin test helpers in `apps/api/test/helpers/admin.ts`.

Run: expected FAIL.

- [ ] **Step 2: Implement**

Add to `apps/api/src/lib/resolution-config.ts`:

```ts
/**
 * Repoints the Shopify workflow when the workflow it names is replaced. Called
 * after the replacing transaction commits (config lives in Redis, not Postgres).
 * A no-op when the pointer names some other workflow.
 */
export async function repointShopifyWorkflow(
  app: FastifyInstance,
  fromId: string,
  toId: string,
): Promise<boolean> {
  const raw = await app.redis.get(CONFIG_KEY);
  const cfg = raw ? JSON.parse(raw) : {};
  if (cfg.shopifyWorkflowTemplateId !== fromId) return false;
  cfg.shopifyWorkflowTemplateId = toId;
  await app.redis.set(CONFIG_KEY, JSON.stringify(cfg));
  return true;
}
```

Call `repointShopifyWorkflow(app, fromId, toId)` at each caller of the reassign, after its transaction resolves, and log `app.log.info({ fromId, toId }, 'shopify workflow repointed after replace')` when it returns true. In the delete handler, before the funnel refusal, add:

```ts
        if ((await getShopifyWorkflowTemplateId(app)) === id) {
          throw new AppError(
            'CONFLICT',
            409,
            'Cannot delete: this is the workflow every Shopify try-on runs. Choose another on the Shopify workflow page first.',
          );
        }
```

(use the same `AppError` code string the neighbouring funnel refusal uses; `grep -n "AppError(" apps/api/src/modules/admin/workflows.routes.ts | head`). Do **not** remove the `funnelCount` guards (amendment 2).

- [ ] **Step 3: Run test to pass, then commit**

Run: `npx vitest run --config vitest.integration.config.ts shopify-workflow-pointer admin-workflow` → PASS.

```bash
git add apps/api/src/lib/resolution-config.ts apps/api/src/modules/admin apps/api/test/integration/shopify-workflow-pointer.test.ts
git commit -m "feat(shopify): keep the Shopify workflow pointer valid across workflow replace and delete"
```

(Stage `apps/api/src/modules/admin` only after `git status` shows no other plan's files there; otherwise list files explicitly.)

---

### Task 4: Sync status carries `total` and `imported`

**Files:**
- Modify: `apps/api/src/modules/shopify/service.ts` (`ProductSyncStatus`, `markProductSyncRunning`)
- Modify: `apps/api/src/modules/shopify/activation.routes.ts` (export `fetchTotalProductCount`)
- Modify: `apps/api/src/modules/shopify/routes.ts` (the `POST /products/sync` and `GET /products/sync/status` handlers)
- Test: `apps/api/test/integration/shopify-sync-status.test.ts`

**Interfaces:**
- Produces: `ProductSyncStatus` gains `total: number | null`. `GET /v1/shopify/products/sync/status` returns `{ state, startedAt, completedAt, total: number | null, imported: number }` where `imported` = non-deleted garment rows with `syncedAt >= startedAt`, capped at `total` when `total` is known.
- `markProductSyncRunning(redis, storeId, total: number | null = null)`.

- [ ] **Step 1: Failing test**

Test via the Shopify session helper (`apps/api/test/helpers/shopify-session.ts`; mirror how `shopify-me.test.ts` authenticates): seed a store, write a status key with `markProductSyncRunning(app.redis, storeId, 50)`, insert 3 garment rows with `syncedAt` after `startedAt` and 2 before, call `GET /v1/shopify/products/sync/status`, expect `{ state: 'running', total: 50, imported: 3 }`. Second case: `total: null` and 0 rows → `imported: 0`, `total: null`. Third: 60 fresh rows with `total: 50` → `imported: 50` (cap).
Run: FAIL (no `total`/`imported`).

- [ ] **Step 2: Implement**

`service.ts`:

```ts
export interface ProductSyncStatus {
  state: 'running' | 'idle';
  startedAt: number;
  completedAt: number | null;
  /** Shopify's product count when the run started; null if that lookup failed. */
  total: number | null;
}
```

`markProductSyncRunning(redis, storeId, total: number | null = null)` builds `{ state: 'running', startedAt: Date.now(), completedAt: null, total }`. `markProductSyncIdle` keeps `total` from the stored value (`(JSON.parse(raw) as ProductSyncStatus).total ?? null`) and the no-key branches of `getProductSyncStatus` return `total: null`.

`activation.routes.ts`: change `async function fetchTotalProductCount(` to `export async function fetchTotalProductCount(`.

`routes.ts` POST handler: before `markProductSyncRunning`, add

```ts
      // Best effort: the progress bar degrades to indeterminate without a total.
      const total = await fetchTotalProductCount(app, store);
      await markProductSyncRunning(app.redis, store.id, total);
```

(importing `fetchTotalProductCount` from `./activation.routes.js`; remove the old bare call). GET handler becomes:

```ts
      const status = await getProductSyncStatus(app.redis, store.id);
      // Rows this run has touched: syncedAt moves on every upsert, so counting
      // from startedAt gives per-run progress even on a re-sync of known rows.
      const [{ imported }] = await app.db
        .select({ imported: count() })
        .from(schema.shopifyProductGarments)
        .where(
          and(
            eq(schema.shopifyProductGarments.storeId, store.id),
            ne(schema.shopifyProductGarments.status, 'deleted'),
            gte(schema.shopifyProductGarments.syncedAt, new Date(status.startedAt)),
          ),
        );
      return {
        ...status,
        imported: status.total == null ? imported : Math.min(imported, status.total),
      };
```

Add `count, gte, ne, and, eq` to the drizzle import in `routes.ts` as needed. Verify `upsertGarment` in `products.sync.ts` (~line 168) sets `syncedAt` on update (`grep -n syncedAt apps/api/src/modules/shopify/products.sync.ts`); if the conflict-update branch does not set it, add `syncedAt: new Date()` there so re-syncs report progress.

- [ ] **Step 3: Run test to pass, then commit**

Run: `npx vitest run --config vitest.integration.config.ts shopify-sync-status shopify-products` → PASS.

```bash
git add apps/api/src/modules/shopify/service.ts apps/api/src/modules/shopify/activation.routes.ts apps/api/src/modules/shopify/routes.ts apps/api/src/modules/shopify/products.sync.ts apps/api/test/integration/shopify-sync-status.test.ts
git commit -m "feat(shopify): sync status reports total and imported counts"
```

---

### Task 5: Global mode on first completion; strip basket data from the API

**Files:**
- Modify: `apps/api/src/modules/shopify/onboarding.routes.ts` (`/complete` handler only)
- Modify: `apps/api/src/modules/shopify/me.routes.ts`, `activation.routes.ts`, `products.routes.ts`, `products.bulk.ts`, `webhook.routes.ts`, `products.sync.ts` (comment at ~589), `activation.ts` (comment at ~84)
- Test: `apps/api/test/integration/shopify-onboarding.test.ts`, `shopify-me.test.ts`, `shopify-products-bulk.test.ts`, `shopify-activation-routes.test.ts`, `shopify-webhooks.test.ts`

**Interfaces:**
- Produces: `POST /v1/shopify/onboarding/complete` sets `settings.activation.mode = 'global'` only when `onboardingCompletedOnce` was not already true. `/v1/shopify/me` no longer returns `stats.unroutedEnabledCount`; `enabledProductCount` = `computeEnabledProductCount` raw. Product list items no longer carry `basket`/`pinnedBasketId`; PATCH and bulk no longer accept `funnelTemplateId`. `activation` summary `tryonEnabledProducts` = raw `countEffectivelyEnabled`.

- [ ] **Step 1: Failing tests**

In `shopify-onboarding.test.ts` add: (a) first `/complete` call on a store whose `settings` has no `onboardingCompletedOnce` → response `settings.activation.mode === 'global'` and `onboardingCompletedOnce === true`; (b) a store that already completed once with `activation.mode = 'selective'` → `/complete` leaves mode `selective`; (c) a first completion where the store already has `activation.mode = 'selective'` explicitly set stays `selective` (do not override a merchant's choice). Update `shopify-me.test.ts` to assert `unroutedEnabledCount` is absent. Update `shopify-products-bulk.test.ts` to drop `funnelTemplateId` cases and assert a body of only `{ funnelTemplateId: ... }` is rejected 400.
Run → FAIL.

- [ ] **Step 2: Implement**

`/complete` handler body:

```ts
      const store = req.shopifyStore as typeof schema.shopifyStores.$inferSelect;
      const firstCompletion = !(store.settings.onboardingCompletedOnce ?? false);
      // Baskets are gone, so a finished onboarding means "try-on is on for the
      // catalogue". Only on the first completion, and never over a mode the
      // merchant already chose, so re-running the wizard cannot flip it back.
      const withActivation =
        firstCompletion && !store.settings.activation?.mode
          ? mergeStoreSettingsObject(storeSettingsJson(), ['activation'], { mode: 'global' })
          : storeSettingsJson();
      const settings = mergeStoreSettingsObject(withActivation, [], {
        onboardingCompletedOnce: true,
      });
```

`me.routes.ts`: delete the `countUnroutedProducts` import and everything between the "Subtract products that are effectively enabled but resolve to no basket" comment and `unroutedEnabledCount` assignment; set `const enabledProductCount = await computeEnabledProductCount(app, store);`; remove `unroutedEnabledCount,` from the returned `stats`.
`activation.routes.ts`: delete the import, the unrouted comment block and the subtraction; `const tryonEnabledProducts = await countEffectivelyEnabled(app, store);`.
`products.routes.ts`: remove `funnelTemplateId` from the PATCH schema/refine message (message becomes `'at least one of enabled, excluded, or garmentImageUrl is required'`), the PATCH handler's basket lookup block (~269-286), and in the list handler the `loadRuleSet`/`resolveBasketFrom` use plus `basket`/`pinnedBasketId` fields and `funnelTemplateId` select. Remove the now-unused imports.
`products.bulk.ts`: remove `funnelTemplateId` from the body schema (refine becomes `b.enabled !== undefined` with message `'enabled is required'`), the basket-validation block (~46-59) and the patch assignments (~100-102).
`webhook.routes.ts`: remove the `loadRuleSet, ruleSetReferencesCollectionTitle` import and the block that re-syncs products when a rule references a renamed collection title (read the surrounding handler first; keep the collection-membership resync itself).
`products.sync.ts` ~589 and `activation.ts` ~84: reword comments that mention routing/funnel-resolution so they no longer cite deleted code.

Run `pnpm --filter @aivastra/api typecheck`: expect remaining errors **only** in files Task 6 deletes (funnel files, funnel tests). Fix anything else.

- [ ] **Step 3: Run tests to pass, then commit**

Run: `npx vitest run --config vitest.integration.config.ts shopify-onboarding shopify-me shopify-products-bulk shopify-activation-routes shopify-webhooks` → PASS.

```bash
git add apps/api/src/modules/shopify/onboarding.routes.ts apps/api/src/modules/shopify/me.routes.ts apps/api/src/modules/shopify/activation.routes.ts apps/api/src/modules/shopify/products.routes.ts apps/api/src/modules/shopify/products.bulk.ts apps/api/src/modules/shopify/webhook.routes.ts apps/api/src/modules/shopify/products.sync.ts apps/api/src/modules/shopify/activation.ts apps/api/test/integration
git commit -m "feat(shopify): complete onboarding turns on global mode; drop basket data from API responses"
```

---

### Task 6: Delete the funnel API surface

**Files:**
- Delete: `apps/api/src/modules/shopify/funnel-resolution.ts`, `funnel-rules.routes.ts`, `apps/api/src/modules/admin/shopify-funnels.routes.ts`, `shopify-funnel-rules.routes.ts`
- Modify: `apps/api/src/server.ts` (imports at lines 57, 58, 106; registrations at ~451, 487, 488)
- Delete tests: `apps/api/test/shopify-funnel-resolution.test.ts`, `apps/api/test/integration/shopify-funnel-loader.test.ts`, `shopify-funnel-schema.test.ts`, `shopify-merchant-funnel-rules.test.ts`, `shopify-admin-funnel-rules.test.ts`, `shopify-product-basket.test.ts`, `apps/api/test/shopify-funnel-templates-admin.test.ts`, `apps/dispatcher/test/integration/shopify.test.ts` **only if** it exclusively tests funnels (otherwise prune its funnel cases)

- [ ] **Step 1: Confirm nothing live still imports them**

Run: `grep -rn "funnel-resolution\|funnel-rules.routes\|shopify-funnels.routes\|shopify-funnel-rules.routes" apps packages --include=*.ts --include=*.tsx | grep -v node_modules | grep -v dist`
Expected: only the files listed above and `server.ts`.

- [ ] **Step 2: Delete and unregister**

```bash
git rm apps/api/src/modules/shopify/funnel-resolution.ts apps/api/src/modules/shopify/funnel-rules.routes.ts apps/api/src/modules/admin/shopify-funnels.routes.ts apps/api/src/modules/admin/shopify-funnel-rules.routes.ts
```

Remove the three imports and the three `app.register(...)` lines (`shopifyFunnelRulesRoutes`, `adminShopifyFunnelsRoutes`, `adminShopifyFunnelRulesRoutes`) from `server.ts`. Leave `adminWhatsAppBasketsRoutes` (separate system).
For each listed test file: `git rm` it. For `apps/dispatcher/test/integration/shopify.test.ts` read it first; delete only funnel-specific cases and fixtures, keep job-flow cases (replace basket seeding with a direct `workflowTemplateId` in `params`, as production now does).

- [ ] **Step 3: Verify**

Run: `pnpm --filter @aivastra/api typecheck` → clean. `pnpm --filter @aivastra/dispatcher typecheck` → clean. `grep -rn "shopifyFunnel" apps/api/src apps/dispatcher/src --include=*.ts` → only `workflow.ts` (shim), `workflows.routes.ts`, `workflow-mapping-reassign.ts` (amendment 2).
Run: `pnpm --filter @aivastra/api test` → unit suite passes.

- [ ] **Step 4: Commit**

```bash
git add -A apps/api/src/server.ts apps/api/src/modules apps/api/test apps/dispatcher/test
git commit -m "refactor(shopify): remove funnel resolution, merchant rules and admin funnel routes"
```

(`-A` limited to these paths removes deletions; run `git status` first and confirm no other plan's files fall under them, else stage explicitly.)

---

### Task 7: Admin panel — one "Shopify workflow" picker

**Files:**
- Create: `apps/admin-web/src/pages/ShopifyWorkflowPage.tsx`
- Delete: `apps/admin-web/src/pages/ShopifyFunnelsPage.tsx`, `apps/admin-web/src/components/BasketImageField.tsx`
- Modify: `apps/admin-web/src/App.tsx` (import line 28, title map line 62, route line 280), `apps/admin-web/src/components/Sidebar.tsx` (lines ~92-97), `apps/admin-web/src/types.ts` line 139 only if `funnelCount` is unused after (it is still returned by the API; leave it)

**Interfaces:**
- Consumes: `GET /admin/workflows` (rows with `id, label, workflowType, isActive`), `GET /admin/config` (`shopifyWorkflowTemplateId`), `PATCH /admin/config` with `{ shopifyWorkflowTemplateId }`.

- [ ] **Step 1: Create the page**

Read `ShopifyFunnelsPage.tsx` top 20 lines and `apiFetch`/`apiErrorMessage` imports to copy the exact import paths and the `Props` type (`{ toast }`), then create `ShopifyWorkflowPage.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { SearchableSelect } from '../components/SearchableSelect';
import { apiErrorMessage, apiFetch } from '../api'; // use the same import paths as ShopifyFunnelsPage

interface WorkflowRow {
  id: string;
  label: string;
  workflowType: string;
  isActive: boolean;
}

interface Props {
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
}

export default function ShopifyWorkflowPage({ toast }: Props) {
  const [workflows, setWorkflows] = useState<WorkflowRow[]>([]);
  const [saved, setSaved] = useState('');
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      apiFetch<WorkflowRow[]>('/admin/workflows'),
      apiFetch<{ shopifyWorkflowTemplateId?: string | null }>('/admin/config'),
    ])
      .then(([rows, cfg]) => {
        setWorkflows(rows);
        const id = cfg.shopifyWorkflowTemplateId ?? '';
        setSaved(id);
        setSelected(id);
      })
      .catch((e) =>
        toast({
          kind: 'error',
          title: 'Failed to load Shopify workflow',
          body: apiErrorMessage(e, 'Please try again.'),
        }),
      )
      .finally(() => setLoading(false));
  }, [toast]);

  // Active workflows only, but keep the saved one visible even if it has since
  // gone inactive, so the page shows what Shopify is actually pointing at.
  const options = useMemo(
    () =>
      workflows
        .filter((w) => w.isActive || w.id === saved)
        .map((w) => ({
          id: w.id,
          label: `${w.label} (${w.workflowType})${w.isActive ? '' : ' — inactive'}`,
        })),
    [workflows, saved],
  );

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await apiFetch('/admin/config', {
        method: 'PATCH',
        body: JSON.stringify({ shopifyWorkflowTemplateId: selected }),
      });
      setSaved(selected);
      toast({ title: 'Shopify workflow saved' });
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to save Shopify workflow',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card settings-card">
      <div className="card-head">
        <h3>Shopify workflow</h3>
      </div>
      <div className="card-body">
        {loading ? (
          <div style={{ color: 'var(--muted)', fontSize: 13 }}>Loading…</div>
        ) : (
          <>
            <div className="setting-desc" style={{ marginBottom: 12 }}>
              Every Shopify try-on runs this workflow. Until one is chosen, try-ons use the
              previous default style's workflow.
            </div>
            <SearchableSelect
              ariaLabel="Shopify workflow"
              options={options}
              value={selected}
              onChange={setSelected}
              placeholder="Choose a workflow"
            />
            <div style={{ marginTop: 16 }}>
              <button
                type="button"
                className="btn primary"
                onClick={save}
                disabled={saving || !selected || selected === saved}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

Match the button class names and import paths to `ShopifyCreditsTab.tsx` (it uses `card settings-card` and a save button; copy its exact button markup).

- [ ] **Step 2: Swap routes and sidebar**

`App.tsx`: replace the import with `import ShopifyWorkflowPage from './pages/ShopifyWorkflowPage';`; title map entry `'shopify-workflow': 'Shopify workflow'` (replace `'shopify-funnels': 'Shopify'`); route lines:

```tsx
            <Route path="/shopify-workflow" element={<ShopifyWorkflowPage {...pageProps} />} />
            <Route path="/shopify-funnels" element={<Navigate to="/shopify-workflow" replace />} />
```

`Sidebar.tsx`: change the entry to `{ k: 'shopify-workflow', label: 'Shopify workflow', icon: Icon.Workflow, perm: 'config.write' }`. Confirm `config.write` is a permission string the sidebar's `perm` accepts (`grep -n "config.write" apps/admin-web/src`); if the sidebar uses a different key set, reuse `saree.write`'s mechanism with the nearest existing config permission.
`git rm` the two deleted files.

- [ ] **Step 3: Verify and commit**

Run: `pnpm --filter @aivastra/admin typecheck && pnpm --filter @aivastra/admin lint` → clean. `grep -rn "ShopifyFunnels\|BasketImageField\|shopify-funnels" apps/admin-web/src` → only the redirect route.

```bash
git add apps/admin-web/src/pages/ShopifyWorkflowPage.tsx apps/admin-web/src/App.tsx apps/admin-web/src/components/Sidebar.tsx
git commit -m "feat(admin): single Shopify workflow picker replaces the funnels page"
```

(Deleted files are staged by `git rm`; include them: `git add -u apps/admin-web/src/pages/ShopifyFunnelsPage.tsx apps/admin-web/src/components/BasketImageField.tsx`.)

---

### Task 8: Merchant app — onboarding step logic and page 1 progress bar

**Files:**
- Rewrite: `apps/shopify/src/lib/onboarding.ts`; update `apps/shopify/src/lib/onboarding.test.ts`
- Rewrite: `apps/shopify/src/pages/OnboardingProductsPage.tsx`
- Modify: `apps/shopify/src/types.ts` (remove `unroutedEnabledCount` at ~75-77; add `ShopifySyncStatus`)

**Interfaces:**
- Produces in `lib/onboarding.ts`: `isProductsDone(me)`, `getOnboardingStep(me)`, `canShowProductsPage(step)`, plus unchanged exports `PAGE_ORDER`, `STEP_PAGES`, `previousPagePath`, `onboardingPath`, `canShowThemePage`, `isTryOnOff`, `needsEmbedEnable`. `canShowPostBasketPage` is renamed `canShowPostProductsPage`. `isSelectionDone`, `isBasketsDone`, `unroutedWarningCount` are removed.
- `types.ts`: `export interface ShopifySyncStatus { state: 'running' | 'idle'; startedAt: number; completedAt: number | null; total: number | null; imported: number }`.

- [ ] **Step 1: Failing unit tests**

Rewrite `onboarding.test.ts` cases to the new rules (mirror its existing fixture helper for `ShopifyMe`):

- fresh store (0 synced, theme not confirmed) → `'intro'`
- synced > 0, theme not confirmed → `'theme'` (products step is done by import alone)
- synced > 0, theme confirmed → `null`
- 0 synced, theme confirmed → `'products'`
- `canShowProductsPage('intro')`, `('products')`, `('theme')` true; `(null)` false
- `canShowPostProductsPage('theme')` and `(null)` true; `('products')` false

Run: `pnpm --filter @aivastra/shopify-admin test -- onboarding` (confirm the script name in `apps/shopify/package.json`) → FAIL.

- [ ] **Step 2: Rewrite `lib/onboarding.ts` logic**

Replace the `isSelectionDone`, `isBasketsDone`, `getOnboardingStep`, `canShowProductsPage`, `canShowPostBasketPage`, `isTryOnOff`, `unroutedWarningCount` definitions with:

```ts
/** The catalogue has been imported. Product choice is gone: on first completion
 *  the API turns on global mode, so importing is the whole "products" step. */
export function isProductsDone(me: ShopifyMe): boolean {
  return me.stats.syncedProductCount > 0;
}

/**
 * The wizard's current step, or null once every step is done. Intro is shown
 * only on a genuinely fresh install (nothing synced, theme not confirmed); once
 * anything is started a resuming merchant jumps to the first incomplete step.
 */
export function getOnboardingStep(me: ShopifyMe): OnboardingStep | null {
  const themeDone = me.store.settings.themeBlockConfirmed ?? false;
  if (!isProductsDone(me) && !themeDone) return 'intro';
  if (!isProductsDone(me)) return 'products';
  if (!themeDone) return 'theme';
  return null;
}

/**
 * Whether the products page may render. 'theme' is allowed because finishing the
 * import flips the derived step to 'theme' at once, but the merchant should stay
 * on the page (showing "imported") until they press Continue.
 */
export function canShowProductsPage(step: OnboardingStep | null): boolean {
  return step === 'intro' || step === 'products' || step === 'theme';
}

/** Pages between the products page and the theme page (contact, limits). */
export function canShowPostProductsPage(step: OnboardingStep | null): boolean {
  return step === 'theme' || step === null;
}

/** Try-on is effectively off for the whole store: nothing is enabled. */
export function isTryOnOff(me: ShopifyMe): boolean {
  return me.stats.enabledProductCount === 0;
}
```

Keep `needsEmbedEnable`, `canShowThemePage`, `previousPagePath`, `onboardingPath`, `PAGE_ORDER`, `STEP_PAGES`, `OnboardingStep`, `OnboardingPage`, `StepPage` as they are. Update every importer of renamed/removed names (`grep -rn "canShowPostBasketPage\|isSelectionDone\|isBasketsDone\|unroutedWarningCount\|canShowProductsPage" apps/shopify/src`): `OnboardingContactPage.tsx` and `OnboardingLimitsPage.tsx` use `canShowPostBasketPage` → `canShowPostProductsPage` (a one-token edit in each; plans 2 and 3 edit other hunks of those files, so re-read before editing). Remove `unroutedEnabledCount` from `types.ts`.

- [ ] **Step 3: Rewrite `OnboardingProductsPage.tsx`**

Keep the existing sync-and-poll mechanics but poll `/v1/shopify/products/sync/status` into state for the bar, drop the picker, baskets and bulk save. Behaviour: on arrival with 0 synced, start sync; show Polaris `ProgressBar` with `imported / total`; when `total` is null show an indeterminate spinner with `imported` text; when idle and `syncedProductCount > 0`, show "N products imported" and enable Continue; Continue navigates to `/onboarding/contact` (no API call here). Full file:

```tsx
import { Banner, BlockStack, Button, Card, ProgressBar, Spinner, Text } from '@shopify/polaris';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ErrorBanner } from '../components/ErrorBanner';
import { OnboardingLayout } from '../components/OnboardingLayout';
import { apiFetch } from '../lib/api';
import { type ClassifiedError, classifyError } from '../lib/errors';
import { canShowProductsPage, getOnboardingStep, onboardingPath } from '../lib/onboarding';
import type { ShopifyMe, ShopifySyncStatus } from '../types';

const POLL_INTERVAL_MS = 1500;
const MAX_POLLS = 120; // ~3 minutes

export default function OnboardingProductsPage({
  me,
  onRefresh,
}: {
  me: ShopifyMe;
  onRefresh: () => Promise<ShopifyMe>;
}) {
  const navigate = useNavigate();
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState<{ imported: number; total: number | null }>({
    imported: 0,
    total: null,
  });
  const [error, setError] = useState<ClassifiedError | null>(null);
  const currentStep = getOnboardingStep(me);
  const syncStarted = useRef(false);

  const runSync = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      // The POST only enqueues (202); the import runs in a background consumer,
      // so poll the status until it goes idle before reading the product count.
      await apiFetch('/v1/shopify/products/sync', { method: 'POST' });
      let finished = false;
      for (let attempt = 0; attempt < MAX_POLLS && !finished; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        const status = await apiFetch<ShopifySyncStatus>('/v1/shopify/products/sync/status');
        setProgress({ imported: status.imported, total: status.total });
        finished = status.state === 'idle';
      }
      if (!finished) {
        throw new Error('Importing your products is taking longer than expected. Try again.');
      }
      await onRefresh();
    } catch (err) {
      setError(classifyError(err));
    } finally {
      setSyncing(false);
    }
  }, [onRefresh]);

  // Import on arrival when nothing is synced. The ref makes it run once: an
  // empty store (0 products after syncing) must not loop forever.
  useEffect(() => {
    if (me.stats.syncedProductCount === 0 && !syncStarted.current) {
      syncStarted.current = true;
      void runSync();
    }
  }, [me.stats.syncedProductCount, runSync]);

  if (!canShowProductsPage(currentStep)) {
    return <Navigate to={onboardingPath(currentStep)} replace />;
  }

  const imported = me.stats.syncedProductCount;
  const noProducts = !syncing && !error && syncStarted.current && imported === 0;
  const percent =
    progress.total && progress.total > 0
      ? Math.min(100, Math.round((progress.imported / progress.total) * 100))
      : 0;

  return (
    <OnboardingLayout
      bare
      page="products"
      heading="Importing your products"
      continueDisabled={syncing || imported === 0}
      continueLoading={false}
      onContinue={() => navigate('/onboarding/contact')}
    >
      <ErrorBanner
        error={error}
        onRetry={imported === 0 && !syncing ? runSync : undefined}
        onDismiss={() => setError(null)}
      />
      {syncing && (
        <Card>
          <BlockStack gap="300">
            {progress.total ? (
              <>
                <ProgressBar progress={percent} size="small" />
                <Text as="p" tone="subdued">
                  {Math.min(progress.imported, progress.total)}/{progress.total} products imported
                </Text>
              </>
            ) : (
              <BlockStack gap="200" inlineAlign="center">
                <Spinner accessibilityLabel="Importing your products" />
                <Text as="p" tone="subdued">
                  Importing your products from Shopify… {progress.imported} so far
                </Text>
              </BlockStack>
            )}
          </BlockStack>
        </Card>
      )}
      {noProducts && (
        <BlockStack gap="200">
          <Text as="p">
            We couldn't find any products in your store. Add products in Shopify, then try again.
          </Text>
          <div>
            <Button size="large" onClick={runSync}>
              Import again
            </Button>
          </div>
        </BlockStack>
      )}
      {!syncing && imported > 0 && (
        <Banner tone="success">
          {imported} product{imported === 1 ? '' : 's'} imported. Try-on will be on for all of
          them; you can exclude products later in Manage.
        </Banner>
      )}
    </OnboardingLayout>
  );
}
```

Check `OnboardingLayout`'s props (`apps/shopify/src/components/OnboardingLayout.tsx`): the old page passed `padding`, `bare`, `heading`, `continueDisabled`, `continueLoading`, `onContinue`; keep only props that exist, and keep `page="products"`. `ProgressBar` is a Polaris export; confirm `progress` is 0–100.

Add to `types.ts`:

```ts
export interface ShopifySyncStatus {
  state: 'running' | 'idle';
  startedAt: number;
  completedAt: number | null;
  /** Shopify's product count when the import started; null if unavailable. */
  total: number | null;
  /** Products this import has written so far. */
  imported: number;
}
```

- [ ] **Step 4: Run tests, typecheck, commit**

Run: `pnpm --filter @aivastra/shopify-admin test` (onboarding tests pass; other suites may fail only on files Task 9 deletes) and `pnpm --filter @aivastra/shopify-admin typecheck` — remaining errors must be confined to `RoutingPage`, `ManagePage`, `DashboardPage`, `BasketAssignmentStage`, `ProductSelectionStage`, `lib/baskets`, `lib/productSelection` (Task 9).

```bash
git add apps/shopify/src/lib/onboarding.ts apps/shopify/src/lib/onboarding.test.ts apps/shopify/src/pages/OnboardingProductsPage.tsx apps/shopify/src/types.ts apps/shopify/src/pages/OnboardingContactPage.tsx apps/shopify/src/pages/OnboardingLimitsPage.tsx
git commit -m "feat(shopify): onboarding page 1 is import-only with a progress bar"
```

(If plan 2 or 3 has uncommitted hunks in the two Onboarding page files, commit those two with `git add -p` or leave them for the owning plan and note the one-token rename in your report so they rebase it.)

---

### Task 9: Merchant app — remove Routing, basket UI and unrouted warnings

**Files:**
- Delete: `apps/shopify/src/pages/RoutingPage.tsx`, `components/onboarding/BasketAssignmentStage.tsx`, `components/onboarding/ProductSelectionStage.tsx`, `lib/baskets.ts`, `lib/productSelection.ts`, `lib/productBaskets.test.ts`
- Modify: `apps/shopify/src/pages/ManagePage.tsx`, `DashboardPage.tsx`, `apps/shopify/src/App.tsx`, `apps/shopify/src/types.ts`

- [ ] **Step 1: Delete the dead files**

```bash
git rm apps/shopify/src/pages/RoutingPage.tsx apps/shopify/src/components/onboarding/BasketAssignmentStage.tsx apps/shopify/src/components/onboarding/ProductSelectionStage.tsx apps/shopify/src/lib/baskets.ts apps/shopify/src/lib/productSelection.ts apps/shopify/src/lib/productBaskets.test.ts
```

- [ ] **Step 2: Strip `ManagePage.tsx`**

Read the file. Remove, with `pnpm --filter @aivastra/shopify-admin typecheck` guiding leftovers:
- `import RoutingTab from './RoutingPage'` and the `OUTER_TABS` entry `{ id: 'routing', content: 'Routing' }` plus its render branch (`OUTER_TABS[outerTabIndex].id === 'routing' && <RoutingTab ... />`).
- `Basket`, `BasketSource`, `BASKET_SOURCE_LABEL`, `BASKET_SOURCE_TONE`, `basketLabelFor` and the Routing-shape comment (~lines 76-133).
- In the product table component: the `/v1/shopify/baskets` fetch, `baskets` state, `basketBusyId`, `updateBasket`, `onBasketChanged` prop, the whole basket column (header and cell, ~lines 477-560).
- In the main component: `landingBaskets`, the routing refresh token/`unroutedRefreshToken`, the `/v1/shopify/baskets` + rules fetch (~856-940), the "Try-On won't work for N until you add a routing rule or pin" banner (~1203), the per-basket product-count list (~1300-1325), and the `onBasketChanged` wiring (~1430).
- The unrouted/"More not shown — add a routing rule…" text (~341).
Keep activation mode, collections, exclusions, and product table without a basket column.
Acceptance: `grep -niE "basket|routing|unrouted|funnel" apps/shopify/src/pages/ManagePage.tsx` returns nothing.

- [ ] **Step 3: Dashboard, App, types**

`DashboardPage.tsx`: remove the `unroutedWarningCount` import (line 24), `unroutedCount` and the whole `{unroutedCount > 0 && (...)}` banner (~293-305), and rewrite the comment above `~244` that explains basket-derived state to describe the current rule ("finished onboarding but nothing is enabled"). Keep `isTryOnOff` / `needsEmbedEnable` usage.
`App.tsx`: remove the `/onboarding/routing` redirect route's explanatory comment only if it mentions baskets (keep the redirect itself); update comments at ~82, ~116-118 that cite `isSelectionDone/isBasketsDone` to cite `isProductsDone`; the `/routing` → `/manage` redirect stays.
`types.ts`: remove `basket` and `pinnedBasketId` (~132-141) and any `Basket*` types (`grep -n "Basket" apps/shopify/src/types.ts`).

- [ ] **Step 4: Verify and commit**

Run: `pnpm --filter @aivastra/shopify-admin typecheck && pnpm --filter @aivastra/shopify-admin lint && pnpm --filter @aivastra/shopify-admin test && pnpm --filter @aivastra/shopify-admin build` → all pass.
`grep -rniE "basket|funnel|unrouted" apps/shopify/src` → only the `/routing` redirect comment and the conversion-funnel names in `AnalyticsPage`/`BarChart` (not baskets).

```bash
git add -u apps/shopify/src
git add apps/shopify/src/pages/ManagePage.tsx apps/shopify/src/pages/DashboardPage.tsx apps/shopify/src/App.tsx apps/shopify/src/types.ts
git commit -m "refactor(shopify): remove Routing page, basket UI and unrouted warnings from the merchant app"
```

(`git add -u apps/shopify/src` would also stage other plans' modifications under that directory — instead list your files: the six deleted paths are already staged by `git rm`; stage only the four modified files above.)

---

### Task 10: Docs and spec amendments

**Files:**
- Modify: `docs/superpowers/specs/2026-10-30-shopify-single-workflow-design.md` (apply the three amendments at the top of this plan)
- Modify: `CLAUDE.md` ("Product routing (baskets)..." paragraph in Shopify surface; `shopify/` row in API modules table; Shopify schema line)
- Modify: `docs/progress.md` (new dated entry at the top)

- [ ] **Step 1: Edit the spec** so the config key, the shim (sole-basket-workflow, since `is_default` was dropped in migration 0200), funnel-counts-stay, and the analytics-funnel note match this plan.
- [ ] **Step 2: CLAUDE.md.** Replace the "Product routing (baskets)..." paragraph with: "**All Shopify try-ons run one workflow**, chosen in the admin panel (`config:system.shopifyWorkflowTemplateId`, resolved by `modules/shopify/workflow.ts` at job creation and pinned into `job_inputs.params`). The funnel tables (`shopify_funnel_templates`, `_rules`, `_store_disabled_rules`) and `shopify_product_garments.funnel_*` columns are dormant until release 2 drops them; `resolveShopifyWorkflow` has a release-1 shim that falls back to the workflow shared by all active funnel templates." Update the `shopify/` row (remove funnel-rules mentions) and add the new admin page.
- [ ] **Step 3: progress.md.** Add `## 2026-10-30 — Shopify single workflow (release 1)` with **Done / Not done / Open**: record the behaviour change (live stores' basket-routed and pinned products now all run the one workflow), the shim, that **the admin must choose the workflow on the Shopify workflow page before release 2**, that release 2 (DROP of 3 tables + 2 columns + shim + workflows.routes funnel guards + CLAUDE.md) is not started, and the state that lives outside the repo (Redis `config:system.shopifyWorkflowTemplateId`).
- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-10-30-shopify-single-workflow-design.md CLAUDE.md docs/progress.md
git commit -m "docs(shopify): single-workflow release 1 notes and spec amendments"
```

---

### Task 11: Full verification gate (run once the other three plans report done, or at the end of this one)

- [ ] **Step 1:** `pnpm typecheck` and `pnpm lint` at repo root → clean (failures in files owned by plans 2–4 are reported to the manager, not fixed here).
- [ ] **Step 2:** `pnpm docker:up`, then `pnpm --filter @aivastra/api test` and the integration files this plan touched: `shopify-workflow-resolver shopify-single-workflow shopify-workflow-pointer shopify-sync-status shopify-onboarding shopify-me shopify-products-bulk shopify-activation-routes shopify-webhooks shopify-customer shopify-refusal-events shopify-limits shopify-analytics`. Expected: all pass.
- [ ] **Step 3:** `pnpm --filter @aivastra/dispatcher test` and its integration suite for `shopify` → pass.
- [ ] **Step 4:** `pnpm --filter @aivastra/admin build && pnpm --filter @aivastra/shopify-admin build` → pass.
- [ ] **Step 5:** Manual (dev stack): admin → Shopify workflow → choose and save → `GET /admin/config` shows the id; on a dev store, onboarding page 1 shows the bar and Continue works; a storefront try-on pins the chosen workflow (`select params->>'workflowTemplateId' from job_inputs order by created_at desc limit 1` against the **local** DB).
- [ ] **Step 6:** Report which steps ran and their output. Do not claim a step that was not run.

---

## Self-review (spec coverage)

| Spec requirement | Task |
|---|---|
| Single workflow resolved at job creation, refuse before deduct | 1, 2 |
| `enabled` endpoint parity | 2 |
| Release-1 shim | 1 |
| Admin picker, funnels page removed | 7 |
| Pointer safe across replace/delete (new, found while planning) | 3 |
| Progress bar needs imported/total | 4, 8 |
| Global mode on first completion, never override | 5 |
| Onboarding step derivation, delete picker/baskets/routing | 8, 9 |
| Strip basket data from `me`, activation, products, bulk, webhook | 5 |
| Delete funnel API + tests | 6 |
| Analytics: nothing to remove (conversion funnel) | amendment 3 |
| Release 2 (DROP) | out of scope; recorded in Task 10 |
| Docs, behaviour-change note | 10 |
