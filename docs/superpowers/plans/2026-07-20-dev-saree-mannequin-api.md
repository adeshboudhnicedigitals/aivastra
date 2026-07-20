# Dev API — Saree Mannequin Endpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `POST /v1/dev/saree-mannequin`, a new developer-API endpoint that accepts a single
garment-cloth image and returns a job id for the existing saree-mannequin (step-1) generation
pipeline, without touching `/v1/dev/tryon`'s route, contract, or behavior at all.

**Architecture:** A single new Fastify route in `apps/api/src/modules/dev/routes.ts`, backed by a
new job-creation function (`createDevSareeMannequinJob`) that shares a refactored-out transaction
helper with the existing `createDevTryonJob`. The dispatcher's `processSareeMannequinJob` gets one
guard fixed so a null `faceId` (which this endpoint always sends) doesn't get rejected before the
workflow template — which has no person node to patch anyway — is even looked up.

**Tech Stack:** Fastify 5, Zod (`fastify-type-provider-zod`), Drizzle ORM, Vitest (real
Postgres/Redis/MinIO via docker-compose, no testcontainers).

## Global Constraints

- Never introduce npm/yarn lockfiles — pnpm workspaces only.
- ESM only, Node 20+, TypeScript 5.6.
- No `console.log` in committed code — use `@aivastra/logger`'s `createLogger`.
- `/v1/dev/tryon`'s route, request/response contract, and the `saree` `tryon_categories` entry's
  linked template (`saree_tryon`, id `5e11bc13-...`) must not change at all.
- Credit deduct + job insert stay one Postgres transaction (existing invariant, preserved by the
  refactor).
- Tests reuse the docker-compose Postgres/Redis/MinIO already running — `pnpm docker:up` must be
  running before any `pnpm test`. No testcontainers.

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/api/src/modules/dev/create-job.ts` | Gains one exported helper (`createDevJobCore`) that both job-creation functions call. `createDevTryonJob`'s public signature/behavior is unchanged. |
| `apps/api/src/modules/dev/create-saree-mannequin-job.ts` | New. `createDevSareeMannequinJob` — resolves the mannequin-step garment type/template, validates, calls `createDevJobCore`. |
| `apps/api/src/modules/dev/routes.ts` | Gains one new route, `POST /v1/dev/saree-mannequin`, added after the existing `/v1/dev/tryon` route. |
| `packages/types/src/dev.ts` | Gains `DevSareeMannequinJsonBody`. Reuses the existing `DevTryonResponse` for the response shape. |
| `apps/dispatcher/src/job/processor.ts` | `processSareeMannequinJob`'s early input guard is reordered — `faceId` is only required when the resolved template has a `tryonPersonNodeId`. |
| `apps/api/test/helpers/merchant.ts` | Gains `createTestSareeMannequinGarmentType`, mirroring the existing `createTestTryonCategory` helper. |
| `apps/api/test/dev-saree-mannequin-create.test.ts` | New. Integration tests for the new route. |
| `apps/dispatcher/test/integration/saree-mannequin.test.ts` | Gains one new test case: a template with no person node + `faceId: null` still completes. |
| `apps/api/dev-api-quickstart.md` | New section documenting the endpoint. |

---

### Task 1: Extract shared dev-job transaction helper

**Files:**
- Modify: `apps/api/src/modules/dev/create-job.ts`
- Test: `apps/api/test/dev-tryon-create.test.ts` (existing — must still pass unchanged)

**Interfaces:**
- Produces: `createDevJobCore(app: FastifyInstance, params: { merchantUserId: string; apiKeyId: string; cost: number; watermark: boolean; metricKind: string; buildJobInputs: () => Omit<typeof schema.jobInputs.$inferInsert, 'jobId'> }): Promise<{ jobId: string }>` — exported from `create-job.ts`, used by both `createDevTryonJob` (this task) and `createDevSareeMannequinJob` (Task 5).

This is a pure refactor — no behavior change, so there's no new failing test to write first. The
regression check is: run the existing test suite before touching the file, then again after, and
diff the results.

- [ ] **Step 1: Run the existing dev-tryon test suite and record the baseline**

Run: `pnpm --filter @aivastra/api test -- dev-tryon-create`
Expected: all tests in `dev-tryon-create.test.ts` PASS (this is the baseline — note the count).

- [ ] **Step 2: Read the current file**

Read `apps/api/src/modules/dev/create-job.ts` in full before editing (already shown below for
reference — the current file, end to end):

```ts
import { randomUUID } from 'node:crypto';
import type { DB } from '@aivastra/db';
import { schema } from '@aivastra/db';
import { jobsCreatedTotal } from '@aivastra/observability';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../../lib/errors.js';
import { getTryonCreditCost } from '../../lib/resolution-config.js';
import { atomicDeduct, refund } from '../credits/ledger.js';

