# Refund on Customer Request Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A catalogues-web customer can request a refund for one generated image; an admin approves or rejects it in the admin panel, and credits are returned only on approval.

**Architecture:** A new `refund_requests` table (one row per job, unique `job_id`) holds the request. Customer routes create the request and report per-job status; admin routes list, approve and reject. Approval credits the user through a transaction-scoped extract of the existing `refund()` ledger logic, so the status flip, the credit and the audit row commit together. Regenerate and download are gated server-side while a request is `PENDING` or `APPROVED`.

**Tech Stack:** Fastify 5 + `fastify-type-provider-zod`, Drizzle/Postgres, Vitest (integration harness `buildTestApp`), Next.js 15 + React Query (catalogues-web), Vite + React (admin-web), Resend mailer.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-10-12-refund-on-request-design.md` (read it first).
- Branch from `dev`; never commit on `dev`. Schema/migration work happens locally only, never against production (CLAUDE.md "Production safety").
- Migration number is `0221` (`0220` is the latest on `dev`). If `dev` has gained a migration since, regenerate and renumber (`docs/version-control.md`).
- ESM only, pnpm only. No `console.log`; use the pino logger (`app.log`).
- Request/response shapes are Zod schemas in `packages/types` — the single source of truth.
- Credit refund ledger reason is exactly `REFUND_USER_REQUEST`.
- Refund amount is the job's `creditsCharged` snapshotted at request time. No partial refunds.
- Eligibility (all required): job belongs to the caller; `status = 'COMPLETED'`; `job_outputs.downloaded_at IS NULL`; `creditsCharged > 0`; `merchantId`, `apiKeyId` and `shopifyStoreId` all NULL; no existing request for the job.
- Note max 300 characters. Admin reject requires an admin note (3–500 chars).
- Every admin mutation calls `recordAudit(tx, ...)` inside the mutation transaction (fail-closed). Permissions: `credits.read` for list, `credits.write` for approve/reject.
- UI: colours from `C` tokens (never raw hex in new code); dropdowns via `PremiumSelect` (catalogues-web) and `SearchableSelect` (admin-web), never a raw `<select>`.
- Admin URL standard (`docs/admin-url-routing-standard.md`): the open request is a URL param via `useUrlState`; the status filter is local state; closing an overlay uses `useCloseOverlay`.
- Integration tests need `pnpm docker:up`. Run one file: `cd apps/api && npx vitest run --config vitest.integration.config.ts <pattern>`.
- Do not commit or push beyond the per-task commits below; do not open the PR without being asked.

## Deviations from the spec (apply in Task 7)

1. `downloadedAt` is stamped by `POST /v1/jobs/:id/download`, **not** `GET /result` (which is called just to display images). The download gate goes on the POST; `GET /result` stays open.
2. Status for tiles comes from one batched `GET /v1/jobs/refund-status?jobIds=…`, not a new field on the job list endpoint.
3. The admin status filter is local state (per the URL standard); only the open request is in the URL.
4. Approve re-checks `downloaded_at IS NULL` and answers 409 if the image was downloaded in the race window; the admin should reject instead.

## File Structure

| File | Responsibility |
|---|---|
| `packages/types/src/refund.ts` (+ `index.ts`, `refund.test.ts`) | Zod schemas, reason codes and labels |
| `packages/db/src/schema/refund-requests.ts` (+ `schema/index.ts`) | `refund_requests` table |
| `packages/db/src/migrations/0221_*.sql` (+ snapshot, journal) | Generated migration |
| `apps/api/src/modules/credits/ledger.ts` | Adds `applyRefundTx`; `refund()` reuses it |
| `apps/api/src/modules/jobs/refund-requests.ts` | Eligibility, create, status, `hasActiveRefundRequest`, customer routes |
| `apps/api/src/modules/jobs/regenerate.ts`, `routes.ts` | Gates (regenerate, download) |
| `apps/api/src/modules/admin/refund-requests.routes.ts` | Admin list / approve / reject |
| `apps/api/src/lib/mailer.ts` | `sendRefundDecisionEmail` |
| `apps/api/src/server.ts` | Registers both route plugins |
| `apps/admin-web/src/pages/RefundRequestsPage.tsx` (+ `App.tsx`, `Sidebar.tsx`, `types.ts`) | Admin page |
| `apps/catalogues-web/src/hooks/use-refund-statuses.ts` | Batched status query |
| `apps/catalogues-web/src/app/(app)/studio/refund-request-modal.tsx` | Request modal |
| `apps/catalogues-web/src/app/(app)/studio/generation-panel.tsx`, `lib/feature-flags.ts` | Button, chip, gating |
| `docs/progress.md`, the spec | Rollout notes, spec corrections |

---

### Task 1: Shared types, table and migration

**Files:**
- Create: `packages/types/src/refund.ts`, `packages/types/src/refund.test.ts`, `packages/db/src/schema/refund-requests.ts`
- Modify: `packages/types/src/index.ts`, `packages/db/src/schema/index.ts`
- Generate: `packages/db/src/migrations/0221_*.sql`, `meta/0221_snapshot.json`, `meta/_journal.json`

**Interfaces:**
- Produces: `REFUND_REASON_CODES`, `RefundReasonCode`, `REFUND_REASON_LABELS`, `RefundStatus`, `CreateRefundRequestBody`, `AdminApproveRefundBody`, `AdminRejectRefundBody` (from `@aivastra/types`); `schema.refundRequests` (from `@aivastra/db`).

- [ ] **Step 1: Write the failing types test**

`packages/types/src/refund.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  AdminRejectRefundBody,
  CreateRefundRequestBody,
  REFUND_REASON_CODES,
  REFUND_REASON_LABELS,
} from './refund.js';

