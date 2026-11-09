# v1.0 Step 2: Devices, In-Store Sessions, Entitlement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merchants pair tablets as devices to a branch; devices run kiosk/assisted in-store sessions, create attributed try-on jobs, and every in-store try-on is charged through one entitlement function (credits only).

**Architecture:** Three additive tables (`merchant_devices`, `instore_sessions`, `session_items`) plus four nullable attribution columns on `jobs`. A new `requireDevice` auth decorator (hashed device token) guards new `/v1/device/*` routes; org/admin management routes follow step 1's patterns. Job creation reuses `createMerchantTryonJob*` with an optional `JobAttribution`, so legacy callers are byte-for-byte unchanged.

**Tech Stack:** Fastify 5 + fastify-type-provider-zod, Drizzle/Postgres 16, Redis, Vitest integration harness (docker-compose), pnpm workspaces.

Spec: `docs/superpowers/specs/2026-11-06-v1-devices-sessions-entitlement-design.md`. Builds on step 1 (commit `a04f969a`).

## Global Constraints

- **Compatibility (binding):** "Nothing in step 2 may change behaviour for existing customers." Every schema change is additive (new tables, nullable columns). Existing routes, auth paths, request/response shapes and credit charging are unchanged. `createMerchantTryonJob` gains only optional attribution parameters; called as today it behaves identically. The legacy email-login kiosk path is never switched off.
- **Do not commit or push** (CLAUDE.md). Stage with `git add <files>` only; never stage `.superpowers/`. Steps that say "Stage" mean `git add`.
- **Production safety:** migrations are generated and applied to the local `tryon_dev` DB only. Never touch production/staging.
- **Audit:** every device/session/sale mutation calls `recordAudit(tx, …)` inside the same transaction (fail-closed). `audit_logs.actor_user_id` is NOT NULL → users, so device actions use the merchant owner's `users.id` with actor role `DEVICE`.
- **Tenancy:** on `/v1/device/*` every query is scoped by `merchant_id`/`branch_id`/`device_id` from the authenticated device row, never from the request body. Each endpoint gets a cross-merchant test.
- **Errors:** envelope is `{ error: { code, message } }` (`AppError(code, status, message)`); tests assert `json().error.code`.
- **Migration index:** run `git fetch origin dev` and rebase first; if `origin/dev` already holds the next index, renumber (docs/version-control.md: the server's index is canonical). After `pnpm db:generate`, format the new snapshot: `npx biome format --write packages/db/src/migrations/meta/<NNNN>_snapshot.json packages/db/src/migrations/meta/_journal.json` (the pre-commit hook rejects unformatted snapshots).
- **Lint:** after each task run `npx biome check --write <changed .ts/.tsx files>` from the repo root; remaining output must be warnings only.
- **Integration test command** (needs `pnpm docker:up`): `cd apps/api && npx vitest run --config vitest.integration.config.ts <pattern>`. Distinct RFC 5737 IPs (`203.0.113.x`) for tests that hit a rate-limited route.
- **No UI work** in this step (admin-web, Merchant Web and Android are out of scope).
- **Out of scope:** shopper OTP/consent/`shoppers`; shopper page; dashboards; subscription coverage and `device_quota_per_month` enforcement; dropping `kiosk_result_*`; removing the legacy kiosk login; quick (garment-less) try-on from devices.

## Spec gaps this plan closes (flagged)

1. The spec lists no way for a device to upload a customer photo or read job status. Added: `POST /v1/device/tryon/presign` and `GET /v1/device/tryon/jobs/:id`.
2. The spec says the merchant admin can undo a sale "any time" but admins don't hold a device token. Added: `POST /v1/merchant/org/session-items/:id/void` (admin-only); the device `DELETE` covers the staff-within-24h case.
3. `session_items.catalog_item_id` has no FK: try-on can target admin demo items (see `resolveTryonGarment`), which are not merchant-owned rows.
4. The idle sweeper ends sessions without an actor, so those ends are not audited.

## File structure

| File | Responsibility |
|---|---|
| `packages/db/src/schema/merchant-device.ts` (new) | `merchantDevices`, `instoreSessions`, `sessionItems` |
| `packages/db/src/schema/jobs.ts` (modify) | + nullable `branchId`, `deviceId`, `sessionId`, `staffId` |
| `packages/types/src/merchant-device.ts` (new) | Zod bodies |
| `apps/api/src/modules/device/secrets.ts` (new) | token/code generation + sha256 |
| `apps/api/src/modules/device/audit.ts` (new) | `deviceAuditActor(tx, merchantId)` |
| `apps/api/src/modules/device/entitlement.ts` (new) | `isDeviceCovered`, `chargeInStoreTryon` |
| `apps/api/src/modules/device/routes.ts` (new) | `/v1/device/*` |
| `apps/api/src/modules/device/session-sweeper.ts` (new) | idle-session sweeper |
| `apps/api/src/modules/merchant/org-devices.routes.ts` (new) | merchant admin device mgmt + sale void |
| `apps/api/src/modules/admin/merchant-devices.routes.ts` (new) | AiVastra admin device mgmt |
| `apps/api/src/modules/merchant/tryon-job-service.ts` (new) | extracted `createGarmentTryonJob`, `assertOwnedCustomerPhoto` |
| `apps/api/src/modules/merchant/create-tryon-job.ts` (modify) | optional `JobAttribution` |
| `apps/api/src/modules/merchant/tryon.routes.ts` (modify) | call the extracted service (no behaviour change) |
| `apps/api/src/plugins/portal-auth.ts` (modify) | `requireDevice`, `resolveStaffFromRequest` |
| `apps/api/src/server.ts`, `apps/api/src/main.ts` (modify) | register routes, start sweeper |
| `apps/api/test/helpers/merchant.ts` (modify) | `createTestDevice`, `createTestGarmentType`, `createTestCatalogItem`, `stageCustomerPhoto` |
| `apps/api/test/integration/device-*.test.ts` (new) | tests per task |

---

### Task 1: Schema, migration, shared types, test helpers

**Files:**
- Create: `packages/db/src/schema/merchant-device.ts`, `packages/types/src/merchant-device.ts`
- Modify: `packages/db/src/schema/jobs.ts`, `packages/db/src/schema/index.ts`, `packages/types/src/index.ts`, `apps/api/test/helpers/merchant.ts`
- Generate: `packages/db/src/migrations/<NNNN>_*.sql`, `meta/<NNNN>_snapshot.json`, `meta/_journal.json`
- Test: `apps/api/test/integration/device-schema.test.ts`

**Interfaces:**
- Produces (DB): `schema.merchantDevices`, `schema.instoreSessions`, `schema.sessionItems`, and `schema.jobs.{branchId,deviceId,sessionId,staffId}`.
- Produces (types): `MerchantDeviceCreateBody`, `MerchantDeviceUpdateBody`, `AdminMerchantDeviceUpdateBody`, `DevicePairBody`, `DeviceSessionCreateBody`, `DeviceSessionItemBody`, `DeviceTryonJobBody`.
- Produces (test helpers): `createTestDevice(app, merchantId, branchId, opts?) → { deviceId, token, auth }`, `createTestGarmentType(app)`, `createTestCatalogItem(app, merchantId, garmentTypeId)`, `stageCustomerPhoto(app, merchantId) → r2Key`.

- [ ] **Step 1: Write the failing schema test**

Create `apps/api/test/integration/device-schema.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';
import { createTestBranch, createTestMerchant } from '../helpers/merchant';

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

describe('device schema', () => {
  it('stores a device, a session and an item, and a legacy-shaped job still inserts with null attribution', async () => {
    const m = await createTestMerchant(app);
    const b = await createTestBranch(app, m.merchantId);
    const [device] = await app.db
      .insert(schema.merchantDevices)
      .values({ merchantId: m.merchantId, branchId: b.id, name: 'Front tablet' })
      .returning();
    expect(device).toMatchObject({ isActive: true, deviceTokenHash: null, lastSeenAt: null });

    const [session] = await app.db
      .insert(schema.instoreSessions)
      .values({ merchantId: m.merchantId, branchId: b.id, deviceId: device!.id, mode: 'kiosk' })
      .returning();
    expect(session!.endedAt).toBeNull();
    expect(session!.lastActivityAt).toBeInstanceOf(Date);

    const [item] = await app.db
      .insert(schema.sessionItems)
      .values({ sessionId: session!.id, catalogItemId: randomUUID(), action: 'wishlisted' })
      .returning();
    expect(item).toMatchObject({ voidedAt: null, jobId: null, staffId: null });

    // Compatibility: a job inserted exactly as legacy code does must still work.
    const jobId = randomUUID();
    await app.db.insert(schema.jobs).values({
      id: jobId,
      userId: m.userId,
      merchantId: m.merchantId,
      status: 'QUEUED',
      creditsCharged: 5,
      source: 'merchant_tryon',
    });
    const [job] = await app.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    expect(job).toMatchObject({ branchId: null, deviceId: null, sessionId: null, staffId: null });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/api && npx vitest run --config vitest.integration.config.ts device-schema`
Expected: FAIL (`schema.merchantDevices` undefined / TypeError).

- [ ] **Step 3: Add the schema**

Create `packages/db/src/schema/merchant-device.ts`:

```ts
import { boolean, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { merchantBranches, merchants, merchantStaff } from './merchant.js';

// v1.0 step 2 (docs/superpowers/specs/2026-11-06-v1-devices-sessions-entitlement-design.md).
// A tablet paired to one branch. Only sha256 hashes of the pairing code and token are
// stored (like api_keys); the token is shown to the device once.
export const merchantDevices = pgTable(
  'merchant_devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    merchantId: uuid('merchant_id')
      .notNull()
      .references(() => merchants.id, { onDelete: 'cascade' }),
    // No cascade: a branch with devices is deactivated, never deleted.
    branchId: uuid('branch_id')
      .notNull()
      .references(() => merchantBranches.id),
    name: text('name').notNull(),
    // Null until paired. Unique so a token resolves to exactly one device.
    deviceTokenHash: text('device_token_hash').unique(),
    pairingCodeHash: text('pairing_code_hash'),
    pairingExpiresAt: timestamp('pairing_expires_at', { withTimezone: true }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byBranch: index('merchant_devices_branch_idx').on(t.branchId, t.isActive),
    byMerchant: index('merchant_devices_merchant_idx').on(t.merchantId),
  }),
);

// One in-store visit. shopper_id / consent columns arrive with step 5.
export const instoreSessions = pgTable(
  'instore_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    merchantId: uuid('merchant_id')
      .notNull()
      .references(() => merchants.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => merchantBranches.id),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => merchantDevices.id),
    staffId: uuid('staff_id').references(() => merchantStaff.id),
    mode: text('mode', { enum: ['kiosk', 'assisted'] }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byDevice: index('instore_sessions_device_idx').on(t.deviceId, t.endedAt),
    byMerchant: index('instore_sessions_merchant_idx').on(t.merchantId, t.startedAt),
  }),
);

// catalog_item_id has no FK on purpose: try-on can target admin demo items, which
// are not merchant-owned rows. Undoing a sale sets voided_at — never a delete.
export const sessionItems = pgTable(
  'session_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => instoreSessions.id, { onDelete: 'cascade' }),
    catalogItemId: uuid('catalog_item_id').notNull(),
    jobId: uuid('job_id'),
    action: text('action', { enum: ['tried', 'wishlisted', 'sold'] }).notNull(),
    staffId: uuid('staff_id').references(() => merchantStaff.id),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedBy: uuid('voided_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    bySession: index('session_items_session_idx').on(t.sessionId),
  }),
);
```

Modify `packages/db/src/schema/index.ts`: add `export * from './merchant-device.js';` next to the other `export *` lines (match their style).

Modify `packages/db/src/schema/jobs.ts`: add imports `import { instoreSessions, merchantDevices } from './merchant-device.js';` and `import { merchantBranches, merchantStaff } from './merchant.js';` (merge with the existing `./merchant.js` import), then add these columns after `merchantId` inside the `jobs` table definition:

```ts
    // v1.0 in-store attribution. All nullable and SET NULL: legacy try-ons leave them
    // null, and deleting a device/branch/session/staff row must never delete a billing
    // record (same reasoning as shopifyShopperId above).
    branchId: uuid('branch_id').references(() => merchantBranches.id, { onDelete: 'set null' }),
    deviceId: uuid('device_id').references(() => merchantDevices.id, { onDelete: 'set null' }),
    sessionId: uuid('session_id').references(() => instoreSessions.id, { onDelete: 'set null' }),
    staffId: uuid('staff_id').references(() => merchantStaff.id, { onDelete: 'set null' }),
```

If `pnpm --filter @aivastra/db typecheck` reports TS7022/TS2589 (circular inference between `jobs.ts` and `merchant-device.ts`), annotate the lazy references: `.references((): AnyPgColumn => instoreSessions.id, …)` with `import type { AnyPgColumn } from 'drizzle-orm/pg-core'`.

- [ ] **Step 4: Add the Zod bodies**

Create `packages/types/src/merchant-device.ts`:

```ts
import { z } from 'zod';

const name = z.string().trim().min(1).max(80);

export const MerchantDeviceCreateBody = z.object({ branchId: z.string().uuid(), name });
export type MerchantDeviceCreateBody = z.infer<typeof MerchantDeviceCreateBody>;

export const MerchantDeviceUpdateBody = z
  .object({
    name: name.optional(),
    branchId: z.string().uuid().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'no fields to update');
export type MerchantDeviceUpdateBody = z.infer<typeof MerchantDeviceUpdateBody>;

export const AdminMerchantDeviceUpdateBody = MerchantDeviceUpdateBody;
export type AdminMerchantDeviceUpdateBody = MerchantDeviceUpdateBody;

export const DevicePairBody = z.object({ code: z.string().trim().toUpperCase().min(6).max(16) });
export type DevicePairBody = z.infer<typeof DevicePairBody>;

export const DeviceSessionCreateBody = z.object({ mode: z.enum(['kiosk', 'assisted']) });
export type DeviceSessionCreateBody = z.infer<typeof DeviceSessionCreateBody>;

export const DeviceSessionItemBody = z.object({
  catalogItemId: z.string().uuid(),
  action: z.enum(['wishlisted', 'sold']),
});
export type DeviceSessionItemBody = z.infer<typeof DeviceSessionItemBody>;

export const DeviceTryonJobBody = z.object({
  sessionId: z.string().uuid(),
  merchantCatalogItemId: z.string().uuid(),
  customerPhotoKey: z.string().min(1),
});
export type DeviceTryonJobBody = z.infer<typeof DeviceTryonJobBody>;
```

Modify `packages/types/src/index.ts`: add `export * from './merchant-device.js';` beside `merchant-org`.

- [ ] **Step 5: Generate, format and apply the migration (local DB only)**

Run from the repo root:

```bash
git fetch origin dev
pnpm db:generate
ls packages/db/src/migrations | tail -3
```

Expected: one new `.sql` file whose index is above the highest on `origin/dev`; its SQL contains only `CREATE TABLE merchant_devices / instore_sessions / session_items`, `ALTER TABLE "jobs" ADD COLUMN` ×4 (all nullable), FK constraints and indexes — nothing else. If any other statement appears, stop and investigate.

```bash
npx biome format --write packages/db/src/migrations/meta/<NNNN>_snapshot.json packages/db/src/migrations/meta/_journal.json
pnpm db:migrate
```

Expected: `Applied <NNNN>_…`.

- [ ] **Step 6: Add the test helpers**

Append to `apps/api/test/helpers/merchant.ts` (add `createHash`/`randomBytes` to the existing `node:crypto` import and `keys` from `@aivastra/storage` if absent):

```ts
export async function createTestDevice(
  app: TestApp,
  merchantId: string,
  branchId: string,
  opts: { isActive?: boolean; name?: string } = {},
) {
  const token = `dvc_${randomBytes(32).toString('base64url')}`;
  const [device] = await app.db
    .insert(schema.merchantDevices)
    .values({
      merchantId,
      branchId,
      name: opts.name ?? `Device ${randomUUID().slice(0, 6)}`,
      deviceTokenHash: createHash('sha256').update(token).digest('hex'),
      isActive: opts.isActive ?? true,
    })
    .returning();
  if (!device) throw new Error('failed to create test device');
  return { deviceId: device.id, token, auth: { authorization: `Device ${token}` } };
}

/** A garment type wired to an active tryon workflow, as merchant-tryon.test.ts seeds it. */
export async function createTestGarmentType(app: TestApp) {
  const [template] = await app.db
    .insert(schema.workflowTemplates)
    .values({
      slug: `template-${randomUUID()}`,
      label: 'Try-on workflow',
      jsonContent: {},
      poseNodeId: 'pose',
      upperNodeIds: [],
      garmentPhasePromptNode: 'garment',
      workflowType: 'tryon',
      isActive: true,
    })
    .returning();
  const [category] = await app.db
    .insert(schema.tryonCategories)
    .values({
      name: `category-${randomUUID()}`,
      slug: `category-${randomUUID()}`,
      workflowTemplateId: template!.id,
      isActive: true,
    })
    .returning();
  const [garmentType] = await app.db
    .insert(schema.garmentSubcategories)
    .values({
      genderSlug: 'women',
      slug: `shirt-${randomUUID()}`,
      label: 'Shirt',
      tryonCategoryId: category!.id,
    })
    .returning();
  return garmentType!;
}

export async function createTestCatalogItem(app: TestApp, merchantId: string, garmentTypeId: string) {
  const [subcategory] = await app.db
    .insert(schema.merchantCatalogSubcategories)
    .values({ merchantId, category: 'women', name: 'Casual Shirts', garmentSubcategoryId: garmentTypeId })
    .returning();
  const imageKey = `merchant-catalog/${merchantId}/${randomUUID()}/image.jpg`;
  const thumbKey = `merchant-catalog/${merchantId}/${randomUUID()}/thumb.jpg`;
  await app.storage.putObject(imageKey, Buffer.from('img'), 'image/jpeg');
  await app.storage.putObject(thumbKey, Buffer.from('thumb'), 'image/jpeg');
  const [item] = await app.db
    .insert(schema.merchantCatalogItems)
    .values({
      merchantId,
      subcategoryId: subcategory!.id,
      label: 'Red Shirt',
      actualPricePaise: 200000,
      offerPricePaise: 180000,
      r2Key: imageKey,
      thumbnailKey: thumbKey,
    })
    .returning();
  return item!;
}

/** A customer photo this merchant "presigned": object in storage + the redis owner record. */
export async function stageCustomerPhoto(app: TestApp, merchantId: string) {
  const r2Key = keys.merchantTryonInput(merchantId, randomUUID(), 'jpg');
  await app.storage.putObject(r2Key, Buffer.from('photo'), 'image/jpeg');
  await app.redis.set(`upload:owner:${r2Key}`, merchantId, 'EX', 600);
  return r2Key;
}
```

(These three helpers deliberately copy `merchant-tryon.test.ts`'s local seeders instead of moving them, so the legacy test file stays untouched.)

- [ ] **Step 7: Run tests and typechecks**

Run: `cd apps/api && npx vitest run --config vitest.integration.config.ts device-schema`
Expected: PASS (1 test).
Run (repo root): `pnpm --filter @aivastra/db typecheck && pnpm --filter @aivastra/types typecheck && pnpm --filter @aivastra/api typecheck`
Expected: no errors.

- [ ] **Step 8: Lint and stage**

```bash
npx biome check --write packages/db/src/schema/merchant-device.ts packages/db/src/schema/jobs.ts packages/db/src/schema/index.ts packages/types/src/merchant-device.ts packages/types/src/index.ts apps/api/test/helpers/merchant.ts apps/api/test/integration/device-schema.test.ts
git add packages/db packages/types apps/api/test
git status --short | grep -v '^[AM] ' || true
```

Expected: no errors from biome; nothing unstaged/untracked that belongs to this task.

---

### Task 2: Device auth, pairing, and `GET /v1/device/me`

**Files:**
- Create: `apps/api/src/modules/device/secrets.ts`, `apps/api/src/modules/device/audit.ts`, `apps/api/src/modules/device/routes.ts`
- Modify: `apps/api/src/plugins/portal-auth.ts`, `apps/api/src/server.ts`
- Test: `apps/api/test/integration/device-auth.test.ts`

**Interfaces:**
- Consumes: Task 1 schema, `createTestDevice`.
- Produces: `app.requireDevice`; `req.device: { deviceId; merchantId; branchId; name }`; `generatePairingCode(): string`, `generateDeviceToken(): string`, `sha256(s: string): string`; `deviceAuditActor(tx: DbTransaction, merchantId: string): Promise<{ userId: string; role: 'DEVICE' }>`; `deviceRoutes(app)` (grows in later tasks).

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/integration/device-auth.test.ts`:

```ts
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generatePairingCode, sha256 } from '../../src/modules/device/secrets';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';
import { createTestBranch, createTestDevice, createTestMerchant } from '../helpers/merchant';

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

async function pendingDevice(merchantId: string, branchId: string, minutes = 15) {
  const code = generatePairingCode();
  const [d] = await app.db
    .insert(schema.merchantDevices)
    .values({
      merchantId,
      branchId,
      name: 'Pending',
      pairingCodeHash: sha256(code),
      pairingExpiresAt: new Date(Date.now() + minutes * 60_000),
    })
    .returning();
  return { code, deviceId: d!.id };
}

describe('device pairing', () => {
  it('exchanges a code for a one-time token that then authenticates', async () => {
    const m = await createTestMerchant(app);
    const b = await createTestBranch(app, m.merchantId);
    const { code, deviceId } = await pendingDevice(m.merchantId, b.id);

    const res = await app.inject({ method: 'POST', url: '/v1/device/pair', payload: { code }, remoteAddress: '203.0.113.11' });
    expect(res.statusCode).toBe(200);
    const { token } = res.json() as { token: string };
    expect(token.startsWith('dvc_')).toBe(true);

    const [row] = await app.db.select().from(schema.merchantDevices).where(eq(schema.merchantDevices.id, deviceId));
    expect(row!.deviceTokenHash).toBe(sha256(token));
    expect(row!.pairingCodeHash).toBeNull();

    const me = await app.inject({ method: 'GET', url: '/v1/device/me', headers: { authorization: `Device ${token}` } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ deviceId, merchantId: m.merchantId, branchId: b.id });
  });

  it('refuses a reused code, an expired code and an unknown code with the same 400', async () => {
    const m = await createTestMerchant(app);
    const b = await createTestBranch(app, m.merchantId);
    const fresh = await pendingDevice(m.merchantId, b.id);
    const expired = await pendingDevice(m.merchantId, b.id, -1);
    const ok = await app.inject({ method: 'POST', url: '/v1/device/pair', payload: { code: fresh.code }, remoteAddress: '203.0.113.12' });
    expect(ok.statusCode).toBe(200);

    for (const code of [fresh.code, expired.code, 'ZZZZZZZZ']) {
      const res = await app.inject({ method: 'POST', url: '/v1/device/pair', payload: { code }, remoteAddress: '203.0.113.12' });
      expect(res.statusCode, code).toBe(400);
      expect(res.json().error.code).toBe('INVALID_PAIRING_CODE');
    }
  });

  it('lets exactly one of two concurrent claims win', async () => {
    const m = await createTestMerchant(app);
    const b = await createTestBranch(app, m.merchantId);
    const { code } = await pendingDevice(m.merchantId, b.id);
    const claim = () => app.inject({ method: 'POST', url: '/v1/device/pair', payload: { code }, remoteAddress: '203.0.113.13' });
    const results = await Promise.all([claim(), claim()]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 400]);
  });

  it('rate-limits pairing attempts per IP', async () => {
    let last = 0;
    for (let i = 0; i < 12; i++) {
      const res = await app.inject({ method: 'POST', url: '/v1/device/pair', payload: { code: 'ABCDEFGH' }, remoteAddress: '203.0.113.14' });
      last = res.statusCode;
    }
    expect(last).toBe(429);
  });
});