export async function createDevTryonJob(
  app: FastifyInstance,
  params: {
    merchantId: string;
    merchantUserId: string;
    apiKeyId: string;
    categorySlug: string;
    personKey: string;
    garmentKey: string;
  },
): Promise<{ jobId: string }> {
  const cost = await getTryonCreditCost(app);

  const [category] = await app.db
    .select({
      workflowTemplateId: schema.tryonCategories.workflowTemplateId,
      templateIsActive: schema.workflowTemplates.isActive,
    })
    .from(schema.tryonCategories)
    .leftJoin(
      schema.workflowTemplates,
      eq(schema.workflowTemplates.id, schema.tryonCategories.workflowTemplateId),
    )
    .where(
      and(
        eq(schema.tryonCategories.slug, params.categorySlug),
        eq(schema.tryonCategories.isActive, true),
      ),
    )
    .limit(1);

  if (!category) throw new AppError('BAD_CATEGORY', 400, 'unknown or inactive category');
  if (!category.workflowTemplateId || !category.templateIsActive) {
    throw new AppError('BAD_CATEGORY', 400, 'category has no active workflow configured');
  }

  const [user] = await app.db
    .select({ isBanned: schema.users.isBanned })
    .from(schema.users)
    .where(eq(schema.users.id, params.merchantUserId));
  if (!user || user.isBanned) throw new AppError('FORBIDDEN', 403, 'account suspended');

  const catalogueId = randomUUID();
  const [job] = await app.db.transaction(async (tx) => {
    const [newJob] = await tx
      .insert(schema.jobs)
      .values({
        userId: params.merchantUserId,
        apiKeyId: params.apiKeyId,
        catalogueId,
        status: 'QUEUED',
        priority: false,
        queueStream: 'normal',
        watermark: false,
        creditsCharged: cost,
        source: 'api',
      })
      .returning();
    if (!newJob) throw new AppError('INTERNAL', 500, 'failed to create job');

    await atomicDeduct(tx as unknown as DB, params.merchantUserId, cost, newJob.id);

    await tx.insert(schema.jobInputs).values({
      jobId: newJob.id,
      upperGarmentKey: params.garmentKey,
      params: { personKey: params.personKey, workflowTemplateId: category.workflowTemplateId },
    });
    return [newJob];
  });
  if (!job) throw new AppError('INTERNAL', 500, 'failed to create job');

  try {
    await app.redis.xadd(
      'jobs:normal',
      'MAXLEN',
      '~',
      10000,
      '*',
      'jobId',
      job.id,
      'userId',
      params.merchantUserId,
    );
    jobsCreatedTotal.inc({ priority: 'normal', kind: 'tryon' });
  } catch (err) {
    app.log.error({ err, jobId: job.id }, 'redis xadd failed — dev tryon job will be refunded');
    await refund(app.db, params.merchantUserId, cost, job.id, 'REFUND_ENQUEUE_FAIL');
    await app.db
      .update(schema.jobs)
      .set({ status: 'FAILED', errorCode: 'ENQUEUE_FAIL' })
      .where(eq(schema.jobs.id, job.id));
    throw new AppError('ENQUEUE_FAIL', 503, 'queue unavailable');
  }

  return { jobId: job.id };
}
```

- [ ] **Step 3: Rewrite the file — extract `createDevJobCore`, rebuild `createDevTryonJob` on top of it**

Replace the entire contents of `apps/api/src/modules/dev/create-job.ts` with:

```ts
import { randomUUID } from 'node:crypto';
import type { DB } from '@aivastra/db';
import { schema } from '@aivastra/db';
import { jobsCreatedTotal } from '@aivastra/observability';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../../lib/errors.js';
import { getTryonCreditCost } from '../../lib/resolution-config.js';
import { atomicDeduct, refund } from '../credits/ledger.js';

/**
 * Shared insert/deduct/enqueue/refund-on-fail core for every dev-API job kind.
 * Deliberately NOT part of jobs/create.ts — see createDevTryonJob's original
 * comment for why the dev API needs its own creation path.
 */
export async function createDevJobCore(
  app: FastifyInstance,
  params: {
    merchantUserId: string;
    apiKeyId: string;
    cost: number;
    watermark: boolean;
    metricKind: string;
    buildJobInputs: () => Omit<typeof schema.jobInputs.$inferInsert, 'jobId'>;
  },
): Promise<{ jobId: string }> {
  const catalogueId = randomUUID();
  const [job] = await app.db.transaction(async (tx) => {
    const [newJob] = await tx
      .insert(schema.jobs)
      .values({
        userId: params.merchantUserId,
        apiKeyId: params.apiKeyId,
        catalogueId,
        status: 'QUEUED',
        priority: false,
        queueStream: 'normal',
        watermark: params.watermark,
        creditsCharged: params.cost,
        source: 'api',
      })
      .returning();
    if (!newJob) throw new AppError('INTERNAL', 500, 'failed to create job');

    await atomicDeduct(tx as unknown as DB, params.merchantUserId, params.cost, newJob.id);

    await tx.insert(schema.jobInputs).values({
      jobId: newJob.id,
      ...params.buildJobInputs(),
    });
    return [newJob];
  });
  if (!job) throw new AppError('INTERNAL', 500, 'failed to create job');

  try {
    await app.redis.xadd(
      'jobs:normal',
      'MAXLEN',
      '~',
      10000,
      '*',
      'jobId',
      job.id,
      'userId',
      params.merchantUserId,
    );
    jobsCreatedTotal.inc({ priority: 'normal', kind: params.metricKind });
  } catch (err) {
    app.log.error(
      { err, jobId: job.id },
      `redis xadd failed — dev ${params.metricKind} job will be refunded`,
    );
    await refund(app.db, params.merchantUserId, params.cost, job.id, 'REFUND_ENQUEUE_FAIL');
    await app.db
      .update(schema.jobs)
      .set({ status: 'FAILED', errorCode: 'ENQUEUE_FAIL' })
      .where(eq(schema.jobs.id, job.id));
    throw new AppError('ENQUEUE_FAIL', 503, 'queue unavailable');
  }

  return { jobId: job.id };
}

