# WhatsApp bot try-on flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second WhatsApp bot flow (photo → gender → 1/3/5 poses → generate) that creates one direct try-on job per pose drawn from an admin-curated pool in `model_pose_assets`, selectable by env flag, leaving the catalogue flow untouched.

**Architecture:** A new pure engine `handleTryon` (own file, own `TryonDeps`) reuses the existing `Session`/state names and the existing delivery loop. Jobs are created through the existing `createDevJobCore` (the path the Chrome-extension try-on uses): `upperGarmentKey` + `params.personKey` (the pose image) + `params.workflowTemplateId`. `WHATSAPP_BOT_FLOW=tryon` makes `runConversation` use the new engine; the default `catalogue` keeps today's behaviour.

**Tech Stack:** TypeScript (ESM), Fastify 5, Drizzle ORM + Postgres, Redis, Vitest, React (admin-web).

**Spec:** `docs/superpowers/specs/2026-10-22-whatsapp-tryon-flow-design.md`

## Global Constraints

- Counts are exactly `1 | 3 | 5`. Split, Full drawn first: `1 → 1 Full`, `3 → 2 Full + 1 Half`, `5 → 3 Full + 2 Half`. No Back poses.
- Gender choices and order: Men, Women, Boys, Girls (slugs `men`, `women`, `boys`, `girls`).
- A pose is drawable only if: `whatsapp_pool` true, `is_active` true, `deleted_at` null, `shot_type` in (`full`,`half`), `gender_slug` = tapped gender, `workflow_template_id` set to a template with `is_active` true and `workflow_type = 'tryon'`.
- Cost per image is `getTryonCreditCost(app)` (admin-configurable, default 5). Count options show `n × cost` credits. Tapping a count is the agreement to spend (no confirm step); the balance is re-checked at that tap.
- WhatsApp limits: button title ≤ 20 chars, list row title ≤ 24, list ≤ 10 rows.
- The catalogue flow code is not removed or behaviourally changed. `WHATSAPP_BOT_FLOW` defaults to `catalogue`; tests build `Env` directly, so compare with `=== 'tryon'`.
- No schema/data work against production; migration is generated and tested locally only (CLAUDE.md, Production safety).
- Do not commit unless the user has asked; each task's commit step is performed only when the user has approved committing for this work. Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Match surrounding code: comments explain *why*; no `console.log`; admin-web has no raw `<select>`.

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `packages/db/src/schema/models.ts` | modify | `whatsappPool` column on `modelPoseAssets` |
| `packages/db/src/migrations/0230_*.sql` (+ meta) | generate | the `ALTER TABLE` |
| `apps/api/src/modules/admin/models.routes.ts` | modify | GET returns / PATCH accepts `whatsappPool` |
| `packages/types/src/job-taxonomy.ts`, `image-compression.ts` | modify | `JOB_SOURCE.WHATSAPP_TRYON` |
| `apps/api/src/modules/jobs/routes.ts` | modify | exclude the new source from the studio gallery |
| `apps/api/src/modules/dev/create-job.ts` | modify | optional `catalogueId` param on `createDevJobCore` |
| `apps/api/src/modules/messaging/engine/tryon-rules.ts` | create | pure split/draw/count rules |
| `apps/api/src/modules/messaging/tryon-jobs.ts` | create | `listPoolPoses`, `createTryonRun` |
| `apps/api/src/modules/messaging/engine/types.ts` | modify | `InboundEvent.runFinished.failed?`, `RunRef.failed?` |
| `apps/api/src/modules/messaging/delivery.ts` | modify | pass `failed` count in `runFinished` |
| `apps/api/src/modules/messaging/engine/copy.ts` | modify | new tryon copy keys |
| `apps/api/src/modules/messaging/engine/engine.ts` | modify | `export` `buttons` and `text` only |
| `apps/api/src/modules/messaging/engine/tryon-engine.ts` | create | `handleTryon`, `TryonDeps` |
| `apps/api/src/modules/messaging/tryon-deps.ts` | create | real `TryonDeps` |
| `apps/api/src/modules/messaging/conversation.ts` | modify | engine selection by flag |
| `apps/api/src/env.ts`, `.env.example`, `.env.production.example` | modify | `WHATSAPP_BOT_FLOW` |
| `apps/admin-web/src/types.ts`, `pages/assets/AssetsContext.tsx`, `pages/AssetsPage.tsx`, `pages/assets/WhatsappPosesTab.tsx` | modify/create | admin tab |
| `docs/progress.md` | modify | log entry |

Tests: `apps/api/test/integration/admin-whatsapp-pool.test.ts`, `apps/api/test/tryon-rules.test.ts`, `apps/api/test/integration/messaging-tryon-jobs.test.ts`, `apps/api/test/messaging-tryon-engine.test.ts`, `apps/api/test/integration/messaging-tryon-conversation.test.ts`, plus edits to `apps/api/test/integration/admin-job-taxonomy.test.ts`.

---

### Task 1: `whatsapp_pool` column and admin API

**Files:**
- Modify: `packages/db/src/schema/models.ts` (inside `modelPoseAssets`, after the `scope:` line)
- Generate: migration via `pnpm db:generate`
- Modify: `apps/api/src/modules/admin/models.routes.ts` (GET select ~line 805, PATCH body ~line 1083, handler type ~line 1100, `set` block ~line 1145)
- Test: `apps/api/test/integration/admin-whatsapp-pool.test.ts`

**Interfaces:**
- Produces: `schema.modelPoseAssets.whatsappPool: boolean` (not null, default false); `GET /admin/assets/pose-assets` items carry `whatsappPool`; `PATCH /admin/assets/pose-assets/:id` accepts `whatsappPool?: boolean`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/integration/admin-whatsapp-pool.test.ts`:

```ts
import { schema } from '@aivastra/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminAuthHeader } from '../helpers/admin.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