describe('requireDevice', () => {
  it('rejects a missing, malformed or unknown token', async () => {
    for (const headers of [{}, { authorization: 'Bearer x' }, { authorization: 'Device nope' }]) {
      const res = await app.inject({ method: 'GET', url: '/v1/device/me', headers });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('DEVICE_INACTIVE');
    }
  });

  it('rejects the very next request after the device, its branch or its merchant is deactivated', async () => {
    const m = await createTestMerchant(app);
    const b = await createTestBranch(app, m.merchantId);
    const d = await createTestDevice(app, m.merchantId, b.id);
    const get = () => app.inject({ method: 'GET', url: '/v1/device/me', headers: d.auth });
    expect((await get()).statusCode).toBe(200);

    await app.db.update(schema.merchantBranches).set({ isActive: false }).where(eq(schema.merchantBranches.id, b.id));
    expect((await get()).statusCode).toBe(401);
    await app.db.update(schema.merchantBranches).set({ isActive: true }).where(eq(schema.merchantBranches.id, b.id));
    expect((await get()).statusCode).toBe(200);

    await app.db.update(schema.merchants).set({ isActive: false }).where(eq(schema.merchants.id, m.merchantId));
    expect((await get()).statusCode).toBe(401);
    await app.db.update(schema.merchants).set({ isActive: true }).where(eq(schema.merchants.id, m.merchantId));

    await app.db.update(schema.merchantDevices).set({ isActive: false }).where(eq(schema.merchantDevices.id, d.deviceId));
    expect((await get()).statusCode).toBe(401);
  });

  it('records last_seen_at', async () => {
    const m = await createTestMerchant(app);
    const b = await createTestBranch(app, m.merchantId);
    const d = await createTestDevice(app, m.merchantId, b.id);
    await app.inject({ method: 'GET', url: '/v1/device/me', headers: d.auth });
    const [row] = await app.db.select().from(schema.merchantDevices).where(eq(schema.merchantDevices.id, d.deviceId));
    expect(row!.lastSeenAt).toBeInstanceOf(Date);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/api && npx vitest run --config vitest.integration.config.ts device-auth`
Expected: FAIL (module `device/secrets` not found).

- [ ] **Step 3: Implement secrets and audit actor**

Create `apps/api/src/modules/device/secrets.ts`:

```ts
import { createHash, randomBytes, randomInt } from 'node:crypto';

// No 0/O/1/I/L: the code is read off one screen and typed into another.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generatePairingCode(): string {
  let out = '';
  for (let i = 0; i < 8; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

export function generateDeviceToken(): string {
  return `dvc_${randomBytes(32).toString('base64url')}`;
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
```

Create `apps/api/src/modules/device/audit.ts`:

```ts
import { type DbTransaction, schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { AppError } from '../../lib/errors.js';

// audit_logs.actor_user_id is NOT NULL → users, and a device has no user. Device
// actions are attributed to the owning merchant's user with a distinct role so
// Team Activity can tell them apart from the merchant admin acting in Merchant Web.
export async function deviceAuditActor(tx: DbTransaction, merchantId: string) {
  const [row] = await tx
    .select({ userId: schema.merchants.userId })
    .from(schema.merchants)
    .where(eq(schema.merchants.id, merchantId))
    .limit(1);
  if (!row) throw new AppError('NOT_FOUND', 404, 'merchant not found');
  return { userId: row.userId, role: 'DEVICE' as const };
}
```

- [ ] **Step 4: Add `requireDevice` to the auth plugin**

Modify `apps/api/src/plugins/portal-auth.ts`. Add imports `import { and } from 'drizzle-orm';` (merge with the existing `eq` import) and `import { sha256 } from '../modules/device/secrets.js';`. Inside `portalAuthPlugin`, after the `requireMerchantAdmin` decorate block, add:

```ts
  // v1.0 devices: `Authorization: Device <token>`. The token is sha256-hashed and looked up;
  // device, branch and merchant must all be active, so deactivating any of them rejects the
  // device's very next request. Legacy requireMerchant / email login are unaffected.
  app.decorate('requireDevice', async (req, _reply) => {
    const h = req.headers.authorization;
    const token = h?.startsWith('Device ') ? h.slice(7).trim() : '';
    const inactive = () => new AppError('DEVICE_INACTIVE', 401, 'device not recognised or inactive');
    if (!token) throw inactive();

    const [row] = await app.db
      .select({
        deviceId: schema.merchantDevices.id,
        merchantId: schema.merchantDevices.merchantId,
        branchId: schema.merchantDevices.branchId,
        name: schema.merchantDevices.name,
      })
      .from(schema.merchantDevices)
      .innerJoin(schema.merchantBranches, eq(schema.merchantBranches.id, schema.merchantDevices.branchId))
      .innerJoin(schema.merchants, eq(schema.merchants.id, schema.merchantDevices.merchantId))
      .where(
        and(
          eq(schema.merchantDevices.deviceTokenHash, sha256(token)),
          eq(schema.merchantDevices.isActive, true),
          eq(schema.merchantBranches.isActive, true),
          eq(schema.merchants.isActive, true),
        ),
      )
      .limit(1);
    if (!row) throw inactive();

    await app.db
      .update(schema.merchantDevices)
      .set({ lastSeenAt: new Date() })
      .where(eq(schema.merchantDevices.id, row.deviceId));
    req.device = row;
  });
```

At the bottom, add the type and augmentations:

```ts
export interface AuthenticatedDevice {
  deviceId: string;
  merchantId: string;
  branchId: string;
  name: string;
}
```

and inside `declare module 'fastify'`: `device?: AuthenticatedDevice;` on `FastifyRequest`, and `requireDevice: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;` on `FastifyInstance`.

- [ ] **Step 5: Add the device routes (pair + me)**

Create `apps/api/src/modules/device/routes.ts`:

```ts
import { schema } from '@aivastra/db';
import { DevicePairBody } from '@aivastra/types';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { recordAudit } from '../admin/audit.js';
import { deviceAuditActor } from './audit.js';
import { generateDeviceToken, sha256 } from './secrets.js';

export async function deviceRoutes(app: FastifyInstance) {
  // Unauthenticated by design: the one-time code IS the credential. Wrong, expired and
  // already-used codes are indistinguishable (same 400) so codes cannot be probed, and the
  // per-IP limit bounds guessing of an 8-char code that lives 15 minutes.
  app.post(
    '/v1/device/pair',
    {
      schema: { body: DevicePairBody },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { code } = req.body as z.infer<typeof DevicePairBody>;
      const token = generateDeviceToken();
      return app.db.transaction(async (tx) => {
        // Atomic claim: only one concurrent caller can match all four predicates.
        const [device] = await tx
          .update(schema.merchantDevices)
          .set({
            deviceTokenHash: sha256(token),
            pairingCodeHash: null,
            pairingExpiresAt: null,
            lastSeenAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.merchantDevices.pairingCodeHash, sha256(code)),
              gt(schema.merchantDevices.pairingExpiresAt, sql`now()`),
              isNull(schema.merchantDevices.deviceTokenHash),
              eq(schema.merchantDevices.isActive, true),
            ),
          )
          .returning({
            id: schema.merchantDevices.id,
            merchantId: schema.merchantDevices.merchantId,
            branchId: schema.merchantDevices.branchId,
            name: schema.merchantDevices.name,
          });
        if (!device) throw new AppError('INVALID_PAIRING_CODE', 400, 'invalid or expired pairing code');

        await recordAudit(tx, {
          actor: await deviceAuditActor(tx, device.merchantId),
          action: 'merchant_device.pair',
          resourceType: 'merchant_device',
          resourceId: device.id,
          after: { branchId: device.branchId, name: device.name },
          request: req,
        });
        return { token, deviceId: device.id, merchantId: device.merchantId, branchId: device.branchId, name: device.name };
      });
    },
  );

  app.get('/v1/device/me', { preHandler: app.requireDevice }, async (req) => {
    const d = req.device;
    if (!d) throw new AppError('DEVICE_INACTIVE', 401, 'device not recognised or inactive');
    return d;
  });
}
```

Modify `apps/api/src/server.ts`: import `deviceRoutes` from `./modules/device/routes.js` (keep the file's import ordering) and register it next to the other `await app.register(…)` calls the same way `merchantOrgRoutes` is registered.

- [ ] **Step 6: Run tests**

Run: `cd apps/api && npx vitest run --config vitest.integration.config.ts device-auth device-schema`
Expected: PASS (all). If the rate-limit test returns 200 at the 12th request, the harness may key limits differently: confirm `remoteAddress` is honoured by checking another test that uses it (`grep -rn remoteAddress apps/api/test/integration | head`) and mirror that.
Run: `cd apps/api && npx vitest run --config vitest.integration.config.ts merchant-org merchant-me` — Expected: PASS (plugin edit must not disturb step 1).
Run: `pnpm --filter @aivastra/api typecheck` — Expected: clean.

- [ ] **Step 7: Lint and stage**

```bash
npx biome check --write apps/api/src/modules/device apps/api/src/plugins/portal-auth.ts apps/api/src/server.ts apps/api/test/integration/device-auth.test.ts
git add apps/api
```

---

### Task 3: Device management routes (merchant admin + AiVastra admin)

**Files:**
- Create: `apps/api/src/modules/merchant/org-devices.routes.ts`, `apps/api/src/modules/admin/merchant-devices.routes.ts`
- Modify: `apps/api/src/modules/admin/merchant-org.routes.ts` (export `ORG_EDIT`), `apps/api/src/server.ts`
- Test: `apps/api/test/integration/device-management.test.ts`

**Interfaces:**
- Consumes: Task 1/2 outputs; `requireMerchantAdmin`, `requireMerchantMember`; step 1's `ORG_EDIT`; `recordAudit`.
- Produces: `updateDevice(app, req, deviceId, body, ctx: { merchantId: string; actor: { userId: string; role: string } }): Promise<DeviceRow>` exported from `org-devices.routes.ts`; routes `POST/GET/PATCH /v1/merchant/org/devices`, `GET/PATCH /admin/merchants/:id/devices[/:deviceId]`.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/integration/device-management.test.ts`:

```ts
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from '../helpers/api';
import { adminAuthHeader } from '../helpers/admin';
import { type Containers, startContainers } from '../helpers/containers';
import { createTestBranch, createTestDevice, createTestMerchant, createTestStaff, memberAuthHeader } from '../helpers/merchant';

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

describe('merchant device management', () => {
  it('admin creates a device and gets a one-time pairing code that pairs', async () => {
    const m = await createTestMerchant(app);
    const b = await createTestBranch(app, m.merchantId);
    const admin = await memberAuthHeader(app, m.userId);

    const res = await app.inject({ method: 'POST', url: '/v1/merchant/org/devices', headers: admin, payload: { branchId: b.id, name: 'Front tablet' } });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { id: string; pairingCode: string; pairingExpiresAt: string };
    expect(body.pairingCode).toHaveLength(8);
    expect(new Date(body.pairingExpiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(JSON.stringify(body)).not.toContain('Hash');

    const pair = await app.inject({ method: 'POST', url: '/v1/device/pair', payload: { code: body.pairingCode }, remoteAddress: '203.0.113.21' });
    expect(pair.statusCode).toBe(200);

    const audit = await app.db.select().from(schema.auditLogs).where(eq(schema.auditLogs.resourceId, body.id));
    expect(audit.map((a) => a.action).sort()).toEqual(['merchant_device.create', 'merchant_device.pair']);
  });

  it('refuses a branch of another merchant and staff creating devices', async () => {
    const a = await createTestMerchant(app);
    const other = await createTestMerchant(app);
    const foreign = await createTestBranch(app, other.merchantId);
    const own = await createTestBranch(app, a.merchantId);
    const admin = await memberAuthHeader(app, a.userId);

    const cross = await app.inject({ method: 'POST', url: '/v1/merchant/org/devices', headers: admin, payload: { branchId: foreign.id, name: 'X' } });
    expect(cross.statusCode).toBe(404);

    const staff = await createTestStaff(app, a.merchantId, own.id);
    const asStaff = await app.inject({ method: 'POST', url: '/v1/merchant/org/devices', headers: staff.auth, payload: { branchId: own.id, name: 'X' } });
    expect(asStaff.statusCode).toBe(403);
  });

  it('lists all devices for the admin but only the own branch for staff, never leaking hashes', async () => {
    const m = await createTestMerchant(app);
    const b1 = await createTestBranch(app, m.merchantId);
    const b2 = await createTestBranch(app, m.merchantId);
    await createTestDevice(app, m.merchantId, b1.id);
    await createTestDevice(app, m.merchantId, b2.id);
    const staff = await createTestStaff(app, m.merchantId, b1.id);

    const adminList = await app.inject({ method: 'GET', url: '/v1/merchant/org/devices', headers: await memberAuthHeader(app, m.userId) });
    expect(adminList.json()).toHaveLength(2);
    const staffList = await app.inject({ method: 'GET', url: '/v1/merchant/org/devices', headers: staff.auth });
    const rows = staffList.json() as Array<{ branchId: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.branchId).toBe(b1.id);
    expect(JSON.stringify(rows)).not.toMatch(/Hash/);
  });

  it('PATCH renames, moves within the merchant, deactivates (device rejected next request) and audits', async () => {
    const m = await createTestMerchant(app);
    const b1 = await createTestBranch(app, m.merchantId);
    const b2 = await createTestBranch(app, m.merchantId);
    const foreign = await createTestBranch(app, (await createTestMerchant(app)).merchantId);
    const d = await createTestDevice(app, m.merchantId, b1.id);
    const admin = await memberAuthHeader(app, m.userId);
    const patch = (payload: object) => app.inject({ method: 'PATCH', url: `/v1/merchant/org/devices/${d.deviceId}`, headers: admin, payload });

    expect((await patch({ name: 'Renamed', branchId: b2.id })).json()).toMatchObject({ name: 'Renamed', branchId: b2.id });
    expect((await patch({ branchId: foreign.id })).statusCode).toBe(404);
    expect((await patch({ isActive: false })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/v1/device/me', headers: d.auth })).statusCode).toBe(401);

    const audit = await app.db.select().from(schema.auditLogs).where(eq(schema.auditLogs.resourceId, d.deviceId));
    expect(audit.filter((a) => a.action === 'merchant_device.update').length).toBeGreaterThanOrEqual(2);
  });

  it("cannot touch another merchant's device", async () => {
    const a = await createTestMerchant(app);
    const other = await createTestMerchant(app);
    const ob = await createTestBranch(app, other.merchantId);
    const od = await createTestDevice(app, other.merchantId, ob.id);
    const res = await app.inject({ method: 'PATCH', url: `/v1/merchant/org/devices/${od.deviceId}`, headers: await memberAuthHeader(app, a.userId), payload: { isActive: false } });
    expect(res.statusCode).toBe(404);
  });
});

describe('admin device management', () => {
  it('ADMIN and SUPER_ADMIN can list and edit; MODERATOR and SUPPORT cannot edit', async () => {
    const m = await createTestMerchant(app);
    const b = await createTestBranch(app, m.merchantId);
    const d = await createTestDevice(app, m.merchantId, b.id);
    const base = `/admin/merchants/${m.merchantId}/devices`;

    const list = await app.inject({ method: 'GET', url: base, headers: await adminAuthHeader(app, 'ADMIN') });
    expect(list.statusCode).toBe(200);
    expect((list.json() as unknown[]).length).toBe(1);

    for (const role of ['SUPER_ADMIN', 'ADMIN'] as const) {
      const ok = await app.inject({ method: 'PATCH', url: `${base}/${d.deviceId}`, headers: await adminAuthHeader(app, role), payload: { name: `by ${role}` } });
      expect(ok.statusCode, role).toBe(200);
    }
    for (const role of ['MODERATOR', 'SUPPORT'] as const) {
      const no = await app.inject({ method: 'PATCH', url: `${base}/${d.deviceId}`, headers: await adminAuthHeader(app, role), payload: { name: 'x' } });
      expect(no.statusCode, role).toBe(403);
    }
    const mismatch = await app.inject({ method: 'PATCH', url: `/admin/merchants/${(await createTestMerchant(app)).merchantId}/devices/${d.deviceId}`, headers: await adminAuthHeader(app, 'ADMIN'), payload: { name: 'x' } });
    expect(mismatch.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/api && npx vitest run --config vitest.integration.config.ts device-management`
Expected: FAIL (404 on the new routes).

- [ ] **Step 3: Implement the merchant routes and shared `updateDevice`**

Create `apps/api/src/modules/merchant/org-devices.routes.ts`:

```ts
import { schema } from '@aivastra/db';
import { MerchantDeviceCreateBody, MerchantDeviceUpdateBody } from '@aivastra/types';
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { recordAudit } from '../admin/audit.js';
import { generatePairingCode, sha256 } from '../device/secrets.js';

const MERCHANT_ADMIN_ACTOR_ROLE = 'MERCHANT_ADMIN';
const PAIRING_TTL_MS = 15 * 60_000;

// Never select the token or code hashes into a response.
const deviceSelect = {
  id: schema.merchantDevices.id,
  branchId: schema.merchantDevices.branchId,
  name: schema.merchantDevices.name,
  isActive: schema.merchantDevices.isActive,
  paired: schema.merchantDevices.deviceTokenHash,
  lastSeenAt: schema.merchantDevices.lastSeenAt,
  createdAt: schema.merchantDevices.createdAt,
};

type DeviceRow = Omit<Awaited<ReturnType<typeof loadDevice>>, 'paired'> & { paired: boolean };

async function loadDevice(
  db: Pick<FastifyInstance['db'], 'select'>,
  merchantId: string,
  deviceId: string,
) {
  const [row] = await db
    .select(deviceSelect)
    .from(schema.merchantDevices)
    .where(and(eq(schema.merchantDevices.id, deviceId), eq(schema.merchantDevices.merchantId, merchantId)));
  return row;
}

const present = (row: NonNullable<Awaited<ReturnType<typeof loadDevice>>>): DeviceRow => ({
  ...row,
  paired: row.paired !== null,
});

/**
 * Shared by the merchant-admin route and the AiVastra admin route. Always scoped by
 * merchantId; a move verifies the target branch belongs to the same merchant (404
 * otherwise, never revealing another merchant's branch).
 */
export async function updateDevice(
  app: FastifyInstance,
  req: FastifyRequest,
  deviceId: string,
  body: z.infer<typeof MerchantDeviceUpdateBody>,
  ctx: { merchantId: string; actor: { userId: string; role: string } },
): Promise<DeviceRow> {
  return app.db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.merchantDevices)
      .where(and(eq(schema.merchantDevices.id, deviceId), eq(schema.merchantDevices.merchantId, ctx.merchantId)))
      .for('update');
    if (!existing) throw new AppError('NOT_FOUND', 404, 'device not found');

    if (body.branchId && body.branchId !== existing.branchId) {
      const [branch] = await tx
        .select({ id: schema.merchantBranches.id })
        .from(schema.merchantBranches)
        .where(and(eq(schema.merchantBranches.id, body.branchId), eq(schema.merchantBranches.merchantId, ctx.merchantId)));
      if (!branch) throw new AppError('NOT_FOUND', 404, 'branch not found');
    }

    await tx
      .update(schema.merchantDevices)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(schema.merchantDevices.id, deviceId));
    const after = await loadDevice(tx, ctx.merchantId, deviceId);
    await recordAudit(tx, {
      actor: ctx.actor,
      action: 'merchant_device.update',
      resourceType: 'merchant_device',
      resourceId: deviceId,
      before: { name: existing.name, branchId: existing.branchId, isActive: existing.isActive },
      after: { name: after?.name, branchId: after?.branchId, isActive: after?.isActive },
      request: req,
    });
    return present(after!);
  });
}

export async function merchantOrgDeviceRoutes(app: FastifyInstance) {
  app.post(
    '/v1/merchant/org/devices',
    { preHandler: app.requireMerchantAdmin, schema: { body: MerchantDeviceCreateBody } },
    async (req, reply) => {
      const m = req.merchantMember!;
      const body = req.body as z.infer<typeof MerchantDeviceCreateBody>;
      const code = generatePairingCode();
      const expires = new Date(Date.now() + PAIRING_TTL_MS);
      const device = await app.db.transaction(async (tx) => {
        const [branch] = await tx
          .select({ id: schema.merchantBranches.id, isActive: schema.merchantBranches.isActive })
          .from(schema.merchantBranches)
          .where(and(eq(schema.merchantBranches.id, body.branchId), eq(schema.merchantBranches.merchantId, m.merchantId)));
        if (!branch) throw new AppError('NOT_FOUND', 404, 'branch not found');
        if (!branch.isActive) throw new AppError('VALIDATION', 400, 'branch is inactive');
        const [row] = await tx
          .insert(schema.merchantDevices)
          .values({ merchantId: m.merchantId, branchId: body.branchId, name: body.name, pairingCodeHash: sha256(code), pairingExpiresAt: expires })
          .returning({ id: schema.merchantDevices.id, branchId: schema.merchantDevices.branchId, name: schema.merchantDevices.name });
        await recordAudit(tx, {
          actor: { userId: m.userId, role: MERCHANT_ADMIN_ACTOR_ROLE },
          action: 'merchant_device.create',
          resourceType: 'merchant_device',
          resourceId: row!.id,
          after: row,
          request: req,
        });
        return row!;
      });
      return reply.code(201).send({ ...device, pairingCode: code, pairingExpiresAt: expires.toISOString() });
    },
  );

  app.get('/v1/merchant/org/devices', { preHandler: app.requireMerchantMember }, async (req) => {
    const m = req.merchantMember!;
    const scope =
      m.role === 'staff'
        ? and(eq(schema.merchantDevices.merchantId, m.merchantId), eq(schema.merchantDevices.branchId, m.branchId!))
        : eq(schema.merchantDevices.merchantId, m.merchantId);
    const rows = await app.db.select(deviceSelect).from(schema.merchantDevices).where(scope).orderBy(asc(schema.merchantDevices.createdAt));
    return rows.map(present);
  });

  app.patch(
    '/v1/merchant/org/devices/:id',
    { preHandler: app.requireMerchantAdmin, schema: { body: MerchantDeviceUpdateBody } },
    async (req) => {
      const m = req.merchantMember!;
      const { id } = req.params as { id: string };
      return updateDevice(app, req, id, req.body as z.infer<typeof MerchantDeviceUpdateBody>, {
        merchantId: m.merchantId,
        actor: { userId: m.userId, role: MERCHANT_ADMIN_ACTOR_ROLE },
      });
    },
  );
}
```

(`!` non-null assertions match step 1's merchant routes; biome reports them as warnings only.)

- [ ] **Step 4: Implement the admin routes and export `ORG_EDIT`**

In `apps/api/src/modules/admin/merchant-org.routes.ts` change `const ORG_EDIT = …` to `export const ORG_EDIT = …`.

Create `apps/api/src/modules/admin/merchant-devices.routes.ts`:

```ts
import { schema } from '@aivastra/db';
import { AdminMerchantDeviceUpdateBody } from '@aivastra/types';
import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import { updateDevice } from '../merchant/org-devices.routes.js';
import { ORG_EDIT } from './merchant-org.routes.js';
import { requirePermission } from './guard.js';

// Same role gate as branch/staff edits (see ORG_EDIT): SUPER_ADMIN and ADMIN.
export async function adminMerchantDeviceRoutes(app: FastifyInstance) {
  app.get('/admin/merchants/:id/devices', { preHandler: requirePermission('merchants.read') }, async (req) => {
    const { id } = req.params as { id: string };
    const rows = await app.db
      .select({
        id: schema.merchantDevices.id,
        branchId: schema.merchantDevices.branchId,
        name: schema.merchantDevices.name,
        isActive: schema.merchantDevices.isActive,
        paired: schema.merchantDevices.deviceTokenHash,
        lastSeenAt: schema.merchantDevices.lastSeenAt,
      })
      .from(schema.merchantDevices)
      .where(eq(schema.merchantDevices.merchantId, id))
      .orderBy(asc(schema.merchantDevices.createdAt));
    return rows.map((r) => ({ ...r, paired: r.paired !== null }));
  });

  app.patch(
    '/admin/merchants/:id/devices/:deviceId',
    { preHandler: ORG_EDIT, schema: { body: AdminMerchantDeviceUpdateBody } },
    async (req) => {
      const { id, deviceId } = req.params as { id: string; deviceId: string };
      return updateDevice(app, req, deviceId, req.body as z.infer<typeof AdminMerchantDeviceUpdateBody>, {
        merchantId: id,
        actor: { userId: req.userId, role: req.adminRole! },
      });
    },
  );
}
```

Modify `apps/api/src/server.ts`: import and register `merchantOrgDeviceRoutes` and `adminMerchantDeviceRoutes` exactly like `merchantOrgRoutes` / `adminMerchantOrgRoutes`.

- [ ] **Step 5: Run tests**

Run: `cd apps/api && npx vitest run --config vitest.integration.config.ts device-management device-auth admin-merchant-org merchant-org`
Expected: PASS. `pnpm --filter @aivastra/api typecheck` clean.

- [ ] **Step 6: Lint and stage**

```bash
npx biome check --write apps/api/src/modules/merchant/org-devices.routes.ts apps/api/src/modules/admin apps/api/src/server.ts apps/api/test/integration/device-management.test.ts
git add apps/api
```

---

### Task 4: Sessions, items, sale void, idle sweeper

**Files:**
- Modify: `apps/api/src/plugins/portal-auth.ts`, `apps/api/src/modules/device/routes.ts`, `apps/api/src/modules/merchant/org-devices.routes.ts`, `apps/api/src/main.ts`
- Create: `apps/api/src/modules/device/session-sweeper.ts`
- Test: `apps/api/test/integration/device-sessions.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: `app.resolveStaffFromRequest(req): Promise<MerchantMember>` (reads `X-Staff-Authorization: Bearer <jwt>`, same resolution as `requireMerchantMember`); routes `POST /v1/device/sessions`, `POST /v1/device/sessions/:id/end`, `POST /v1/device/sessions/:id/items`, `DELETE /v1/device/sessions/:id/items/:itemId`, `POST /v1/merchant/org/session-items/:id/void`; `runInstoreSessionSweepTick(app, opts?: { idleMs?: number }): Promise<{ ended: number }>`, `startInstoreSessionSweeper(app, intervalMs?)`.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/integration/device-sessions.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runInstoreSessionSweepTick } from '../../src/modules/device/session-sweeper';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';
import { createTestBranch, createTestDevice, createTestMerchant, createTestStaff, memberAuthHeader } from '../helpers/merchant';

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

async function setup() {
  const m = await createTestMerchant(app);
  const branch = await createTestBranch(app, m.merchantId);
  const device = await createTestDevice(app, m.merchantId, branch.id);
  const staff = await createTestStaff(app, m.merchantId, branch.id);
  return { m, branch, device, staff };
}
const startSession = (device: { auth: Record<string, string> }, payload: object, extra: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url: '/v1/device/sessions', headers: { ...device.auth, ...extra }, payload });

describe('device sessions', () => {
  it('starts a kiosk session without staff', async () => {
    const { device, branch, m } = await setup();
    const res = await startSession(device, { mode: 'kiosk' });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ mode: 'kiosk', branchId: branch.id, staffId: null });
    const [row] = await app.db.select().from(schema.instoreSessions).where(eq(schema.instoreSessions.id, res.json().id));
    expect(row).toMatchObject({ merchantId: m.merchantId, deviceId: device.deviceId });
  });

  it('assisted needs a staff JWT of this device\'s branch', async () => {
    const { m, device, staff } = await setup();
    const none = await startSession(device, { mode: 'assisted' });
    expect(none.statusCode).toBe(401);

    const ok = await startSession(device, { mode: 'assisted' }, { 'x-staff-authorization': staff.auth.authorization });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().staffId).toBe(staff.staffId);

    const otherBranch = await createTestBranch(app, m.merchantId);
    const elsewhere = await createTestStaff(app, m.merchantId, otherBranch.id);
    const wrongBranch = await startSession(device, { mode: 'assisted' }, { 'x-staff-authorization': elsewhere.auth.authorization });
    expect(wrongBranch.statusCode).toBe(403);

    const otherMerchant = await createTestMerchant(app);
    const ob = await createTestBranch(app, otherMerchant.merchantId);
    const foreignStaff = await createTestStaff(app, otherMerchant.merchantId, ob.id);
    const wrongMerchant = await startSession(device, { mode: 'assisted' }, { 'x-staff-authorization': foreignStaff.auth.authorization });
    expect(wrongMerchant.statusCode).toBe(403);

    const owner = await memberAuthHeader(app, m.userId);
    const asAdmin = await startSession(device, { mode: 'assisted' }, { 'x-staff-authorization': owner.authorization });
    expect(asAdmin.statusCode).toBe(403);

    await app.db.update(schema.merchantStaff).set({ isActive: false }).where(eq(schema.merchantStaff.id, staff.staffId));
    const inactive = await startSession(device, { mode: 'assisted' }, { 'x-staff-authorization': staff.auth.authorization });
    expect(inactive.statusCode).toBe(403);
  });

  it('is idempotent on Idempotency-Key', async () => {
    const { device } = await setup();
    const key = randomUUID();
    const a = await startSession(device, { mode: 'kiosk' }, { 'idempotency-key': key });
    const b = await startSession(device, { mode: 'kiosk' }, { 'idempotency-key': key });
    expect(a.json().id).toBe(b.json().id);
  });

  it('ends a session once and refuses items on an ended session', async () => {
    const { device } = await setup();
    const s = (await startSession(device, { mode: 'kiosk' })).json() as { id: string };
    const end = await app.inject({ method: 'POST', url: `/v1/device/sessions/${s.id}/end`, headers: device.auth });
    expect(end.statusCode).toBe(200);
    const again = await app.inject({ method: 'POST', url: `/v1/device/sessions/${s.id}/end`, headers: device.auth });
    expect(again.statusCode).toBe(200);
    const item = await app.inject({ method: 'POST', url: `/v1/device/sessions/${s.id}/items`, headers: device.auth, payload: { catalogItemId: randomUUID(), action: 'wishlisted' } });
    expect(item.statusCode).toBe(409);
    expect(item.json().error.code).toBe('SESSION_ENDED');
  });

  it("a device cannot see or change another device's session", async () => {
    const a = await setup();
    const other = await setup();
    const s = (await startSession(a.device, { mode: 'kiosk' })).json() as { id: string };
    const end = await app.inject({ method: 'POST', url: `/v1/device/sessions/${s.id}/end`, headers: other.device.auth });
    expect(end.statusCode).toBe(404);
    const item = await app.inject({ method: 'POST', url: `/v1/device/sessions/${s.id}/items`, headers: other.device.auth, payload: { catalogItemId: randomUUID(), action: 'wishlisted' } });
    expect(item.statusCode).toBe(404);
  });
});

describe('session items and sales', () => {
  it('records wishlist in kiosk mode but only allows sold in an assisted session', async () => {
    const { device, staff } = await setup();
    const kiosk = (await startSession(device, { mode: 'kiosk' })).json() as { id: string };
    const wish = await app.inject({ method: 'POST', url: `/v1/device/sessions/${kiosk.id}/items`, headers: device.auth, payload: { catalogItemId: randomUUID(), action: 'wishlisted' } });
    expect(wish.statusCode).toBe(201);
    const soldKiosk = await app.inject({ method: 'POST', url: `/v1/device/sessions/${kiosk.id}/items`, headers: device.auth, payload: { catalogItemId: randomUUID(), action: 'sold' } });
    expect(soldKiosk.statusCode).toBe(409);
    expect(soldKiosk.json().error.code).toBe('SOLD_REQUIRES_ASSISTED');

    const assisted = (await startSession(device, { mode: 'assisted' }, { 'x-staff-authorization': staff.auth.authorization })).json() as { id: string };
    const sold = await app.inject({ method: 'POST', url: `/v1/device/sessions/${assisted.id}/items`, headers: device.auth, payload: { catalogItemId: randomUUID(), action: 'sold' } });
    expect(sold.statusCode).toBe(201);
    expect(sold.json()).toMatchObject({ action: 'sold', staffId: staff.staffId, voidedAt: null });
  });

  async function soldItem() {
    const ctx = await setup();
    const assisted = (await startSession(ctx.device, { mode: 'assisted' }, { 'x-staff-authorization': ctx.staff.auth.authorization })).json() as { id: string };
    const sold = (await app.inject({ method: 'POST', url: `/v1/device/sessions/${assisted.id}/items`, headers: ctx.device.auth, payload: { catalogItemId: randomUUID(), action: 'sold' } })).json() as { id: string };
    return { ...ctx, sessionId: assisted.id, itemId: sold.id };
  }
  const undo = (ctx: { sessionId: string; itemId: string; device: { auth: Record<string, string> } }, staffAuth?: Record<string, string>) =>
    app.inject({ method: 'DELETE', url: `/v1/device/sessions/${ctx.sessionId}/items/${ctx.itemId}`, headers: { ...ctx.device.auth, ...(staffAuth ? { 'x-staff-authorization': staffAuth.authorization } : {}) } });

  it('the selling staff member can undo within 24h; the row is voided, not deleted', async () => {
    const ctx = await soldItem();
    const res = await undo(ctx, ctx.staff.auth);
    expect(res.statusCode).toBe(200);
    const [row] = await app.db.select().from(schema.sessionItems).where(eq(schema.sessionItems.id, ctx.itemId));
    expect(row!.voidedAt).toBeInstanceOf(Date);
    expect(row!.voidedBy).toBe(ctx.staff.userId);
    const again = await undo(ctx, ctx.staff.auth);
    expect(again.statusCode).toBe(409);
  });

  it('refuses undo by another staff member, without staff auth, and after 24h', async () => {
    const ctx = await soldItem();
    const colleague = await createTestStaff(app, ctx.m.merchantId, ctx.branch.id);
    expect((await undo(ctx, colleague.auth)).statusCode).toBe(403);
    expect((await undo(ctx)).statusCode).toBe(401);

    await app.db.update(schema.sessionItems).set({ createdAt: sql`now() - interval '25 hours'` }).where(eq(schema.sessionItems.id, ctx.itemId));
    const late = await undo(ctx, ctx.staff.auth);
    expect(late.statusCode).toBe(403);
    expect(late.json().error.code).toBe('UNDO_WINDOW_PASSED');
  });

  it('the merchant admin can void any time; other merchants and staff cannot', async () => {
    const ctx = await soldItem();
    await app.db.update(schema.sessionItems).set({ createdAt: sql`now() - interval '40 days'` }).where(eq(schema.sessionItems.id, ctx.itemId));
    const url = `/v1/merchant/org/session-items/${ctx.itemId}/void`;

    const stranger = await createTestMerchant(app);
    expect((await app.inject({ method: 'POST', url, headers: await memberAuthHeader(app, stranger.userId) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url, headers: ctx.staff.auth })).statusCode).toBe(403);

    const ok = await app.inject({ method: 'POST', url, headers: await memberAuthHeader(app, ctx.m.userId) });
    expect(ok.statusCode).toBe(200);
    const [row] = await app.db.select().from(schema.sessionItems).where(eq(schema.sessionItems.id, ctx.itemId));
    expect(row!.voidedBy).toBe(ctx.m.userId);
  });

  it('audits start, end, sale and void', async () => {
    const ctx = await soldItem();
    await undo(ctx, ctx.staff.auth);
    await app.inject({ method: 'POST', url: `/v1/device/sessions/${ctx.sessionId}/end`, headers: ctx.device.auth });
    const actions = (await app.db.select().from(schema.auditLogs).where(eq(schema.auditLogs.actorRole, 'DEVICE'))).map((a) => a.action);
    for (const a of ['instore_session.start', 'instore_session.end', 'session_item.sold', 'session_item.void']) {
      expect(actions).toContain(a);
    }
  });
});

describe('idle session sweeper', () => {
  it('ends only sessions idle past the window', async () => {
    const { device } = await setup();
    const idle = (await startSession(device, { mode: 'kiosk' })).json() as { id: string };
    const active = (await startSession(device, { mode: 'kiosk' })).json() as { id: string };
    await app.db.update(schema.instoreSessions).set({ lastActivityAt: sql`now() - interval '11 minutes'` }).where(eq(schema.instoreSessions.id, idle.id));

    const { ended } = await runInstoreSessionSweepTick(app, { idleMs: 10 * 60_000 });
    expect(ended).toBeGreaterThanOrEqual(1);
    const rows = await app.db.select().from(schema.instoreSessions);
    expect(rows.find((r) => r.id === idle.id)!.endedAt).toBeInstanceOf(Date);
    expect(rows.find((r) => r.id === active.id)!.endedAt).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/api && npx vitest run --config vitest.integration.config.ts device-sessions`
Expected: FAIL (module `session-sweeper` not found).

- [ ] **Step 3: Refactor `portal-auth.ts` (behaviour-preserving) and add `resolveStaffFromRequest`**

In `userIdFromBearer`, take the header name: change the signature to `async function userIdFromBearer(req: FastifyRequest, header: 'authorization' | 'x-staff-authorization' = 'authorization')` and read `const h = req.headers[header] as string | undefined;` (the rest unchanged; keep existing call sites passing nothing).

Extract the body of `requireMerchantMember` into `async function memberFromUserId(req: FastifyRequest, userId: string): Promise<MerchantMember>` that returns the member instead of assigning to `req.merchantMember`, then make the decorator:

```ts
  app.decorate('requireMerchantMember', async (req, _reply) => {
    req.merchantMember = await memberFromUserId(await userIdFromBearer(req));
  });

  // Staff identify themselves on a shared device with their own access JWT in a second
  // header; the device token stays in Authorization.
  app.decorate('resolveStaffFromRequest', async (req) =>
    memberFromUserId(await userIdFromBearer(req, 'x-staff-authorization')),
  );
```

`memberFromUserId` contains exactly the existing owner/staff lookup logic and thrown `AppError`s (move the code, do not alter it). Add `resolveStaffFromRequest: (req: FastifyRequest) => Promise<MerchantMember>;` to the `FastifyInstance` augmentation. Step 1's `merchant-org`/`merchant-me` tests pin that nothing changed.

- [ ] **Step 4: Implement sessions, items, void**

Append to `deviceRoutes` in `apps/api/src/modules/device/routes.ts` (add imports: `DeviceSessionCreateBody`, `DeviceSessionItemBody` from `@aivastra/types`; `withIdempotency` from `../../lib/idempotency.js`; `z` from `zod`; `eq`, `and`, `sql`):

```ts
  const DEVICE_SESSION_PREHANDLER = { preHandler: app.requireDevice };

  async function loadOwnSession(deviceId: string, sessionId: string) {
    const [s] = await app.db
      .select()
      .from(schema.instoreSessions)
      .where(and(eq(schema.instoreSessions.id, sessionId), eq(schema.instoreSessions.deviceId, deviceId)));
    if (!s) throw new AppError('NOT_FOUND', 404, 'session not found');
    return s;
  }

  app.post(
    '/v1/device/sessions',
    { ...DEVICE_SESSION_PREHANDLER, schema: { body: DeviceSessionCreateBody } },
    async (req, reply) => {
      const d = req.device!;
      const { mode } = req.body as z.infer<typeof DeviceSessionCreateBody>;
      let staffId: string | null = null;
      if (mode === 'assisted') {
        const member = await app.resolveStaffFromRequest(req);
        if (member.role !== 'staff' || member.merchantId !== d.merchantId || member.branchId !== d.branchId) {
          throw new AppError('FORBIDDEN', 403, 'staff of this device\'s branch required');
        }
        staffId = member.staffId;
      }
      const session = await withIdempotency(
        app,
        'device-sessions',
        d.deviceId,
        req.headers['idempotency-key'] as string | undefined,
        () =>
          app.db.transaction(async (tx) => {
            const [row] = await tx
              .insert(schema.instoreSessions)
              .values({ merchantId: d.merchantId, branchId: d.branchId, deviceId: d.deviceId, staffId, mode })
              .returning();
            await recordAudit(tx, {
              actor: await deviceAuditActor(tx, d.merchantId),
              action: 'instore_session.start',
              resourceType: 'instore_session',
              resourceId: row!.id,
              after: { mode, staffId, deviceId: d.deviceId },
              request: req,
            });
            return row!;
          }),
      );
      return reply.code(201).send(session);
    },
  );

  app.post(
    '/v1/device/sessions/:id/end',
    { ...DEVICE_SESSION_PREHANDLER, schema: { params: z.object({ id: z.string().uuid() }) } },
    async (req) => {
      const d = req.device!;
      const { id } = req.params as { id: string };
      const s = await loadOwnSession(d.deviceId, id);
      if (s.endedAt) return s; // ending twice is a no-op, not an error: the kiosk may retry
      return app.db.transaction(async (tx) => {
        const [row] = await tx
          .update(schema.instoreSessions)
          .set({ endedAt: new Date() })
          .where(and(eq(schema.instoreSessions.id, id), isNull(schema.instoreSessions.endedAt)))
          .returning();
        if (row) {
          await recordAudit(tx, {
            actor: await deviceAuditActor(tx, d.merchantId),
            action: 'instore_session.end',
            resourceType: 'instore_session',
            resourceId: id,
            request: req,
          });
        }
        return row ?? s;
      });
    },
  );

  app.post(
    '/v1/device/sessions/:id/items',
    { ...DEVICE_SESSION_PREHANDLER, schema: { params: z.object({ id: z.string().uuid() }), body: DeviceSessionItemBody } },
    async (req, reply) => {
      const d = req.device!;
      const { id } = req.params as { id: string };
      const body = req.body as z.infer<typeof DeviceSessionItemBody>;
      const s = await loadOwnSession(d.deviceId, id);
      if (s.endedAt) throw new AppError('SESSION_ENDED', 409, 'session already ended');
      // "Sold" is the staff button: only a session started by a logged-in staff member.
      if (body.action === 'sold' && s.mode !== 'assisted') {
        throw new AppError('SOLD_REQUIRES_ASSISTED', 409, 'sales can only be recorded in an assisted session');
      }
      const item = await app.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(schema.sessionItems)
          .values({ sessionId: id, catalogItemId: body.catalogItemId, action: body.action, staffId: body.action === 'sold' ? s.staffId : null })
          .returning();
        await tx.update(schema.instoreSessions).set({ lastActivityAt: new Date() }).where(eq(schema.instoreSessions.id, id));
        if (body.action === 'sold') {
          await recordAudit(tx, {
            actor: await deviceAuditActor(tx, d.merchantId),
            action: 'session_item.sold',
            resourceType: 'session_item',
            resourceId: row!.id,
            after: { sessionId: id, catalogItemId: body.catalogItemId, staffId: s.staffId },
            request: req,
          });
        }
        return row!;
      });
      return reply.code(201).send(item);
    },
  );

  // Undo a sale on the device: only the staff member who made it, within 24 hours. The
  // merchant admin voids at any time via /v1/merchant/org/session-items/:id/void.
  app.delete(
    '/v1/device/sessions/:id/items/:itemId',
    { ...DEVICE_SESSION_PREHANDLER, schema: { params: z.object({ id: z.string().uuid(), itemId: z.string().uuid() }) } },
    async (req) => {
      const d = req.device!;
      const { id, itemId } = req.params as { id: string; itemId: string };
      await loadOwnSession(d.deviceId, id);
      const member = await app.resolveStaffFromRequest(req);
      return app.db.transaction(async (tx) => {
        const [item] = await tx
          .select()
          .from(schema.sessionItems)
          .where(and(eq(schema.sessionItems.id, itemId), eq(schema.sessionItems.sessionId, id), eq(schema.sessionItems.action, 'sold')))
          .for('update');
        if (!item) throw new AppError('NOT_FOUND', 404, 'sale not found');
        if (item.voidedAt) throw new AppError('ALREADY_VOIDED', 409, 'sale already voided');
        if (member.role !== 'staff' || member.staffId !== item.staffId) {
          throw new AppError('FORBIDDEN', 403, 'only the selling staff member can undo this sale');
        }
        if (Date.now() - item.createdAt.getTime() > 24 * 3_600_000) {
          throw new AppError('UNDO_WINDOW_PASSED', 403, 'the 24-hour undo window has passed; ask the merchant admin');
        }
        const [row] = await tx
          .update(schema.sessionItems)
          .set({ voidedAt: new Date(), voidedBy: member.userId })
          .where(eq(schema.sessionItems.id, itemId))
          .returning();
        await recordAudit(tx, {
          actor: await deviceAuditActor(tx, d.merchantId),
          action: 'session_item.void',
          resourceType: 'session_item',
          resourceId: itemId,
          after: { voidedBy: member.userId },
          request: req,
        });
        return row!;
      });
    },
  );
```

Add `isNull` to the `drizzle-orm` import in this file.

Append to `merchantOrgDeviceRoutes` in `org-devices.routes.ts` (add `isNull`-free; it needs `innerJoin` on sessions to scope by merchant):

```ts
  app.post(
    '/v1/merchant/org/session-items/:id/void',
    { preHandler: app.requireMerchantAdmin, schema: { params: z.object({ id: z.string().uuid() }) } },
    async (req) => {
      const m = req.merchantMember!;
      const { id } = req.params as { id: string };
      return app.db.transaction(async (tx) => {
        const [found] = await tx
          .select({ item: schema.sessionItems })
          .from(schema.sessionItems)
          .innerJoin(schema.instoreSessions, eq(schema.instoreSessions.id, schema.sessionItems.sessionId))
          .where(and(eq(schema.sessionItems.id, id), eq(schema.instoreSessions.merchantId, m.merchantId), eq(schema.sessionItems.action, 'sold')))
          .for('update', { of: schema.sessionItems });
        if (!found) throw new AppError('NOT_FOUND', 404, 'sale not found');
        if (found.item.voidedAt) throw new AppError('ALREADY_VOIDED', 409, 'sale already voided');
        const [row] = await tx
          .update(schema.sessionItems)
          .set({ voidedAt: new Date(), voidedBy: m.userId })
          .where(eq(schema.sessionItems.id, id))
          .returning();
        await recordAudit(tx, {
          actor: { userId: m.userId, role: MERCHANT_ADMIN_ACTOR_ROLE },
          action: 'session_item.void',
          resourceType: 'session_item',
          resourceId: id,
          request: req,
        });
        return row!;
      });
    },
  );
```

Add `import { z } from 'zod';` (value import) to `org-devices.routes.ts` (it currently imports `type { z }`; change to a value import).

- [ ] **Step 5: Implement the sweeper and start it**

Create `apps/api/src/modules/device/session-sweeper.ts`:

```ts
import { schema } from '@aivastra/db';
import { and, isNull, lt } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

const IDLE_MS = 10 * 60_000;
const SWEEP_INTERVAL_MS = 60_000;

/**
 * Ends in-store sessions idle for 10 minutes (spec §5.2). Not audited: the sweeper has
 * no actor, and audit_logs.actor_user_id is NOT NULL.
 */
export async function runInstoreSessionSweepTick(
  app: FastifyInstance,
  opts: { idleMs?: number } = {},
): Promise<{ ended: number }> {
  const cutoff = new Date(Date.now() - (opts.idleMs ?? IDLE_MS));
  const rows = await app.db
    .update(schema.instoreSessions)
    .set({ endedAt: new Date() })
    .where(and(isNull(schema.instoreSessions.endedAt), lt(schema.instoreSessions.lastActivityAt, cutoff)))
    .returning({ id: schema.instoreSessions.id });
  return { ended: rows.length };
}

export function startInstoreSessionSweeper(
  app: FastifyInstance,
  intervalMs: number = SWEEP_INTERVAL_MS,
): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void runInstoreSessionSweepTick(app)
      .catch((err) => app.log.error({ err }, 'instore session sweeper tick failed'))
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  return () => clearInterval(timer);
}
```

Modify `apps/api/src/main.ts`: import `startInstoreSessionSweeper` and call `startInstoreSessionSweeper(app);` after `startUploadSweeper(app);`.

- [ ] **Step 6: Run tests**

Run: `cd apps/api && npx vitest run --config vitest.integration.config.ts device-sessions device-auth device-management merchant-org merchant-me`
Expected: PASS. `pnpm --filter @aivastra/api typecheck` clean.

- [ ] **Step 7: Lint and stage**

```bash
npx biome check --write apps/api/src apps/api/test/integration/device-sessions.test.ts
git add apps/api
```

---

### Task 5: Entitlement, attributed job creation, device try-on routes

**Files:**
- Create: `apps/api/src/modules/device/entitlement.ts`, `apps/api/src/modules/merchant/tryon-job-service.ts`
- Modify: `apps/api/src/modules/merchant/create-tryon-job.ts`, `apps/api/src/modules/merchant/tryon.routes.ts`, `apps/api/src/modules/device/routes.ts`
- Test: `apps/api/test/integration/device-tryon.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4; `createTestGarmentType`, `createTestCatalogItem`, `stageCustomerPhoto`.
- Produces:
  - `isDeviceCovered(deviceId: string): Promise<boolean>` (returns `false` until the subscription module ships) and `chargeInStoreTryon(tx, ctx: { merchantId: string; deviceId: string; cost: number; jobId: string }, covered?: (deviceId: string) => Promise<boolean>): Promise<void>`.
  - `JobAttribution { branchId; deviceId; sessionId; staffId: string | null; catalogItemId: string }` exported from `create-tryon-job.ts`.
  - `createGarmentTryonJob(app, merchantId, input: { merchantCatalogItemId; customerPhotoKey }, attribution?: JobAttribution): Promise<{ jobId: string }>` and `assertOwnedCustomerPhoto(app, merchantId, key)` exported from `tryon-job-service.ts`.
  - Routes `POST /v1/device/tryon/presign`, `POST /v1/device/tryon/jobs`, `GET /v1/device/tryon/jobs/:id`.

- [ ] **Step 1: Characterize the legacy path first**

Run the legacy suites before touching anything, to pin current behaviour:
`cd apps/api && npx vitest run --config vitest.integration.config.ts merchant-tryon merchant-quick-tryon merchant-tryon-history merchant-tryon-results`
Expected: PASS. Record the counts; the same numbers must pass after Step 6.

- [ ] **Step 2: Write the failing tests**

Create `apps/api/test/integration/device-tryon.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chargeInStoreTryon, isDeviceCovered } from '../../src/modules/device/entitlement';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';
import {
  createTestBranch, createTestCatalogItem, createTestDevice, createTestGarmentType,
  createTestMerchant, createTestStaff, memberAuthHeader, stageCustomerPhoto,
} from '../helpers/merchant';

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

async function setup(balance = 100) {
  const m = await createTestMerchant(app, { balance });
  const branch = await createTestBranch(app, m.merchantId);
  const device = await createTestDevice(app, m.merchantId, branch.id);
  const garmentType = await createTestGarmentType(app);
  const item = await createTestCatalogItem(app, m.merchantId, garmentType.id);
  const session = (await app.inject({ method: 'POST', url: '/v1/device/sessions', headers: device.auth, payload: { mode: 'kiosk' } })).json() as { id: string };
  return { m, branch, device, item, session };
}
const balanceOf = async (userId: string) =>
  (await app.db.select().from(schema.userCredits).where(eq(schema.userCredits.userId, userId)))[0]!.balance;

describe('entitlement', () => {
  it('isDeviceCovered is false until the subscription module ships', async () => {
    expect(await isDeviceCovered(randomUUID())).toBe(false);
  });

  it('treats a throwing coverage check as not covered and charges credits', async () => {
    const { m, device } = await setup(20);
    const jobId = randomUUID();
    await app.db.insert(schema.jobs).values({ id: jobId, userId: m.userId, merchantId: m.merchantId, status: 'QUEUED', creditsCharged: 5, source: 'merchant_tryon' });
    await app.db.transaction(async (tx) => {
      await chargeInStoreTryon(tx, { merchantId: m.merchantId, deviceId: device.deviceId, cost: 5, jobId }, async () => {
        throw new Error('subscription module down');
      });
    });
    expect(await balanceOf(m.userId)).toBe(15);
  });

  it('skips the charge when the device is covered', async () => {
    const { m, device } = await setup(20);
    const jobId = randomUUID();
    await app.db.insert(schema.jobs).values({ id: jobId, userId: m.userId, merchantId: m.merchantId, status: 'QUEUED', creditsCharged: 0, source: 'merchant_tryon' });
    await app.db.transaction(async (tx) => {
      await chargeInStoreTryon(tx, { merchantId: m.merchantId, deviceId: device.deviceId, cost: 5, jobId }, async () => true);
    });
    expect(await balanceOf(m.userId)).toBe(20);
  });
});

describe('POST /v1/device/tryon/jobs', () => {
  it('creates an attributed job, charges credits, writes a tried item, and the device can read it', async () => {
    const { m, branch, device, item, session } = await setup(100);
    const photo = await stageCustomerPhoto(app, m.merchantId);
    const res = await app.inject({
      method: 'POST', url: '/v1/device/tryon/jobs', headers: device.auth,
      payload: { sessionId: session.id, merchantCatalogItemId: item.id, customerPhotoKey: photo },
    });
    expect(res.statusCode).toBe(201);
    const { jobId } = res.json() as { jobId: string };

    const [job] = await app.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    expect(job).toMatchObject({ merchantId: m.merchantId, branchId: branch.id, deviceId: device.deviceId, sessionId: session.id, creditsCharged: 5 });
    expect(await balanceOf(m.userId)).toBe(95);

    const [tried] = await app.db.select().from(schema.sessionItems).where(and(eq(schema.sessionItems.sessionId, session.id), eq(schema.sessionItems.action, 'tried')));
    expect(tried).toMatchObject({ jobId, catalogItemId: item.id });

    const read = await app.inject({ method: 'GET', url: `/v1/device/tryon/jobs/${jobId}`, headers: device.auth });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({ id: jobId, status: 'QUEUED' });
  });

  it('attributes the session staff member', async () => {
    const { m, branch, device, item } = await setup(100);
    const staff = await createTestStaff(app, m.merchantId, branch.id);
    const s = (await app.inject({ method: 'POST', url: '/v1/device/sessions', headers: { ...device.auth, 'x-staff-authorization': staff.auth.authorization }, payload: { mode: 'assisted' } })).json() as { id: string };
    const photo = await stageCustomerPhoto(app, m.merchantId);
    const { jobId } = (await app.inject({ method: 'POST', url: '/v1/device/tryon/jobs', headers: device.auth, payload: { sessionId: s.id, merchantCatalogItemId: item.id, customerPhotoKey: photo } })).json() as { jobId: string };
    const [job] = await app.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    expect(job!.staffId).toBe(staff.staffId);
  });

  it('returns 402 and leaves no job row when credits are insufficient', async () => {
    const { m, device, item, session } = await setup(2);
    const before = await app.db.select().from(schema.jobs).where(eq(schema.jobs.merchantId, m.merchantId));
    const photo = await stageCustomerPhoto(app, m.merchantId);
    const res = await app.inject({ method: 'POST', url: '/v1/device/tryon/jobs', headers: device.auth, payload: { sessionId: session.id, merchantCatalogItemId: item.id, customerPhotoKey: photo } });
    expect(res.statusCode).toBe(402);
    expect(res.json().error.code).toBe('INSUFFICIENT_CREDITS');
    const after = await app.db.select().from(schema.jobs).where(eq(schema.jobs.merchantId, m.merchantId));
    expect(after.length).toBe(before.length);
    expect(await balanceOf(m.userId)).toBe(2);
  });

  it('is idempotent: a retry with the same key charges once', async () => {
    const { m, device, item, session } = await setup(100);
    const photo = await stageCustomerPhoto(app, m.merchantId);
    const send = () => app.inject({ method: 'POST', url: '/v1/device/tryon/jobs', headers: { ...device.auth, 'idempotency-key': 'k-1' }, payload: { sessionId: session.id, merchantCatalogItemId: item.id, customerPhotoKey: photo } });
    const a = (await send()).json() as { jobId: string };
    const b = (await send()).json() as { jobId: string };
    expect(a.jobId).toBe(b.jobId);
    expect(await balanceOf(m.userId)).toBe(95);
  });

  it('refuses an ended session, another device\'s session, a foreign photo and a foreign catalog item', async () => {
    const a = await setup(100);
    const other = await setup(100);
    const photo = await stageCustomerPhoto(app, a.m.merchantId);
    const post = (headers: Record<string, string>, payload: object) => app.inject({ method: 'POST', url: '/v1/device/tryon/jobs', headers, payload });

    expect((await post(other.device.auth, { sessionId: a.session.id, merchantCatalogItemId: other.item.id, customerPhotoKey: await stageCustomerPhoto(app, other.m.merchantId) })).statusCode).toBe(404);
    expect((await post(a.device.auth, { sessionId: a.session.id, merchantCatalogItemId: a.item.id, customerPhotoKey: await stageCustomerPhoto(app, other.m.merchantId) })).statusCode).toBe(403);
    expect((await post(a.device.auth, { sessionId: a.session.id, merchantCatalogItemId: other.item.id, customerPhotoKey: photo })).statusCode).toBeGreaterThanOrEqual(400);

    await app.inject({ method: 'POST', url: `/v1/device/sessions/${a.session.id}/end`, headers: a.device.auth });
    const ended = await post(a.device.auth, { sessionId: a.session.id, merchantCatalogItemId: a.item.id, customerPhotoKey: photo });
    expect(ended.statusCode).toBe(409);
    expect(ended.json().error.code).toBe('SESSION_ENDED');
  });

  it("a device cannot read another device's job", async () => {
    const a = await setup(100);
    const other = await setup(100);
    const photo = await stageCustomerPhoto(app, a.m.merchantId);
    const { jobId } = (await app.inject({ method: 'POST', url: '/v1/device/tryon/jobs', headers: a.device.auth, payload: { sessionId: a.session.id, merchantCatalogItemId: a.item.id, customerPhotoKey: photo } })).json() as { jobId: string };
    const res = await app.inject({ method: 'GET', url: `/v1/device/tryon/jobs/${jobId}`, headers: other.device.auth });
    expect(res.statusCode).toBe(404);
  });

  it('presigns a customer photo under this merchant', async () => {
    const { m, device } = await setup();
    const res = await app.inject({ method: 'POST', url: '/v1/device/tryon/presign', headers: device.auth, payload: { contentType: 'image/jpeg', contentLength: 1024 } });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { r2Key: string }).r2Key.startsWith(`merchant-inputs/${m.merchantId}/`)).toBe(true);
  });
});

describe('legacy path is unchanged', () => {
  it('an owner-token try-on still charges credits and leaves attribution null', async () => {
    const m = await createTestMerchant(app, { balance: 100 });
    const garmentType = await createTestGarmentType(app);
    const item = await createTestCatalogItem(app, m.merchantId, garmentType.id);
    const photo = await stageCustomerPhoto(app, m.merchantId);
    const res = await app.inject({
      method: 'POST', url: '/v1/merchant/tryon/jobs', headers: await memberAuthHeader(app, m.userId),
      payload: { merchantCatalogItemId: item.id, customerPhotoKey: photo },
    });
    expect(res.statusCode).toBe(201);
    const [job] = await app.db.select().from(schema.jobs).where(eq(schema.jobs.id, (res.json() as { jobId: string }).jobId));
    expect(job).toMatchObject({ creditsCharged: 5, branchId: null, deviceId: null, sessionId: null, staffId: null });
    expect(await balanceOf(m.userId)).toBe(95);
    const items = await app.db.select().from(schema.sessionItems);
    expect(items.some((i) => i.jobId === job!.id)).toBe(false);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `cd apps/api && npx vitest run --config vitest.integration.config.ts device-tryon`
Expected: FAIL (module `device/entitlement` not found).

- [ ] **Step 4: Implement entitlement**

Create `apps/api/src/modules/device/entitlement.ts`:

```ts
import type { DbTransaction } from '@aivastra/db';
import { atomicMerchantDeduct } from '../merchant/ledger.js';

/**
 * Seam for the subscription module (docs/architecture/v1-hld.md §6). Returns false
 * until that module ships, so every in-store try-on is paid with credits.
 * device_quota_per_month is enforced here once this can return true — not before.
 */
export async function isDeviceCovered(_deviceId: string): Promise<boolean> {
  return false;
}

/**
 * Decides how one in-store try-on is paid for. Runs inside the job-creation
 * transaction, so the deduct and the job insert commit or roll back together, and a
 * refund on terminal failure is unchanged. If the coverage check throws it counts as
 * NOT covered: fall back to credits, never grant free usage. Insufficient credits throw
 * 402 INSUFFICIENT_CREDITS from the deduct, before any job row survives.
 */
export async function chargeInStoreTryon(
  tx: DbTransaction,
  ctx: { merchantId: string; deviceId: string; cost: number; jobId: string },
  covered: (deviceId: string) => Promise<boolean> = isDeviceCovered,
): Promise<void> {
  const isCovered = await covered(ctx.deviceId).catch(() => false);
  if (isCovered) return;
  // biome-ignore lint/suspicious/noExplicitAny: tx type narrowing loses the custom methods added by the merchant ledger helper (same cast as create-tryon-job.ts).
  await atomicMerchantDeduct(tx as any, ctx.merchantId, ctx.cost, ctx.jobId);
}
```

- [ ] **Step 5: Add optional attribution to the job creators (legacy-identical when absent)**

In `apps/api/src/modules/merchant/create-tryon-job.ts` add the imports `import { chargeInStoreTryon } from '../device/entitlement.js';` and export:

```ts
/** In-store attribution. Absent for every legacy caller; present only from /v1/device/tryon. */
export interface JobAttribution {
  branchId: string;
  deviceId: string;
  sessionId: string;
  staffId: string | null;
  catalogItemId: string;
}
```

Add `attribution?: JobAttribution;` to `CreateMerchantTryonJobInput` and `CreateMerchantTryonJobTwoStepInput`. In `createMerchantTryonJob`, change the `jobs` insert object to spread attribution columns, and the charge and `tried` item to depend on it:

```ts
    await (tx.insert(schema.jobs).values as any)({
      id: jobId,
      userId: input.merchantUserId,
      merchantId: input.merchantId,
      customerPhotoKey: input.customerPhotoKey,
      status: 'QUEUED',
      creditsCharged: cost,
      source: JOB_SOURCE.MERCHANT_TRYON,
      ...attributionColumns(input.attribution),
    });
```

and replace the final `await atomicMerchantDeduct(tx as any, input.merchantId, cost, jobId);` (keep its biome-ignore comment) with:

```ts
    await chargeJob(tx, input.merchantId, cost, jobId, input.attribution);
```

Apply the identical three edits (attribution spread in the *real* `jobId` insert, `chargeJob` instead of the deduct) to `createMerchantTryonJobTwoStep`; the 0-credit mannequin job insert is left alone (no `merchantId`, no attribution). Add these helpers at module level in the same file:

```ts
function attributionColumns(a?: JobAttribution) {
  return a ? { branchId: a.branchId, deviceId: a.deviceId, sessionId: a.sessionId, staffId: a.staffId } : {};
}

// Legacy callers keep the exact original deduct; only attributed (device) jobs go through
// the entitlement function and record the `tried` session item in the same transaction.
async function chargeJob(
  // biome-ignore lint/suspicious/noExplicitAny: same tx widening as the original call site.
  tx: any,
  merchantId: string,
  cost: number,
  jobId: string,
  a?: JobAttribution,
) {
  if (!a) {
    await atomicMerchantDeduct(tx, merchantId, cost, jobId);
    return;
  }
  await chargeInStoreTryon(tx, { merchantId, deviceId: a.deviceId, cost, jobId });
  await tx.insert(schema.sessionItems).values({
    sessionId: a.sessionId,
    catalogItemId: a.catalogItemId,
    jobId,
    action: 'tried',
    staffId: a.staffId,
  });
  await tx
    .update(schema.instoreSessions)
    .set({ lastActivityAt: new Date() })
    .where(eq(schema.instoreSessions.id, a.sessionId));
}
```

(add `eq` from `drizzle-orm` to this file's imports). The non-attributed path must remain byte-equivalent in effect: same insert columns, same `atomicMerchantDeduct(tx, merchantId, cost, jobId)` call, same order.

- [ ] **Step 6: Extract the garment job service and slim the legacy route**

Create `apps/api/src/modules/merchant/tryon-job-service.ts` — move `assertOwnedCustomerPhoto` verbatim out of `tryon.routes.ts` (export it; needs imports `keys` from `@aivastra/storage`, `getUploadLimitBytes`, `AppError`, `FastifyInstance`) and add:

```ts
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { AppError } from '../../lib/errors.js';
import {
  createMerchantTryonJob,
  createMerchantTryonJobTwoStep,
  type JobAttribution,
} from './create-tryon-job.js';
import { resolveTryonGarment } from './resolve-tryon-garment.js';

/**
 * The garment try-on body of POST /v1/merchant/tryon/jobs, extracted so the device route
 * can reuse it. With no `attribution` it is exactly the previous inline behaviour.
 */
export async function createGarmentTryonJob(
  app: FastifyInstance,
  merchantId: string,
  input: { merchantCatalogItemId: string; customerPhotoKey: string },
  attribution?: JobAttribution,
): Promise<{ jobId: string }> {
  const { merchantCatalogItemId, customerPhotoKey } = input;
  const garment = await resolveTryonGarment(app, merchantId, merchantCatalogItemId);

  await assertOwnedCustomerPhoto(app, merchantId, customerPhotoKey);

  const [merchant] = await app.db
    .select({ userId: schema.merchants.userId })
    .from(schema.merchants)
    .where(eq(schema.merchants.id, merchantId))
    .limit(1);
  if (!merchant) throw new AppError('NOT_FOUND', 404, 'merchant not found');

  const jobId =
    garment.kind === 'two-input'
      ? await createMerchantTryonJobTwoStep(app, {
          merchantId,
          merchantUserId: merchant.userId,
          customerPhotoKey,
          bodyKey: garment.bodyKey,
          palluKey: garment.palluKey,
          garmentSubcategoryId: garment.garmentSubcategoryId,
          merchantCatalogItemId,
          mannequinWorkflowTemplateId: garment.mannequinWorkflowTemplateId,
          mannequinWorkflowTemplateVersion: garment.mannequinWorkflowTemplateVersion,
          tryonWorkflowTemplateId: garment.tryonWorkflowTemplateId,
          tryonWorkflowTemplateVersion: garment.tryonWorkflowTemplateVersion,
          attribution,
        })
      : await createMerchantTryonJob(app, {
          merchantId,
          merchantUserId: merchant.userId,
          upperGarmentKey: garment.r2Key,
          customerPhotoKey,
          workflowTemplateId: garment.workflowTemplateId,
          dispatchTemplateVersion: garment.workflowTemplateVersion ?? null,
          attribution,
        });

  return { jobId };
}
```

In `tryon.routes.ts`: delete the local `assertOwnedCustomerPhoto` and import it (plus `createGarmentTryonJob`) from `./tryon-job-service.js`; drop now-unused imports (`resolveTryonGarment`, `createMerchantTryonJobTwoStep`, and `createMerchantTryonJob` only if the quick-tryon route no longer uses it — it still does, so keep that one). Replace the inner function of `POST /v1/merchant/tryon/jobs` so the handler becomes:

```ts
      const result = await withIdempotency(
        app,
        'merchant-tryon-jobs',
        merchantId,
        req.headers['idempotency-key'] as string | undefined,
        () => createGarmentTryonJob(app, merchantId, { merchantCatalogItemId, customerPhotoKey }),
      );

      reply.code(201);
      return result;
```

Run the Step 1 command again now: the four legacy suites must pass with the same counts.

- [ ] **Step 7: Add the device try-on routes**

Append to `deviceRoutes` (imports: `DeviceTryonJobBody`, `MerchantTryonPresignBody` from `@aivastra/types`; `randomUUID` from `node:crypto`; `keys` from `@aivastra/storage`; `createGarmentTryonJob` from `../merchant/tryon-job-service.js`):

```ts
  // Customer photo upload for the kiosk: same key layout/ownership record as the merchant
  // presign, so assertOwnedCustomerPhoto accepts it unchanged.
  app.post(
    '/v1/device/tryon/presign',
    { preHandler: app.requireDevice, schema: { body: MerchantTryonPresignBody } },
    async (req) => {
      const d = req.device!;
      const { contentType, contentLength } = req.body as z.infer<typeof MerchantTryonPresignBody>;
      const ext = contentType.split('/')[1] ?? 'jpg';
      const key = keys.merchantTryonInput(d.merchantId, randomUUID(), ext);
      const { url, expiresIn } = await app.storage.presignPut(key, contentType, contentLength, 600);
      await app.redis.set(`upload:owner:${key}`, d.merchantId, 'EX', 600);
      return { uploadUrl: url, r2Key: key, expiresIn };
    },
  );

  app.post(
    '/v1/device/tryon/jobs',
    { preHandler: app.requireDevice, schema: { body: DeviceTryonJobBody } },
    async (req, reply) => {
      const d = req.device!;
      const { sessionId, merchantCatalogItemId, customerPhotoKey } = req.body as z.infer<typeof DeviceTryonJobBody>;
      const result = await withIdempotency(
        app,
        'device-tryon-jobs',
        d.deviceId,
        req.headers['idempotency-key'] as string | undefined,
        async () => {
          const session = await loadOwnSession(d.deviceId, sessionId);
          if (session.endedAt) throw new AppError('SESSION_ENDED', 409, 'session already ended');
          return createGarmentTryonJob(
            app,
            d.merchantId,
            { merchantCatalogItemId, customerPhotoKey },
            {
              branchId: d.branchId,
              deviceId: d.deviceId,
              sessionId: session.id,
              staffId: session.staffId,
              catalogItemId: merchantCatalogItemId,
            },
          );
        },
      );
      return reply.code(201).send(result);
    },
  );

  app.get(
    '/v1/device/tryon/jobs/:id',
    { preHandler: app.requireDevice, schema: { params: z.object({ id: z.string().uuid() }) } },
    async (req) => {
      const d = req.device!;
      const { id } = req.params as { id: string };
      const [job] = await app.db
        .select({
          id: schema.jobs.id,
          status: schema.jobs.status,
          errorCode: schema.jobs.errorCode,
          resultKey: schema.jobOutputs.resultKey,
        })
        .from(schema.jobs)
        .leftJoin(schema.jobOutputs, eq(schema.jobOutputs.jobId, schema.jobs.id))
        .where(and(eq(schema.jobs.id, id), eq(schema.jobs.deviceId, d.deviceId)))
        .limit(1);
      if (!job) throw new AppError('NOT_FOUND', 404, 'job not found');
      const resultUrl =
        job.status === 'COMPLETED' && job.resultKey
          ? await app.storage.presignGet(job.resultKey, 3600).then((r) => r.url).catch(() => null)
          : null;
      return { id: job.id, status: job.status, errorCode: job.errorCode, resultUrl };
    },
  );
```

- [ ] **Step 8: Run tests**

Run: `cd apps/api && npx vitest run --config vitest.integration.config.ts device-tryon device-sessions device-auth device-management device-schema merchant-tryon merchant-quick-tryon merchant-tryon-history merchant-tryon-results merchant-org merchant-me unlimited-plan-offer`
Expected: PASS, with the four legacy suites at the counts recorded in Step 1.
Run: `pnpm --filter @aivastra/api typecheck` — clean.
Run: `pnpm --filter @aivastra/api test` — Expected: all unit tests pass (previously 1,192; the count may rise).

- [ ] **Step 9: Lint and stage**

```bash
npx biome check --write apps/api/src apps/api/test/integration/device-tryon.test.ts
git add apps/api
```

---

### Task 6: Docs, progress log and final verification

**Files:**
- Modify: `docs/progress.md`, `docs/architecture/v1-hld.md`
- Create: none

- [ ] **Step 1: Update the HLD data model**

In `docs/architecture/v1-hld.md` §4.1 mark `shoppers`/`shopper_page_events` as step 5 unchanged; in the `merchant_devices` row note "token hash unique and nullable until paired"; in the `instore_sessions` row remove `shopper_id` and `consent_by_staff` and add `last_activity_at` with a note "added in step 5"; in `session_items` note "catalog_item_id has no FK (demo items)". In §5.4 nothing changes.

- [ ] **Step 2: Add the progress entry**

Add a new top entry to `docs/progress.md` in the file's existing format: "2026-11-06 — v1.0 step 2: devices, in-store sessions, entitlement (uncommitted, staged)". Under Done list: tables + `jobs` attribution columns + migration `<NNNN>` (local only); `requireDevice`; pairing; merchant/admin device management; sessions, items, sale void; idle sweeper; `chargeInStoreTryon` + `isDeviceCovered` seam; attributed job creation via `JobAttribution`; extracted `createGarmentTryonJob`. Under Verified: the exact test files and counts from Step 3. Under Failed/Not Done: no admin-web/Merchant Web/Android UI; quota/subscription not enforced; sweeper ends not audited; migration not applied to staging/prod. Under Open questions: how and when customers are migrated off the email-login kiosk (per-customer, later); the four "spec gaps" decisions to confirm.

- [ ] **Step 3: Final verification**

Run (from `apps/api`): `npx vitest run --config vitest.integration.config.ts device- merchant-org admin-merchant-org merchant-staff-account-guards merchant-me merchant-tryon merchant-quick-tryon unlimited-plan-offer`
Expected: PASS. Record the counts in the progress entry.
Run (repo root): `pnpm typecheck` — Expected: no errors (admin-mobile is paused and excluded by the hook's filter; if `pnpm typecheck` includes it and fails for unrelated reasons, run `pnpm -r --filter "!@aivastra/admin-mobile" run typecheck` instead).
Run: `pnpm biome check . --diagnostic-level=error` — Expected: no errors.

- [ ] **Step 4: Stage**

```bash
git add docs apps packages
git status --short | grep -v '^[AM] ' || true
```

Expected: nothing under `.superpowers/` is staged; no stray untracked files.

---

## Self-review

**Spec coverage** (spec section → task): compatibility rule → Global Constraints + Task 5 Step 1/6 + legacy test; decisions 1–3 → Tasks 1/5/Out-of-scope; data model → Task 1; device auth → Task 2; pairing (atomic claim, same 400, per-IP limit) → Task 2; merchant/admin device management incl. audit and cross-merchant → Task 3; sessions (kiosk/assisted, branch check, idempotency, end) → Task 4; items and undo (24 h staff, admin any time) → Task 4; try-on route reusing `createMerchantTryonJob` with attribution and the `tried` item in the same transaction → Task 5; idle sweeper → Task 4; entitlement + seam + 402 + throw-means-not-covered → Task 5; security/audit → Tasks 2–5; testing list → each task's tests (legacy path test in Task 5). Quota branch intentionally absent (spec).

**Placeholder scan:** none; every code step has code. `<NNNN>` in Task 1 is determined by the generator output and is explicitly instructed.

**Type consistency:** `req.device` fields (`deviceId, merchantId, branchId, name`) used identically in Tasks 2–5; `JobAttribution` fields match the `attributionColumns`/`chargeJob` bodies and the route call; `updateDevice` ctx shape matches both callers; `ORG_EDIT` exported before the admin device routes import it; `resolveStaffFromRequest` returns `MerchantMember` used with `.role/.merchantId/.branchId/.staffId/.userId`.

**Known risks to watch during execution:** (1) circular schema import `jobs.ts` ↔ `merchant-device.ts` (annotation fallback given); (2) the rate-limit test depends on the harness honouring `remoteAddress`; (3) Task 4's `portal-auth.ts` refactor touches step 1 code — `merchant-org`/`merchant-me` suites must stay green; (4) Task 5's route extraction touches a legacy route — the four legacy suites are the guard.