export async function createDevTryonJob(
  app: FastifyInstance,
  params: {
    merchantId: string;
    merchantUserId: string;
    apiKeyId: string;
    categorySlug: string;
    personKey: string;
    garmentKey: string;
  },
): Promise<{ jobId: string }> {
  const cost = await getTryonCreditCost(app);

  // Kill-switch parity: a category an admin deactivated, or one whose workflow
  // template is inactive, must not resolve. This runs before any credit
  // movement, so a rejected request is always free.
  const [category] = await app.db
    .select({
      workflowTemplateId: schema.tryonCategories.workflowTemplateId,
      templateIsActive: schema.workflowTemplates.isActive,
    })
    .from(schema.tryonCategories)
    .leftJoin(
      schema.workflowTemplates,
      eq(schema.workflowTemplates.id, schema.tryonCategories.workflowTemplateId),
    )
    .where(
      and(
        eq(schema.tryonCategories.slug, params.categorySlug),
        eq(schema.tryonCategories.isActive, true),
      ),
    )
    .limit(1);

  if (!category) throw new AppError('BAD_CATEGORY', 400, 'unknown or inactive category');
  if (!category.workflowTemplateId || !category.templateIsActive) {
    throw new AppError('BAD_CATEGORY', 400, 'category has no active workflow configured');
  }

  const [user] = await app.db
    .select({ isBanned: schema.users.isBanned })
    .from(schema.users)
    .where(eq(schema.users.id, params.merchantUserId));
  if (!user || user.isBanned) throw new AppError('FORBIDDEN', 403, 'account suspended');

  return createDevJobCore(app, {
    merchantUserId: params.merchantUserId,
    apiKeyId: params.apiKeyId,
    cost,
    watermark: false,
    metricKind: 'tryon',
    buildJobInputs: () => ({
      upperGarmentKey: params.garmentKey,
      params: { personKey: params.personKey, workflowTemplateId: category.workflowTemplateId },
    }),
  });
}
```

- [ ] **Step 4: Build the api package**

Run: `pnpm --filter @aivastra/api build`
Expected: PASS, no type errors.

- [ ] **Step 5: Re-run the dev-tryon test suite and confirm identical results**

Run: `pnpm --filter @aivastra/api test -- dev-tryon-create`
Expected: same PASS count as Step 1. This proves the refactor changed nothing observable.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/dev/create-job.ts
git commit -m "refactor(dev-api): extract shared job-creation core from createDevTryonJob"
```

---

### Task 2: Add the new request schema

**Files:**
- Modify: `packages/types/src/dev.ts`

**Interfaces:**
- Produces: `DevSareeMannequinJsonBody: ZodObject<{ garment: ZodString }>`, exported from
  `@aivastra/types` (re-exported via `packages/types/src/index.ts:7`, already `export * from
  './dev.js'` — no change needed there).

- [ ] **Step 1: Add the schema**

In `packages/types/src/dev.ts`, add after the existing `DevTryonJsonBody` block (after line 26):

```ts
// JSON/base64 alternative to the multipart upload for the saree-mannequin
// endpoint — single image, no category/person (see DevTryonJsonBody above).
export const DevSareeMannequinJsonBody = z.object({
  garment: z.string().min(1),
});
```

- [ ] **Step 2: Build the types package**

Run: `pnpm --filter @aivastra/types build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/types/src/dev.ts
git commit -m "feat(types): add DevSareeMannequinJsonBody schema"
```

---

### Task 3: Test helper for a mannequin-step garment type

**Files:**
- Modify: `apps/api/test/helpers/merchant.ts`

**Interfaces:**
- Consumes: `schema.workflowTemplates`, `schema.garmentSubcategories` (from `@aivastra/db`) —
  same tables/columns as the existing `createTestTryonCategory` helper in this file.
- Produces: `createTestSareeMannequinGarmentType(app: TestApp, opts?: { isActive?: boolean;
  templateIsActive?: boolean; withPersonNode?: boolean }): Promise<{ garmentTypeId: string;
  workflowTemplateId: string }>` — used by Task 4's tests.

- [ ] **Step 1: Add the helper**

In `apps/api/test/helpers/merchant.ts`, add after `createTestTryonCategory` (end of file):