describe('refund schemas', () => {
  it('has a label for every reason code', () => {
    for (const code of REFUND_REASON_CODES) {
      expect(REFUND_REASON_LABELS[code]).toBeTruthy();
    }
  });

  it('accepts a valid request and trims the note', () => {
    const parsed = CreateRefundRequestBody.parse({ reasonCode: 'FACE_MISMATCH', note: '  off  ' });
    expect(parsed.note).toBe('off');
  });

  it('rejects an unknown reason code and an over-long note', () => {
    expect(CreateRefundRequestBody.safeParse({ reasonCode: 'NOPE' }).success).toBe(false);
    expect(
      CreateRefundRequestBody.safeParse({ reasonCode: 'OTHER', note: 'x'.repeat(301) }).success,
    ).toBe(false);
  });

  it('requires an admin note of at least 3 characters to reject', () => {
    expect(AdminRejectRefundBody.safeParse({ adminNote: 'no' }).success).toBe(false);
    expect(AdminRejectRefundBody.safeParse({ adminNote: 'Looks fine to us' }).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @aivastra/types test -- refund`
Expected: FAIL — cannot resolve `./refund.js`.

- [ ] **Step 3: Implement the schemas**

`packages/types/src/refund.ts`:

```ts
import { z } from 'zod';

export const REFUND_REASON_CODES = [
  'WRONG_GARMENT',
  'DISTORTED_BODY',
  'FACE_MISMATCH',
  'BACKGROUND_OR_POSE',
  'POOR_QUALITY',
  'OTHER',
] as const;
export const RefundReasonCode = z.enum(REFUND_REASON_CODES);
export type RefundReasonCode = z.infer<typeof RefundReasonCode>;

export const REFUND_REASON_LABELS: Record<RefundReasonCode, string> = {
  WRONG_GARMENT: 'Wrong garment or colour',
  DISTORTED_BODY: 'Distorted body or hands',
  FACE_MISMATCH: 'Face does not match',
  BACKGROUND_OR_POSE: 'Background or pose issue',
  POOR_QUALITY: 'Poor image quality',
  OTHER: 'Other',
};

export const RefundStatus = z.enum(['PENDING', 'APPROVED', 'REJECTED']);
export type RefundStatus = z.infer<typeof RefundStatus>;

export const CreateRefundRequestBody = z.object({
  reasonCode: RefundReasonCode,
  note: z.string().trim().max(300).optional(),
});
export type CreateRefundRequestBody = z.infer<typeof CreateRefundRequestBody>;

export const AdminApproveRefundBody = z.object({
  adminNote: z.string().trim().max(500).optional(),
});
export type AdminApproveRefundBody = z.infer<typeof AdminApproveRefundBody>;

export const AdminRejectRefundBody = z.object({
  adminNote: z.string().trim().min(3).max(500),
});
export type AdminRejectRefundBody = z.infer<typeof AdminRejectRefundBody>;
```

Append to `packages/types/src/index.ts` (keep alphabetical, after `rate-limits`):

```ts
export * from './refund.js';
```

- [ ] **Step 4: Run the types test and confirm it passes**

Run: `pnpm --filter @aivastra/types test -- refund`
Expected: PASS (4 tests).

- [ ] **Step 5: Add the table**

`packages/db/src/schema/refund-requests.ts`:

```ts
import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { jobs } from './jobs.js';
import { users } from './users.js';

// One row per job — the unique job_id is what makes "a rejected request cannot be
// re-filed" a database guarantee rather than an application convention.
// credits is a snapshot of jobs.credits_charged at request time: it is what an
// approval refunds, even if the job row were ever to change afterwards.
export const refundRequests = pgTable(
  'refund_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobId: uuid('job_id')
      .notNull()
      .unique()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    credits: integer('credits').notNull(),
    reasonCode: text('reason_code').notNull(),
    note: text('note'),
    // 'PENDING' | 'APPROVED' | 'REJECTED'
    status: text('status').notNull().default('PENDING'),
    adminNote: text('admin_note'),
    // The admin's users.id (not admin_users.id), matching credit_ledger.admin_id.
    reviewedBy: uuid('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byStatusCreated: index('refund_requests_status_created_idx').on(t.status, t.createdAt),
  }),
);
```

Append to `packages/db/src/schema/index.ts` (match the file's existing ordering style):

```ts
export * from './refund-requests.js';
```

- [ ] **Step 6: Generate the migration locally**

Run: `pnpm db:generate`
Expected: a new `packages/db/src/migrations/0221_<name>.sql`, `meta/0221_snapshot.json` and a new `_journal.json` entry. Open the SQL and confirm it contains `CREATE TABLE "refund_requests"`, the unique constraint on `job_id`, both foreign keys and `refund_requests_status_created_idx`, and nothing touching other tables. If it contains anything else, stop and investigate before continuing.

- [ ] **Step 7: Typecheck and apply locally**

Run: `pnpm --filter @aivastra/db build && pnpm --filter @aivastra/types build && pnpm db:migrate`
Expected: builds succeed; migration applies to the local `DATABASE_URL` (docker stack, never production).

- [ ] **Step 8: Commit**

```bash
git add packages/types packages/db
git commit -m "feat(db): refund_requests table, reason codes and Zod schemas"
```

---

### Task 2: Transaction-scoped refund primitive

**Files:**
- Modify: `apps/api/src/modules/credits/ledger.ts` (the `refund` function, lines ~40-85)
- Test: `apps/api/test/integration/refund-apply-tx.test.ts`

**Interfaces:**
- Produces: `applyRefundTx(tx: DbTransaction, userId: string, amount: number, jobId: string, reason: string): Promise<boolean>` — `true` if the ledger row was inserted and the balance bumped, `false` if `(job_id, reason)` was already refunded.

- [ ] **Step 1: Write the failing test**

`apps/api/test/integration/refund-apply-tx.test.ts`:

```ts
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyRefundTx } from '../../src/modules/credits/ledger.js';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

describe('applyRefundTx', () => {
  let c: Containers;
  let app: TestApp;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
  }, 60_000);
  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  async function seed() {
    const [user] = await app.db
      .insert(schema.users)
      .values({ email: `apply-tx-${Date.now()}@x.com`, emailVerified: true })
      .returning();
    await app.db.insert(schema.userCredits).values({ userId: user.id, balance: 5 });
    const [job] = await app.db
      .insert(schema.jobs)
      .values({ userId: user.id, status: 'COMPLETED', creditsCharged: 10 })
      .returning();
    return { userId: user.id, jobId: job.id };
  }

  async function balance(userId: string) {
    const [row] = await app.db
      .select({ balance: schema.userCredits.balance })
      .from(schema.userCredits)
      .where(eq(schema.userCredits.userId, userId));
    return row.balance;
  }

  it('credits once and is a no-op on replay for the same (job, reason)', async () => {
    const { userId, jobId } = await seed();
    const first = await app.db.transaction((tx) =>
      applyRefundTx(tx, userId, 10, jobId, 'REFUND_USER_REQUEST'),
    );
    const second = await app.db.transaction((tx) =>
      applyRefundTx(tx, userId, 10, jobId, 'REFUND_USER_REQUEST'),
    );
    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(await balance(userId)).toBe(15);
    const rows = await app.db
      .select()
      .from(schema.creditLedger)
      .where(eq(schema.creditLedger.jobId, jobId));
    expect(rows).toHaveLength(1);
    expect(rows[0].reason).toBe('REFUND_USER_REQUEST');
    expect(rows[0].delta).toBe(10);
  });

  it('rolls the credit back when the surrounding transaction fails', async () => {
    const { userId, jobId } = await seed();
    await expect(
      app.db.transaction(async (tx) => {
        await applyRefundTx(tx, userId, 10, jobId, 'REFUND_USER_REQUEST');
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await balance(userId)).toBe(5);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/api && npx vitest run --config vitest.integration.config.ts refund-apply-tx`
Expected: FAIL — `applyRefundTx` is not exported.

- [ ] **Step 3: Extract the primitive**

In `apps/api/src/modules/credits/ledger.ts`, change the import line `import type { DB } from '@aivastra/db';` to:

```ts
import type { DB, DbTransaction } from '@aivastra/db';
```

Add above `export async function refund(`:

```ts
/**
 * Writes the refund ledger row and bumps the balance inside the caller's
 * transaction. The ledger insert goes first: the unique index on (job_id, reason)
 * WHERE job_id IS NOT NULL is what guarantees at-most-once without a racy SELECT.
 * Returns false when this (job, reason) was already refunded. Callers own the
 * metric (`creditsRefundedTotal`) — increment it only after the transaction commits.
 */
export async function applyRefundTx(
  tx: DbTransaction,
  userId: string,
  amount: number,
  jobId: string,
  reason: string,
): Promise<boolean> {
  const inserted = await tx
    .insert(schema.creditLedger)
    .values({ userId, delta: amount, reason, jobId })
    .onConflictDoNothing()
    .returning({ id: schema.creditLedger.id });
  if (!inserted.length) return false;
  await tx
    .update(schema.userCredits)
    .set({ balance: sql`${schema.userCredits.balance} + ${amount}`, updatedAt: new Date() })
    .where(eq(schema.userCredits.userId, userId));
  return true;
}
```

In `refund()`, replace the block from the comment `// Insert ledger row first — unique index…` through `return true;` (the last statements inside the transaction callback) with:

```ts
    return applyRefundTx(tx, userId, amount, jobId, reason);
```

Leave the `REFUND_ADMIN_CANCEL` pre-check above it and the `if (refunded) creditsRefundedTotal.inc(amount);` after it unchanged.

- [ ] **Step 4: Run the new test and the existing credit tests**

Run: `cd apps/api && npx vitest run --config vitest.integration.config.ts refund-apply-tx credits`
Expected: PASS, including every pre-existing credits/refund integration test (the refactor must not change behaviour).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/credits/ledger.ts apps/api/test/integration/refund-apply-tx.test.ts
git commit -m "refactor(credits): extract transaction-scoped applyRefundTx from refund()"
```

---

### Task 3: Customer API, regenerate gate and download gate

**Files:**
- Create: `apps/api/src/modules/jobs/refund-requests.ts`, `apps/api/test/integration/refund-requests.test.ts`
- Modify: `apps/api/src/modules/jobs/regenerate.ts` (after the `downloadedAt` check, ~line 113), `apps/api/src/modules/jobs/routes.ts` (download handler, ~line 975, plus import), `apps/api/src/server.ts` (import + register after `jobsRoutes`, ~line 411)

**Interfaces:**
- Consumes: `schema.refundRequests` (Task 1), `CreateRefundRequestBody` (Task 1).
- Produces:
  - `hasActiveRefundRequest(db: DB, jobId: string): Promise<boolean>` — true if the job has a `PENDING` or `APPROVED` request.
  - `createRefundRequest(app, userId, jobId, body)` → `{ id, jobId, status: 'PENDING', credits, reasonCode, note, createdAt }`.
  - `getRefundStatuses(app, userId, jobIds)` → `Array<{ jobId: string; eligible: boolean; request: { status, reasonCode, adminNote, createdAt, reviewedAt } | null }>`; jobs not owned by the caller are omitted.
  - Routes: `POST /v1/jobs/:id/refund-request`, `GET /v1/jobs/refund-status?jobIds=a,b` (max 50 ids).
  - Error codes: `NOT_FOUND` 404; `NOT_READY` 409; `NOT_REFUNDABLE` 409; `ALREADY_DOWNLOADED` 409; `REFUND_ALREADY_REQUESTED` 409; `REFUND_REQUESTED` 409 (the two gates).

- [ ] **Step 1: Write the failing tests**

`apps/api/test/integration/refund-requests.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signAccess } from '../../src/modules/auth/service.js';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

describe('refund requests — customer API and gates', () => {
  let c: Containers;
  let app: TestApp;
  let seq = 0;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
  }, 60_000);
  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  async function registerUser(label: string) {
    seq += 1;
    const [user] = await app.db
      .insert(schema.users)
      .values({ email: `refund-${label}-${seq}@x.com`, emailVerified: true, tier: 'free' })
      .returning();
    await app.db.insert(schema.userCredits).values({ userId: user.id, balance: 0 });
    const secret = new TextEncoder().encode(app.env.JWT_SECRET);
    const token = await signAccess(secret, user.id, { kind: 'access' }, app.env.JWT_EXPIRY);
    return { token, userId: user.id, auth: { authorization: `Bearer ${token}` } };
  }

  async function seedJob(
    userId: string,
    o: {
      status?: string;
      creditsCharged?: number;
      downloadedAt?: Date | null;
      shopifyStoreId?: string;
    } = {},
  ) {
    const [job] = await app.db
      .insert(schema.jobs)
      .values({
        userId,
        status: o.status ?? 'COMPLETED',
        creditsCharged: o.creditsCharged ?? 10,
        shopifyStoreId: o.shopifyStoreId,
      })
      .returning();
    await app.db.insert(schema.jobInputs).values({ jobId: job.id, upperGarmentKey: 'x' });
    await app.db.insert(schema.jobOutputs).values({
      jobId: job.id,
      resultKey: `outputs/${job.id}.png`,
      downloadedAt: o.downloadedAt ?? null,
    });
    return job.id as string;
  }

  const post = (jobId: string, auth: Record<string, string>, payload: unknown) =>
    app.inject({
      method: 'POST',
      url: `/v1/jobs/${jobId}/refund-request`,
      headers: auth,
      payload: payload as object,
    });

  describe('POST /v1/jobs/:id/refund-request', () => {
    it('requires authentication', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/jobs/${randomUUID()}/refund-request`,
        payload: { reasonCode: 'OTHER' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('creates a PENDING request that snapshots the job credits', async () => {
      const u = await registerUser('ok');
      const jobId = await seedJob(u.userId, { creditsCharged: 7 });
      const res = await post(jobId, u.auth, { reasonCode: 'FACE_MISMATCH', note: ' wrong face ' });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body).toMatchObject({
        jobId,
        status: 'PENDING',
        credits: 7,
        reasonCode: 'FACE_MISMATCH',
        note: 'wrong face',
      });
      const [row] = await app.db
        .select()
        .from(schema.refundRequests)
        .where(eq(schema.refundRequests.jobId, jobId));
      expect(row.userId).toBe(u.userId);
    });

    it('404s for another user\'s job and for a missing job', async () => {
      const owner = await registerUser('owner');
      const thief = await registerUser('thief');
      const jobId = await seedJob(owner.userId);
      expect((await post(jobId, thief.auth, { reasonCode: 'OTHER' })).statusCode).toBe(404);
      expect((await post(randomUUID(), thief.auth, { reasonCode: 'OTHER' })).statusCode).toBe(404);
    });

    it('409s when the job is not COMPLETED', async () => {
      const u = await registerUser('notdone');
      const jobId = await seedJob(u.userId, { status: 'RUNNING' });
      const res = await post(jobId, u.auth, { reasonCode: 'OTHER' });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('NOT_READY');
    });

    it('409s for a free job (creditsCharged 0)', async () => {
      const u = await registerUser('free');
      const jobId = await seedJob(u.userId, { creditsCharged: 0 });
      const res = await post(jobId, u.auth, { reasonCode: 'OTHER' });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('NOT_REFUNDABLE');
    });

    it('409s for a Shopify store job', async () => {
      const u = await registerUser('shopify');
      const [store] = await app.db
        .insert(schema.shopifyStores)
        .values({
          shopDomain: `refund-${seq}.myshopify.com`,
          shopifyShopId: 910000000 + seq,
          accessToken: 'enc:token',
          scope: 'read_products',
        })
        .returning();
      const jobId = await seedJob(u.userId, { shopifyStoreId: store.id });
      const res = await post(jobId, u.auth, { reasonCode: 'OTHER' });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('NOT_REFUNDABLE');
    });

    it('409s when the result was already downloaded', async () => {
      const u = await registerUser('dl');
      const jobId = await seedJob(u.userId, { downloadedAt: new Date() });
      const res = await post(jobId, u.auth, { reasonCode: 'OTHER' });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('ALREADY_DOWNLOADED');
    });

    it('409s on a second request for the same job, even after rejection', async () => {
      const u = await registerUser('dup');
      const jobId = await seedJob(u.userId);
      expect((await post(jobId, u.auth, { reasonCode: 'OTHER' })).statusCode).toBe(201);
      await app.db
        .update(schema.refundRequests)
        .set({ status: 'REJECTED' })
        .where(eq(schema.refundRequests.jobId, jobId));
      const again = await post(jobId, u.auth, { reasonCode: 'OTHER' });
      expect(again.statusCode).toBe(409);
      expect(again.json().error.code).toBe('REFUND_ALREADY_REQUESTED');
    });

    it('400s on an unknown reason code or an over-long note', async () => {
      const u = await registerUser('bad');
      const jobId = await seedJob(u.userId);
      expect((await post(jobId, u.auth, { reasonCode: 'NOPE' })).statusCode).toBe(400);
      expect(
        (await post(jobId, u.auth, { reasonCode: 'OTHER', note: 'x'.repeat(301) })).statusCode,
      ).toBe(400);
    });
  });

  describe('GET /v1/jobs/refund-status', () => {
    it('reports eligibility and request state, omitting jobs the caller does not own', async () => {
      const u = await registerUser('status');
      const other = await registerUser('status-other');
      const fresh = await seedJob(u.userId);
      const requested = await seedJob(u.userId);
      const downloaded = await seedJob(u.userId, { downloadedAt: new Date() });
      const foreign = await seedJob(other.userId);
      await post(requested, u.auth, { reasonCode: 'POOR_QUALITY' });

      const res = await app.inject({
        method: 'GET',
        url: `/v1/jobs/refund-status?jobIds=${[fresh, requested, downloaded, foreign].join(',')}`,
        headers: u.auth,
      });
      expect(res.statusCode).toBe(200);
      const items = res.json().items as {
        jobId: string;
        eligible: boolean;
        request: { status: string } | null;
      }[];
      const byId = new Map(items.map((i) => [i.jobId, i]));
      expect(byId.get(fresh)).toMatchObject({ eligible: true, request: null });
      expect(byId.get(requested)).toMatchObject({
        eligible: false,
        request: { status: 'PENDING' },
      });
      expect(byId.get(downloaded)).toMatchObject({ eligible: false, request: null });
      expect(byId.has(foreign)).toBe(false);
    });

    it('400s on a malformed or oversized id list', async () => {
      const u = await registerUser('status-bad');
      const bad = await app.inject({
        method: 'GET',
        url: '/v1/jobs/refund-status?jobIds=not-a-uuid',
        headers: u.auth,
      });
      expect(bad.statusCode).toBe(400);
      const many = Array.from({ length: 51 }, () => randomUUID()).join(',');
      const tooMany = await app.inject({
        method: 'GET',
        url: `/v1/jobs/refund-status?jobIds=${many}`,
        headers: u.auth,
      });
      expect(tooMany.statusCode).toBe(400);
    });
  });

  describe('gates while a request is open', () => {
    async function pendingJob() {
      const u = await registerUser('gate');
      const jobId = await seedJob(u.userId);
      await post(jobId, u.auth, { reasonCode: 'OTHER' });
      return { u, jobId };
    }

    it('blocks regenerate while PENDING and APPROVED, allows it after REJECTED', async () => {
      const { u, jobId } = await pendingJob();
      const regen = () =>
        app.inject({
          method: 'POST',
          url: `/v1/jobs/${jobId}/regenerate`,
          headers: u.auth,
          payload: { reason: 'try again' },
        });

      const pending = await regen();
      expect(pending.statusCode).toBe(409);
      expect(pending.json().error.code).toBe('REFUND_REQUESTED');

      await app.db
        .update(schema.refundRequests)
        .set({ status: 'APPROVED' })
        .where(eq(schema.refundRequests.jobId, jobId));
      expect((await regen()).json().error.code).toBe('REFUND_REQUESTED');

      await app.db
        .update(schema.refundRequests)
        .set({ status: 'REJECTED' })
        .where(eq(schema.refundRequests.jobId, jobId));
      // Past the refund gate. No regeneration template is seeded here, so it stops at
      // the config check — the point is that it is no longer REFUND_REQUESTED.
      const after = await regen();
      expect(after.json().error?.code).not.toBe('REFUND_REQUESTED');
    });

    it('blocks the download while PENDING without stamping downloadedAt, and allows it after REJECTED', async () => {
      const { u, jobId } = await pendingJob();
      const download = () =>
        app.inject({ method: 'POST', url: `/v1/jobs/${jobId}/download`, headers: u.auth });
      const blockedDownloadedAt = async () => {
        const [o] = await app.db
          .select({ downloadedAt: schema.jobOutputs.downloadedAt })
          .from(schema.jobOutputs)
          .where(eq(schema.jobOutputs.jobId, jobId));
        return o.downloadedAt;
      };

      const blocked = await download();
      expect(blocked.statusCode).toBe(409);
      expect(blocked.json().error.code).toBe('REFUND_REQUESTED');
      expect(await blockedDownloadedAt()).toBeNull();

      await app.db
        .update(schema.refundRequests)
        .set({ status: 'REJECTED' })
        .where(eq(schema.refundRequests.jobId, jobId));
      expect((await download()).statusCode).toBe(200);
      expect(await blockedDownloadedAt()).not.toBeNull();
    });

    it('keeps GET /result open so a pending image can still be viewed', async () => {
      const { u, jobId } = await pendingJob();
      const res = await app.inject({
        method: 'GET',
        url: `/v1/jobs/${jobId}/result`,
        headers: u.auth,
      });
      expect(res.statusCode).toBe(200);
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && npx vitest run --config vitest.integration.config.ts refund-requests`
Expected: FAIL — the routes do not exist (404s / failed status assertions).

- [ ] **Step 3: Implement the module**

`apps/api/src/modules/jobs/refund-requests.ts`:

```ts
import type { DB } from '@aivastra/db';
import { schema } from '@aivastra/db';
import { CreateRefundRequestBody } from '@aivastra/types';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';

const R = schema.refundRequests;
const ACTIVE_STATUSES = ['PENDING', 'APPROVED'];
const MAX_STATUS_IDS = 50;

type JobRow = typeof schema.jobs.$inferSelect;

/**
 * True while a refund request holds the job: PENDING (decision outstanding) or
 * APPROVED (credits returned). Regenerate and download both refuse in that state;
 * a REJECTED request releases the job again.
 */
export async function hasActiveRefundRequest(db: DB, jobId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: R.id })
    .from(R)
    .where(and(eq(R.jobId, jobId), inArray(R.status, ACTIVE_STATUSES)))
    .limit(1);
  return !!row;
}

/**
 * Single source of truth for "can this job be refund-requested", shared by the
 * create route (which throws) and the status route (which reports a boolean) so
 * the button and the server can never disagree. Null means eligible.
 */
export function refundIneligibility(
  job: JobRow,
  downloadedAt: Date | null,
  hasRequest: boolean,
): { code: string; message: string } | null {
  if (job.status !== 'COMPLETED') return { code: 'NOT_READY', message: 'job not complete' };
  // Free regenerations and unlimited-plan jobs charge 0 — there is nothing to return.
  // Merchant, API-key and Shopify jobs bill a different balance than the user's.
  if (job.creditsCharged <= 0 || job.merchantId || job.apiKeyId || job.shopifyStoreId) {
    return { code: 'NOT_REFUNDABLE', message: 'this job has no refundable credits' };
  }
  if (downloadedAt) {
    return {
      code: 'ALREADY_DOWNLOADED',
      message: 'this result has already been downloaded and can no longer be refunded',
    };
  }
  if (hasRequest) {
    return { code: 'REFUND_ALREADY_REQUESTED', message: 'a refund was already requested' };
  }
  return null;
}

export async function createRefundRequest(
  app: FastifyInstance,
  userId: string,
  jobId: string,
  body: CreateRefundRequestBody,
) {
  return app.db.transaction(async (tx) => {
    // Lock the job row so two simultaneous requests serialise: the second one sees
    // the first one's row and gets REFUND_ALREADY_REQUESTED, not a unique violation.
    const [job] = await tx
      .select()
      .from(schema.jobs)
      .where(and(eq(schema.jobs.id, jobId), eq(schema.jobs.userId, userId)))
      .for('update');
    if (!job) throw new AppError('NOT_FOUND', 404, 'job not found');

    const [output] = await tx
      .select({ downloadedAt: schema.jobOutputs.downloadedAt })
      .from(schema.jobOutputs)
      .where(eq(schema.jobOutputs.jobId, jobId));
    const [existing] = await tx.select({ id: R.id }).from(R).where(eq(R.jobId, jobId)).limit(1);

    const problem = refundIneligibility(job, output?.downloadedAt ?? null, !!existing);
    if (problem) throw new AppError(problem.code, 409, problem.message);

    const [row] = await tx
      .insert(R)
      .values({
        jobId,
        userId,
        credits: job.creditsCharged,
        reasonCode: body.reasonCode,
        note: body.note || null,
      })
      .returning();
    return {
      id: row.id,
      jobId: row.jobId,
      status: row.status,
      credits: row.credits,
      reasonCode: row.reasonCode,
      note: row.note,
      createdAt: row.createdAt,
    };
  });
}

export async function getRefundStatuses(app: FastifyInstance, userId: string, jobIds: string[]) {
  const jobs = await app.db
    .select({
      job: schema.jobs,
      downloadedAt: schema.jobOutputs.downloadedAt,
    })
    .from(schema.jobs)
    .leftJoin(schema.jobOutputs, eq(schema.jobOutputs.jobId, schema.jobs.id))
    .where(and(inArray(schema.jobs.id, jobIds), eq(schema.jobs.userId, userId)));

  const owned = jobs.map((j) => j.job.id);
  const requests = owned.length
    ? await app.db.select().from(R).where(inArray(R.jobId, owned))
    : [];
  const byJob = new Map(requests.map((r) => [r.jobId, r]));

  return jobs.map(({ job, downloadedAt }) => {
    const req = byJob.get(job.id);
    return {
      jobId: job.id,
      eligible: refundIneligibility(job, downloadedAt ?? null, !!req) === null,
      request: req
        ? {
            status: req.status,
            reasonCode: req.reasonCode,
            adminNote: req.adminNote,
            createdAt: req.createdAt,
            reviewedAt: req.reviewedAt,
          }
        : null,
    };
  });
}

export async function refundRequestsRoutes(app: FastifyInstance) {
  app.post(
    '/v1/jobs/:id/refund-request',
    {
      preHandler: app.requireUser,
      schema: { params: z.object({ id: z.string().uuid() }), body: CreateRefundRequestBody },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const created = await createRefundRequest(
        app,
        req.userId,
        id,
        req.body as CreateRefundRequestBody,
      );
      return reply.code(201).send(created);
    },
  );

  // Static segment beats /v1/jobs/:id in the router, so this does not collide with it.
  app.get(
    '/v1/jobs/refund-status',
    {
      preHandler: app.requireUser,
      schema: { querystring: z.object({ jobIds: z.string().min(1) }) },
    },
    async (req) => {
      const { jobIds } = req.query as { jobIds: string };
      const ids = z
        .array(z.string().uuid())
        .min(1)
        .max(MAX_STATUS_IDS)
        .safeParse(jobIds.split(','));
      if (!ids.success) {
        throw new AppError('VALIDATION', 400, `jobIds must be 1-${MAX_STATUS_IDS} comma-separated uuids`);
      }
      return { items: await getRefundStatuses(app, req.userId, ids.data) };
    },
  );
}
```

- [ ] **Step 4: Register the routes**

In `apps/api/src/server.ts`, add the import next to the other jobs import (after line 77's `jobsRoutes` import, keeping import ordering Biome-clean):

```ts
import { refundRequestsRoutes } from './modules/jobs/refund-requests.js';
```

and register directly after `await app.register(jobsRoutes);` (~line 411):

```ts
  await app.register(refundRequestsRoutes);
```

- [ ] **Step 5: Add the regenerate gate**

In `apps/api/src/modules/jobs/regenerate.ts` add to the imports:

```ts
import { hasActiveRefundRequest } from './refund-requests.js';
```

and, immediately after the `if (original.downloadedAt) { … }` block (before `if (FREE_REGENERATE_LIMIT_ENABLED)`), add:

```ts
  // A refund request holds the job (PENDING, or APPROVED once credits are back):
  // regenerating would be a free retry on top of the claim. REJECTED releases it.
  if (await hasActiveRefundRequest(app.db, originalJobId)) {
    throw new AppError(
      'REFUND_REQUESTED',
      409,
      'a refund request is open for this image, so it cannot be regenerated',
    );
  }
```

- [ ] **Step 6: Add the download gate**

In `apps/api/src/modules/jobs/routes.ts` add to the imports (next to `import { getRegenerateReasons, regenerateJob } from './regenerate.js';`):

```ts
import { hasActiveRefundRequest } from './refund-requests.js';
```

In the `POST /v1/jobs/:id/download` handler, directly after `if (job.status !== 'COMPLETED') throw new AppError('NOT_READY', 409, 'job not complete');` and **before** the `job_outputs` select, add:

```ts
      // Checked before anything is presigned or stamped: a blocked download must never
      // mark the job downloaded, or a rejected request could not release it again.
      if (await hasActiveRefundRequest(app.db, id)) {
        throw new AppError(
          'REFUND_REQUESTED',
          409,
          'This image has a refund request open, so it cannot be downloaded until we decide.',
        );
      }
```

Do not touch `GET /v1/jobs/:id/result` — it is also how the UI displays the image.

- [ ] **Step 7: Run the new tests and the regenerate suite**

Run: `cd apps/api && npx vitest run --config vitest.integration.config.ts refund-requests regenerate`
Expected: PASS — all new tests, and every existing `regenerate` test unchanged.

- [ ] **Step 8: Typecheck and commit**

Run: `pnpm --filter @aivastra/api typecheck`
Expected: no errors.

```bash
git add apps/api
git commit -m "feat(api): customer refund requests with regenerate and download gates"
```

---

### Task 4: Admin API, audit and decision email

**Files:**
- Create: `apps/api/src/modules/admin/refund-requests.routes.ts`, `apps/api/test/integration/admin-refund-requests.test.ts`
- Modify: `apps/api/src/lib/mailer.ts` (append), `apps/api/src/server.ts` (import + register next to `adminShopifyPurchasesRoutes`, ~line 53 / the register block)

**Interfaces:**
- Consumes: `applyRefundTx` (Task 2), `schema.refundRequests` (Task 1), `AdminApproveRefundBody` / `AdminRejectRefundBody` (Task 1), `recordAudit`, `requirePermission`.
- Produces:
  - `adminApproveRefundRequest(app, id, actor: { userId; role }, request: FastifyRequest, body: AdminApproveRefundBody)` → `{ id, status: 'APPROVED', credits, userId }`.
  - `adminRejectRefundRequest(app, id, actor, request, body: AdminRejectRefundBody)` → `{ id, status: 'REJECTED', credits, userId }`.
  - Routes: `GET /admin/refund-requests?status=&cursor=&limit=`, `POST /admin/refund-requests/:id/approve`, `POST /admin/refund-requests/:id/reject`.
  - `sendRefundDecisionEmail(apiKey, from, to, p: { approved: boolean; credits: number; adminNote: string | null }): Promise<void>`.
  - Audit actions: `refund_request.approve`, `refund_request.reject`, resource type `refund_requests`.

- [ ] **Step 1: Write the failing tests**

`apps/api/test/integration/admin-refund-requests.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { and, eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminApproveRefundRequest,
  adminRejectRefundRequest,
} from '../../src/modules/admin/refund-requests.routes.js';
import { adminAuthHeader } from '../helpers/admin.js';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

describe('admin refund requests', () => {
  let c: Containers;
  let app: TestApp;
  let adminUserId: string;
  let seq = 0;
  const fakeRequest = { id: 'req-1', ip: '127.0.0.1', headers: {} } as unknown as FastifyRequest;
  const actor = () => ({ userId: adminUserId, role: 'SUPER_ADMIN' });

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
    await adminAuthHeader(app, 'SUPER_ADMIN');
    const [u] = await app.db
      .select({ id: schema.adminUsers.userId })
      .from(schema.adminUsers)
      .limit(1);
    adminUserId = u.id;
  }, 60_000);
  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  async function seedRequest(o: { credits?: number; downloadedAt?: Date | null } = {}) {
    seq += 1;
    const [user] = await app.db
      .insert(schema.users)
      .values({ email: `admin-refund-${seq}@x.com`, emailVerified: true })
      .returning();
    await app.db.insert(schema.userCredits).values({ userId: user.id, balance: 3 });
    const credits = o.credits ?? 10;
    const [job] = await app.db
      .insert(schema.jobs)
      .values({ userId: user.id, status: 'COMPLETED', creditsCharged: credits })
      .returning();
    await app.db.insert(schema.jobOutputs).values({
      jobId: job.id,
      resultKey: `outputs/${job.id}.png`,
      downloadedAt: o.downloadedAt ?? null,
    });
    const [request] = await app.db
      .insert(schema.refundRequests)
      .values({ jobId: job.id, userId: user.id, credits, reasonCode: 'POOR_QUALITY' })
      .returning();
    return { request, userId: user.id, jobId: job.id as string };
  }

  const balance = async (userId: string) =>
    (
      await app.db
        .select({ b: schema.userCredits.balance })
        .from(schema.userCredits)
        .where(eq(schema.userCredits.userId, userId))
    )[0].b;

  const audit = (id: string, action: string) =>
    app.db
      .select()
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.resourceId, id), eq(schema.auditLogs.action, action)));

  describe('approve', () => {
    it('credits the user once, marks APPROVED and writes an audit row', async () => {
      const { request, userId, jobId } = await seedRequest({ credits: 10 });
      const out = await adminApproveRefundRequest(app, request.id, actor(), fakeRequest, {
        adminNote: 'confirmed',
      });
      expect(out).toMatchObject({ status: 'APPROVED', credits: 10, userId });
      expect(await balance(userId)).toBe(13);
      const [row] = await app.db
        .select()
        .from(schema.refundRequests)
        .where(eq(schema.refundRequests.id, request.id));
      expect(row).toMatchObject({ status: 'APPROVED', reviewedBy: adminUserId, adminNote: 'confirmed' });
      expect(row.reviewedAt).not.toBeNull();
      const ledger = await app.db
        .select()
        .from(schema.creditLedger)
        .where(eq(schema.creditLedger.jobId, jobId));
      expect(ledger).toHaveLength(1);
      expect(ledger[0]).toMatchObject({ reason: 'REFUND_USER_REQUEST', delta: 10 });
      expect(await audit(request.id, 'refund_request.approve')).toHaveLength(1);
    });

    it('credits exactly once under two concurrent approvals', async () => {
      const { request, userId } = await seedRequest({ credits: 10 });
      const results = await Promise.allSettled([
        adminApproveRefundRequest(app, request.id, actor(), fakeRequest, {}),
        adminApproveRefundRequest(app, request.id, actor(), fakeRequest, {}),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await balance(userId)).toBe(13);
    });

    it('409s when the request is no longer PENDING', async () => {
      const { request, userId } = await seedRequest();
      await adminRejectRefundRequest(app, request.id, actor(), fakeRequest, {
        adminNote: 'not a defect',
      });
      await expect(
        adminApproveRefundRequest(app, request.id, actor(), fakeRequest, {}),
      ).rejects.toMatchObject({ statusCode: 409 });
      expect(await balance(userId)).toBe(3);
    });

    it('409s when the image was downloaded in the meantime, without crediting', async () => {
      const { request, userId } = await seedRequest({ downloadedAt: new Date() });
      await expect(
        adminApproveRefundRequest(app, request.id, actor(), fakeRequest, {}),
      ).rejects.toMatchObject({ statusCode: 409, code: 'ALREADY_DOWNLOADED' });
      expect(await balance(userId)).toBe(3);
    });

    it('404s for an unknown id', async () => {
      await expect(
        adminApproveRefundRequest(app, randomUUID(), actor(), fakeRequest, {}),
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('rolls the credit and the status back if the audit insert fails', async () => {
      const { request, userId } = await seedRequest();
      // The audit table's NOT NULL actor columns reject an empty actor role.
      await expect(
        adminApproveRefundRequest(
          app,
          request.id,
          { userId: adminUserId, role: null as unknown as string },
          fakeRequest,
          {},
        ),
      ).rejects.toBeTruthy();
      expect(await balance(userId)).toBe(3);
      const [row] = await app.db
        .select({ status: schema.refundRequests.status })
        .from(schema.refundRequests)
        .where(eq(schema.refundRequests.id, request.id));
      expect(row.status).toBe('PENDING');
    });
  });

  describe('reject', () => {
    it('marks REJECTED with the note, writes an audit row and moves no credits', async () => {
      const { request, userId, jobId } = await seedRequest();
      const out = await adminRejectRefundRequest(app, request.id, actor(), fakeRequest, {
        adminNote: 'Image looks fine',
      });
      expect(out.status).toBe('REJECTED');
      expect(await balance(userId)).toBe(3);
      const ledger = await app.db
        .select()
        .from(schema.creditLedger)
        .where(eq(schema.creditLedger.jobId, jobId));
      expect(ledger).toHaveLength(0);
      const [row] = await app.db
        .select()
        .from(schema.refundRequests)
        .where(eq(schema.refundRequests.id, request.id));
      expect(row).toMatchObject({ status: 'REJECTED', adminNote: 'Image looks fine' });
      expect(await audit(request.id, 'refund_request.reject')).toHaveLength(1);
    });
  });

  describe('HTTP', () => {
    it('requires authentication and the right permission', async () => {
      const { request } = await seedRequest();
      expect((await app.inject({ method: 'GET', url: '/admin/refund-requests' })).statusCode).toBe(
        401,
      );
      const noWrite = await adminAuthHeader(app, 'SUPPORT');
      const res = await app.inject({
        method: 'POST',
        url: `/admin/refund-requests/${request.id}/approve`,
        headers: noWrite,
        payload: {},
      });
      // SUPPORT has credits.read but not credits.write in the seeded role matrix; if the
      // seed ever grants it write, change this role to one that lacks it.
      expect(res.statusCode).toBe(403);
    });

    it('lists requests with the requester, filtered by status', async () => {
      const { request } = await seedRequest();
      const headers = await adminAuthHeader(app, 'SUPER_ADMIN');
      const res = await app.inject({
        method: 'GET',
        url: '/admin/refund-requests?status=PENDING&limit=100',
        headers,
      });
      expect(res.statusCode).toBe(200);
      const { requests } = res.json() as {
        requests: { id: string; userEmail: string; status: string; downloadedAt: string | null }[];
      };
      const found = requests.find((r) => r.id === request.id);
      expect(found).toBeTruthy();
      expect(found?.userEmail).toContain('@x.com');
      expect(requests.every((r) => r.status === 'PENDING')).toBe(true);
    });

    it('approves over HTTP', async () => {
      const { request, userId } = await seedRequest({ credits: 4 });
      const headers = await adminAuthHeader(app, 'SUPER_ADMIN');
      const res = await app.inject({
        method: 'POST',
        url: `/admin/refund-requests/${request.id}/approve`,
        headers,
        payload: {},
      });
      expect(res.statusCode).toBe(200);
      expect(await balance(userId)).toBe(7);
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && npx vitest run --config vitest.integration.config.ts admin-refund-requests`
Expected: FAIL — cannot resolve `refund-requests.routes.js`.

- [ ] **Step 3: Append the email to the mailer**

Append to `apps/api/src/lib/mailer.ts` (follows the file's `*Html` + `send(...)` pattern; the `send` helper already exists in this file):

```ts
function refundDecisionHtml(p: {
  approved: boolean;
  credits: number;
  adminNote: string | null;
}): string {
  const heading = p.approved ? 'Your refund request was approved' : 'Your refund request was declined';
  const body = p.approved
    ? `We've returned <strong style="color:#1a1a1a;">${p.credits.toLocaleString()} credits</strong> to your account.`
    : "We reviewed your request and weren't able to refund this image.";
  const note = p.adminNote
    ? `<p style="font-size:14px;color:#555;margin:16px 0 0;"><strong>Note from our team:</strong> ${escapeHtml(p.adminNote)}</p>`
    : '';
  return `<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;background:#f6f6f6;margin:0;padding:40px 0;">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:40px;">
    <h1 style="font-size:20px;font-weight:700;color:#1a1a1a;margin:0 0 16px;">${heading}</h1>
    <p style="font-size:14px;color:#555;margin:0;">${body}</p>
    ${note}
    <p style="font-size:12px;color:#999;margin:32px 0 0;">If you have questions, just reply to this email or contact support from the app.</p>
  </div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function sendRefundDecisionEmail(
  apiKey: string,
  from: string,
  to: string,
  p: { approved: boolean; credits: number; adminNote: string | null },
): Promise<void> {
  await send(apiKey, {
    from,
    to,
    subject: p.approved ? 'Your refund request was approved' : 'Your refund request was declined',
    html: refundDecisionHtml(p),
  });
}
```

Before appending, search the file for an existing `escapeHtml`; if one exists reuse it instead of defining a second.

- [ ] **Step 4: Implement the admin module**

`apps/api/src/modules/admin/refund-requests.routes.ts`:

```ts
import { schema } from '@aivastra/db';
import { creditsRefundedTotal } from '@aivastra/observability';
import { keys } from '@aivastra/storage';
import {
  AdminApproveRefundBody,
  AdminRejectRefundBody,
  RefundStatus,
} from '@aivastra/types';
import { and, desc, eq, lt } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { sendRefundDecisionEmail } from '../../lib/mailer.js';
import { applyRefundTx } from '../credits/ledger.js';
import { recordAudit } from './audit.js';
import { requirePermission } from './guard.js';

const R = schema.refundRequests;

const ListQuery = z.object({
  status: RefundStatus.optional(),
  cursor: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

type Actor = { userId: string; role: string };

/**
 * Approve = refund the snapshotted credits, flip the status and write the audit row
 * in ONE transaction. The ledger's (job_id, reason) unique index plus the row lock make
 * a double click or two admins at once credit exactly once. Exported so tests can drive
 * it without HTTP; the route adds the post-commit email.
 */
export async function adminApproveRefundRequest(
  app: FastifyInstance,
  id: string,
  actor: Actor,
  request: FastifyRequest,
  body: AdminApproveRefundBody,
) {
  const result = await app.db.transaction(async (tx) => {
    const [row] = await tx.select().from(R).where(eq(R.id, id)).for('update');
    if (!row) throw new AppError('NOT_FOUND', 404, 'refund request not found');
    if (row.status !== 'PENDING') {
      throw new AppError('CONFLICT', 409, `request is already ${row.status}`);
    }

    // The customer cannot download while the request is open, so this only trips when a
    // download landed in the instant before the request was created. They have the image
    // — the admin should reject, not refund.
    const [output] = await tx
      .select({ downloadedAt: schema.jobOutputs.downloadedAt })
      .from(schema.jobOutputs)
      .where(eq(schema.jobOutputs.jobId, row.jobId));
    if (output?.downloadedAt) {
      throw new AppError(
        'ALREADY_DOWNLOADED',
        409,
        'the customer downloaded this image — reject the request instead',
      );
    }

    const applied = await applyRefundTx(
      tx,
      row.userId,
      row.credits,
      row.jobId,
      'REFUND_USER_REQUEST',
    );
    if (!applied) throw new AppError('CONFLICT', 409, 'credits for this job were already refunded');

    const now = new Date();
    await tx
      .update(R)
      .set({
        status: 'APPROVED',
        adminNote: body.adminNote || null,
        reviewedBy: actor.userId,
        reviewedAt: now,
      })
      .where(and(eq(R.id, id), eq(R.status, 'PENDING')));

    await recordAudit(tx, {
      actor,
      action: 'refund_request.approve',
      resourceType: 'refund_requests',
      resourceId: id,
      before: { status: 'PENDING' },
      after: { status: 'APPROVED', credits: row.credits, adminNote: body.adminNote ?? null },
      request,
    });
    return { id, status: 'APPROVED' as const, credits: row.credits, userId: row.userId };
  });
  creditsRefundedTotal.inc(result.credits);
  return result;
}

export async function adminRejectRefundRequest(
  app: FastifyInstance,
  id: string,
  actor: Actor,
  request: FastifyRequest,
  body: AdminRejectRefundBody,
) {
  return app.db.transaction(async (tx) => {
    const [row] = await tx.select().from(R).where(eq(R.id, id)).for('update');
    if (!row) throw new AppError('NOT_FOUND', 404, 'refund request not found');
    if (row.status !== 'PENDING') {
      throw new AppError('CONFLICT', 409, `request is already ${row.status}`);
    }
    await tx
      .update(R)
      .set({
        status: 'REJECTED',
        adminNote: body.adminNote,
        reviewedBy: actor.userId,
        reviewedAt: new Date(),
      })
      .where(and(eq(R.id, id), eq(R.status, 'PENDING')));

    await recordAudit(tx, {
      actor,
      action: 'refund_request.reject',
      resourceType: 'refund_requests',
      resourceId: id,
      before: { status: 'PENDING' },
      after: { status: 'REJECTED', adminNote: body.adminNote },
      request,
    });
    return { id, status: 'REJECTED' as const, credits: row.credits, userId: row.userId };
  });
}

/** Best-effort: a failed email must never undo a committed decision. */
async function notifyUser(
  app: FastifyInstance,
  userId: string,
  decision: { approved: boolean; credits: number; adminNote: string | null },
) {
  try {
    const [user] = await app.db
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, userId));
    if (!user?.email) return;
    await sendRefundDecisionEmail(app.env.RESEND_API_KEY, app.env.EMAIL_FROM, user.email, decision);
  } catch (err) {
    app.log.error({ err, userId }, 'Failed to send refund decision email');
  }
}

export async function adminRefundRequestsRoutes(app: FastifyInstance) {
  const RO = requirePermission('credits.read');
  const RW = requirePermission('credits.write');
  const idParams = z.object({ id: z.string().uuid() });

  app.get('/admin/refund-requests', { preHandler: RO, schema: { querystring: ListQuery } }, async (req) => {
    const q = req.query as z.infer<typeof ListQuery>;
    const conds = [];
    if (q.status) conds.push(eq(R.status, q.status));
    if (q.cursor) conds.push(lt(R.createdAt, new Date(q.cursor)));

    const rows = await app.db
      .select({
        id: R.id,
        jobId: R.jobId,
        userId: R.userId,
        userEmail: schema.users.email,
        userName: schema.users.displayName,
        credits: R.credits,
        reasonCode: R.reasonCode,
        note: R.note,
        status: R.status,
        adminNote: R.adminNote,
        reviewedAt: R.reviewedAt,
        createdAt: R.createdAt,
        resultKey: schema.jobOutputs.resultKey,
        thumbnailKey: schema.jobOutputs.thumbnailKey,
        downloadedAt: schema.jobOutputs.downloadedAt,
      })
      .from(R)
      .innerJoin(schema.users, eq(schema.users.id, R.userId))
      .leftJoin(schema.jobOutputs, eq(schema.jobOutputs.jobId, R.jobId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(R.createdAt))
      .limit(q.limit);

    const requests = await Promise.all(
      rows.map(async ({ resultKey, thumbnailKey, ...r }) => {
        const full = resultKey ?? keys.output(r.jobId);
        return {
          ...r,
          imageUrl: (await app.storage.presignGet(full, 3600)).url,
          previewUrl: (await app.storage.presignGet(thumbnailKey ?? full, 3600)).url,
        };
      }),
    );
    const nextCursor =
      rows.length === q.limit ? rows[rows.length - 1].createdAt.toISOString() : null;
    return { requests, nextCursor };
  });

  app.post(
    '/admin/refund-requests/:id/approve',
    { preHandler: RW, schema: { params: idParams, body: AdminApproveRefundBody } },
    async (req) => {
      const { id } = req.params as { id: string };
      const body = req.body as AdminApproveRefundBody;
      const out = await adminApproveRefundRequest(
        app,
        id,
        { userId: req.userId, role: req.adminRole as string },
        req,
        body,
      );
      await notifyUser(app, out.userId, {
        approved: true,
        credits: out.credits,
        adminNote: body.adminNote || null,
      });
      return { id: out.id, status: out.status, credits: out.credits };
    },
  );

  app.post(
    '/admin/refund-requests/:id/reject',
    { preHandler: RW, schema: { params: idParams, body: AdminRejectRefundBody } },
    async (req) => {
      const { id } = req.params as { id: string };
      const body = req.body as AdminRejectRefundBody;
      const out = await adminRejectRefundRequest(
        app,
        id,
        { userId: req.userId, role: req.adminRole as string },
        req,
        body,
      );
      await notifyUser(app, out.userId, {
        approved: false,
        credits: out.credits,
        adminNote: body.adminNote,
      });
      return { id: out.id, status: out.status };
    },
  );
}
```

- [ ] **Step 5: Register the admin routes**

In `apps/api/src/server.ts` add the import in alphabetical position among the admin imports (after `adminPaymentsRoutes`, line ~47):

```ts
import { adminRefundRequestsRoutes } from './modules/admin/refund-requests.routes.js';
```

and register next to the other credit-related admin routes (after `await app.register(adminCreditsRoutes);`, ~line 437):

```ts
  await app.register(adminRefundRequestsRoutes);
```

- [ ] **Step 6: Run the tests**

Run: `cd apps/api && npx vitest run --config vitest.integration.config.ts admin-refund-requests refund-requests`
Expected: PASS. If the SUPPORT 403 assertion fails because that role has `credits.write`, pick a role from the `role_permissions` seed that has `credits.read` only (check with `grep -rn "credits.write" packages/db/src`) and update the test and its comment; do not weaken the assertion.

- [ ] **Step 7: Typecheck, lint and commit**

Run: `pnpm --filter @aivastra/api typecheck && pnpm --filter @aivastra/api lint`
Expected: no errors (warnings that already exist are fine).

```bash
git add apps/api
git commit -m "feat(admin): refund request list, approve and reject with audit and email"
```

---

### Task 5: Admin panel page

**Files:**
- Create: `apps/admin-web/src/pages/RefundRequestsPage.tsx`
- Modify: `apps/admin-web/src/types.ts` (append), `apps/admin-web/src/App.tsx` (import, title map at line ~61, route at line ~267), `apps/admin-web/src/components/Sidebar.tsx` (entry after the `shopify-purchases` item, ~line 179)

**Interfaces:**
- Consumes: the three admin routes from Task 4. `useAuth().hasPermission`, `useUrlState`, `useCloseOverlay`, `SearchableSelect`, `apiFetch`, `apiErrorMessage` (all already used by `ShopifyPurchasesPage.tsx`).
- Produces: route `/refund-requests`, sidebar key `refund-requests`.

No test runner exists for admin-web; verification is a clean build/lint plus the manual check in Task 7.

- [ ] **Step 1: Add the type**

Append to `apps/admin-web/src/types.ts`:

```ts
export type RefundRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

/** One row of GET /admin/refund-requests. */
export interface RefundRequest {
  id: string;
  jobId: string;
  userId: string;
  userEmail: string;
  userName: string | null;
  credits: number;
  reasonCode: string;
  note: string | null;
  status: RefundRequestStatus;
  adminNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
  downloadedAt: string | null;
  imageUrl: string;
  previewUrl: string;
}
```

- [ ] **Step 2: Write the page**

`apps/admin-web/src/pages/RefundRequestsPage.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { SearchableSelect } from '../components/SearchableSelect';
import { useAuth } from '../context/AuthContext';
import { useCloseOverlay } from '../hooks/use-close-overlay';
import { useUrlState } from '../hooks/use-url-state';
import { apiErrorMessage, apiFetch } from '../lib/data';
import type { RefundRequest, RefundRequestStatus } from '../types';

interface Props {
  toast: (opts: { kind?: 'error'; title: string; body?: string }) => void;
}

type Filter = 'ALL' | RefundRequestStatus;

const FILTER_OPTIONS: { id: Filter; label: string }[] = [
  { id: 'PENDING', label: 'Pending' },
  { id: 'APPROVED', label: 'Approved' },
  { id: 'REJECTED', label: 'Rejected' },
  { id: 'ALL', label: 'All requests' },
];

// Mirrors REFUND_REASON_LABELS in packages/types/src/refund.ts. admin-web does not
// depend on @aivastra/types, so the labels are repeated here.
const REASON_LABEL: Record<string, string> = {
  WRONG_GARMENT: 'Wrong garment or colour',
  DISTORTED_BODY: 'Distorted body or hands',
  FACE_MISMATCH: 'Face does not match',
  BACKGROUND_OR_POSE: 'Background or pose issue',
  POOR_QUALITY: 'Poor image quality',
  OTHER: 'Other',
};

function badgeClass(s: RefundRequestStatus): string {
  if (s === 'APPROVED') return 'badge success';
  if (s === 'REJECTED') return 'badge danger';
  return 'badge warn';
}

function when(value: string | null): string {
  return value ? new Date(value).toLocaleString() : '—';
}

/**
 * Customer requests to get credits back for a generated image. Approving credits the
 * snapshotted amount to the customer (once, audited); rejecting records the reason and
 * moves no credits. The customer is emailed either way.
 */
export default function RefundRequestsPage({ toast }: Props) {
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('credits.write');

  // The open request is navigation (shareable link); the status filter is just how the
  // list is sliced, so it stays local state (docs/admin-url-routing-standard.md).
  const [requestParam, setRequestParam] = useUrlState('request');
  const closeRequest = useCloseOverlay(['request']);

  const [filter, setFilter] = useState<Filter>('PENDING');
  const [rows, setRows] = useState<RefundRequest[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const [adminNote, setAdminNote] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(
    async (cursor?: string) => {
      if (cursor) setLoadingMore(true);
      else setLoading(true);
      try {
        const params = new URLSearchParams({ limit: '50' });
        if (filter !== 'ALL') params.set('status', filter);
        if (cursor) params.set('cursor', cursor);
        const data = await apiFetch<{ requests: RefundRequest[]; nextCursor: string | null }>(
          `/admin/refund-requests?${params}`,
        );
        setRows((prev) => (cursor ? [...prev, ...data.requests] : data.requests));
        setNextCursor(data.nextCursor);
      } catch (err) {
        toast({
          kind: 'error',
          title: 'Failed to load refund requests',
          body: apiErrorMessage(err, 'Please try again.'),
        });
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [filter, toast],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // A stale id in the URL (decided and filtered out, or never existed) just shows the list.
  const selected = useMemo(
    () => rows.find((r) => r.id === requestParam) ?? null,
    [rows, requestParam],
  );

  function open(row: RefundRequest) {
    setAdminNote('');
    setRequestParam(row.id);
  }

  async function decide(row: RefundRequest, decision: 'approve' | 'reject') {
    setSaving(true);
    try {
      await apiFetch(`/admin/refund-requests/${row.id}/${decision}`, {
        method: 'POST',
        body: JSON.stringify({ adminNote: adminNote.trim() || undefined }),
      });
      toast({
        title:
          decision === 'approve'
            ? `Refunded ${row.credits.toLocaleString()} credits`
            : 'Request rejected',
      });
      closeRequest();
      await load();
    } catch (err) {
      toast({
        kind: 'error',
        title: decision === 'approve' ? 'Failed to approve' : 'Failed to reject',
        body: apiErrorMessage(err, 'Please try again.'),
      });
    } finally {
      setSaving(false);
    }
  }

  const rejectNoteValid = adminNote.trim().length >= 3;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="page-head">
        <div>
          <h1 style={{ margin: 0 }}>Refund requests</h1>
          <div className="sub" style={{ marginTop: 4 }}>
            Customers asking for credits back on a generated image. Credits move only when you
            approve.
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-body" style={{ maxWidth: 320 }}>
          <label className="sub" htmlFor="rr-filter">
            Show
          </label>
          <SearchableSelect
            id="rr-filter"
            ariaLabel="Status filter"
            options={FILTER_OPTIONS}
            value={filter}
            onChange={(id) => setFilter((id || 'PENDING') as Filter)}
          />
        </div>
      </div>

      <div className="card">
        <div className="card-body">
          {loading ? (
            <p style={{ color: 'var(--muted)', fontSize: 13 }}>Loading…</p>
          ) : rows.length === 0 ? (
            <p style={{ color: 'var(--muted)', fontSize: 13 }}>
              {filter === 'PENDING' ? 'No pending requests.' : 'No requests match.'}
            </p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Image</th>
                    <th>Customer</th>
                    <th>Reason</th>
                    <th style={{ textAlign: 'right' }}>Credits</th>
                    <th>Status</th>
                    <th>Requested</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => open(r)}>
                      <td>
                        <img
                          src={r.previewUrl}
                          alt="Generated result"
                          width={48}
                          height={64}
                          style={{ objectFit: 'cover', borderRadius: 6 }}
                        />
                      </td>
                      <td>{r.userEmail}</td>
                      <td>{REASON_LABEL[r.reasonCode] ?? r.reasonCode}</td>
                      <td style={{ textAlign: 'right' }}>{r.credits.toLocaleString()}</td>
                      <td>
                        <span className={badgeClass(r.status)}>{r.status}</span>
                      </td>
                      <td>{when(r.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {nextCursor && (
            <button
              type="button"
              className="btn ghost"
              style={{ marginTop: 12 }}
              disabled={loadingMore}
              onClick={() => void load(nextCursor)}
            >
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          )}
        </div>
      </div>

      {selected && (
        <div className="modal-overlay" onClick={closeRequest}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>
                {selected.credits.toLocaleString()} credits · {selected.userEmail}
              </h3>
            </div>
            <div className="modal-body" style={{ display: 'grid', gap: 12, fontSize: 13 }}>
              <a href={selected.imageUrl} target="_blank" rel="noreferrer">
                <img
                  src={selected.previewUrl}
                  alt="Generated result (opens full size)"
                  style={{ maxWidth: '100%', maxHeight: 360, borderRadius: 8 }}
                />
              </a>
              <div>
                <strong>Status:</strong>{' '}
                <span className={badgeClass(selected.status)}>{selected.status}</span>
              </div>
              <div>
                <strong>Reason:</strong> {REASON_LABEL[selected.reasonCode] ?? selected.reasonCode}
              </div>
              <div>
                <strong>Customer note:</strong> {selected.note ?? '—'}
              </div>
              <div>
                <strong>Requested:</strong> {when(selected.createdAt)}
              </div>
              {selected.downloadedAt && (
                <div className="badge danger">
                  The customer downloaded this image ({when(selected.downloadedAt)}) — reject, do
                  not refund.
                </div>
              )}
              {selected.status !== 'PENDING' && (
                <>
                  <div>
                    <strong>Decided:</strong> {when(selected.reviewedAt)}
                  </div>
                  <div>
                    <strong>Admin note:</strong> {selected.adminNote ?? '—'}
                  </div>
                </>
              )}
              {canWrite && selected.status === 'PENDING' && (
                <div>
                  <label className="sub" htmlFor="rr-note">
                    Note to the customer (required to reject, 3–500 characters)
                  </label>
                  <textarea
                    id="rr-note"
                    className="input"
                    rows={3}
                    maxLength={500}
                    value={adminNote}
                    onChange={(e) => setAdminNote(e.target.value)}
                    style={{ width: '100%' }}
                  />
                </div>
              )}
            </div>
            <div className="modal-foot">
              <button type="button" className="btn ghost" onClick={closeRequest} disabled={saving}>
                Close
              </button>
              {canWrite && selected.status === 'PENDING' && (
                <>
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={saving || !rejectNoteValid}
                    onClick={() => void decide(selected, 'reject')}
                  >
                    Reject
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={saving || !!selected.downloadedAt}
                    onClick={() => void decide(selected, 'approve')}
                  >
                    {saving ? 'Saving…' : `Approve & refund ${selected.credits.toLocaleString()}`}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Wire route, title and sidebar**

`apps/admin-web/src/App.tsx`:
- Add after `import ShopifyPurchasesPage from './pages/ShopifyPurchasesPage';` (line 28), keeping the file's import ordering: `import RefundRequestsPage from './pages/RefundRequestsPage';`
- In the title map, after `'shopify-purchases': 'Pack purchases',` (line 61) add: `'refund-requests': 'Refund requests',`
- After the `shopify-purchases` `<Route …/>` (line 267) add: `<Route path="/refund-requests" element={<RefundRequestsPage {...pageProps} />} />`

`apps/admin-web/src/components/Sidebar.tsx`, after the `shopify-purchases` item (lines 174-179) add:

```tsx
      {
        k: 'refund-requests',
        label: 'Refund requests',
        icon: Icon.Coin,
        perm: 'credits.read',
      },
```

- [ ] **Step 4: Build and lint**

Run: `pnpm --filter @aivastra/admin build && pnpm --filter @aivastra/admin lint`
Expected: TypeScript compiles, no new Biome errors.

- [ ] **Step 5: Commit**

```bash
git add apps/admin-web
git commit -m "feat(admin-web): refund requests page"
```

---

### Task 6: Customer UI in the generation panel

**Files:**
- Create: `apps/catalogues-web/src/hooks/use-refund-statuses.ts`, `apps/catalogues-web/src/app/(app)/studio/refund-request-modal.tsx`
- Modify: `apps/catalogues-web/src/lib/feature-flags.ts` (append), `apps/catalogues-web/src/app/(app)/studio/generation-panel.tsx`

**Interfaces:**
- Consumes: `GET /v1/jobs/refund-status`, `POST /v1/jobs/:id/refund-request` (Task 3); `REFUND_REASON_CODES`, `REFUND_REASON_LABELS` from `@aivastra/types` (confirm `@aivastra/types` is already a dependency of catalogues-web with `grep -n "@aivastra/types" apps/catalogues-web/package.json`; if absent, add `"@aivastra/types": "workspace:*"` and run `pnpm install`).
- Produces: `useRefundStatuses(jobIds: string[]): { byJob: Map<string, RefundStatusItem>; refetch: () => void }`, `<RefundRequestModal jobId onClose onSubmitted />`, flag `REFUND_REQUEST_ENABLED`.

No test runner exists for catalogues-web; verification is typecheck + lint + the Task 7 manual check.

- [ ] **Step 1: Add the flag**

Append to `apps/catalogues-web/src/lib/feature-flags.ts`:

```ts

// Refund requests: the "Request refund" button, modal and status chip on completed
// results. The API and admin page ship with it; flip to true to expose the button.
export const REFUND_REQUEST_ENABLED = false;
```

- [ ] **Step 2: Add the status hook**

`apps/catalogues-web/src/hooks/use-refund-statuses.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { REFUND_REQUEST_ENABLED } from '@/lib/feature-flags';

export interface RefundStatusItem {
  jobId: string;
  eligible: boolean;
  request: {
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
    reasonCode: string;
    adminNote: string | null;
    createdAt: string;
    reviewedAt: string | null;
  } | null;
}

/**
 * Refund state for a set of completed jobs in one request. The server is the only
 * place that knows eligibility (downloaded? free job? already requested?), so the
 * button is driven by `eligible` rather than re-derived here.
 */
export function useRefundStatuses(jobIds: string[]) {
  const ids = [...jobIds].sort();
  const query = useQuery({
    queryKey: ['refund-status', ids.join(',')],
    queryFn: () =>
      api.get<{ items: RefundStatusItem[] }>(`/v1/jobs/refund-status?jobIds=${ids.join(',')}`),
    enabled: REFUND_REQUEST_ENABLED && ids.length > 0 && ids.length <= 50,
    staleTime: 30_000,
  });
  const byJob = new Map((query.data?.items ?? []).map((i) => [i.jobId, i]));
  return { byJob, refetch: query.refetch };
}
```

- [ ] **Step 3: Add the modal**

`apps/catalogues-web/src/app/(app)/studio/refund-request-modal.tsx`:

```tsx
'use client';

import { REFUND_REASON_CODES, REFUND_REASON_LABELS, type RefundReasonCode } from '@aivastra/types';
import { useState } from 'react';
import { SpinnerIcon } from '@/components/icons';
import { C } from '@/components/tokens';
import { PremiumSelect } from '@/components/ui/premium-select';
import { api } from '@/lib/api';

interface Props {
  jobId: string;
  onClose: () => void;
  onSubmitted: () => void;
}

export function RefundRequestModal({ jobId, onClose, onSubmitted }: Props) {
  const [reasonCode, setReasonCode] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!reasonCode || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.post(`/v1/jobs/${jobId}/refund-request`, {
        reasonCode,
        note: note.trim() || undefined,
      });
      onSubmitted();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send your request. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const disabled = submitting || !reasonCode;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Request a refund"
      onClick={() => !submitting && onClose()}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        zIndex: 1100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(440px, 100%)',
          background: C.card,
          borderRadius: 14,
          padding: 24,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: C.text }}>
          Request a refund
        </h3>
        <p style={{ margin: 0, fontSize: 12.5, color: C.mid, lineHeight: 1.5 }}>
          Tell us what went wrong. Our team will review it and, if approved, the credits go back to
          your account. Until we decide, this image can't be downloaded or regenerated.
        </p>
        <div
          style={{ border: `1px solid ${C.border}`, borderRadius: 8, background: C.lighter }}
        >
          <PremiumSelect
            ariaLabel="Reason for refund"
            value={reasonCode}
            onChange={(v) => setReasonCode(String(v))}
            options={REFUND_REASON_CODES.map((code) => ({
              value: code,
              label: REFUND_REASON_LABELS[code as RefundReasonCode],
            }))}
            disabled={submitting}
            placeholder="Select a reason…"
            fullWidth
            height={42}
            fontSize={13}
          />
        </div>
        <textarea
          aria-label="Additional details (optional)"
          placeholder="Anything else we should know? (optional)"
          value={note}
          maxLength={300}
          onChange={(e) => setNote(e.target.value)}
          disabled={submitting}
          rows={3}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: 10,
            fontSize: 13,
            color: C.text,
            background: C.lighter,
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            resize: 'vertical',
          }}
        />
        {error && (
          <p role="alert" style={{ margin: 0, fontSize: 12.5, color: C.red }}>
            {error}
          </p>
        )}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            style={{
              padding: '10px 18px',
              borderRadius: 8,
              background: 'transparent',
              color: C.mid,
              border: `1px solid ${C.border}`,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => void submit()}
            style={{
              padding: '10px 18px',
              borderRadius: 8,
              background: 'linear-gradient(135deg, var(--c-pink), var(--c-amber))',
              color: 'white',
              border: 'none',
              fontWeight: 600,
              fontSize: 13,
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.6 : 1,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            {submitting ? <SpinnerIcon size={16} /> : null}
            Send request
          </button>
        </div>
      </div>
    </div>
  );
}
```

Check `C.red` exists in `src/components/tokens.ts` (`grep -n "red" apps/catalogues-web/src/components/tokens.ts`); if the token is named differently use that one — never a raw hex.

- [ ] **Step 4: Wire the generation panel**

All edits are in `apps/catalogues-web/src/app/(app)/studio/generation-panel.tsx`.

a) Imports — change the feature-flags import (line 21) to include the new flag and add the two new imports alongside the existing ones:

```ts
import { GOOGLE_DRIVE_ENABLED, REFUND_REQUEST_ENABLED, REGENERATE_ENABLED } from '@/lib/feature-flags';
import { useRefundStatuses } from '@/hooks/use-refund-statuses';
import { RefundRequestModal } from './refund-request-modal';
```

(keep Biome's import ordering — run `pnpm --filter @aivastra/web lint` and apply its fix if it reorders).

b) State and derived values — directly after the `completedIds` declaration (line ~237) add:

```ts
  // Refund requests: one batched status lookup for every completed result. The server
  // decides eligibility; a PENDING or APPROVED request also locks Regenerate/Download.
  const refunds = useRefundStatuses(completedIds);
  const [refundModalJobId, setRefundModalJobId] = useState<string | null>(null);
  const refundBlocks = (jobId: string) => {
    const s = refunds.byJob.get(jobId)?.request?.status;
    return s === 'PENDING' || s === 'APPROVED';
  };
```

c) Download All — in `handleDownloadAll` (line ~394) replace the first line of the body:

```ts
    const completedSelected = displayJobs.filter(
      (j) => statuses[j.id] === 'COMPLETED' && !refundBlocks(j.id),
    );
```

d) Regenerate button — in its condition (line ~1380) add `!refundBlocks(job.id)`:

```tsx
                    {REGENERATE_ENABLED &&
                      !onUseImage &&
                      isCompleted &&
                      resultUrl &&
                      !downloadedJobIds.has(job.id) &&
                      !refundBlocks(job.id) && (
```

e) Request refund button — insert immediately after the Regenerate button's closing `)}` and before `{!hideDownload && (` (line ~1413). It copies the Regenerate button's styling:

```tsx
                    {REFUND_REQUEST_ENABLED &&
                      !onUseImage &&
                      isCompleted &&
                      resultUrl &&
                      refunds.byJob.get(job.id)?.eligible && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setRefundModalJobId(job.id);
                          }}
                          style={{
                            flex: 1,
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 3,
                            minWidth: 0,
                            padding: '8px 2px',
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            color: C.mid,
                          }}
                        >
                          <span style={{ fontSize: 9, fontWeight: 600, whiteSpace: 'nowrap' }}>
                            Request refund
                          </span>
                        </button>
                      )}
```

f) Download button — block it while a request is open. In the `onClick`, change `if (resultUrl) downloadImage(resultUrl, job.id);` to:

```tsx
                          if (resultUrl && !refundBlocks(job.id)) downloadImage(resultUrl, job.id);
```

and in the same button's style, change `cursor: isCompleted && resultUrl ? 'pointer' : 'not-allowed',` and `opacity: isCompleted && resultUrl ? 1 : 0.45,` to use a local flag:

```tsx
                          cursor: isCompleted && resultUrl && !refundBlocks(job.id) ? 'pointer' : 'not-allowed',
                          opacity: isCompleted && resultUrl && !refundBlocks(job.id) ? 1 : 0.45,
```

g) Status chip — insert immediately **before** the `{/* Actions row … */}` comment (line ~1340):

```tsx
                  {REFUND_REQUEST_ENABLED && refunds.byJob.get(job.id)?.request && (
                    <div
                      style={{
                        padding: '6px 10px',
                        fontSize: 11,
                        color: C.mid,
                        borderTop: `1px solid ${C.border}`,
                      }}
                    >
                      {(() => {
                        const req = refunds.byJob.get(job.id)?.request;
                        if (!req) return null;
                        if (req.status === 'PENDING') return 'Refund requested — under review';
                        if (req.status === 'APPROVED') return 'Refund approved — credits returned';
                        return `Refund declined${req.adminNote ? `: ${req.adminNote}` : ''}`;
                      })()}
                    </div>
                  )}
```

h) Modal — render next to the other modals, just before the closing `</>` at the end of the component (after the `showRegenerateLimitModal` block):

```tsx
      {REFUND_REQUEST_ENABLED && refundModalJobId && (
        <RefundRequestModal
          jobId={refundModalJobId}
          onClose={() => setRefundModalJobId(null)}
          onSubmitted={() => {
            setRefundModalJobId(null);
            void refunds.refetch();
          }}
        />
      )}
```

- [ ] **Step 5: Typecheck and lint**

Run: `pnpm --filter @aivastra/web typecheck && pnpm --filter @aivastra/web lint`
Expected: no errors. Fix anything Biome reports in the new files (import order, formatting).

- [ ] **Step 6: Commit**

```bash
git add apps/catalogues-web
git commit -m "feat(web): request-refund button, modal and status chip on generation results"
```

---

### Task 7: Docs, spec corrections and end-to-end verification

**Files:**
- Modify: `docs/superpowers/specs/2026-10-12-refund-on-request-design.md`, `docs/progress.md` (new entry at the top, below the header note)

- [ ] **Step 1: Correct the spec**

In `docs/superpowers/specs/2026-10-12-refund-on-request-design.md` make these four edits so it matches what was built:
1. Decisions table, "Download" row and the API section: the gate is on `POST /v1/jobs/:id/download` (which stamps `downloadedAt`), not `GET /v1/jobs/:id/result`; add that `GET /result` stays open so a pending image can still be viewed.
2. API section: replace "The job list endpoint the generation panel polls also returns `refundStatus` per job…" with the batched `GET /v1/jobs/refund-status?jobIds=…` (max 50) returning `{ items: [{ jobId, eligible, request }] }`.
3. Admin UI section: the status filter is local state; only the open request is a URL param.
4. Approve section: add the `downloaded_at IS NULL` re-check (409 `ALREADY_DOWNLOADED` → admin should reject).

Change the header line to `**Status:** implemented on branch feat/refund-on-request`.

- [ ] **Step 2: Add the progress entry**

Add at the top of `docs/progress.md` (newest first, matching the existing entry format): a dated entry (use the day you finish) "Refund on customer request", with **Done** (what shipped, migration `0221`, the two route plugins, the flag `REFUND_REQUEST_ENABLED = false` in `apps/catalogues-web/src/lib/feature-flags.ts`), the exact validation commands and results from Step 3 below, and **Open**: flag is off until enabled; decision email depends on `RESEND_API_KEY`/`EMAIL_FROM` already being set in each environment; no admin notification email (pending requests are visible on the admin page only).

- [ ] **Step 3: Full verification**

Run each and record the real output in the progress entry (do not claim a result you did not see):

```bash
pnpm docker:up
pnpm --filter @aivastra/api test:unit
cd apps/api && npx vitest run --config vitest.integration.config.ts refund-apply-tx refund-requests admin-refund-requests regenerate credits && cd ../..
pnpm --filter @aivastra/types test
pnpm typecheck
pnpm lint
```

Expected: all pass; `pnpm lint` exits 0 (existing warnings are acceptable, zero errors).

- [ ] **Step 4: Manual end-to-end check (flag on locally, not committed)**

Temporarily set `REFUND_REQUEST_ENABLED = true`, run `pnpm dev`, then:
1. Generate one image as a normal user with credits; note the balance.
2. On the finished tile, "Request refund" appears beside Regenerate. Submit it with a reason. The chip reads "Refund requested — under review"; Regenerate and Download are disabled; the image still opens in the zoom view.
3. In admin → Refund requests, the request shows with a thumbnail. Approve it. The customer's balance rises by exactly the job's credits, and an email is attempted (check the API log if Resend is not configured locally).
4. Generate a second image, request a refund, **reject** it with a note. The tile shows "Refund declined: <note>", Regenerate and Download work again, and the "Request refund" button does not return.
5. Download a third image first; confirm no refund button appears on it.

Set the flag back to `false` before committing.

- [ ] **Step 5: Commit**

```bash
git add docs apps/catalogues-web/src/lib/feature-flags.ts
git commit -m "docs: refund-on-request progress entry and spec corrections"
```

---

## Self-review notes

- Spec coverage: data model (T1), eligibility incl. merchant/api/shopify exclusion (T3), approval transaction + audit + idempotency (T2, T4), regenerate/download gates (T3), customer UI incl. chip and flag (T6), admin page with URL state (T5), email (T4), tests (T2-T4), rollout/docs (T7).
- Names are consistent across tasks: `applyRefundTx`, `hasActiveRefundRequest`, `createRefundRequest`, `getRefundStatuses`, `adminApproveRefundRequest`, `adminRejectRefundRequest`, `sendRefundDecisionEmail`, `useRefundStatuses`, `RefundRequestModal`, `REFUND_REQUEST_ENABLED`, ledger reason `REFUND_USER_REQUEST`.