describe('admin pose assets: WhatsApp pool flag', () => {
  let c: Containers;
  let app: TestApp;
  let headers: Record<string, string>;
  let poseId: string;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
    headers = await adminAuthHeader(app, 'SUPER_ADMIN');
    const [pose] = await app.db
      .insert(schema.modelPoseAssets)
      .values({
        label: `PoolPose${Date.now()}`,
        genderSlug: 'men',
        shotType: 'full',
        r2Key: `pool-pose-${Date.now()}.jpg`,
        thumbnailKey: `pool-pose-${Date.now()}.thumb.jpg`,
      })
      .returning();
    poseId = pose.id;
  }, 60000);

  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  it('defaults to false and is listed', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/assets/pose-assets', headers });
    expect(res.statusCode).toBe(200);
    const row = res.json().items.find((i: { id: string }) => i.id === poseId);
    expect(row.whatsappPool).toBe(false);
  });

  it('PATCH toggles it on and off', async () => {
    const on = await app.inject({
      method: 'PATCH',
      url: `/admin/assets/pose-assets/${poseId}`,
      headers,
      payload: { whatsappPool: true },
    });
    expect(on.statusCode).toBe(200);
    expect(on.json().whatsappPool).toBe(true);

    const list = await app.inject({ method: 'GET', url: '/admin/assets/pose-assets', headers });
    expect(
      list.json().items.find((i: { id: string }) => i.id === poseId).whatsappPool,
    ).toBe(true);

    const off = await app.inject({
      method: 'PATCH',
      url: `/admin/assets/pose-assets/${poseId}`,
      headers,
      payload: { whatsappPool: false },
    });
    expect(off.json().whatsappPool).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run (from `apps/api`): `npx vitest run --config vitest.integration.config.ts admin-whatsapp-pool`
Expected: FAIL (TypeScript/DB error: column `whatsapp_pool` / property `whatsappPool` does not exist).

- [ ] **Step 3: Add the column**

In `packages/db/src/schema/models.ts`, inside `modelPoseAssets`, directly after `scope: text('scope').notNull().default('general'),` add:

```ts
  // The WhatsApp bot draws only from poses with this set (spec
  // 2026-10-22-whatsapp-tryon-flow-design). A membership flag, not a visibility
  // flag: the studio and catalogue templates ignore it.
  whatsappPool: boolean('whatsapp_pool').notNull().default(false),
```

- [ ] **Step 4: Generate and inspect the migration (local only)**

Run (repo root): `pnpm db:generate`
Expected: a new `packages/db/src/migrations/0230_*.sql` containing only
`ALTER TABLE "model_pose_assets" ADD COLUMN "whatsapp_pool" boolean DEFAULT false NOT NULL;`
Open the file and confirm that is its entire content (no other tables touched). If drizzle generated anything else, stop and report.

- [ ] **Step 5: Expose it in the admin API**

In `models.routes.ts`:

GET select list — after `sortOrder: schema.modelPoseAssets.sortOrder,` add:
```ts
          whatsappPool: schema.modelPoseAssets.whatsappPool,
```
PATCH zod body — after `sortOrder: z.number().int().optional(),` add:
```ts
          whatsappPool: z.boolean().optional(),
```
PATCH handler `body` type — after `sortOrder?: number;` add:
```ts
        whatsappPool?: boolean;
```
PATCH `set` block — after `if (body.sortOrder !== undefined) set.sortOrder = body.sortOrder;` add:
```ts
      if (body.whatsappPool !== undefined) set.whatsappPool = body.whatsappPool;
```

- [ ] **Step 6: Run the test and typecheck**

Run (from `apps/api`): `npx vitest run --config vitest.integration.config.ts admin-whatsapp-pool` → PASS (2 tests).
Run: `npx tsc --noEmit` → no errors.

- [ ] **Step 7: Commit (only when the user has approved committing)**

```bash
git add packages/db/src/schema/models.ts packages/db/src/migrations apps/api/src/modules/admin/models.routes.ts apps/api/test/integration/admin-whatsapp-pool.test.ts
git commit -m "feat(db): whatsapp_pool flag on pose assets, exposed in admin API"
```

---

### Task 2: `WHATSAPP_TRYON` job source and shared `catalogueId`

**Files:**
- Modify: `packages/types/src/job-taxonomy.ts`, `packages/types/src/image-compression.ts`
- Modify: `apps/api/src/modules/jobs/routes.ts` (gallery exclusion list ~line 589)
- Modify: `apps/api/src/modules/dev/create-job.ts` (`createDevJobCore`)
- Test: `apps/api/test/integration/admin-job-taxonomy.test.ts`

**Interfaces:**
- Produces: `JOB_SOURCE.WHATSAPP_TRYON === 'whatsapp_tryon'`; `createDevJobCore` params gain `catalogueId?: string` (default: a fresh UUID, unchanged behaviour).

- [ ] **Step 1: Update the taxonomy test first (it should fail)**

In `apps/api/test/integration/admin-job-taxonomy.test.ts` change `expect(body).toHaveLength(16);` to `toHaveLength(17)` and add `'whatsapp_tryon',` after `'extension_tryon',` in the expected list.
Also run `grep -rn "toHaveLength(16)" apps/api/test packages/types` and update any other assertion that counts job sources.

Run: `npx vitest run --config vitest.integration.config.ts admin-job-taxonomy` → FAIL (length 16 vs 17).

- [ ] **Step 2: Add the source**

`packages/types/src/job-taxonomy.ts`, after `EXTENSION_TRYON: 'extension_tryon',`:
```ts
  WHATSAPP_TRYON: 'whatsapp_tryon',
```
`packages/types/src/image-compression.ts`, add `JOB_SOURCE.WHATSAPP_TRYON,` to the end of `COMPRESSED_BY_DEFAULT` (it runs through `processTryonDirectJob` like the other try-on sources):
```ts
  JOB_SOURCE.EXTENSION_TRYON,
  JOB_SOURCE.WHATSAPP_TRYON,
];
```
Rebuild the types package so api sees it: `pnpm --filter @aivastra/types build`.

- [ ] **Step 3: Keep these jobs out of the studio gallery**

In `apps/api/src/modules/jobs/routes.ts`, in the `notInArray(schema.jobs.source, [...])` list after `JOB_SOURCE.EXTENSION_TRYON,` add:
```ts
                // WhatsApp try-ons are delivered in the chat; like the extension's they are
                // direct person+garment jobs, not the curated catalogue gallery.
                JOB_SOURCE.WHATSAPP_TRYON,
```

- [ ] **Step 4: Let callers choose the `catalogueId`**

In `apps/api/src/modules/dev/create-job.ts`, in `createDevJobCore`'s `params` type add after `lane?: ...;`:
```ts
    // One id shared by every job of a run (the WhatsApp try-on run id). Absent: a fresh
    // id per job, as before.
    catalogueId?: string;
```
and replace `const catalogueId = randomUUID();` with:
```ts
  const catalogueId = params.catalogueId ?? randomUUID();
```

- [ ] **Step 5: Verify**

Run: `npx vitest run --config vitest.integration.config.ts admin-job-taxonomy` → PASS.
Run (from `apps/api`): `npx tsc --noEmit` → clean; `npx vitest run extension-tryon` → PASS (unchanged default).

- [ ] **Step 6: Commit (only when approved)**

```bash
git add packages/types/src apps/api/src/modules/jobs/routes.ts apps/api/src/modules/dev/create-job.ts apps/api/test/integration/admin-job-taxonomy.test.ts
git commit -m "feat(api): whatsapp_tryon job source; createDevJobCore accepts a shared catalogueId"
```

---

### Task 3: Pure pose rules

**Files:**
- Create: `apps/api/src/modules/messaging/engine/tryon-rules.ts`
- Test: `apps/api/test/tryon-rules.test.ts`

**Interfaces:**
- Produces (all exported): `type ShotType = 'full' | 'half'`; `interface TryonPose { id: string; gender: Gender; shotType: ShotType; r2Key: string; workflowTemplateId: string; templateVersion: number | null }`; `TRYON_COUNTS = [1, 3, 5] as const`; `type TryonCount`; `TRYON_SPLIT`; `canFill(pool: TryonPose[], gender: Gender, n: TryonCount): boolean`; `drawTryonPoses(pool: TryonPose[], gender: Gender, n: TryonCount, shuffle: (ids: string[]) => string[]): TryonPose[]`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/tryon-rules.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  canFill,
  drawTryonPoses,
  type TryonPose,
  TRYON_COUNTS,
  TRYON_SPLIT,
} from '../src/modules/messaging/engine/tryon-rules';

const pose = (id: string, gender: TryonPose['gender'], shotType: TryonPose['shotType']): TryonPose => ({
  id,
  gender,
  shotType,
  r2Key: `${id}.jpg`,
  workflowTemplateId: 'wf',
  templateVersion: 1,
});

const men = [
  pose('f1', 'men', 'full'),
  pose('f2', 'men', 'full'),
  pose('f3', 'men', 'full'),
  pose('h1', 'men', 'half'),
  pose('h2', 'men', 'half'),
  pose('w1', 'women', 'full'),
];
const keep = (ids: string[]) => ids; // deterministic "shuffle"
const reverse = (ids: string[]) => [...ids].reverse();

describe('tryon rules', () => {
  it('splits are Full-first with no Back', () => {
    expect(TRYON_COUNTS).toEqual([1, 3, 5]);
    expect(TRYON_SPLIT[1]).toEqual({ full: 1, half: 0 });
    expect(TRYON_SPLIT[3]).toEqual({ full: 2, half: 1 });
    expect(TRYON_SPLIT[5]).toEqual({ full: 3, half: 2 });
  });

  it('canFill needs enough poses of each shot type for that gender', () => {
    expect(canFill(men, 'men', 5)).toBe(true);
    expect(canFill(men, 'women', 1)).toBe(true);
    expect(canFill(men, 'women', 3)).toBe(false); // one Full, no Half
    expect(canFill(men, 'boys', 1)).toBe(false);
  });

  it('draws the split for the tapped gender only, Full first', () => {
    const drawn = drawTryonPoses(men, 'men', 5, keep);
    expect(drawn.map((p) => p.id)).toEqual(['f1', 'f2', 'f3', 'h1', 'h2']);
    expect(drawTryonPoses(men, 'men', 3, keep).map((p) => p.id)).toEqual(['f1', 'f2', 'h1']);
    expect(drawTryonPoses(men, 'men', 1, keep).map((p) => p.id)).toEqual(['f1']);
  });

  it('uses the injected shuffle within each category and never repeats a pose', () => {
    const drawn = drawTryonPoses(men, 'men', 3, reverse);
    expect(drawn.map((p) => p.id)).toEqual(['f3', 'f2', 'h2']);
    expect(new Set(drawn.map((p) => p.id)).size).toBe(drawn.length);
  });

  it('takes what exists when a category is short', () => {
    expect(drawTryonPoses(men, 'women', 3, keep).map((p) => p.id)).toEqual(['w1']);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run (from `apps/api`): `npx vitest run tryon-rules` → FAIL (module not found).

- [ ] **Step 3: Implement**

Create `apps/api/src/modules/messaging/engine/tryon-rules.ts`:

```ts
import type { Gender } from './types.js';

// The two shot types the WhatsApp pool uses. Back poses need a photo of the
// garment's back (jobs/create.ts), which the bot does not ask for yet.
export type ShotType = 'full' | 'half';

// One drawable pose, as the engine and job creation see it.
export interface TryonPose {
  id: string;
  gender: Gender;
  shotType: ShotType;
  // The pose image: sent to the workflow as the person.
  r2Key: string;
  workflowTemplateId: string;
  templateVersion: number | null;
}

export const TRYON_COUNTS = [1, 3, 5] as const;
export type TryonCount = (typeof TRYON_COUNTS)[number];

// Full is always drawn first (spec 2026-10-22, decision 4).
export const TRYON_SPLIT: Record<TryonCount, Record<ShotType, number>> = {
  1: { full: 1, half: 0 },
  3: { full: 2, half: 1 },
  5: { full: 3, half: 2 },
};

const of = (pool: TryonPose[], gender: Gender, shot: ShotType) =>
  pool.filter((p) => p.gender === gender && p.shotType === shot);

/** True when the pool holds enough poses of each shot type to draw exactly `n`. */
export function canFill(pool: TryonPose[], gender: Gender, n: TryonCount): boolean {
  const need = TRYON_SPLIT[n];
  return of(pool, gender, 'full').length >= need.full && of(pool, gender, 'half').length >= need.half;
}

/**
 * `n` distinct poses for the gender: the Full share first, then the Half share,
 * each shuffled on its own. A short category yields what exists (callers check
 * canFill first). `shuffle` works on ids so the engine's injected shuffle (and
 * a test's fixed one) can be used unchanged.
 */
export function drawTryonPoses(
  pool: TryonPose[],
  gender: Gender,
  n: TryonCount,
  shuffle: (ids: string[]) => string[],
): TryonPose[] {
  const byId = new Map(pool.map((p) => [p.id, p] as const));
  const need = TRYON_SPLIT[n];
  const pick = (shot: ShotType) =>
    shuffle(of(pool, gender, shot).map((p) => p.id))
      .slice(0, need[shot])
      .flatMap((id) => {
        const p = byId.get(id);
        return p ? [p] : [];
      });
  return [...pick('full'), ...pick('half')];
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx vitest run tryon-rules` → PASS (5 tests). `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit (only when approved)**

```bash
git add apps/api/src/modules/messaging/engine/tryon-rules.ts apps/api/test/tryon-rules.test.ts
git commit -m "feat(whatsapp): pure split and draw rules for the try-on flow"
```

---

### Task 4: Pool query and run creation

**Files:**
- Create: `apps/api/src/modules/messaging/tryon-jobs.ts`
- Test: `apps/api/test/integration/messaging-tryon-jobs.test.ts`

**Interfaces:**
- Consumes: `TryonPose` (Task 3), `createDevJobCore` + `catalogueId` (Task 2), `JOB_SOURCE.WHATSAPP_TRYON` (Task 2), `schema.modelPoseAssets.whatsappPool` (Task 1), `EngineContext` (`engine/types.ts`).
- Produces: `listPoolPoses(app, gender): Promise<TryonPose[]>`; `createTryonRun(app, ctx, { garmentKey, poses }): Promise<{ runId: string; requested: number; created: number; reason?: string }>`. Throws the original `AppError` (e.g. `INSUFFICIENT_CREDITS`) when no job could be created.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/integration/messaging-tryon-jobs.test.ts`:

```ts
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../../src/lib/errors';
import { CHANNEL_WHATSAPP, connectAccount } from '../../src/modules/messaging/identity';
import { storeGarmentPhoto } from '../../src/modules/messaging/photos';
import { createTryonRun, listPoolPoses } from '../../src/modules/messaging/tryon-jobs';
import { buildTestApp, type TestApp } from '../helpers/api';
import { createVerifiedUserToken } from '../helpers/auth';
import { type Containers, startContainers } from '../helpers/containers';

describe('whatsapp try-on pool and run creation', () => {
  let c: Containers;
  let app: TestApp;
  let realHeadObject: TestApp['storage']['headObject'];
  let tryonWf: { id: string };
  let seq = 0;

  const pose = async (over: Partial<typeof schema.modelPoseAssets.$inferInsert> = {}) => {
    const n = ++seq;
    const [p] = await app.db
      .insert(schema.modelPoseAssets)
      .values({
        label: `TryonPose${Date.now()}-${n}`,
        genderSlug: 'men',
        shotType: 'full',
        r2Key: `tp-${Date.now()}-${n}.jpg`,
        thumbnailKey: `tp-${Date.now()}-${n}.thumb.jpg`,
        workflowTemplateId: tryonWf.id,
        whatsappPool: true,
        ...over,
      })
      .returning();
    return p;
  };

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c, { MESSAGING_WHATSAPP_ENABLED: true, WEB_URL: 'http://localhost:3000' });
    realHeadObject = app.storage.headObject.bind(app.storage);
    await app.db
      .insert(schema.creditPlans)
      .values({ slug: 'free', name: 'free', credits: 1000, basePaise: 0, watermark: false })
      .onConflictDoNothing({ target: schema.creditPlans.slug });
    [tryonWf] = await app.db
      .insert(schema.workflowTemplates)
      .values({
        slug: `tryon-wf-${Date.now()}`,
        label: 'Tryon wf',
        jsonContent: {},
        workflowType: 'tryon',
        poseNodeId: '1',
        upperNodeIds: [],
        garmentPhasePromptNode: '2',
      })
      .returning();
  }, 60000);
  beforeEach(() => {
    app.storage.headObject = (async () => ({ contentLength: 1024 })) as typeof app.storage.headObject;
  });
  afterEach(() => {
    app.storage.headObject = realHeadObject;
  });
  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  it('listPoolPoses returns only eligible poses for the gender', async () => {
    const ok = await pose({ genderSlug: 'boys', shotType: 'half' });
    await pose({ genderSlug: 'boys', whatsappPool: false });
    await pose({ genderSlug: 'boys', isActive: false });
    await pose({ genderSlug: 'boys', deletedAt: new Date() });
    await pose({ genderSlug: 'boys', workflowTemplateId: null });
    await pose({ genderSlug: 'boys', shotType: 'closeup' });
    await pose({ genderSlug: 'girls' });
    const [inactiveWf] = await app.db
      .insert(schema.workflowTemplates)
      .values({
        slug: `off-wf-${Date.now()}`,
        label: 'Off',
        jsonContent: {},
        workflowType: 'tryon',
        isActive: false,
        poseNodeId: '1',
        upperNodeIds: [],
        garmentPhasePromptNode: '2',
      })
      .returning();
    await pose({ genderSlug: 'boys', workflowTemplateId: inactiveWf.id });
    const [regularWf] = await app.db
      .insert(schema.workflowTemplates)
      .values({
        slug: `reg-wf-${Date.now()}`,
        label: 'Regular',
        jsonContent: {},
        poseNodeId: '1',
        upperNodeIds: [],
        garmentPhasePromptNode: '2',
      })
      .returning();
    await pose({ genderSlug: 'boys', workflowTemplateId: regularWf.id });

    const found = await listPoolPoses(app, 'boys');
    expect(found.map((p) => p.id)).toEqual([ok.id]);
    expect(found[0]).toMatchObject({
      gender: 'boys',
      shotType: 'half',
      r2Key: ok.r2Key,
      workflowTemplateId: tryonWf.id,
    });
  });

  async function seller(credits: number) {
    const { userId } = await createVerifiedUserToken(app, `tryon-${Date.now()}-${++seq}@example.com`);
    await app.db.insert(schema.userCredits).values({ userId, balance: credits });
    const { account } = await connectAccount(app.db, {
      channel: CHANNEL_WHATSAPP,
      externalId: `+91${Date.now().toString().slice(-9)}${seq}`,
      userId,
      linkedVia: 'web_code',
    });
    const garmentKey = await storeGarmentPhoto(app, userId, Buffer.from('fake-jpeg'), 'image/jpeg');
    return { userId, accountId: account.id, garmentKey };
  }
  const balanceOf = async (userId: string) =>
    (
      await app.db
        .select({ balance: schema.userCredits.balance })
        .from(schema.userCredits)
        .where(eq(schema.userCredits.userId, userId))
    )[0]?.balance;

  it('creates one charged job per pose, sharing one run id, and records the run', async () => {
    const s = await seller(100);
    const poses = [await pose({ genderSlug: 'men' }), await pose({ genderSlug: 'men', shotType: 'half' })];
    const tp = (await listPoolPoses(app, 'men')).filter((p) => poses.some((x) => x.id === p.id));

    const run = await createTryonRun(
      app,
      { userId: s.userId, accountId: s.accountId, messageId: `wamid.${seq}` },
      { garmentKey: s.garmentKey, poses: tp },
    );
    expect(run).toMatchObject({ requested: 2, created: 2 });

    const [record] = await app.db
      .select()
      .from(schema.messagingRuns)
      .where(eq(schema.messagingRuns.catalogueId, run.runId));
    expect(record).toMatchObject({ messagingAccountId: s.accountId, userId: s.userId });
    expect(record.jobIds).toHaveLength(2);

    const jobs = await app.db
      .select({
        source: schema.jobs.source,
        catalogueId: schema.jobs.catalogueId,
        upperGarmentKey: schema.jobInputs.upperGarmentKey,
        params: schema.jobInputs.params,
      })
      .from(schema.jobs)
      .innerJoin(schema.jobInputs, eq(schema.jobInputs.jobId, schema.jobs.id))
      .where(eq(schema.jobs.catalogueId, run.runId));
    expect(jobs).toHaveLength(2);
    for (const j of jobs) {
      expect(j.source).toBe('whatsapp_tryon');
      expect(j.upperGarmentKey).toBe(s.garmentKey);
      expect(j.params).toMatchObject({ workflowTemplateId: tryonWf.id });
    }
    expect(jobs.map((j) => (j.params as { personKey: string }).personKey).sort()).toEqual(
      poses.map((p) => p.r2Key).sort(),
    );
    expect(await balanceOf(s.userId)).toBe(90); // 2 × 5
  });

  it('a redelivered message does not create a second run', async () => {
    const s = await seller(100);
    const [p] = await listPoolPoses(app, 'men');
    const ctx = { userId: s.userId, accountId: s.accountId, messageId: `wamid.dup.${seq}` };
    const a = await createTryonRun(app, ctx, { garmentKey: s.garmentKey, poses: [p] });
    const b = await createTryonRun(app, ctx, { garmentKey: s.garmentKey, poses: [p] });
    expect(b.runId).toBe(a.runId);
    expect(await balanceOf(s.userId)).toBe(95);
  });

  it('a run the balance cannot cover entirely throws INSUFFICIENT_CREDITS and charges nothing', async () => {
    const s = await seller(3);
    const [p] = await listPoolPoses(app, 'men');
    await expect(
      createTryonRun(
        app,
        { userId: s.userId, accountId: s.accountId, messageId: `wamid.poor.${seq}` },
        { garmentKey: s.garmentKey, poses: [p] },
      ),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_CREDITS' });
    expect(await balanceOf(s.userId)).toBe(3);
  });

  it('a balance that covers only some poses creates those and reports the rest', async () => {
    const s = await seller(7); // one image at 5 credits
    const all = await listPoolPoses(app, 'men');
    const run = await createTryonRun(
      app,
      { userId: s.userId, accountId: s.accountId, messageId: `wamid.part.${seq}` },
      { garmentKey: s.garmentKey, poses: all.slice(0, 2) },
    );
    expect(run).toMatchObject({ requested: 2, created: 1 });
    expect(run.reason).toBeTruthy();
    expect(await balanceOf(s.userId)).toBe(2);
  });

  it('refuses a garment key the user does not own', async () => {
    const s = await seller(100);
    const other = await seller(100);
    const [p] = await listPoolPoses(app, 'men');
    await expect(
      createTryonRun(
        app,
        { userId: s.userId, accountId: s.accountId, messageId: `wamid.own.${seq}` },
        { garmentKey: other.garmentKey, poses: [p] },
      ),
    ).rejects.toBeInstanceOf(AppError);
    expect(await balanceOf(s.userId)).toBe(100);
  });
});
```

Note: the 5-credit cost relies on `getTryonCreditCost` falling back to `SIMPLE_TRYON_COST` (5) in a fresh test database. If `getTryonCreditCost` reads a Redis config key in this harness and returns something else, set it the way `resolution-config.ts` expects (read lines ~100-115) and keep the expected balances in sync.

- [ ] **Step 2: Run it and confirm it fails**

Run (from `apps/api`): `npx vitest run --config vitest.integration.config.ts messaging-tryon-jobs` → FAIL (module `tryon-jobs` not found).

- [ ] **Step 3: Implement**

Create `apps/api/src/modules/messaging/tryon-jobs.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { JOB_SOURCE } from '@aivastra/types';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../../lib/errors.js';
import { withIdempotency } from '../../lib/idempotency.js';
import { getTryonCreditCost } from '../../lib/resolution-config.js';
import { createDevJobCore } from '../dev/create-job.js';
import { resolveQueueRouting, verifyGarmentKey } from '../jobs/create.js';
import type { ShotType, TryonPose } from './engine/tryon-rules.js';
import type { EngineContext, Gender } from './engine/types.js';

const P = schema.modelPoseAssets;
const W = schema.workflowTemplates;

/**
 * The poses the bot may draw for a gender: in the WhatsApp pool, live, Full or
 * Half, and carrying an active try-on workflow. Read fresh on every use, so an
 * admin removing a pose or switching off a workflow takes effect at once.
 */
export async function listPoolPoses(app: FastifyInstance, gender: Gender): Promise<TryonPose[]> {
  const rows = await app.db
    .select({
      id: P.id,
      shotType: P.shotType,
      r2Key: P.r2Key,
      workflowTemplateId: W.id,
      templateVersion: W.version,
    })
    .from(P)
    .innerJoin(W, eq(W.id, P.workflowTemplateId))
    .where(
      and(
        eq(P.whatsappPool, true),
        eq(P.isActive, true),
        isNull(P.deletedAt),
        eq(P.genderSlug, gender),
        inArray(P.shotType, ['full', 'half']),
        eq(W.isActive, true),
        eq(W.workflowType, 'tryon'),
      ),
    )
    .orderBy(P.sortOrder, P.label);
  return rows.map((r) => ({
    id: r.id,
    gender,
    shotType: r.shotType as ShotType,
    r2Key: r.r2Key,
    workflowTemplateId: r.workflowTemplateId,
    templateVersion: r.templateVersion ?? null,
  }));
}

/**
 * One direct try-on job per pose (the shape processTryonDirectJob runs: garment
 * as upperGarmentKey, the pose image as params.personKey), all under one run id
 * that is also the jobs' catalogueId, plus the messaging_runs row delivery reads.
 *
 * Each job is charged and enqueued on its own (createDevJobCore), so when the
 * balance or the queue gives out partway the earlier jobs stand and only they
 * are recorded; `created < requested` tells the caller. Nothing created means
 * the first error is rethrown (INSUFFICIENT_CREDITS reaches the engine as such).
 * Keyed on the Meta message id like createRun, so a redelivered webhook cannot
 * start a second run.
 */
export async function createTryonRun(
  app: FastifyInstance,
  ctx: EngineContext,
  input: { garmentKey: string; poses: TryonPose[] },
): Promise<{ runId: string; requested: number; created: number; reason?: string }> {
  if (input.poses.length === 0) throw new AppError('BAD_REQUEST', 400, 'no poses to generate');
  return withIdempotency(app, 'jobs', ctx.userId, `wa:${ctx.messageId}`, async () => {
    await verifyGarmentKey(app, ctx.userId, input.garmentKey);
    const cost = await getTryonCreditCost(app);
    // The seller's own credits, so their watermark entitlement applies (as for the extension).
    const { watermark } = await resolveQueueRouting(app, ctx.userId);
    const runId = randomUUID();
    const jobIds: string[] = [];
    let failure: unknown;
    for (const pose of input.poses) {
      try {
        const { jobId } = await createDevJobCore(app, {
          merchantUserId: ctx.userId,
          apiKeyId: null,
          cost,
          watermark,
          source: JOB_SOURCE.WHATSAPP_TRYON,
          catalogueId: runId,
          buildJobInputs: () => ({
            upperGarmentKey: input.garmentKey,
            params: {
              personKey: pose.r2Key,
              workflowTemplateId: pose.workflowTemplateId,
              dispatchTemplateVersion: pose.templateVersion,
            },
          }),
        });
        jobIds.push(jobId);
      } catch (err) {
        failure = err;
        break;
      }
    }
    if (jobIds.length === 0) throw failure;
    await app.db
      .insert(schema.messagingRuns)
      .values({
        catalogueId: runId,
        messagingAccountId: ctx.accountId,
        userId: ctx.userId,
        jobIds,
      })
      .onConflictDoNothing();
    return {
      runId,
      requested: input.poses.length,
      created: jobIds.length,
      reason: failure instanceof AppError ? failure.message : failure ? 'a temporary problem' : undefined,
    };
  });
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx vitest run --config vitest.integration.config.ts messaging-tryon-jobs` → PASS (5 tests). `npx tsc --noEmit` → clean.
If `withIdempotency` re-throws or misses on the second call in "redelivered", read `apps/api/src/lib/idempotency.ts` and adjust the test (not the contract) to what the helper guarantees.

- [ ] **Step 5: Commit (only when approved)**

```bash
git add apps/api/src/modules/messaging/tryon-jobs.ts apps/api/test/integration/messaging-tryon-jobs.test.ts
git commit -m "feat(whatsapp): pool query and per-pose try-on run creation"
```

---

### Task 5: Delivery reports the failed count

**Files:**
- Modify: `apps/api/src/modules/messaging/engine/types.ts` (`RunRef`, `InboundEvent`)
- Modify: `apps/api/src/modules/messaging/delivery.ts` (the `runFinished` event, ~line 106)
- Test: extend the existing delivery integration test (find it with `grep -ln "deliverRun" apps/api/test/integration/*.ts`) — or `apps/api/test/messaging-engine.test.ts` for the type-level change.

**Interfaces:**
- Produces: `InboundEvent` `runFinished` gains `failed?: number`; `RunRef` gains `failed?: number`. The catalogue engine ignores both.

- [ ] **Step 1: Types**

In `engine/types.ts`, in `RunRef` add after `failedPoseIds?: string[];`:
```ts
  // Jobs that did not complete (set by the try-on flow, which has no pose ids).
  failed?: number;
```
and change the event line to:
```ts
  | { type: 'runFinished'; runId: string; images: number; failedPoseIds: string[]; failed?: number }
```

- [ ] **Step 2: Delivery passes it**

In `delivery.ts`, the `runConversation(... { type: 'runFinished', runId, images: run.jobIds.length, failedPoseIds }, ...)` call becomes:
```ts
      {
        type: 'runFinished',
        runId,
        images: run.jobIds.length,
        failedPoseIds,
        // Direct try-on jobs carry no pose id, so the count is the only signal.
        failed: jobs.filter((j) => j.status !== 'COMPLETED').length,
      },
```

- [ ] **Step 3: Verify**

Run (from `apps/api`): `npx tsc --noEmit` → clean.
Run: `npx vitest run messaging whatsapp` → all pass (unchanged catalogue behaviour).
Run: `npx vitest run --config vitest.integration.config.ts whatsapp-hooks whatsapp-inbound` → only the pre-existing `notifyCreditsAdded ... pose cards` failure may remain; anything else is a regression.
If a delivery test asserts the exact `runFinished` event, update it to include `failed`.

- [ ] **Step 4: Commit (only when approved)**

```bash
git add apps/api/src/modules/messaging/engine/types.ts apps/api/src/modules/messaging/delivery.ts
git commit -m "feat(whatsapp): runFinished carries the failed job count"
```

---

### Task 6: The try-on engine

**Files:**
- Modify: `apps/api/src/modules/messaging/engine/engine.ts` (add `export` to `text` at line 75 and to `function buttons`)
- Modify: `apps/api/src/modules/messaging/engine/copy.ts` (new keys)
- Create: `apps/api/src/modules/messaging/engine/tryon-engine.ts`
- Test: `apps/api/test/messaging-tryon-engine.test.ts`

**Interfaces:**
- Consumes: `TryonPose`, `TRYON_COUNTS`, `canFill`, `drawTryonPoses` (Task 3); `RunRef.failed`, `runFinished.failed` (Task 5); `Session`, `EngineContext`, `EngineResult`, `InboundEvent`, `OutboundMessage`, `Gender`, `EngineDeps` (types.ts); `encodeReplyId`/`decodeReplyId`.
- Produces: `TryonDeps`; `handleTryon(prev: Session | null, event: InboundEvent, ctx: EngineContext, deps: TryonDeps): Promise<EngineResult>`.

- [ ] **Step 1: Export two helpers**

In `engine.ts` change `function buttons(` to `export function buttons(` and `const text = (t: string): OutboundMessage => ...` to `export const text = (t: string): OutboundMessage => ...`.

- [ ] **Step 2: Copy keys**

In `copy.ts` add inside `COPY` (after `deliveredNext`):

```ts
  // Try-on flow (spec 2026-10-22-whatsapp-tryon-flow-design).
  tryonCountPrompt: (category: string, perImage: number, balance: number) =>
    `Great! Let's create your catalogue. ✨
Category: ${category}

Credits per pose: ${perImage} credits
Available balance: ${balance} credits

How many poses would you like?
Tapping an option starts generating right away.`,
  tryonNoPoses:
    "We don't have poses ready for that category on WhatsApp yet. Please choose another.",
  tryonDelivered: (n: number, category: string, used: number, remaining: number) =>
    `Here are your ${n} generated ${n === 1 ? 'pose' : 'poses'}!\nCategory: ${category}\nCredits used: ${used} credits\nRemaining balance: ${remaining} credits`,
  btnMakeMore: 'Make more',
  btnNewGarment: 'New garment',
```

- [ ] **Step 3: Write the failing tests**

Create `apps/api/test/messaging-tryon-engine.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { AppError } from '../src/lib/errors';
import { decodeReplyId } from '../src/modules/messaging/engine/reply-id';
import { handleTryon, type TryonDeps } from '../src/modules/messaging/engine/tryon-engine';
import type { TryonPose } from '../src/modules/messaging/engine/tryon-rules';
import type {
  EngineContext,
  EngineResult,
  Gender,
  InboundEvent,
  OutboundMessage,
  Session,
} from '../src/modules/messaging/engine/types';

const CTX: EngineContext = { userId: 'u1', accountId: 'a1', messageId: 'm1' };
const KEY = 'inputs/00000000-0000-4000-8000-000000000001/garment.jpg';

const pose = (id: string, gender: Gender, shotType: TryonPose['shotType']): TryonPose => ({
  id,
  gender,
  shotType,
  r2Key: `${id}.jpg`,
  workflowTemplateId: 'wf',
  templateVersion: 1,
});
const POOL: TryonPose[] = [
  pose('mf1', 'men', 'full'),
  pose('mf2', 'men', 'full'),
  pose('mf3', 'men', 'full'),
  pose('mh1', 'men', 'half'),
  pose('mh2', 'men', 'half'),
  pose('wf1', 'women', 'full'),
];

function fakeDeps(over: Partial<TryonDeps> & { balance?: number } = {}) {
  const calls = {
    runs: [] as { garmentKey: string; poses: TryonPose[] }[],
    noPoses: [] as Gender[],
  };
  let n = 0;
  const { balance = 100, ...rest } = over;
  const deps: TryonDeps = {
    newNonce: () => `n${++n}`,
    getBalance: async () => balance,
    getTryonCost: async () => 5,
    shuffle: (ids) => ids,
    listPoolPoses: async (g) => POOL.filter((p) => p.gender === g),
    createTryonRun: async (_ctx, a) => {
      calls.runs.push(a);
      return { runId: 'run-1', requested: a.poses.length, created: a.poses.length };
    },
    reportNoPoses: (g) => calls.noPoses.push(g),
    links: { pricing: 'https://p', help: 'https://h', studio: 'https://s' },
    ...rest,
  };
  return { deps, calls };
}

const tapIn = (msgs: OutboundMessage[], action: string, value?: string): InboundEvent => {
  for (const m of msgs) {
    const ids =
      m.kind === 'buttons'
        ? m.buttons.map((b) => b.id)
        : m.kind === 'list'
          ? m.rows.map((r) => r.id)
          : [];
    for (const id of ids) {
      const d = decodeReplyId(id);
      if (d?.action === action && (value === undefined || d.value === value))
        return { type: 'reply', id };
    }
  }
  throw new Error(`${action} not offered: ${JSON.stringify(msgs)}`);
};
const photo: InboundEvent = { type: 'image', garmentKey: KEY };
const titles = (m: OutboundMessage | undefined) =>
  m?.kind === 'list' ? m.rows.map((r) => r.title) : m?.kind === 'buttons' ? m.buttons.map((b) => b.title) : [];
const texts = (msgs: OutboundMessage[]) => msgs.flatMap((m) => (m.kind === 'text' ? [m.text] : []));

async function step(r: EngineResult, e: InboundEvent, deps: TryonDeps) {
  return handleTryon(r.session, e, CTX, deps);
}
async function toGender(deps: TryonDeps) {
  return handleTryon(null, photo, CTX, deps);
}
async function toCount(deps: TryonDeps, g: Gender = 'men') {
  const asked = await toGender(deps);
  return step(asked, tapIn(asked.messages, 'gender', g), deps);
}

describe('try-on engine', () => {
  it('a first photo asks the gender: Men, Women, Boys, Girls', async () => {
    const { deps } = fakeDeps();
    const r = await toGender(deps);
    expect(r.session).toMatchObject({ state: 'ASK_GENDER', garmentKey: KEY });
    expect(titles(r.messages.at(-1))).toEqual(['Men', 'Women', 'Boys', 'Girls']);
  });

  it('a gender shows the count options with their credit cost', async () => {
    const { deps } = fakeDeps();
    const r = await toCount(deps);
    expect(r.session).toMatchObject({ state: 'ASK_POSE_COUNT', gender: 'men', perImage: 5, balance: 100 });
    expect(titles(r.messages.at(-1))).toEqual([
      '1 pose (5 credits)',
      '3 poses (15 credits)',
      '5 poses (25 credits)',
    ]);
  });

  it('offers only affordable counts', async () => {
    const { deps } = fakeDeps({ balance: 12 });
    const r = await toCount(deps);
    expect(titles(r.messages.at(-1))).toEqual(['1 pose (5 credits)']);
  });

  it('offers only counts the pool can fill', async () => {
    const { deps } = fakeDeps();
    const r = await toCount(deps, 'women');
    expect(titles(r.messages.at(-1))).toEqual(['1 pose (5 credits)']);
  });

  it('nothing affordable goes to NO_CREDITS', async () => {
    const { deps } = fakeDeps({ balance: 3 });
    const r = await toCount(deps);
    expect(r.session.state).toBe('NO_CREDITS');
    expect(texts(r.messages).join(' ') + JSON.stringify(r.messages)).toContain('https://p');
  });

  it('a gender with no poses reports it and asks the gender again', async () => {
    const { deps, calls } = fakeDeps();
    const r = await toCount(deps, 'boys');
    expect(calls.noPoses).toEqual(['boys']);
    expect(r.session.state).toBe('ASK_GENDER');
    expect(texts(r.messages)[0]).toContain("don't have poses ready");
  });

  it('a count draws the split for that gender and starts the run', async () => {
    const { deps, calls } = fakeDeps();
    const counts = await toCount(deps);
    const r = await step(counts, tapIn(counts.messages, 'count', '3'), deps);
    expect(calls.runs).toHaveLength(1);
    expect(calls.runs[0].garmentKey).toBe(KEY);
    expect(calls.runs[0].poses.map((p) => p.id)).toEqual(['mf1', 'mf2', 'mh1']);
    expect(r.session).toMatchObject({ state: 'GENERATING', count: 3 });
    expect(r.session.runs).toEqual([{ runId: 'run-1', images: 3 }]);
    expect(texts(r.messages).join('\n')).toContain('Generating your 3 poses');
  });

  it('re-checks the balance at the tap', async () => {
    const { deps, calls } = fakeDeps();
    const counts = await toCount(deps);
    const poor = fakeDeps({ balance: 4 }).deps;
    const r = await step(counts, tapIn(counts.messages, 'count', '1'), poor);
    expect(calls.runs).toHaveLength(0);
    expect(r.session.state).toBe('NO_CREDITS');
  });

  it('INSUFFICIENT_CREDITS from job creation goes to NO_CREDITS', async () => {
    const { deps } = fakeDeps({
      createTryonRun: async () => {
        throw new AppError('INSUFFICIENT_CREDITS', 402, 'no');
      },
    });
    const counts = await toCount(deps);
    const r = await step(counts, tapIn(counts.messages, 'count', '1'), deps);
    expect(r.session.state).toBe('NO_CREDITS');
  });

  it('reports a partly started run', async () => {
    const { deps } = fakeDeps({
      createTryonRun: async (_c, a) => ({
        runId: 'run-2',
        requested: a.poses.length,
        created: 1,
        reason: 'not enough credits',
      }),
    });
    const counts = await toCount(deps);
    const r = await step(counts, tapIn(counts.messages, 'count', '3'), deps);
    expect(texts(r.messages)[0]).toBe("Started 1 of 3 images. The rest couldn't start: not enough credits");
    expect(r.session.runs).toEqual([{ runId: 'run-2', images: 1 }]);
  });

  it('a stale tap re-sends the current step', async () => {
    const { deps } = fakeDeps();
    const counts = await toCount(deps);
    const stale = tapIn(counts.messages, 'count', '1');
    const moved = await step(counts, tapIn(counts.messages, 'count', '1'), deps);
    const r = await handleTryon(moved.session, stale, CTX, deps);
    expect(texts(r.messages)[0]).toBe('That option is from an earlier step.');
  });

  it('the run finishing summarises, then offers Make more / New garment / Menu', async () => {
    const { deps } = fakeDeps();
    const counts = await toCount(deps);
    const gen = await step(counts, tapIn(counts.messages, 'count', '3'), deps);
    const done = await step(
      gen,
      { type: 'runFinished', runId: 'run-1', images: 3, failedPoseIds: [], failed: 1 },
      deps,
    );
    const t = texts(done.messages);
    expect(t[0]).toBe(
      'Here are your 2 generated poses!\nCategory: Men\nCredits used: 10 credits\nRemaining balance: 100 credits',
    );
    expect(t[1]).toBe('1 of 3 images failed. The credits for it were refunded.');
    expect(done.session.state).toBe('DELIVERED');
    expect(titles(done.messages.at(-1))).toEqual(['Make more', 'New garment', 'Menu']);
  });

  it('Make more returns to the count list with the same photo and gender', async () => {
    const { deps } = fakeDeps();
    const counts = await toCount(deps);
    const gen = await step(counts, tapIn(counts.messages, 'count', '1'), deps);
    const done = await step(
      gen,
      { type: 'runFinished', runId: 'run-1', images: 1, failedPoseIds: [] },
      deps,
    );
    const again = await step(done, tapIn(done.messages, 'next', 'more'), deps);
    expect(again.session).toMatchObject({ state: 'ASK_POSE_COUNT', garmentKey: KEY, gender: 'men' });
    expect(again.messages.at(-1)?.kind).toBe('list');
  });

  it('New garment asks for a photo and clears the old one', async () => {
    const { deps } = fakeDeps();
    const counts = await toCount(deps);
    const gen = await step(counts, tapIn(counts.messages, 'count', '1'), deps);
    const done = await step(
      gen,
      { type: 'runFinished', runId: 'run-1', images: 1, failedPoseIds: [] },
      deps,
    );
    const r = await step(done, tapIn(done.messages, 'next', 'new'), deps);
    expect(r.session.state).toBe('ASK_GARMENT_PHOTO');
    expect(r.session.garmentKey).toBeUndefined();
  });

  it('credits added resumes a NO_CREDITS session at the count list', async () => {
    const poor = fakeDeps({ balance: 3 }).deps;
    const stuck = await toCount(poor);
    expect(stuck.session.state).toBe('NO_CREDITS');
    const rich = fakeDeps().deps;
    const r = await handleTryon(stuck.session, { type: 'creditsAdded', credits: 50 }, CTX, rich);
    expect(r.session.state).toBe('ASK_POSE_COUNT');
    expect(texts(r.messages)[0]).toBe('50 credits added.');
  });

  it('a session left by the other flow starts at the menu', async () => {
    const { deps } = fakeDeps();
    const legacy = { v: 1, state: 'PICK_LOOKS', nonce: 'x', page: 0, photos: {}, picked: [] } as unknown as Session;
    const r = await handleTryon(legacy, { type: 'text', text: 'hi' }, CTX, deps);
    expect(r.session.state).toBe('MAIN_MENU');
  });

  it('MENU resets to the menu from anywhere', async () => {
    const { deps } = fakeDeps();
    const counts = await toCount(deps);
    const r = await step(counts, { type: 'text', text: 'menu' }, deps);
    expect(r.session.state).toBe('MAIN_MENU');
    expect(r.session.garmentKey).toBeUndefined();
  });
});
```

- [ ] **Step 4: Run it and confirm it fails**

Run (from `apps/api`): `npx vitest run messaging-tryon-engine` → FAIL (module not found).

- [ ] **Step 5: Implement the engine**

Create `apps/api/src/modules/messaging/engine/tryon-engine.ts`:

```ts
import { AppError } from '../../../lib/errors.js';
import { COPY } from './copy.js';
import { buttons, text } from './engine.js';
import { decodeReplyId, encodeReplyId } from './reply-id.js';
import {
  canFill,
  drawTryonPoses,
  TRYON_COUNTS,
  type TryonCount,
  type TryonPose,
} from './tryon-rules.js';
import type {
  EngineContext,
  EngineDeps,
  EngineResult,
  Gender,
  InboundEvent,
  OutboundMessage,
  Session,
  State,
} from './types.js';

/**
 * The try-on flow (spec 2026-10-22-whatsapp-tryon-flow-design):
 * photo -> gender -> how many poses -> generate. It reuses Session and the state
 * names the catalogue engine already has; it has its own reducer so the
 * catalogue flow stays untouched until this one is approved.
 */
export interface TryonDeps extends Pick<EngineDeps, 'newNonce' | 'getBalance' | 'shuffle' | 'links'> {
  // Credits per image (getTryonCreditCost).
  getTryonCost(): Promise<number>;
  // The drawable poses for a gender, read fresh.
  listPoolPoses(gender: Gender): Promise<TryonPose[]>;
  // One job per pose under one run. Throws AppError (INSUFFICIENT_CREDITS, ...)
  // when no job could be created; `created < requested` is a partial start.
  createTryonRun(
    ctx: EngineContext,
    input: { garmentKey: string; poses: TryonPose[] },
  ): Promise<{ runId: string; requested: number; created: number; reason?: string }>;
  // Admin-facing: a gender with nothing to draw (logged, never shown to the seller).
  reportNoPoses(gender: Gender): void;
}

type Out = OutboundMessage[];

const STATES: State[] = [
  'MAIN_MENU',
  'ASK_GARMENT_PHOTO',
  'ASK_GENDER',
  'ASK_POSE_COUNT',
  'NO_CREDITS',
  'GENERATING',
  'DELIVERED',
];
// The order the product asked for.
const GENDERS: Gender[] = ['men', 'women', 'boys', 'girls'];
// States where free text just shows the current step again.
const IDLE: State[] = ['MAIN_MENU', 'DELIVERED'];
const EXIT_WORDS = new Set(['cancel', 'exit', 'quit', 'back']);

function fresh(deps: TryonDeps): Session {
  return {
    v: 1,
    state: 'MAIN_MENU',
    nonce: deps.newNonce(),
    page: 0,
    // Unused by this flow; the fields are required by Session.
    aspectRatio: '3:4',
    resolution: '2K',
    photos: {},
    picked: [],
  };
}

/** Everything chosen so far dropped; the next step is asked from scratch. */
const cleared = (s: Session, deps: TryonDeps): Session => ({ ...fresh(deps), nonce: s.nonce });

/** Moves to `state` with a fresh nonce and renders its prompt. */
function enter(s: Session, state: State, out: Out, ctx: EngineContext, deps: TryonDeps) {
  return render({ ...s, state, nonce: deps.newNonce(), page: 0 }, out, ctx, deps);
}

async function render(
  s: Session,
  out: Out,
  ctx: EngineContext,
  deps: TryonDeps,
): Promise<EngineResult> {
  const done = (session: Session = s): EngineResult => ({ session, messages: out });

  switch (s.state) {
    case 'MAIN_MENU':
      out.push(
        buttons(s, COPY.menu, [
          ['menu', 'new', COPY.btnMenuNew],
          ['menu', 'credits', COPY.btnCredits],
          ['menu', 'help', COPY.btnHelp],
        ]),
      );
      return done();

    case 'ASK_GARMENT_PHOTO':
      out.push(buttons(s, COPY.askGarmentPhoto, [['menu', 'menu', COPY.btnMenu]]));
      return done();

    case 'ASK_GENDER':
      out.push({
        kind: 'list',
        text: COPY.askGender,
        buttonLabel: COPY.listChoose,
        rows: GENDERS.map((g) => ({
          id: encodeReplyId(s.nonce, 'gender', g),
          title: COPY.genders[g],
        })),
      });
      return done();

    case 'ASK_POSE_COUNT': {
      if (!s.gender) return enter(cleared(s, deps), 'MAIN_MENU', out, ctx, deps);
      const [pool, perImage, balance] = await Promise.all([
        deps.listPoolPoses(s.gender),
        deps.getTryonCost(),
        deps.getBalance(ctx.userId),
      ]);
      const fillable = TRYON_COUNTS.filter((n) => canFill(pool, s.gender as Gender, n));
      if (fillable.length === 0) {
        deps.reportNoPoses(s.gender);
        out.push(text(COPY.tryonNoPoses));
        return enter({ ...s, gender: undefined }, 'ASK_GENDER', out, ctx, deps);
      }
      const offered = fillable.filter((n) => n * perImage <= balance);
      const next: Session = { ...s, perImage, balance };
      if (offered.length === 0) return enter(next, 'NO_CREDITS', out, ctx, deps);
      out.push({
        kind: 'list',
        text: COPY.tryonCountPrompt(COPY.genders[s.gender], perImage, balance),
        buttonLabel: COPY.listChoose,
        rows: offered.map((n) => ({
          id: encodeReplyId(s.nonce, 'count', String(n)),
          title: COPY.countOption(n, n * perImage),
        })),
      });
      return done(next);
    }

    case 'NO_CREDITS':
      out.push(buttons(s, COPY.noCredits(deps.links.pricing), [['menu', 'menu', COPY.btnMenu]]));
      return done();

    case 'GENERATING':
      out.push(text(COPY.generating(s.count ?? 0)));
      return done();

    case 'DELIVERED':
      out.push(
        buttons(s, COPY.deliveredNext, [
          ['next', 'more', COPY.btnMakeMore],
          ['next', 'new', COPY.btnNewGarment],
          ['menu', 'menu', COPY.btnMenu],
        ]),
      );
      return done();

    default:
      return enter(cleared(s, deps), 'MAIN_MENU', out, ctx, deps);
  }
}

/** The count tap: the seller's agreement to spend (D45), so the balance is re-read here. */
async function generate(
  s: Session,
  n: TryonCount,
  out: Out,
  ctx: EngineContext,
  deps: TryonDeps,
): Promise<EngineResult> {
  if (!s.gender || !s.garmentKey) return enter(cleared(s, deps), 'MAIN_MENU', out, ctx, deps);
  const [pool, perImage, balance] = await Promise.all([
    deps.listPoolPoses(s.gender),
    deps.getTryonCost(),
    deps.getBalance(ctx.userId),
  ]);
  if (!canFill(pool, s.gender, n)) {
    // An admin removed poses since the list was shown: nothing is charged.
    out.push(text(COPY.posesChanged));
    return enter(s, 'ASK_POSE_COUNT', out, ctx, deps);
  }
  const noCredits = () => enter({ ...s, perImage, balance }, 'NO_CREDITS', out, ctx, deps);
  if (n * perImage > balance) return noCredits();

  const poses = drawTryonPoses(pool, s.gender, n, deps.shuffle);
  let run: Awaited<ReturnType<TryonDeps['createTryonRun']>>;
  try {
    run = await deps.createTryonRun(ctx, { garmentKey: s.garmentKey, poses });
  } catch (err) {
    if (!(err instanceof AppError)) throw err;
    if (err.code === 'INSUFFICIENT_CREDITS') return noCredits();
    out.push(text(err.message));
    return enter(s, 'ASK_POSE_COUNT', out, ctx, deps);
  }
  if (run.created < run.requested) {
    out.push(text(COPY.partlyStarted(run.created, run.requested, run.reason ?? 'a temporary problem')));
  }
  out.push(text(COPY.generating(run.created)));
  return {
    session: {
      ...s,
      state: 'GENERATING',
      nonce: deps.newNonce(),
      page: 0,
      count: n,
      perImage,
      balance,
      runs: [{ runId: run.runId, images: run.created }],
    },
    messages: out,
  };
}

async function onReply(
  s: Session,
  action: string,
  value: string,
  out: Out,
  ctx: EngineContext,
  deps: TryonDeps,
): Promise<EngineResult> {
  if (action === 'menu') {
    if (value === 'new') return enter(cleared(s, deps), 'ASK_GARMENT_PHOTO', out, ctx, deps);
    if (value === 'credits') {
      const balance = await deps.getBalance(ctx.userId);
      out.push(text(COPY.credits(balance, deps.links.pricing)));
      return render(s, out, ctx, deps);
    }
    if (value === 'help') {
      out.push(text(COPY.help(deps.links.help)));
      return render(s, out, ctx, deps);
    }
    return enter(cleared(s, deps), 'MAIN_MENU', out, ctx, deps);
  }
  if (action === 'gender' && s.state === 'ASK_GENDER') {
    const gender = GENDERS.find((g) => g === value);
    if (!gender) return render(s, out, ctx, deps);
    return enter({ ...s, gender }, 'ASK_POSE_COUNT', out, ctx, deps);
  }
  if (action === 'count' && s.state === 'ASK_POSE_COUNT') {
    const n = TRYON_COUNTS.find((c) => String(c) === value);
    if (!n) return render(s, out, ctx, deps);
    return generate(s, n, out, ctx, deps);
  }
  if (action === 'next' && s.state === 'DELIVERED') {
    if (value === 'more') return enter({ ...s, runs: undefined }, 'ASK_POSE_COUNT', out, ctx, deps);
    return enter(cleared(s, deps), 'ASK_GARMENT_PHOTO', out, ctx, deps);
  }
  return render(s, out, ctx, deps);
}

export async function handleTryon(
  prev: Session | null,
  event: InboundEvent,
  ctx: EngineContext,
  deps: TryonDeps,
): Promise<EngineResult> {
  const out: Out = [];
  // A session saved by the other flow (the flag was switched) starts over.
  const known = prev && STATES.includes(prev.state) ? prev : null;
  if (!known) {
    const s = fresh(deps);
    if (event.type === 'reply' && prev) out.push(text(COPY.sessionExpired));
    if (event.type === 'image') {
      return enter({ ...s, garmentKey: event.garmentKey }, 'ASK_GENDER', out, ctx, deps);
    }
    return render(s, out, ctx, deps);
  }
  const s = known;

  switch (event.type) {
    case 'text': {
      const cmd = event.text.trim().toLowerCase();
      if (cmd === 'menu' || cmd === 'restart' || EXIT_WORDS.has(cmd))
        return enter(cleared(s, deps), 'MAIN_MENU', out, ctx, deps);
      if (cmd === 'help') {
        out.push(text(COPY.help(deps.links.help)));
        return render(s, out, ctx, deps);
      }
      if (IDLE.includes(s.state)) return render(s, out, ctx, deps);
      out.push(text(COPY.reprompt));
      return { session: s, messages: out };
    }

    case 'reply': {
      const d = decodeReplyId(event.id);
      if (!d || d.nonce !== s.nonce) {
        out.push(text(COPY.stale));
        return render(s, out, ctx, deps);
      }
      return onReply(s, d.action, d.value, out, ctx, deps);
    }

    case 'image':
      if (s.state === 'GENERATING') {
        out.push(text(COPY.notNow));
        return render(s, out, ctx, deps);
      }
      return enter(
        { ...cleared(s, deps), garmentKey: event.garmentKey },
        'ASK_GENDER',
        out,
        ctx,
        deps,
      );

    case 'unsupportedMedia':
      out.push(text(COPY.unsupported));
      return s.state === 'ASK_GARMENT_PHOTO'
        ? { session: s, messages: out }
        : render(s, out, ctx, deps);

    case 'runFinished': {
      const mine = (s.runs ?? []).find((r) => r.runId === event.runId);
      // A run from an earlier session still gets its images (delivery sends by
      // run); only the closing message here is skipped.
      if (!mine || mine.finished) return { session: s, messages: out };
      const failed = event.failed ?? event.failedPoseIds.length;
      const delivered = Math.max(event.images - failed, 0);
      const runs = (s.runs ?? []).map((r) =>
        r.runId === event.runId ? { ...r, finished: true, failed } : r,
      );
      if (delivered > 0) {
        const remaining = await deps.getBalance(ctx.userId);
        out.push(
          text(
            COPY.tryonDelivered(
              delivered,
              COPY.genders[(s.gender ?? 'men') as Gender],
              delivered * (s.perImage ?? 0),
              remaining,
            ),
          ),
        );
      }
      if (failed > 0) out.push(text(COPY.partlyFailed(failed, event.images)));
      return enter({ ...s, runs }, 'DELIVERED', out, ctx, deps);
    }

    case 'creditsAdded':
      out.push(text(COPY.creditsAdded(event.credits)));
      if (s.state === 'NO_CREDITS' && s.gender && s.garmentKey)
        return enter(s, 'ASK_POSE_COUNT', out, ctx, deps);
      return { session: s, messages: out };
  }
}
```

- [ ] **Step 6: Run the tests and typecheck**

Run (from `apps/api`): `npx vitest run messaging-tryon-engine` → PASS (17 tests).
Run: `npx tsc --noEmit` → clean.
Run: `npx vitest run messaging whatsapp` → everything still passes (catalogue engine unchanged apart from two `export` keywords).
If a test expectation is off by wording from `COPY` (e.g. `COPY.credits`, `COPY.help`), fix the test to the real copy, not the copy.

- [ ] **Step 7: Commit (only when approved)**

```bash
git add apps/api/src/modules/messaging/engine apps/api/test/messaging-tryon-engine.test.ts
git commit -m "feat(whatsapp): try-on engine (photo, gender, pose count, generate)"
```

---

### Task 7: Wiring and the flag

**Files:**
- Modify: `apps/api/src/env.ts` (after `WHATSAPP_RESULTS_TEMPLATE`, ~line 204)
- Modify: `.env.example` (~line 175), `.env.production.example` (~line 236)
- Create: `apps/api/src/modules/messaging/tryon-deps.ts`
- Modify: `apps/api/src/modules/messaging/conversation.ts`
- Test: `apps/api/test/integration/messaging-tryon-conversation.test.ts`

**Interfaces:**
- Consumes: `handleTryon`, `TryonDeps` (Task 6), `listPoolPoses`, `createTryonRun` (Task 4), `createEngineDeps` (existing; reuse `newNonce`, `getBalance`, `shuffle`, `links`).
- Produces: `createTryonDeps(app): TryonDeps`; `WHATSAPP_BOT_FLOW: 'catalogue' | 'tryon'`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/integration/messaging-tryon-conversation.test.ts`:

```ts
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runConversation } from '../../src/modules/messaging/conversation';
import { decodeReplyId } from '../../src/modules/messaging/engine/reply-id';
import type { InboundEvent, OutboundMessage } from '../../src/modules/messaging/engine/types';
import { CHANNEL_WHATSAPP, connectAccount } from '../../src/modules/messaging/identity';
import { storeGarmentPhoto } from '../../src/modules/messaging/photos';
import { loadSession } from '../../src/modules/messaging/session-store';
import { buildTestApp, type TestApp } from '../helpers/api';
import { createVerifiedUserToken } from '../helpers/auth';
import { type Containers, startContainers } from '../helpers/containers';

function tapIn(msgs: OutboundMessage[], action: string, value?: string): InboundEvent {
  for (const m of msgs) {
    const ids =
      m.kind === 'buttons'
        ? m.buttons.map((b) => b.id)
        : m.kind === 'list'
          ? m.rows.map((r) => r.id)
          : [];
    for (const id of ids) {
      const d = decodeReplyId(id);
      if (d?.action === action && (value === undefined || d.value === value))
        return { type: 'reply', id };
    }
  }
  throw new Error(`${action} not offered: ${JSON.stringify(msgs)}`);
}

describe('whatsapp try-on flow (real deps, WHATSAPP_BOT_FLOW=tryon)', () => {
  let c: Containers;
  let app: TestApp;
  let realHeadObject: TestApp['storage']['headObject'];

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c, {
      MESSAGING_WHATSAPP_ENABLED: true,
      WEB_URL: 'http://localhost:3000',
      WHATSAPP_BOT_FLOW: 'tryon',
    });
    realHeadObject = app.storage.headObject.bind(app.storage);
    const sfx = `${Date.now()}`;
    await app.db
      .insert(schema.creditPlans)
      .values({ slug: 'free', name: 'free', credits: 1000, basePaise: 0, watermark: false })
      .onConflictDoNothing({ target: schema.creditPlans.slug });
    const [wf] = await app.db
      .insert(schema.workflowTemplates)
      .values({
        slug: `tc-wf-${sfx}`,
        label: 'Tryon',
        jsonContent: {},
        workflowType: 'tryon',
        poseNodeId: '1',
        upperNodeIds: [],
        garmentPhasePromptNode: '2',
      })
      .returning();
    const mk = (i: number, shotType: 'full' | 'half') => ({
      label: `TcPose${sfx}-${i}`,
      genderSlug: 'men',
      shotType,
      r2Key: `tc-${sfx}-${i}.jpg`,
      thumbnailKey: `tc-${sfx}-${i}.thumb.jpg`,
      workflowTemplateId: wf.id,
      whatsappPool: true,
    });
    await app.db
      .insert(schema.modelPoseAssets)
      .values([mk(1, 'full'), mk(2, 'full'), mk(3, 'full'), mk(4, 'half'), mk(5, 'half')]);
  }, 60000);
  beforeEach(() => {
    app.storage.headObject = (async () => ({ contentLength: 1024 })) as typeof app.storage.headObject;
  });
  afterEach(() => {
    app.storage.headObject = realHeadObject;
  });
  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  it('photo → Men → 3 poses creates 3 charged jobs under one recorded run', async () => {
    const { userId } = await createVerifiedUserToken(app, `tc-${Date.now()}@example.com`);
    await app.db.insert(schema.userCredits).values({ userId, balance: 100 });
    const { account } = await connectAccount(app.db, {
      channel: CHANNEL_WHATSAPP,
      externalId: `+91${Date.now().toString().slice(-10)}`,
      userId,
      linkedVia: 'web_code',
    });
    const acct = { id: account.id, userId, channel: account.channel, externalId: account.externalId };
    let n = 0;
    const send = (e: InboundEvent) => runConversation(app, acct, e, `wamid.tc.${++n}`);

    const key = await storeGarmentPhoto(app, userId, Buffer.from('fake-jpeg'), 'image/jpeg');
    let msgs = await send({ type: 'image', garmentKey: key });
    msgs = await send(tapIn(msgs, 'gender', 'men'));
    msgs = await send(tapIn(msgs, 'count', '3'));

    const session = await loadSession(app.redis, acct.channel, acct.externalId);
    expect(session?.state).toBe('GENERATING');
    const runId = session?.runs?.[0]?.runId as string;
    const [run] = await app.db
      .select()
      .from(schema.messagingRuns)
      .where(eq(schema.messagingRuns.catalogueId, runId));
    expect(run.jobIds).toHaveLength(3);

    const poses = await app.db
      .select({ params: schema.jobInputs.params })
      .from(schema.jobInputs)
      .innerJoin(schema.jobs, eq(schema.jobs.id, schema.jobInputs.jobId))
      .where(eq(schema.jobs.catalogueId, runId));
    expect(poses).toHaveLength(3);
    const [credits] = await app.db
      .select({ balance: schema.userCredits.balance })
      .from(schema.userCredits)
      .where(eq(schema.userCredits.userId, userId));
    expect(credits.balance).toBe(85);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run (from `apps/api`): `npx vitest run --config vitest.integration.config.ts messaging-tryon-conversation` → FAIL (the catalogue engine handles the flow, or the env key is unknown).

- [ ] **Step 3: Add the env flag**

`apps/api/src/env.ts`, after the `WHATSAPP_RESULTS_TEMPLATE` entry:

```ts
  // Which bot flow answers: 'catalogue' (garment type, templates) or 'tryon' (photo,
  // gender, pose count; spec 2026-10-22-whatsapp-tryon-flow-design). Read per message,
  // so a restart switches it.
  WHATSAPP_BOT_FLOW: z.enum(['catalogue', 'tryon']).default('catalogue'),
```
Add to `.env.example` (after `WHATSAPP_DISPLAY_NUMBER=`) and `.env.production.example` (after its `WHATSAPP_DISPLAY_NUMBER=`):
```
# 'catalogue' (default) or 'tryon' — which WhatsApp bot flow answers.
WHATSAPP_BOT_FLOW=catalogue
```

- [ ] **Step 4: Real deps**

Create `apps/api/src/modules/messaging/tryon-deps.ts`:

```ts
import { whatsappGarmentUnavailableTotal } from '@aivastra/observability';
import type { FastifyInstance } from 'fastify';
import { getTryonCreditCost } from '../../lib/resolution-config.js';
import { createEngineDeps } from './deps.js';
import type { TryonDeps } from './engine/tryon-engine.js';
import { createTryonRun, listPoolPoses } from './tryon-jobs.js';

/** Real TryonDeps. Nonce, balance, shuffle and links are the catalogue flow's own. */
export function createTryonDeps(app: FastifyInstance): TryonDeps {
  const base = createEngineDeps(app);
  return {
    newNonce: base.newNonce,
    getBalance: base.getBalance,
    shuffle: base.shuffle,
    links: base.links,
    getTryonCost: () => getTryonCreditCost(app),
    listPoolPoses: (gender) => listPoolPoses(app, gender),
    createTryonRun: (ctx, input) => createTryonRun(app, ctx, input),
    // Info, not warn: it is admin data. The label reuses the existing counter.
    reportNoPoses: (gender) => {
      whatsappGarmentUnavailableTotal.inc({ reason: 'no_poses' });
      app.log.info({ gender }, 'whatsapp: no try-on poses for gender');
    },
  };
}
```
If `whatsappGarmentUnavailableTotal`'s `reason` label is a closed enum in `packages/observability`, `no_poses` will not type-check: in that case drop the metric line and keep only the log.

- [ ] **Step 5: Select the engine**

In `conversation.ts` add imports and replace the `handle(...)` call:

```ts
import { handleTryon } from './engine/tryon-engine.js';
import { createTryonDeps } from './tryon-deps.js';
```
```ts
  const prev = await loadSession(app.redis, account.channel, account.externalId);
  const ctx = { userId: account.userId, accountId: account.id, messageId };
  // WHATSAPP_BOT_FLOW=tryon swaps the whole reducer; both read and write the same
  // session key, and each starts a session left by the other cleanly.
  const { session, messages } =
    app.env.WHATSAPP_BOT_FLOW === 'tryon'
      ? await handleTryon(prev, event, ctx, createTryonDeps(app))
      : await handle(prev, event, ctx, deps);
```
(Remove the old inline ctx object.)

- [ ] **Step 6: Verify**

Run: `npx vitest run --config vitest.integration.config.ts messaging-tryon-conversation` → PASS.
Run: `npx tsc --noEmit` → clean.
Run: `npx vitest run messaging whatsapp` → all pass.
Run: `npx vitest run --config vitest.integration.config.ts whatsapp-inbound whatsapp-hooks messaging-connect` → no new failures (the NO_CREDITS pose-cards test in `whatsapp-hooks` is a known earlier failure).

- [ ] **Step 7: Commit (only when approved)**

```bash
git add apps/api/src/env.ts .env.example .env.production.example apps/api/src/modules/messaging/tryon-deps.ts apps/api/src/modules/messaging/conversation.ts apps/api/test/integration/messaging-tryon-conversation.test.ts
git commit -m "feat(whatsapp): WHATSAPP_BOT_FLOW=tryon selects the try-on engine"
```

---

### Task 8: Admin "WhatsApp Poses" tab

**Files:**
- Modify: `apps/admin-web/src/types.ts` (`ModelPoseAsset`)
- Modify: `apps/admin-web/src/pages/assets/AssetsContext.tsx` (`AssetTab` union and `VALID_TABS`)
- Modify: `apps/admin-web/src/pages/AssetsPage.tsx` (`TABS`, import, render)
- Create: `apps/admin-web/src/pages/assets/WhatsappPosesTab.tsx`

**Interfaces:**
- Consumes: `GET /admin/assets/pose-assets` (items with `whatsappPool`, `genderSlug`, `shotType`, `workflowTemplateId`, `thumbnailUrl`, `isActive`), `PATCH /admin/assets/pose-assets/:id` (Task 1), `useAssetsContext().workflows`, `apiFetch`/`apiErrorMessage` from `../../lib/data`.

- [ ] **Step 1: Type and tab registration**

`types.ts`: in `ModelPoseAsset` add after `scope: 'general' | 'template';`:
```ts
  /** In the WhatsApp bot's draw pool (Assets → WhatsApp Poses). */
  whatsappPool?: boolean;
```
`AssetsContext.tsx`: add `| 'whatsapp-poses'` to the `AssetTab` union and `'whatsapp-poses',` to `VALID_TABS` (after `'pose-assets'`).
`AssetsPage.tsx`: import `import { WhatsappPosesTab } from './assets/WhatsappPosesTab';`, add `{ k: 'whatsapp-poses' as const, l: 'WhatsApp Poses' },` to `TABS` after the Pose Assets entry, and render `{activeTab === 'whatsapp-poses' && <WhatsappPosesTab />}` after the pose-assets line.

- [ ] **Step 2: The tab**

Create `apps/admin-web/src/pages/assets/WhatsappPosesTab.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AssetThumb } from '../../components/AssetThumb';
import { apiErrorMessage, apiFetch } from '../../lib/data';
import type { ModelPoseAsset } from '../../types';
import { useAssetsContext } from './AssetsContext';

// The counts the bot offers and what each draws (mirrors apps/api tryon-rules.ts
// TRYON_SPLIT; the server is authoritative — this is only for the warning strip).
const NEEDS: { n: number; full: number; half: number }[] = [
  { n: 1, full: 1, half: 0 },
  { n: 3, full: 2, half: 1 },
  { n: 5, full: 3, half: 2 },
];
const GENDERS = [
  { k: 'men', l: 'Men' },
  { k: 'women', l: 'Women' },
  { k: 'boys', l: 'Boys' },
  { k: 'girls', l: 'Girls' },
] as const;

/** A pose the bot can actually draw: the same rules as the API's pool query. */
function drawable(p: ModelPoseAsset, tryonWorkflowIds: Set<string>) {
  return (
    p.whatsappPool === true &&
    p.isActive &&
    !p.deletedAt &&
    (p.shotType === 'full' || p.shotType === 'half') &&
    !!p.genderSlug &&
    !!p.workflowTemplateId &&
    tryonWorkflowIds.has(p.workflowTemplateId)
  );
}

export function WhatsappPosesTab() {
  const { workflows, toast, setPreviewUrl } = useAssetsContext();
  const [poses, setPoses] = useState<ModelPoseAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ items: ModelPoseAsset[] }>('/admin/assets/pose-assets');
      setPoses(res.items);
    } catch (e) {
      toast({ kind: 'error', title: 'Could not load poses', body: apiErrorMessage(e) });
    } finally {
      setLoading(false);
    }
  }, [toast]);
  useEffect(() => {
    void load();
  }, [load]);

  const tryonIds = useMemo(
    () => new Set(workflows.filter((w) => w.workflowType === 'tryon' && w.isActive).map((w) => w.id)),
    [workflows],
  );
  const wfLabel = (id: string | null) => workflows.find((w) => w.id === id)?.label ?? '—';

  const setPool = async (p: ModelPoseAsset, whatsappPool: boolean) => {
    setBusy(p.id);
    try {
      await apiFetch(`/admin/assets/pose-assets/${p.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ whatsappPool }),
      });
      setPoses((prev) => prev.map((x) => (x.id === p.id ? { ...x, whatsappPool } : x)));
    } catch (e) {
      toast({ kind: 'error', title: 'Update failed', body: apiErrorMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  const inPool = poses.filter((p) => p.whatsappPool === true);
  const candidates = poses.filter(
    (p) => p.whatsappPool !== true && (p.shotType === 'full' || p.shotType === 'half'),
  );
  const count = (g: string, shot: 'full' | 'half') =>
    poses.filter((p) => drawable(p, tryonIds) && p.genderSlug === g && p.shotType === shot).length;

  const Section = ({ shot, title }: { shot: 'full' | 'half'; title: string }) => {
    const list = inPool.filter((p) => p.shotType === shot);
    return (
      <div style={{ marginBottom: 24 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
          {title} <span style={{ color: 'var(--muted)' }}>({list.length})</span>
        </h3>
        {list.length === 0 ? (
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>No {title.toLowerCase()} in the pool yet.</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
            {list.map((p) => {
              const ok = drawable(p, tryonIds);
              return (
                <div key={p.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                  <button
                    type="button"
                    onClick={() => p.r2Url && setPreviewUrl(p.r2Url)}
                    style={{ all: 'unset', cursor: 'zoom-in', display: 'block', width: '100%' }}
                  >
                    <AssetThumb src={p.thumbnailUrl} alt={p.displayName ?? p.label} />
                  </button>
                  <div style={{ padding: '8px 8px 10px' }}>
                    <p
                      style={{ fontSize: 11, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      title={p.displayName ?? p.label}
                    >
                      {p.displayName ?? p.label}
                    </p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 4 }}>
                      <span className="badge dot accent" style={{ fontSize: 10 }}>
                        {p.genderSlug ?? 'no gender'}
                      </span>
                      <span className="badge dot accent" style={{ fontSize: 10 }} title="Workflow">
                        {wfLabel(p.workflowTemplateId)}
                      </span>
                      {!ok && (
                        <span className="badge" style={{ fontSize: 10, color: 'var(--amber, #b45309)' }} title="Needs a gender, an active try-on workflow, and to be active">
                          not drawable
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      className="btn"
                      disabled={busy === p.id}
                      onClick={() => void setPool(p, false)}
                      style={{ marginTop: 8, fontSize: 11 }}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  if (loading) return <div style={{ color: 'var(--muted)', padding: '2rem', textAlign: 'center' }}>Loading…</div>;

  return (
    <div>
      <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>
        The WhatsApp bot draws poses from here: 1 pose = 1 Full · 3 = 2 Full + 1 Half · 5 = 3 Full + 2 Half,
        filtered by the gender the seller taps. A pose needs a gender and an active try-on workflow.
        Edit those in Pose Assets.
      </p>

      <div className="card" style={{ padding: 12, marginBottom: 16, overflowX: 'auto' }}>
        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left' }}>
              <th style={{ padding: '4px 8px' }}>Gender</th>
              <th style={{ padding: '4px 8px' }}>Full</th>
              <th style={{ padding: '4px 8px' }}>Half</th>
              <th style={{ padding: '4px 8px' }}>Bot can offer</th>
            </tr>
          </thead>
          <tbody>
            {GENDERS.map((g) => {
              const full = count(g.k, 'full');
              const half = count(g.k, 'half');
              const offers = NEEDS.filter((x) => full >= x.full && half >= x.half).map((x) => x.n);
              return (
                <tr key={g.k}>
                  <td style={{ padding: '4px 8px' }}>{g.l}</td>
                  <td style={{ padding: '4px 8px' }}>{full}</td>
                  <td style={{ padding: '4px 8px' }}>{half}</td>
                  <td
                    style={{
                      padding: '4px 8px',
                      color: offers.length === NEEDS.length ? 'var(--mint, #047857)' : 'var(--amber, #b45309)',
                    }}
                  >
                    {offers.length === 0 ? 'nothing — this gender gets "no poses yet"' : offers.join(' / ')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Section shot="full" title="Full poses" />
      <Section shot="half" title="Half poses" />

      <button type="button" className="btn" onClick={() => setAdding((v) => !v)}>
        {adding ? 'Close' : 'Add from Pose Assets'}
      </button>
      {adding && (
        <div style={{ marginTop: 12 }}>
          {candidates.length === 0 ? (
            <p style={{ color: 'var(--muted)', fontSize: 13 }}>
              No Full or Half poses left to add. Upload poses in Pose Assets first.
            </p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
              {candidates.map((p) => (
                <div key={p.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                  <AssetThumb src={p.thumbnailUrl} alt={p.displayName ?? p.label} />
                  <div style={{ padding: '8px 8px 10px' }}>
                    <p style={{ fontSize: 11, fontWeight: 600 }}>{p.displayName ?? p.label}</p>
                    <p style={{ fontSize: 10, color: 'var(--muted)' }}>
                      {p.shotType} · {p.genderSlug ?? 'no gender'}
                    </p>
                    <button
                      type="button"
                      className="btn"
                      disabled={busy === p.id}
                      onClick={() => void setPool(p, true)}
                      style={{ marginTop: 8, fontSize: 11 }}
                    >
                      Add
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```
Before finalising, open `apps/admin-web/src/components/AssetThumb.tsx` and match its real props (the usage above assumes `src` and `alt`); and check how `PoseAssetsTab` names the `btn` classes and the `setPreviewUrl` context member (it is exposed by `useAssetsContext`, see `AssetsPage.tsx`). Adjust names to what exists; do not invent props.

- [ ] **Step 3: Verify**

Run (from `apps/admin-web`): `pnpm exec tsc -p tsconfig.app.json --noEmit` → clean.
Run lint for the file if configured: `pnpm exec eslint src/pages/assets/WhatsappPosesTab.tsx` → clean.
Manual check (record the result honestly): start admin-web against a dev API, open Assets → WhatsApp Poses; add a Full pose, confirm the Full section lists it, the strip counts update, Remove returns it to the "Add" list. If the dev stack is not available, say so instead of claiming it works.

- [ ] **Step 4: Commit (only when approved)**

```bash
git add apps/admin-web/src
git commit -m "feat(admin): WhatsApp Poses tab for the bot's pose pool"
```

---

### Task 9: Progress log and final verification

**Files:**
- Modify: `docs/progress.md` (new dated entry at the top, newest first; read the top entries for the format first)

- [ ] **Step 1: Log**

Add a `2026-10-22` entry under Done / Failed-Not-Done / Open Questions covering: the new flow and flag, the `whatsapp_pool` migration (`0230_*`), the `whatsapp_tryon` job source, the admin tab; and under Open: real-number WhatsApp test; the three stale Flow-2 integration tests (`messaging-conversation` ×2, `whatsapp-hooks` NO_CREDITS); studio-gallery exclusion means results appear only in the chat (no web copy); Back poses deferred; old catalogue flow still present pending approval; the flag must be set to `tryon` and at least one gender's pool filled (staging first).

- [ ] **Step 2: Final verification (report each result honestly)**

Run (from `apps/api`): `npx tsc --noEmit`; `npx vitest run messaging whatsapp tryon`; `npx vitest run --config vitest.integration.config.ts admin-whatsapp-pool messaging-tryon-jobs messaging-tryon-conversation admin-job-taxonomy whatsapp-inbound messaging-connect`.
Run (repo root): `pnpm --filter @aivastra/types build` and `pnpm --filter @aivastra/admin exec tsc -p tsconfig.app.json --noEmit`.
Expected: all green except the known pre-existing failures listed above; any other failure is a regression to fix.

- [ ] **Step 3: Commit (only when approved)**

```bash
git add docs/progress.md
git commit -m "docs: progress entry for the WhatsApp try-on flow"
```

---

## Self-review notes

- **Spec coverage:** pool column + migration (T1); admin tab (T8); job source + shared run id (T2); split/draw/fillable counts (T3); pool query + job creation + idempotency + partial start + ownership (T4); runFinished failed count (T5); engine states, count list with credits, NO_CREDITS, no-poses message, Make more / New garment / Menu (T6); flag + wiring + legacy-session handling (T6 `handleTryon` known-state check, T7). The spec's separate `/admin/whatsapp-poses` routes were folded into the existing pose-asset GET/PATCH (simpler, same permission, audit already wired); the tab computes the per-gender strip client-side.
- **Deviations from the spec to confirm with the user:** (1) the pool also requires the pose's workflow to be `workflow_type = 'tryon'`; (2) WhatsApp try-on jobs are excluded from the studio gallery, so results exist only in the chat; (3) the admin API surface is the existing pose-asset routes.
- **Type consistency:** `TryonPose`, `TryonCount`, `canFill`, `drawTryonPoses`, `TRYON_COUNTS` defined in T3 and used unchanged in T4/T6; `createTryonRun` return shape defined in T4 matches `TryonDeps.createTryonRun` in T6; `RunRef.failed` and `runFinished.failed` defined in T5 and read in T6.