```ts
/**
 * Creates a garment_subcategories row with requires_mannequin_step = true, plus
 * the saree_step1 workflow template it points at. Mirrors createTestTryonCategory
 * above, adapted for the mannequin-step shape (garment + output node only —
 * no pose/upper/lower/face-node fields apply to workflowType 'saree_step1').
 */
export async function createTestSareeMannequinGarmentType(
  app: TestApp,
  opts: { isActive?: boolean; templateIsActive?: boolean; withPersonNode?: boolean } = {},
) {
  const [wf] = await app.db
    .insert(schema.workflowTemplates)
    .values({
      slug: `saree-step1-${randomUUID()}`,
      label: 'Test Saree Step1 WF',
      jsonContent: {
        '31': { class_type: 'LoadImage', inputs: { image: 'placeholder.jpg' } },
        '134': { class_type: 'SaveImage', inputs: {} },
      },
      poseNodeId: 'x',
      upperNodeIds: [],
      garmentPhasePromptNode: 'x',
      workflowType: 'saree_step1',
      tryonPersonNodeId: opts.withPersonNode ? '1' : null,
      tryonGarmentNodeId: '31',
      tryonOutputNodeId: '134',
      isActive: opts.templateIsActive ?? true,
    })
    .returning();
  if (!wf) throw new Error('failed to create test saree step1 workflow template');

  const [garmentType] = await app.db
    .insert(schema.garmentSubcategories)
    .values({
      genderSlug: 'women',
      slug: `flat-saree-${randomUUID()}`,
      label: 'Test Flat Saree',
      isActive: opts.isActive ?? true,
      requiresMannequinStep: true,
      mannequinWorkflowTemplateId: wf.id,
    })
    .returning();
  if (!garmentType) throw new Error('failed to create test flat-saree garment type');

  return { garmentTypeId: garmentType.id, workflowTemplateId: wf.id };
}
```

- [ ] **Step 2: Build to confirm no type errors**

Run: `pnpm --filter @aivastra/api build`
Expected: PASS. (Test files aren't part of the build's `tsconfig.build.json` include — if this
step reports no errors touching `test/`, that's expected; a real check happens once Task 4 runs
this helper. If the build config *does* include test files and errors here, fix the type error
before moving on.)

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/helpers/merchant.ts
git commit -m "test(dev-api): add createTestSareeMannequinGarmentType helper"
```

---

### Task 4: Write the failing integration tests

**Files:**
- Create: `apps/api/test/dev-saree-mannequin-create.test.ts`

**Interfaces:**
- Consumes: `buildTestApp`, `startContainers` (`./helpers/api.js`, `./helpers/containers.js`),
  `createTestMerchant`, `createTestApiKey`, `createTestSareeMannequinGarmentType`
  (`./helpers/merchant.js`, Task 3).
- Consumes (route under test, not yet implemented — this task's tests FAIL until Task 5 lands):
  `POST /v1/dev/saree-mannequin`.

- [ ] **Step 1: Write the test file**

```ts
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from './helpers/api.js';
import { type Containers, startContainers } from './helpers/containers.js';
import {
  createTestApiKey,
  createTestMerchant,
  createTestSareeMannequinGarmentType,
} from './helpers/merchant.js';

let c: Containers;
let app: TestApp;
let base: string;
let key: string;
let userId: string;
let setCredits: (n: number) => Promise<void>;

const jpegBytes = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);

function form(opts: { garment?: Buffer; garmentType?: string } = {}) {
  const fd = new FormData();
  fd.set(
    'garment',
    new Blob([opts.garment ?? jpegBytes()], { type: opts.garmentType ?? 'image/jpeg' }),
    'garment.jpg',
  );
  return fd;
}

const post = (fd: FormData, token = key) =>
  fetch(`${base}/v1/dev/saree-mannequin`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: fd,
  });

const postJson = (body: unknown, token = key) =>
  fetch(`${base}/v1/dev/saree-mannequin`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  c = await startContainers();
  app = await buildTestApp(c);
  await app.ready();
  const addr = app.server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;

  const m = await createTestMerchant(app, { balance: 100 });
  userId = m.userId;
  setCredits = m.credits;
  ({ key } = await createTestApiKey(app, m.merchantId));

  await createTestSareeMannequinGarmentType(app);
});

afterAll(async () => {
  await app.close();
  await c.stop();
});

const balance = async () => {
  const [row] = await app.db
    .select()
    .from(schema.userCredits)
    .where(eq(schema.userCredits.userId, userId));
  return row?.balance ?? 0;
};

describe('POST /v1/dev/saree-mannequin', () => {
  it('creates a queued job, deducts credits, and writes the saree_mannequin job shape', async () => {
    const before = await balance();
    const res = await post(form());
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.status).toBe('QUEUED');

    const [job] = await app.db.select().from(schema.jobs).where(eq(schema.jobs.id, body.jobId));
    expect(job?.source).toBe('api');
    expect(job?.apiKeyId).toBeTruthy();
    expect(job?.watermark).toBe(false);
    expect(await balance()).toBe(before - job!.creditsCharged);

    const [inputs] = await app.db
      .select()
      .from(schema.jobInputs)
      .where(eq(schema.jobInputs.jobId, body.jobId));
    expect(inputs!.upperGarmentKey).toBeTruthy();
    expect(inputs!.garmentTypeId).toBeTruthy();
    expect(inputs!.faceId).toBeNull();
    expect(inputs!.backgroundId).toBeNull();
    expect(inputs!.poseId).toBeNull();
    const params = inputs!.params as Record<string, unknown>;
    expect(params.kind).toBe('saree_mannequin');
  });

  it('enqueues the job on jobs:normal', async () => {
    const res = await post(form());
    const { jobId } = await res.json();
    const entries = await app.redis.xrange('jobs:normal', '-', '+');
    const ids = entries.flatMap(([, fields]) => {
      const i = fields.indexOf('jobId');
      return i >= 0 ? [fields[i + 1]] : [];
    });
    expect(ids).toContain(jobId);
  });

  it('rejects an unauthenticated request with 401', async () => {
    const res = await fetch(`${base}/v1/dev/saree-mannequin`, { method: 'POST', body: form() });
    expect(res.status).toBe(401);
  });

  it('rejects a non-image disguised with an image content-type', async () => {
    const before = await balance();
    const res = await post(
      form({ garment: Buffer.from('#!/bin/sh\nrm -rf /', 'utf8'), garmentType: 'image/jpeg' }),
    );
    expect(res.status).toBe(400);
    expect(await balance()).toBe(before);
  });

  it('rejects a request missing the garment file with 400', async () => {
    const fd = new FormData();
    expect((await post(fd)).status).toBe(400);
  });

  it('returns 402 when the merchant has insufficient credits', async () => {
    await setCredits(0);
    const res = await post(form());
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error.code).toBe('INSUFFICIENT_CREDITS');
    await setCredits(100);
  });
});

describe('POST /v1/dev/saree-mannequin (JSON/base64 body)', () => {
  it('creates a queued job', async () => {
    const before = await balance();
    const res = await postJson({ garment: jpegBytes().toString('base64') });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.status).toBe('QUEUED');
    expect(await balance()).toBeLessThan(before);
  });

  it('accepts a data: URI prefix', async () => {
    const b64 = jpegBytes().toString('base64');
    const res = await postJson({ garment: `data:image/jpeg;base64,${b64}` });
    expect(res.status).toBe(202);
  });

  it('rejects malformed base64 with 400', async () => {
    const res = await postJson({ garment: '!!!not-base64!!!' });
    expect(res.status).toBe(400);
  });
});

describe('POST /v1/dev/saree-mannequin (unconfigured)', () => {
  it('rejects with 400 and does not move credits when no mannequin garment type is active', async () => {
    // Fresh merchant/app instance with no createTestSareeMannequinGarmentType call.
    const c2 = await startContainers();
    const app2 = await buildTestApp(c2);
    await app2.ready();
    const addr2 = app2.server.address();
    const base2 = `http://127.0.0.1:${typeof addr2 === 'object' && addr2 ? addr2.port : 0}`;
    const m2 = await createTestMerchant(app2, { balance: 100 });
    const { key: key2 } = await createTestApiKey(app2, m2.merchantId);

    const before = await app2.db
      .select()
      .from(schema.userCredits)
      .where(eq(schema.userCredits.userId, m2.userId));

    const res = await fetch(`${base2}/v1/dev/saree-mannequin`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key2}` },
      body: form(),
    });
    expect(res.status).toBe(400);

    const after = await app2.db
      .select()
      .from(schema.userCredits)
      .where(eq(schema.userCredits.userId, m2.userId));
    expect(after[0]?.balance).toBe(before[0]?.balance);

    await app2.close();
    await c2.stop();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails for the right reason**

Run: `pnpm --filter @aivastra/api test -- dev-saree-mannequin-create`
Expected: FAIL — every request returns 404 (route doesn't exist yet). This is the expected
pre-implementation failure; if you see a different failure (e.g. a TypeScript error), fix that
first before proceeding.

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/dev-saree-mannequin-create.test.ts
git commit -m "test(dev-api): add failing tests for POST /v1/dev/saree-mannequin"
```

---

### Task 5: Implement the job-creation function and the route

**Files:**
- Create: `apps/api/src/modules/dev/create-saree-mannequin-job.ts`
- Modify: `apps/api/src/modules/dev/routes.ts`

**Interfaces:**
- Consumes: `createDevJobCore` (Task 1), `DevSareeMannequinJsonBody` (Task 2), `DevTryonResponse`
  (existing, `@aivastra/types`), `MAX_FILE_BYTES`/`EXT_BY_MIME`/`rateLimitConfig`/`sniffImageMime`
  (existing module-level consts/import already in `routes.ts`).
- Produces: `createDevSareeMannequinJob(app: FastifyInstance, params: { merchantUserId: string;
  apiKeyId: string; garmentKey: string }): Promise<{ jobId: string }>`.

- [ ] **Step 1: Write `createDevSareeMannequinJob`**

Create `apps/api/src/modules/dev/create-saree-mannequin-job.ts`:

```ts
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../../lib/errors.js';
import { getTryonCreditCost } from '../../lib/resolution-config.js';
import { createDevJobCore } from './create-job.js';

/**
 * Creates a developer-API saree-mannequin (step-1) job from a raw garment
 * cloth image. Resolves the workflow off whichever garment_subcategories row
 * has requires_mannequin_step = true — today, exactly one (Flat Saree). No
 * category/garmentType param yet; add one if a second such garment type ever
 * exists (see docs/superpowers/specs/2026-07-20-dev-saree-mannequin-api-design.md).
 *
 * faceId is always null here — the workflow's face comes from a fixed URL node
 * baked into the template, not a caller-supplied image.
 */
export async function createDevSareeMannequinJob(
  app: FastifyInstance,
  params: {
    merchantUserId: string;
    apiKeyId: string;
    garmentKey: string;
  },
): Promise<{ jobId: string }> {
  const cost = await getTryonCreditCost(app);

  const [garmentType] = await app.db
    .select({
      id: schema.garmentSubcategories.id,
      workflowTemplateId: schema.garmentSubcategories.mannequinWorkflowTemplateId,
      isActive: schema.garmentSubcategories.isActive,
    })
    .from(schema.garmentSubcategories)
    .where(eq(schema.garmentSubcategories.requiresMannequinStep, true))
    .limit(1);

  if (!garmentType || !garmentType.isActive || !garmentType.workflowTemplateId) {
    throw new AppError('BAD_CATEGORY', 400, 'saree mannequin generation is not configured');
  }

  const [template] = await app.db
    .select({ isActive: schema.workflowTemplates.isActive })
    .from(schema.workflowTemplates)
    .where(eq(schema.workflowTemplates.id, garmentType.workflowTemplateId));
  if (!template?.isActive) {
    throw new AppError('BAD_CATEGORY', 400, 'saree mannequin generation is not configured');
  }

  const [user] = await app.db
    .select({ isBanned: schema.users.isBanned })
    .from(schema.users)
    .where(eq(schema.users.id, params.merchantUserId));
  if (!user || user.isBanned) throw new AppError('FORBIDDEN', 403, 'account suspended');

  return createDevJobCore(app, {
    merchantUserId: params.merchantUserId,
    apiKeyId: params.apiKeyId,
    cost,
    watermark: false,
    metricKind: 'saree_mannequin',
    buildJobInputs: () => ({
      upperGarmentKey: params.garmentKey,
      garmentTypeId: garmentType.id,
      faceId: null,
      params: { kind: 'saree_mannequin' },
    }),
  });
}
```

- [ ] **Step 2: Add the route**

In `apps/api/src/modules/dev/routes.ts`:

Add to the imports at the top:

```ts
import { DevSareeMannequinJsonBody, /* ...existing imports... */ } from '@aivastra/types';
import { createDevSareeMannequinJob } from './create-saree-mannequin-job.js';
```

(Merge `DevSareeMannequinJsonBody` into the existing `@aivastra/types` import block rather than
adding a second import line.)

Then add the new route inside `devRoutes`, immediately after the closing `);` of the existing
`POST /v1/dev/tryon` route (after line 221 in the current file, before `GET /v1/dev/jobs/:id`):

```ts
  app.post(
    '/v1/dev/saree-mannequin',
    {
      preHandler: app.requireApiKey,
      config: rateLimitConfig,
      // One image, base64-inflated ~1.34x — 10MB source caps around 13.4MB of JSON text.
      bodyLimit: 15 * 1024 * 1024,
      attachValidation: true,
      schema: {
        tags: ['dev'],
        summary: 'Generate a saree-draped mannequin image from a garment cloth photo',
        description:
          'Upload a saree/garment cloth image, either as multipart/form-data (field: garment) ' +
          'or as a JSON body with a base64-encoded image (field: garment — plain base64 or a ' +
          'data: URI). The face/model is fixed by the configured workflow, not caller-supplied. ' +
          'Returns a job id to poll.',
        consumes: ['multipart/form-data', 'application/json'],
        body: DevSareeMannequinJsonBody,
        response: { 202: DevTryonResponse },
      },
    },
    async (req, reply) => {
      const merchantId = req.merchantId as string;
      const merchantUserId = req.merchantUserId as string;
      const apiKeyId = req.apiKeyId as string;

      let garmentFile: { buf: Buffer; mime: string } | undefined;

      const isJson = (req.headers['content-type'] ?? '').startsWith('application/json');

      if (isJson) {
        const parsed = DevSareeMannequinJsonBody.safeParse(req.body);
        if (!parsed.success) {
          throw new AppError(
            'VALIDATION',
            400,
            parsed.error.issues[0]?.message ?? 'invalid request body',
          );
        }
        const raw = parsed.data.garment.replace(/^data:[^;]+;base64,/, '');
        const buf = Buffer.from(raw, 'base64');
        if (buf.length === 0 || buf.length > MAX_FILE_BYTES) {
          throw new AppError('VALIDATION', 400, 'garment exceeds the 10MB limit');
        }
        const mime = sniffImageMime(buf);
        if (!mime) {
          throw new AppError('VALIDATION', 400, 'garment must be a JPEG, PNG, or WebP image');
        }
        garmentFile = { buf, mime };
      } else {
        const parts = req.parts({ limits: { fileSize: MAX_FILE_BYTES, files: 1 } });
        for await (const part of parts) {
          if (part.type !== 'file') continue;
          if (part.fieldname !== 'garment') {
            throw new AppError('VALIDATION', 400, `unexpected file field: ${part.fieldname}`);
          }
          const buf = await part.toBuffer().catch(() => {
            throw new AppError('VALIDATION', 400, 'garment exceeds the 10MB limit');
          });
          if (part.file.truncated) {
            throw new AppError('VALIDATION', 400, 'garment exceeds the 10MB limit');
          }
          const mime = sniffImageMime(buf);
          if (!mime) {
            throw new AppError('VALIDATION', 400, 'garment must be a JPEG, PNG, or WebP image');
          }
          garmentFile = { buf, mime };
        }
      }

      if (!garmentFile) throw new AppError('VALIDATION', 400, 'garment image is required');

      const garmentKey = keys.devUpload(
        merchantId,
        randomUUID(),
        EXT_BY_MIME[garmentFile.mime as keyof typeof EXT_BY_MIME],
      );
      await app.storage.putObject(garmentKey, garmentFile.buf, garmentFile.mime);

      const { jobId } = await createDevSareeMannequinJob(app, {
        merchantUserId,
        apiKeyId,
        garmentKey,
      });

      return reply.code(202).send({ jobId, status: 'QUEUED' });
    },
  );

```

- [ ] **Step 3: Build**

Run: `pnpm --filter @aivastra/api build`
Expected: PASS.

- [ ] **Step 4: Run the new tests**

Run: `pnpm --filter @aivastra/api test -- dev-saree-mannequin-create`
Expected: all PASS.

- [ ] **Step 5: Run the full dev-* test suite to confirm no regression**

Run: `pnpm --filter @aivastra/api test -- dev-`
Expected: all PASS, including `dev-tryon-create.test.ts` (proves `/v1/dev/tryon` is untouched).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/dev/create-saree-mannequin-job.ts apps/api/src/modules/dev/routes.ts
git commit -m "feat(dev-api): add POST /v1/dev/saree-mannequin"
```

---

### Task 6: Fix the dispatcher's faceId guard

**Files:**
- Modify: `apps/dispatcher/src/job/processor.ts:808-824`
- Test: `apps/dispatcher/test/integration/saree-mannequin.test.ts`

**Interfaces:**
- No new exports — internal fix to `processSareeMannequinJob`.

- [ ] **Step 1: Write the failing test**

In `apps/dispatcher/test/integration/saree-mannequin.test.ts`, add a second `it` block inside the
existing `describe('dispatcher — saree mannequin (step 1) job', ...)`, after the existing
`seedMannequinJob` function and its test:

```ts
  async function seedMannequinJobNoPersonNode() {
    const [user] = await env.db
      .insert(schema.users)
      .values({ email: `mannequin-noface-${Date.now()}@test.com`, passwordHash: 'x', tier: 'free' })
      .returning();

    const [template] = await env.db
      .insert(schema.workflowTemplates)
      .values({
        slug: `saree-step1-nopersonnode-${Date.now()}`,
        label: 'Step1 No Person Node',
        jsonContent: {
          '2': { class_type: 'LoadImage', inputs: { image: 'placeholder.jpg' } },
        },
        workflowType: 'saree_step1',
        faceNodeId: '',
        poseNodeId: '',
        bgNodeId: '',
        upperNodeIds: [],
        facePhasePromptNode: '',
        garmentPhasePromptNode: '',
        tryonPersonNodeId: null,
        tryonGarmentNodeId: '2',
        tryonOutputNodeId: '10',
      })
      .returning();

    const [garmentType] = await env.db
      .insert(schema.garmentSubcategories)
      .values({
        genderSlug: 'women',
        slug: `flat-saree-noface-${Date.now()}`,
        label: 'Flat Saree No Face',
        requiresMannequinStep: true,
        mannequinWorkflowTemplateId: template.id,
      })
      .returning();

    const [job] = await env.db
      .insert(schema.jobs)
      .values({ userId: user.id, status: 'QUEUED', priority: false, creditsCharged: 0 })
      .returning();

    await env.db.insert(schema.jobInputs).values({
      jobId: job.id,
      upperGarmentKey: `inputs/${job.id}/garment.jpg`,
      faceId: null,
      garmentTypeId: garmentType.id,
      params: { kind: 'saree_mannequin' },
    });

    await env.s3.send(
      new PutObjectCommand({
        Bucket: env.r2Bucket,
        Key: `inputs/${job.id}/garment.jpg`,
        Body: Buffer.from('stub'),
        ContentType: 'image/jpeg',
      }),
    );

    return { jobId: job.id, userId: user.id };
  }

  it('processes a saree_mannequin job with no person node and null faceId to COMPLETED', async () => {
    const { jobId, userId } = await seedMannequinJobNoPersonNode();
    const log = createLogger('test');

    await processJob(
      { db: env.db, redis, pub, storage: env.storage, s3: env.s3, r2Bucket: env.r2Bucket, log },
      jobId,
      userId,
      'jobs:normal',
      '1-2',
    );

    const [job] = await env.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    expect(job?.status).toBe('COMPLETED');

    const prompt = comfy.lastPrompt();
    // Garment node was patched with the uploaded file; no person node exists to patch.
    expect(prompt?.prompt['2']?.inputs?.image).toBeTruthy();
  });
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter @aivastra/dispatcher exec vitest run -c vitest.integration.config.ts test/integration/saree-mannequin.test.ts`
Expected: FAIL — the new test's job ends `FAILED` with `errorCode: 'MANNEQUIN_INPUTS_MISSING'`
(the current guard rejects `faceId: null` unconditionally). The pre-existing test in this file
should still PASS.

- [ ] **Step 3: Fix the guard**

In `apps/dispatcher/src/job/processor.ts`, replace the block currently at lines 808-885
(`const garmentKey = inputs.upperGarmentKey;` through the `MANNEQUIN_NODES_NOT_CONFIGURED` check)
with:

```ts
  const garmentKey = inputs.upperGarmentKey;
  const faceId = inputs.faceId;
  const garmentTypeId = inputs.garmentTypeId;

  if (!garmentKey || !garmentTypeId) {
    await markFailed(
      cfg,
      jobId,
      userId,
      stream,
      messageId,
      'MANNEQUIN_INPUTS_MISSING',
      jobLog,
      startedAt,
    );
    return;
  }

  const [garmentType] = await db
    .select({
      mannequinWorkflowTemplateId: schema.garmentSubcategories.mannequinWorkflowTemplateId,
    })
    .from(schema.garmentSubcategories)
    .where(eq(schema.garmentSubcategories.id, garmentTypeId));
  const workflowTemplateId = garmentType?.mannequinWorkflowTemplateId;
  if (!workflowTemplateId) {
    await markFailed(
      cfg,
      jobId,
      userId,
      stream,
      messageId,
      'MANNEQUIN_WORKFLOW_NOT_CONFIGURED',
      jobLog,
      startedAt,
    );
    return;
  }

  const [template] = await db
    .select({
      jsonContent: schema.workflowTemplates.jsonContent,
      tryonPersonNodeId: schema.workflowTemplates.tryonPersonNodeId,
      tryonGarmentNodeId: schema.workflowTemplates.tryonGarmentNodeId,
      tryonOutputNodeId: schema.workflowTemplates.tryonOutputNodeId,
    })
    .from(schema.workflowTemplates)
    .where(eq(schema.workflowTemplates.id, workflowTemplateId));
  if (!template) {
    await markFailed(
      cfg,
      jobId,
      userId,
      stream,
      messageId,
      'WORKFLOW_NOT_FOUND',
      jobLog,
      startedAt,
    );
    return;
  }

  const personNodeId = template.tryonPersonNodeId;
  const garmentNodeId = template.tryonGarmentNodeId;
  const outputNodeId = template.tryonOutputNodeId;
  if (!garmentNodeId || !outputNodeId) {
    await markFailed(
      cfg,
      jobId,
      userId,
      stream,
      messageId,
      'MANNEQUIN_NODES_NOT_CONFIGURED',
      jobLog,
      startedAt,
    );
    return;
  }

  // Only templates with a person node need a caller-supplied face — templates
  // that bake the face in directly (e.g. a fixed URL node) have nothing to
  // resolve here regardless of what faceId arrived as.
  if (personNodeId && !faceId) {
    await markFailed(
      cfg,
      jobId,
      userId,
      stream,
      messageId,
      'MANNEQUIN_INPUTS_MISSING',
      jobLog,
      startedAt,
    );
    return;
  }
```

(The downstream block starting `let personKey: string | undefined;` at what is currently line
887 is unchanged — it already gates on `if (personNodeId)`.)

- [ ] **Step 4: Build the dispatcher**

Run: `pnpm --filter @aivastra/dispatcher build`
Expected: PASS.

- [ ] **Step 5: Run the test again and confirm both cases pass**

Run: `pnpm --filter @aivastra/dispatcher exec vitest run -c vitest.integration.config.ts test/integration/saree-mannequin.test.ts`
Expected: PASS — both the pre-existing `faceId`-present test and the new `faceId: null` test.

- [ ] **Step 6: Commit**

```bash
git add apps/dispatcher/src/job/processor.ts apps/dispatcher/test/integration/saree-mannequin.test.ts
git commit -m "fix(dispatcher): only require faceId for saree-mannequin templates with a person node"
```

---

### Task 7: Document the endpoint

**Files:**
- Modify: `apps/api/dev-api-quickstart.md`

- [ ] **Step 1: Add a new section**

Add a new section after `## 3b. JSON/base64 instead of multipart` (before `## 4. Node.js
example`), matching the existing doc's tone and structure:

```markdown
## 3c. Saree mannequin generation

A separate, single-image endpoint: `POST /v1/dev/saree-mannequin`. Send one `garment` image
(the saree/garment cloth photo) — no `person` image, no `category`. The model/face is fixed by
the configured workflow, not caller-supplied. Same 202 + poll pattern, same `GET
/v1/dev/jobs/:id` polling, same credit/refund/error behavior as `/v1/dev/tryon` above.

```bash
curl -s -X POST "$API_URL/v1/dev/saree-mannequin" \
  -H "Authorization: Bearer $API_KEY" \
  -F "garment=@saree.jpg"
# => {"jobId": "...", "status": "QUEUED"}
```

Or JSON/base64:

```bash
python3 -c "
import json, base64
garment = base64.b64encode(open('saree.jpg', 'rb').read()).decode()
print(json.dumps({'garment': garment}))
" > body.json

curl -s -X POST "$API_URL/v1/dev/saree-mannequin" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  --data @body.json
```

If no mannequin-step garment type is configured (or its workflow is inactive), this returns
`400 BAD_CATEGORY` with no credits charged — same kill-switch behavior as an unknown/inactive
`category` on `/v1/dev/tryon`.
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/dev-api-quickstart.md
git commit -m "docs(dev-api): document POST /v1/dev/saree-mannequin"
```

---

## Manual smoke test (not automated — needs a live GPU worker)

After all tasks land, to actually see a generated image end-to-end against the real (remote)
worker fleet:

```bash
curl -s -X POST "http://localhost:4000/v1/dev/saree-mannequin" \
  -H "Authorization: Bearer sk_live_kDozmq4gymCu0JiohdqLLACDjwFzSj-iNlEZnxJvXHQ" \
  -F "garment=@sareetest.jpg" | python3 -m json.tool
# => {"jobId": "...", "status": "QUEUED"}

curl -s "http://localhost:4000/v1/dev/jobs/<jobId>" \
  -H "Authorization: Bearer sk_live_kDozmq4gymCu0JiohdqLLACDjwFzSj-iNlEZnxJvXHQ" | python3 -m json.tool
# repeat until status is COMPLETED (imageUrl) or FAILED (error)
```

This dispatches a real job to a live remote ComfyUI worker (`w1/w2/w3.aivastra.com`) — real GPU
compute, real credits deducted from the `scvx` test merchant account.
