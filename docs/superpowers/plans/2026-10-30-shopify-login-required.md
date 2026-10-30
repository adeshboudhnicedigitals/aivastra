# Shopify Login Required Implementation Plan (sub-project 3 of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A merchant can switch on "Make Login Required"; the server then refuses try-on for any shopper who is not logged in to the store (verified through Shopify's signed App Proxy), and requires the shopper's email and phone, taken from their account when present and otherwise asked in the widget.

**Architecture:** Shopify appends `logged_in_customer_id` to every App Proxy request and includes it in the HMAC. The existing `requireShopifyStoreKey` plugin already verifies that signature; it now also exposes the verified id as `req.shopifyLoggedInCustomerId` (null on the unsigned `X-Widget-Key` path). `POST /customer/jobs` uses it as the only trusted identity when `limits.loginRequired` is on. Contact data (email, phone) is stored on the shopper row; a missing value yields a `contact_required` refusal the widget turns into a form.

**Tech Stack:** Fastify 5 + Zod, Drizzle/Postgres (one migration), Redis, Vitest integration; React + Polaris (`apps/shopify`); vanilla JS + Liquid (`apps/shopify-extension`).

Spec: `docs/superpowers/specs/2026-10-30-shopify-login-required-design.md`.

## Prerequisite

Plan 2 Task 1 must be committed first: it adds `isValidPhone`, `PHONE_MIN_DIGITS`, `PHONE_MAX_LENGTH`, `PHONE_CHARS_RE`, `phoneDigitCount` to `@aivastra/types` (`packages/types/src/phone.ts`). Check with `git log --oneline -- packages/types/src/phone.ts`. If it is not there yet, stop and tell the manager; do **not** create that file yourself.

## Design decisions made while planning

1. **The login gate must not depend on `clientId`.** The route only resolves a shopper row `if (clientId)` ("Deployed widget versions did not send clientId"). Putting the login check inside `checkShopperLimits` would let a caller skip it by omitting `clientId`. The login gate is therefore a separate function run in the route **before** the `clientId` branch, and for login-required stores a missing `clientId` is a 400.
2. **Verified id overrides the body for every store.** `const customerId = verifiedCustomerId ?? body.shopifyCustomerId`. For login-required stores the body id is never used. For other stores behaviour is unchanged unless Shopify supplied a verified id, which is strictly more trustworthy.
3. **Email and phone are shopper-asserted contact data, not authority.** Only the signed customer id is trusted. (Verifying the account's email/phone through the Admin API would need `read_customers` and protected-customer-data approval; out of scope.)
4. **Two new refusal reasons:** `login_required`, `contact_required`. Event types `refused_login_gate`, `refused_contact_gate` are recorded; the Analytics page cards are not changed (out of scope).
5. **Legacy `emailAfterNTryOns` keeps working untouched.** Onboarding stops writing it; Settings → Limits still edits it.

## Global Constraints

- Phone rule is the shared one: digits, space, `+ ( ) - .`, at least 7 digits, max 30, stored trimmed.
- `limits.loginRequired` defaults off; absent means off. No Redis or env flag.
- One migration (`shopify_shoppers.phone`, `phone_captured_at`), generated **locally** with `pnpm db:generate` and applied with `pnpm db:migrate` against the local DB only. Never touch production or `tryon_prod`; never hand-edit a drizzle snapshot.
- The widget must fail **closed** for login-required stores: if the proxy signature or `logged_in_customer_id` is missing the server refuses.
- Never `git add -A` / `git add .`, `git stash`, `git checkout`, `git reset`, `git commit -a`.
- API tests: `pnpm --filter @aivastra/api test` is unit only. Integration, from `apps/api`: `npx vitest run --config vitest.integration.config.ts <pattern>`; needs `pnpm docker:up`. `@aivastra/api` resolves `@aivastra/types` and `@aivastra/db` from `dist`: after changing either, run `pnpm --filter @aivastra/types build` / `pnpm --filter @aivastra/db build`.
- Package names: `@aivastra/api`, `@aivastra/types`, `@aivastra/db`, `@aivastra/shopify-admin` (apps/shopify).
- Do not edit `docs/progress.md` or `CLAUDE.md`; put notes in your final report.
- CI never runs `shopify app deploy`; do not run it. The widget cannot be exercised by an automated test in this repo (no harness), so widget tasks are verified with `node --check` plus the manual script in Task 9.

## Parallel execution protocol (four plans share branch `feat/shopify-simplification`)

- Stage **explicit paths only**; commit only your task's files. Re-read before every edit; use `Edit` hunks.
- Shared files and the **only** hunks this plan may touch:
  - `apps/api/src/modules/shopify/customer.routes.ts`: the `/jobs` handler (`registerProxied(... '/jobs' ...)`), `REFUSAL_EVENT_TYPE`, and the one `return { enabled, verboseErrors ... }` line of the `enabled` handler. Plan 1 owns the workflow-resolution hunks (`resolveShopifyWorkflow`) in both handlers; plan 4 owns the `source` query handling in the `enabled` handler.
  - `apps/api/src/modules/shopify/limits.ts`, `shopper.ts`: this plan owns them.
  - `packages/types/src/widget.ts`: the `ShopifyCustomerJobRequest`, `ShopifyStoreLimitsPatch` and `SHOPIFY_REFUSAL_EVENT_TYPES` hunks only.
  - `apps/shopify/src/pages/OnboardingLimitsPage.tsx`: everything **except** the `canShowPostBasketPage` import and its use (plan 1 renames it).
  - `apps/shopify/src/pages/SettingsPage.tsx`: only the Limits tab block that renders `AskForEmailCard`.
  - `apps/shopify/src/types.ts`: only `ShopifyStoreLimits`.
  - `apps/shopify-extension/extensions/tryon-theme-extension/snippets/tryon-widget.liquid`, `assets/tryon-widget.js`, `assets/tryon-widget.css`: plan 4 restructures how triggers, placement and the modal are initialised and rendered. **You own only**: the `data-customer-*`/`data-login-url` attributes, the email step markup and the new login step markup (Liquid); the email step handler, `createJob`, `proceedWithPhoto`, the `steps` map entry and the login gating (JS); one CSS block (below). Do not touch placement, trigger binding, `placeWidget`, `data-source`, the button or icon markup.
- Failures in files outside this plan are not yours; report them.

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `packages/types/src/widget.ts` | modify | `loginRequired` in the limits patch; `phone` in the job request; two refusal event types |
| `packages/db/src/schema/shopify.ts` | modify | `ShopifyStoreLimits.loginRequired`; shopper `phone`, `phoneCapturedAt` |
| `packages/db/src/migrations/*` | generated | one migration |
| `apps/api/src/plugins/shopify-widget-auth.ts` (+test) | modify | expose verified `shopifyLoggedInCustomerId` |
| `apps/api/src/modules/shopify/shopper.ts` | modify | `resolveShopper` stores phone |
| `apps/api/src/modules/shopify/limits.ts` | modify | refusal reasons, `checkLoginGate`, contact check |
| `apps/api/src/modules/shopify/customer.routes.ts` | modify | enforcement in `/jobs`; `loginRequired` in `enabled` |
| `apps/api/src/modules/shopify/shoppers.routes.ts` | modify | phone in list and CSV |
| `apps/shopify/src/{types.ts,pages/OnboardingLimitsPage.tsx,pages/SettingsPage.tsx,components/ShopperLimitCards.tsx}` | modify | the toggle |
| `apps/shopify-extension/extensions/tryon-theme-extension/{snippets,assets}` | modify | login step, contact step, gating |

---

### Task 1: Types: limits flag, job-request phone, refusal event types

**Files:**
- Modify: `packages/types/src/widget.ts` (`ShopifyCustomerJobRequest` ~line 471; `ShopifyStoreLimitsPatch` ~line 502; `SHOPIFY_REFUSAL_EVENT_TYPES` ~line 576)
- Modify: `packages/db/src/schema/shopify.ts` (`ShopifyStoreLimits` interface ~line 19)
- Modify: `apps/shopify/src/types.ts` (`ShopifyStoreLimits`, line 1)
- Test: `packages/types/src/widget.test.ts` (create if absent; mirror `jobs.test.ts` style)

**Interfaces:**
- Produces: `ShopifyStoreLimitsPatch.loginRequired?: boolean`; `ShopifyCustomerJobRequest.phone?: string` (validated with `isValidPhone`, trimmed); `SHOPIFY_REFUSAL_EVENT_TYPES` includes `'refused_login_gate'` and `'refused_contact_gate'`; `ShopifyStoreLimits.loginRequired?: boolean` in both the db schema type and the SPA type.

- [ ] **Step 1: Failing test** `packages/types/src/widget.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  SHOPIFY_REFUSAL_EVENT_TYPES,
  ShopifyCustomerJobRequest,
  ShopifyStoreLimitsPatch,
} from './widget.js';

const base = {
  customerPhotoKey: 'k',
  shopifyProductId: 1,
};

describe('ShopifyStoreLimitsPatch.loginRequired', () => {
  it('accepts booleans and rejects other values', () => {
    expect(ShopifyStoreLimitsPatch.parse({ loginRequired: true })).toEqual({ loginRequired: true });
    expect(ShopifyStoreLimitsPatch.parse({ loginRequired: false })).toEqual({ loginRequired: false });
    expect(ShopifyStoreLimitsPatch.safeParse({ loginRequired: 'yes' }).success).toBe(false);
    expect(ShopifyStoreLimitsPatch.safeParse({ loginRequired: null }).success).toBe(false);
  });
});

describe('ShopifyCustomerJobRequest.phone', () => {
  it('is optional', () => {
    expect(ShopifyCustomerJobRequest.safeParse(base).success).toBe(true);
  });
  it('trims and accepts a valid phone', () => {
    const r = ShopifyCustomerJobRequest.parse({ ...base, phone: '  +91 98765-43210 ' });
    expect(r.phone).toBe('+91 98765-43210');
  });
  it.each(['', '123456', 'call me', '+()- .'])('rejects %j', (phone) => {
    expect(ShopifyCustomerJobRequest.safeParse({ ...base, phone }).success).toBe(false);
  });
});

describe('refusal event types', () => {
  it('include the login and contact gates', () => {
    expect(SHOPIFY_REFUSAL_EVENT_TYPES).toContain('refused_login_gate');
    expect(SHOPIFY_REFUSAL_EVENT_TYPES).toContain('refused_contact_gate');
  });
});
```

Run: `pnpm --filter @aivastra/types test -- widget` → FAIL.

- [ ] **Step 2: Implement**

`widget.ts`:
- add `import { isValidPhone } from './phone.js';` at the top with the other imports;
- in `ShopifyCustomerJobRequest` add after `emailConsent`:

```ts
  // Contact data, like email: shopper-asserted, never an authorization input.
  // Only stored, and only required of shoppers of a login-required store.
  phone: z
    .string()
    .trim()
    .refine(isValidPhone, { message: 'invalid phone number' })
    .optional(),
```

- in `ShopifyStoreLimitsPatch` add `loginRequired: z.boolean().optional(),` after `emailAfterNTryOns`;
- extend `SHOPIFY_REFUSAL_EVENT_TYPES` with `'refused_login_gate'`, `'refused_contact_gate'`.

`packages/db/src/schema/shopify.ts` `ShopifyStoreLimits`: add `loginRequired?: boolean;` with the comment `// Shoppers must be logged in to the storefront (verified via App Proxy) and have email + phone on file.`; also update the comment above `type: text('type')` listing server-written event types to include the two new ones. `apps/shopify/src/types.ts` `ShopifyStoreLimits`: add `loginRequired?: boolean;`.

- [ ] **Step 3: Verify, build, commit**

Run: `pnpm --filter @aivastra/types test -- widget && pnpm --filter @aivastra/types build && pnpm --filter @aivastra/db build` → pass.

```bash
git add packages/types/src/widget.ts packages/types/src/widget.test.ts packages/db/src/schema/shopify.ts apps/shopify/src/types.ts
git commit -m "feat(shopify): login-required limits flag, shopper phone in job request, refusal event types"
```

(`widget.ts`, `shopify.ts` and `apps/shopify/src/types.ts` are shared: stage only your hunks with `git add -p` if others have uncommitted edits.)

---

### Task 2: Shopper phone column, migration, `resolveShopper`

**Files:**
- Modify: `packages/db/src/schema/shopify.ts` (`shopifyShoppers`)
- Generated: `packages/db/src/migrations/<next>_*.sql` + `meta/*`
- Modify: `apps/api/src/modules/shopify/shopper.ts`
- Test: `apps/api/test/integration/shopify-shopper-phone.test.ts`

**Interfaces:**
- Produces: `shopify_shoppers.phone text null`, `phone_captured_at timestamptz null`; `ShopperIdentityInput.phone?: string | null`; `resolveShopper` stores a phone (trimmed) and `phoneCapturedAt`, and never nulls a known phone when the input has none; `normalizePhone(phone?: string | null): string | null`.

- [ ] **Step 1: Failing test**

`shopify-shopper-phone.test.ts` (copy the harness header from `shopify-basket-routing.test.ts`: `startContainers`, `buildTestApp`, a store seed). Cases: (a) `resolveShopper(app, storeId, { clientId, phone: ' 555 0100 123 ' })` → row `phone === '555 0100 123'` and `phoneCapturedAt` set; (b) a second call for the same `clientId` with no phone keeps the phone; (c) a second call with a different phone replaces it; (d) blank string input is treated as no phone.
Run → FAIL (no column / no param).

- [ ] **Step 2: Schema + generate the migration (local only)**

In `shopifyShoppers` after `emailCapturedAt` add:

```ts
    // Contact phone, shopper-asserted (like email). Collected for login-required
    // stores. Never part of the counting identity: the limit identity stays
    // customer id > email > client id.
    phone: text('phone'),
    phoneCapturedAt: timestamp('phone_captured_at', { withTimezone: true }),
```

Run: `pnpm db:generate` (local; confirm the generated SQL is exactly two `ALTER TABLE "shopify_shoppers" ADD COLUMN` statements and nothing else; if drizzle emits unrelated drift, stop and report). Then `pnpm db:migrate` against the **local** `DATABASE_URL` (check it points at 127.0.0.1) and `pnpm ci:check-migration-index` if the script exists (`grep ci:check package.json`).

- [ ] **Step 3: Implement `shopper.ts`**

Add:

```ts
/** Trimmed phone, or null for blank/absent. Format is validated at the request
 *  boundary (ShopifyCustomerJobRequest); this only normalises. */
export function normalizePhone(phone?: string | null): string | null {
  const trimmed = phone?.trim();
  return trimmed ? trimmed : null;
}
```

Add `phone?: string | null;` to `ShopperIdentityInput`. In `resolveShopper`: `const phone = normalizePhone(input.phone);`; in the `patch` add `if (phone) { patch.phone = phone; patch.phoneCapturedAt = now; }`; in the insert `values` add `phone, phoneCapturedAt: phone ? now : null,`.

- [ ] **Step 4: Verify, commit**

Run: `pnpm --filter @aivastra/db build && cd apps/api && npx vitest run --config vitest.integration.config.ts shopify-shopper-phone shopify-limits shopper` → pass.
GDPR check: read `apps/api/src/modules/shopify/gdpr.ts` `redactShopperData`/purge path and confirm a fully-erased shopper **deletes the row** (so the phone goes with it). If any path only nulls `email` and keeps the row, add `phone: null, phoneCapturedAt: null` there and a test; record the finding in your report either way.

```bash
git add packages/db/src/schema/shopify.ts packages/db/src/migrations apps/api/src/modules/shopify/shopper.ts apps/api/test/integration/shopify-shopper-phone.test.ts
git commit -m "feat(shopify): store shopper phone (migration + resolveShopper)"
```

(Stage the generated migration files by their exact names from `git status`; do not stage anything else under `migrations`.)

---

### Task 3: Expose the verified Shopify customer id

**Files:**
- Modify: `apps/api/src/plugins/shopify-widget-auth.ts`
- Test: `apps/api/src/plugins/shopify-widget-auth.test.ts` (add cases using its existing `signAppProxyQuery` helper and mock `app`)

**Interfaces:**
- Produces: `req.shopifyLoggedInCustomerId: number | null` set by `requireShopifyStoreKey`: the numeric `logged_in_customer_id` query param **only** when the App Proxy signature verified; `null` on the legacy header path and when the param is empty/non-numeric/absent.

- [ ] **Step 1: Failing tests**

Read how the existing "resolves the store by shop domain on a validly signed, fresh app proxy request" test builds its `app`/`req` mocks and add three cases beside it, each asserting `req.shopifyLoggedInCustomerId`:
1. signed query with `logged_in_customer_id: '8123456789'` → `8123456789`
2. signed query with `logged_in_customer_id: ''` (what Shopify sends when logged out) → `null`
3. legacy `x-widget-key` request whose query carries `logged_in_customer_id=8123456789` but no signature → `null` (a forged parameter on the unsigned path is ignored)
4. signed query with a non-numeric value `'abc'` → `null`

Run: `pnpm --filter @aivastra/api test -- shopify-widget-auth` → FAIL.

- [ ] **Step 2: Implement**

In the signed branch, after `req.shopifyStoreRow = store;` and before `return;` add:

```ts
      // Shopify adds logged_in_customer_id to every proxied request ("" when the
      // shopper is logged out) and signs it with the rest of the query, so after
      // the check above it is the one identity here that is not shopper-asserted.
      const rawCustomerId =
        typeof query.logged_in_customer_id === 'string' ? query.logged_in_customer_id : '';
      req.shopifyLoggedInCustomerId = /^\d+$/.test(rawCustomerId) ? Number(rawCustomerId) : null;
```

At the top of the handler (before the signed branch) add `req.shopifyLoggedInCustomerId = null;` so the legacy path and every failure leave it null. Add to the `declare module 'fastify'` block: `shopifyLoggedInCustomerId?: number | null;` on `FastifyRequest`.

- [ ] **Step 3: Verify, commit**

Run: `pnpm --filter @aivastra/api test -- shopify-widget-auth` → pass; `pnpm --filter @aivastra/api typecheck` (only foreign-plan errors allowed).

```bash
git add apps/api/src/plugins/shopify-widget-auth.ts apps/api/src/plugins/shopify-widget-auth.test.ts
git commit -m "feat(shopify): expose Shopify-verified logged-in customer id on proxied requests"
```

---

### Task 4: Login gate and contact check in `limits.ts`

**Files:**
- Modify: `apps/api/src/modules/shopify/limits.ts`
- Test: `apps/api/src/modules/shopify/limits.test.ts` (create; pure unit tests with plain objects, no DB)

**Interfaces:**
- Consumes: `ShopperRow` (now has `phone`), `store.settings.limits.loginRequired`.
- Produces:
  - `LimitRefusal['reason']` = `'email_required' | 'shopper_limit' | 'store_limit' | 'login_required' | 'contact_required'`.
  - `export function checkLoginGate(store: Store, verifiedCustomerId: number | null): LimitRefusal | null` → `{ reason: 'login_required', message: 'Please log in to your account to use virtual try-on.' }` when `loginRequired` is on and the id is null; else null.
  - `checkShopperLimits` returns `{ reason: 'contact_required', message: 'Enter your email and phone number to continue.' }` first, when `loginRequired` is on and `!shopper.email || !shopper.phone`, before the existing email gate and caps. Because `lockAndRecheckShopperLimits` calls `checkShopperLimits`, the recheck covers it for free.

- [ ] **Step 1: Failing tests** (`limits.test.ts`)

```ts
import { describe, expect, it } from 'vitest';
import { checkLoginGate } from './limits.js';

// Only settings.limits is read, so a partial store is enough.
const store = (limits?: object) => ({ settings: { limits } }) as never;

describe('checkLoginGate', () => {
  it('passes when the store does not require login', () => {
    expect(checkLoginGate(store(), null)).toBeNull();
    expect(checkLoginGate(store({}), null)).toBeNull();
    expect(checkLoginGate(store({ loginRequired: false }), null)).toBeNull();
  });
  it('refuses an unverified shopper when login is required', () => {
    expect(checkLoginGate(store({ loginRequired: true }), null)).toMatchObject({
      reason: 'login_required',
    });
  });
  it('passes a verified shopper', () => {
    expect(checkLoginGate(store({ loginRequired: true }), 8123456789)).toBeNull();
  });
});
```

Contact-check cases need a DB (it counts jobs only after the new check, so with a shopper missing email/phone it returns before any query). Add to `limits.test.ts`:

```ts
import { checkShopperLimits } from './limits.js';

describe('checkShopperLimits contact gate', () => {
  const shopper = (over: object = {}) => ({ id: 's', clientId: 'c', email: null, phone: null, shopifyCustomerId: 1, ...over }) as never;
  const db = {} as never; // never reached: the contact refusal returns before any query

  it('refuses a login-required shopper with no email', async () => {
    const r = await checkShopperLimits(db, store({ loginRequired: true }), shopper({ phone: '555 0100 123' }));
    expect(r).toMatchObject({ reason: 'contact_required' });
  });
  it('refuses a login-required shopper with no phone', async () => {
    const r = await checkShopperLimits(db, store({ loginRequired: true }), shopper({ email: 'a@b.co' }));
    expect(r).toMatchObject({ reason: 'contact_required' });
  });
});
```

Run: `pnpm --filter @aivastra/api test -- limits` → FAIL.

- [ ] **Step 2: Implement**

`limits.ts`: extend the `reason` union; add

```ts
/**
 * Login requirement, evaluated against the Shopify-verified customer id (see
 * requireShopifyStoreKey), never a value the shopper sent. A separate function
 * from checkShopperLimits on purpose: that one only runs once a shopper row
 * exists, which needs a clientId the caller controls, so a gate inside it could
 * be skipped by leaving the clientId out.
 */
export function checkLoginGate(store: Store, verifiedCustomerId: number | null): LimitRefusal | null {
  if (store.settings.limits?.loginRequired !== true) return null;
  if (verifiedCustomerId != null) return null;
  return { reason: 'login_required', message: 'Please log in to your account to use virtual try-on.' };
}
```

In `checkShopperLimits`, right after `if (!limits) return null;` and **before** `siblingShopperIds`:

```ts
  if (limits.loginRequired === true && (!shopper.email || !shopper.phone)) {
    return { reason: 'contact_required', message: 'Enter your email and phone number to continue.' };
  }
```

(`=== true`: tests construct settings directly, so a missing flag is `undefined`; money/access gates compare strictly per CLAUDE.md.)

- [ ] **Step 3: Verify, commit**

Run: `pnpm --filter @aivastra/api test -- limits` → pass.

```bash
git add apps/api/src/modules/shopify/limits.ts apps/api/src/modules/shopify/limits.test.ts
git commit -m "feat(shopify): login gate and contact requirement in shopper limits"
```

---

### Task 5: Enforce in `POST /customer/jobs`; `loginRequired` on `enabled`

**Files:**
- Modify: `apps/api/src/modules/shopify/customer.routes.ts` (`REFUSAL_EVENT_TYPE`; `/jobs` handler: body destructure, the block before `if (clientId)`, the `resolveShopper` call; `enabled` handler return)
- Test: `apps/api/test/integration/shopify-login-required.test.ts`

**Interfaces:**
- Consumes: `req.shopifyLoggedInCustomerId` (Task 3), `checkLoginGate` (Task 4), `resolveShopper({ phone })` (Task 2), `ShopifyCustomerJobRequest.phone` (Task 1).
- Produces: for a store with `limits.loginRequired`:
  - not verified (direct path, or proxy with empty/absent id) → `202 { reason: 'login_required', message }`, no job, no deduct, event `refused_login_gate`;
  - verified but no `clientId` in body → `400`;
  - verified, shopper row lacking email or phone after applying the body → `202 { reason: 'contact_required', message }`, event `refused_contact_gate`;
  - verified with contact → job created; `shopify_shoppers.shopify_customer_id` = the verified id even if the body claimed another.
  The `enabled` endpoint returns `{ enabled, verboseErrors, loginRequired }`.

- [ ] **Step 1: Failing integration test**

`shopify-login-required.test.ts`. Use `buildTestApp(ctx, { SHOPIFY_API_SECRET: SECRET })` and copy `signAppProxyQuery` from `shopify-customer-app-proxy.test.ts` (`SECRET = 'login-required-test-secret'`). Seed per test: a store with enough credits and `settings: { limits: { loginRequired: true } }`, a workflow and the Redis config pointing at it (plan 1 introduces `config:system.shopifyWorkflowTemplateId`; if plan 1 has not landed when you run, seed a funnel template + default as the current tests in `shopify-customer.test.ts` do and use whichever mechanism that file uses at that moment), an enabled active garment (copy `seedStore`/`seedGarment` from `shopify-refusal-events.test.ts`), and an uploaded photo key owned by the store (copy that file's helper that sets `shopify:upload:{key}` and puts an object). Helper:

```ts
function postJob(
  store: { shopDomain: string },
  body: Record<string, unknown>,
  opts: { signed: boolean; loggedInCustomerId?: string },
) {
  const ts = String(Math.floor(Date.now() / 1000));
  const params: Record<string, string> = { shop: store.shopDomain, timestamp: ts };
  if (opts.loggedInCustomerId !== undefined) params.logged_in_customer_id = opts.loggedInCustomerId;
  return app.inject({
    method: 'POST',
    url: opts.signed ? '/v1/shopify/proxy/customer/jobs' : '/v1/shopify/customer/jobs',
    query: opts.signed ? signAppProxyQuery(params) : undefined,
    headers: opts.signed ? {} : { 'x-widget-key': store.storeKey },
    payload: body,
  });
}
```

Cases:
1. **direct X-Widget-Key path** with a full valid body incl. `shopifyCustomerId`, email, phone → `202`, `reason: 'login_required'`; no row in `jobs`; credit balance unchanged; one `shopify_widget_events` row of type `refused_login_gate`.
2. **signed, `logged_in_customer_id: ''`** → same refusal.
3. **signed, no `logged_in_customer_id` param at all** → same refusal.
4. **signed, verified id, body omits `clientId`** → `400`.
5. **signed, verified id, `clientId`, no email/phone** → `202 contact_required`; event `refused_contact_gate`; no job.
6. **signed, verified id, email only** → `202 contact_required`; then **same shopper** resends with email + phone → `200` and a job exists; shopper row has `email`, `phone`, `shopifyCustomerId = verified id`.
7. **body claims `shopifyCustomerId: 999` while verified id is `111`** → job created for shopper with `shopifyCustomerId === 111`.
8. **store without `loginRequired`**: direct path, no customer id, `clientId` present → still creates a job (behaviour unchanged).
9. **`enabled` endpoint** for the login-required store returns `loginRequired: true`; for the other store `false`.
10. **per-shopper cap still applies** after login: store `{ loginRequired: true, perShopperCap: 1, perShopperWindow: 'day' }`, two verified requests (second with a new `clientId`, same verified id) → second is `202 shopper_limit` (customer-id counting spans browsers).

Run (from `apps/api`): `npx vitest run --config vitest.integration.config.ts shopify-login-required` → FAIL.

- [ ] **Step 2: Implement in `customer.routes.ts`**

Imports: add `checkLoginGate` to the existing `./limits.js` import.
`REFUSAL_EVENT_TYPE` add:

```ts
  login_required: 'refused_login_gate',
  contact_required: 'refused_contact_gate',
```

In the `/jobs` body destructure add `phone` (type `phone?: string`). Replace the pre-shopper section so it reads (keep plan 1's `resolveShopifyWorkflow` hunk exactly where it is, above):

```ts
      // Identity: Shopify's signed logged-in customer id beats anything in the
      // body. A login-required store accepts nothing else.
      const verifiedCustomerId = req.shopifyLoggedInCustomerId ?? null;
      const loginRequired = store.settings.limits?.loginRequired === true;
      if (loginRequired) {
        const loginRefusal = checkLoginGate(store, verifiedCustomerId);
        if (loginRefusal) {
          await recordRefusal(
            app,
            storeId,
            loginRefusal.reason,
            clientId ?? null,
            shopifyProductId,
          );
          return reply.code(202).send(loginRefusal);
        }
        // The shopper row is what carries contact data and the per-shopper
        // limit; without a clientId there is no row, and skipping it would
        // skip those checks.
        if (!clientId) throw new AppError('BAD_REQUEST', 400, 'clientId is required');
      }
      const effectiveCustomerId = verifiedCustomerId ?? (loginRequired ? null : (shopifyCustomerId ?? null));
```

and change the `resolveShopper` call to `shopifyCustomerId: effectiveCustomerId,` and add `phone: phone ?? null,`. Replace the old `// Deployed widget versions did not send clientId...` comment lines only if they now contradict; keep them for the non-login branch.

`enabled` handler: change the return to `return { enabled, verboseErrors: app.env.SHOPIFY_WIDGET_VERBOSE === true, loginRequired: store.settings.limits?.loginRequired === true };` (touch only this return statement; plan 4 edits the lines above it).

Confirm `AppError('BAD_REQUEST', 400, ...)` is the code string used elsewhere in the file (`grep -n "AppError('BAD" apps/api/src/modules/shopify/customer.routes.ts`).

- [ ] **Step 3: Run tests and the regression set, commit**

Run: `npx vitest run --config vitest.integration.config.ts shopify-login-required shopify-limits shopify-refusal-events shopify-customer shopify-customer-app-proxy` → all pass. `pnpm --filter @aivastra/api typecheck`.

```bash
git add apps/api/src/modules/shopify/customer.routes.ts apps/api/test/integration/shopify-login-required.test.ts
git commit -m "feat(shopify): enforce login-required on try-on creation via the signed proxy identity"
```

(Stage only your hunks with `git add -p` if plan 1/4 have uncommitted hunks in `customer.routes.ts`.)

---

### Task 6: Merchant app: the toggle (onboarding page 3 and Settings)

**Files:**
- Modify: `apps/shopify/src/pages/OnboardingLimitsPage.tsx`, `apps/shopify/src/components/ShopperLimitCards.tsx`, `apps/shopify/src/pages/SettingsPage.tsx`
- Test: `apps/shopify/src/lib/limits.test.ts` (add a small pure helper test) and the helper in `apps/shopify/src/lib/limits.ts`

**Interfaces:**
- Produces in `lib/limits.ts`: `loginRequiredPatch(checked: boolean): Partial<ShopifyStoreLimits>` returning `{ loginRequired: checked }`.

- [ ] **Step 1: Failing test** in `limits.test.ts`:

```ts
import { loginRequiredPatch } from './limits';

describe('loginRequiredPatch', () => {
  it('writes an explicit boolean so the API merge can switch it back off', () => {
    expect(loginRequiredPatch(true)).toEqual({ loginRequired: true });
    expect(loginRequiredPatch(false)).toEqual({ loginRequired: false });
  });
});
```

Run: `pnpm --filter @aivastra/shopify-admin test -- limits` → FAIL.

- [ ] **Step 2: Implement**

`lib/limits.ts`: add `export function loginRequiredPatch(checked: boolean): Partial<ShopifyStoreLimits> { return { loginRequired: checked }; }`.

`OnboardingLimitsPage.tsx` (re-read; leave the `canShowPostBasketPage` import/use alone):
- `draft` becomes `{ perShopperCap, perShopperWindow, loginRequired: limits.loginRequired === true }` (remove `emailAfterNTryOns` from `draft`, `changed`, and the `emailRequired` derivation).
- `changed` compares `draft.loginRequired !== (saved.loginRequired === true)` in place of the email comparison.
- Replace the checkbox with:

```tsx
            <Checkbox
              label="Make Login Required"
              helpText="Customers must log in to your store before using virtual try-on. We'll ask for their email and phone number if their account doesn't have them."
              checked={limits.loginRequired === true}
              onChange={(checked) => patchLimits(loginRequiredPatch(checked))}
            />
```

- Update the component doc comment ("a plain require/don't-require toggle for email" → "for login").
- Update the comment above `draft` to say only the three settings it shows (cap, window, login) are sent.
- import `loginRequiredPatch` from `../lib/limits`.

`ShopperLimitCards.tsx`: add and export

```tsx
export function LoginRequiredCard({ limits, onChange }: { limits: ShopifyStoreLimits; onChange: (patch: Partial<ShopifyStoreLimits>) => void }) {
  return (
    <Card>
      <BlockStack gap="200">
        <Text as="h3" variant="headingSm">Require login</Text>
        <Checkbox
          label="Shoppers must log in to use try-on"
          helpText="Email and phone number are collected automatically: from the customer account when present, otherwise the shopper is asked."
          checked={limits.loginRequired === true}
          onChange={(checked) => onChange(loginRequiredPatch(checked))}
        />
      </BlockStack>
    </Card>
  );
}
```

(Match the file's existing imports and card structure; copy `AskForEmailCard`'s wrapper markup rather than the snippet above if they differ; import `Checkbox`, `loginRequiredPatch`.) In `SettingsPage.tsx` render `<LoginRequiredCard limits={limits} onChange={patchLimits} />` directly above `<AskForEmailCard ... />` (line ~143).

- [ ] **Step 3: Verify, commit**

Run: `pnpm --filter @aivastra/shopify-admin test -- limits && pnpm --filter @aivastra/shopify-admin typecheck && pnpm --filter @aivastra/shopify-admin lint` (errors in files owned by other plans are not yours).

```bash
git add apps/shopify/src/lib/limits.ts apps/shopify/src/lib/limits.test.ts apps/shopify/src/pages/OnboardingLimitsPage.tsx apps/shopify/src/components/ShopperLimitCards.tsx apps/shopify/src/pages/SettingsPage.tsx
git commit -m "feat(shopify): Make Login Required toggle in onboarding and settings"
```

(Stage only your hunks where other plans have uncommitted edits.)

---

### Task 7: Shoppers export includes phone

**Files:**
- Modify: `apps/api/src/modules/shopify/shoppers.routes.ts`
- Test: extend the existing shoppers test (`grep -rln "shoppers.csv" apps/api/test`); create `apps/api/test/integration/shopify-shoppers-phone.test.ts` if none exists
- Modify: the merchant UI that lists collected emails if it renders a table (`grep -rn "v1/shopify/shoppers" apps/shopify/src`)

**Interfaces:**
- Produces: `GET /v1/shopify/shoppers` items carry `phone: string | null`; `GET /v1/shopify/shoppers.csv` header is `email,consent,first_seen,try_ons,phone` (phone appended last so existing imports of the file do not shift columns).

- [ ] **Step 1: Failing test** seeding two shoppers (one with phone) and asserting the JSON `phone` field and the exact CSV header and a row ending in `,555 0100 123`.
- [ ] **Step 2: Implement:** add `phone: schema.shopifyShoppers.phone` to the select; CSV header `'email,consent,first_seen,try_ons,phone'`; append `csvCell(r.phone ?? '')` to each row. Add `phone` to the SPA type for the shoppers item and a Phone column to any table that lists them.
- [ ] **Step 3: Verify, commit**

Run the new/extended shoppers test and `pnpm --filter @aivastra/api typecheck`.

```bash
git add apps/api/src/modules/shopify/shoppers.routes.ts apps/api/test/integration/shopify-shoppers-phone.test.ts
git commit -m "feat(shopify): include shopper phone in the collected contacts list and CSV"
```

(Add the SPA files you changed to the same commit by explicit path.)

---

### Task 8: Storefront widget: login step, contact step, gating

**Files:**
- Modify: `apps/shopify-extension/extensions/tryon-theme-extension/snippets/tryon-widget.liquid`
- Modify: `apps/shopify-extension/extensions/tryon-theme-extension/assets/tryon-widget.js`
- Modify: `apps/shopify-extension/extensions/tryon-theme-extension/assets/tryon-widget.css`

**Interfaces:**
- Consumes: the `enabled` response `loginRequired` (Task 5); `202 { reason: 'login_required' | 'contact_required' }` from `/customer/jobs`; `phone` in the job body (Task 1).
- Produces: a `login` step (message plus link to the store login page, returning to the product), a contact step that asks only for the missing fields, and gating on open.

- [ ] **Step 1: Liquid (`tryon-widget.liquid`)**

In the root element's attributes, inside the existing `{% if customer %} ... {% endif %}` block add `data-customer-phone="{{ customer.phone | escape }}"` next to `data-customer-email`, and add (outside the `if`, next to `data-api-base`) `data-login-url="{{ routes.account_login_url }}?return_url={{ product.url | url_encode }}"`.

Replace the email step (`aivastra-tryon__step--email`) with this (the email input, consent and submit keep their classes so existing JS and CSS still bind; the title/lead get classes so JS can reword them; the phone block is new):

```liquid
            <div class="aivastra-tryon__step aivastra-tryon__step--email" hidden>
              <h2 class="aivastra-tryon__upload-title">One quick thing</h2>
              <p class="aivastra-tryon__upload-lead aivastra-tryon__email-lead">
                Enter your email to continue.
              </p>
              <input
                type="email"
                class="aivastra-tryon__email-input"
                placeholder="you@example.com"
                autocomplete="email"
                required
              />
              <input
                type="tel"
                class="aivastra-tryon__phone-input"
                placeholder="Phone number"
                autocomplete="tel"
                hidden
              />
              <label class="aivastra-tryon__email-consent">
                <input type="checkbox" class="aivastra-tryon__email-consent-input" />
                <span>Email me offers and updates from this store.</span>
              </label>
              <p class="aivastra-tryon__email-error" hidden></p>
              <button type="button" class="aivastra-tryon__email-submit">Continue</button>
            </div>

            <div class="aivastra-tryon__step aivastra-tryon__step--login" hidden>
              <h2 class="aivastra-tryon__upload-title">Log in to try on</h2>
              <p class="aivastra-tryon__upload-lead">
                Log in to your account to use virtual try-on.
              </p>
              <a class="aivastra-tryon__login-link" href="{{ routes.account_login_url }}?return_url={{ product.url | url_encode }}">Log in</a>
            </div>
```

- [ ] **Step 2: JS (`tryon-widget.js`)** (re-read each region right before editing)

a. After `const shopifyCustomerId = ...` / `let shopperEmail = ...` (near line 521) add:

```js
    let shopperPhone = root.dataset.customerPhone || null;
    // From the enabled check below. Also re-learned from a login_required
    // refusal, so a stale or failed enabled check cannot let a shopper through:
    // the server is the real gate and this only avoids showing a doomed upload.
    let loginRequired = false;
    const loginUrl = root.dataset.loginUrl || '/account/login';

    // Same rule as packages/types/src/phone.ts (digits, space, + ( ) - .; at
    // least 7 digits; at most 30 characters). Kept in step by hand: this file
    // cannot import the package.
    function isValidPhone(value) {
      const v = String(value || '').trim();
      return v.length <= 30 && /^[0-9+()\-.\s]+$/.test(v) && v.replace(/\D/g, '').length >= 7;
    }
```

b. In the `steps` object add `login: root.querySelector('.aivastra-tryon__step--login'),`. Verify `showStep` hides every step generically (`grep -n "function showStep" -A12`); if it lists steps by name, add `login`.

c. In the enabled-check success path after `verboseErrors = body.verboseErrors === true;` add `loginRequired = body.loginRequired === true;`.

d. Contact step helper, placed with the email-step code (`emailInput` etc.):

```js
    const phoneInput = root.querySelector('.aivastra-tryon__phone-input');
    const emailLead = root.querySelector('.aivastra-tryon__email-lead');
    const emailConsentLabel = root.querySelector('.aivastra-tryon__email-consent');

    // Shows only the fields the server said it is missing. Email keeps its
    // consent checkbox; phone has none (it is collected, not marketed to).
    function configureContactStep({ needEmail, needPhone }) {
      if (emailInput) emailInput.hidden = !needEmail;
      if (emailConsentLabel) emailConsentLabel.hidden = !needEmail;
      if (phoneInput) {
        phoneInput.hidden = !needPhone;
        if (needPhone && shopperPhone) phoneInput.value = shopperPhone;
      }
      if (emailLead) {
        emailLead.textContent =
          needEmail && needPhone
            ? 'Enter your email and phone number to continue.'
            : needPhone
              ? 'Enter your phone number to continue.'
              : 'Enter your email to continue.';
      }
    }
```

e. Replace the body of the `emailSubmit` click handler's validation/state part (from `const value = (emailInput?.value ...` through `emailConfirmedByShopper = true;`) with:

```js
        const emailVisible = !!emailInput && !emailInput.hidden;
        const phoneVisible = !!phoneInput && !phoneInput.hidden;
        if (emailVisible) {
          const value = (emailInput?.value ? emailInput.value : '').trim();
          // Shape check only; the server's Zod schema is still the real
          // validation. Kept deliberately in step with it — see EMAIL_RE.
          if (!EMAIL_RE.test(value)) {
            showEmailError('Enter a valid email address.');
            return;
          }
          shopperEmail = value;
          shopperEmailConsent = !!emailConsentInput?.checked;
          // This click is the affirmative action. Until it happens, createJob
          // sends no email at all unless the store requires login, even for a
          // logged-in customer whose address was prefilled into the input above.
          emailConfirmedByShopper = true;
        }
        if (phoneVisible) {
          const phoneValue = (phoneInput.value || '').trim();
          if (!isValidPhone(phoneValue)) {
            showEmailError('Enter a valid phone number (at least 7 digits).');
            return;
          }
          shopperPhone = phoneValue;
        }
        if (emailError) emailError.hidden = true;
```

(Keep the rest of the handler, `const key = awaitingEmailForPhotoKey; ...` onward, unchanged. The old `if (emailError) emailError.hidden = true;`, `shopperEmail = value;`, `shopperEmailConsent = ...;`, `emailConfirmedByShopper = true;` lines are replaced by the block above, so make sure none remain duplicated.)

Before the existing refusal-driven `showStep('email')` calls make sure the plain email gate still shows email only: in `proceedWithPhoto`'s `email_required` branch call `configureContactStep({ needEmail: true, needPhone: false });` before `showStep('email')`; in `returnToEmailStep` also call `configureContactStep({ needEmail: true, needPhone: false });` first.

f. `createJob`: replace the `sentEmail` line and the spread lines with:

```js
      // Login-required stores take the account's email as-is (the shopper logged
      // in to get here); everywhere else an address is only sent after the
      // shopper submitted the email step, never merely because Liquid rendered it.
      const sentEmail = !!(shopperEmail && (emailConfirmedByShopper || loginRequired));
      const sentPhone = !!(loginRequired && shopperPhone && isValidPhone(shopperPhone));
```

and in the JSON body replace the `...(sentEmail ? { email: shopperEmail, emailConsent: shopperEmailConsent } : {}),` line with:

```js
              ...(sentEmail ? { email: shopperEmail, emailConsent: shopperEmailConsent } : {}),
              ...(sentPhone ? { phone: shopperPhone.trim() } : {}),
```

(Keep the long explanatory comment that precedes it, adjusting its first sentence to mention the login-required exception.) `emailConsent` stays false unless the shopper ticked the box.

g. `proceedWithPhoto`, in the `if (jobResult.pending)` block add before the `email_required` check:

```js
          if (jobResult.reason === 'login_required') {
            loginRequired = true;
            showStep('login');
            return;
          }
          if (jobResult.reason === 'contact_required') {
            // The server lacks email and/or phone for this shopper. Hold the
            // photo (same 600s ownership record) and ask only for what we do
            // not already have; if we sent both and it still refused, show both
            // so the shopper can correct them.
            const missingEmail = !shopperEmail;
            const missingPhone = !shopperPhone;
            const showBoth = !missingEmail && !missingPhone;
            awaitingEmailForPhotoKey = customerPhotoKey;
            configureContactStep({
              needEmail: missingEmail || showBoth,
              needPhone: missingPhone || showBoth,
            });
            showStep('email');
            return;
          }
```

h. Login gating: in `startOver()` (find with `grep -n "function startOver"`), after it has shown its normal step, add `if (loginRequired && !shopifyCustomerId) showStep('login');`. If `startOver` is also what runs the initial reset on first open, this covers the first open too.

- [ ] **Step 3: CSS** (`tryon-widget.css`)

Insert, immediately after the `.aivastra-tryon__email-submit` rule (find it with `grep -n "email-submit" tryon-widget.css`), this block (do not append at end of file; plan 4 appends there):

```css
/* login-required (plan 3) */
.aivastra-tryon__phone-input {
  /* same box as the email input */
}
.aivastra-tryon__login-link {
  display: block;
  box-sizing: border-box;
  width: 100%;
  padding: 12px 16px;
  text-align: center;
  text-decoration: none;
  color: var(--aivastra-text-color, #fff);
  background: var(--aivastra-button-color, #000);
  border-radius: var(--aivastra-border-radius, 4px);
}
```

Replace the empty `.aivastra-tryon__phone-input` rule by making the existing email-input rule a shared selector: edit the existing `.aivastra-tryon__email-input { ... }` selector to `.aivastra-tryon__email-input,\n.aivastra-tryon__phone-input { ... }` and delete the placeholder rule above.

- [ ] **Step 4: Verify, commit**

Run: `node --check apps/shopify-extension/extensions/tryon-theme-extension/assets/tryon-widget.js` (no output = OK). Run `shopify app` theme check if available locally (`npx shopify theme check --path apps/shopify-extension/extensions/tryon-theme-extension`; skip with a note if the CLI is absent): no new offences.
Grep guards: `grep -n "sentEmail\|emailConfirmedByShopper" tryon-widget.js` shows no duplicated declarations; `grep -c "configureContactStep" tryon-widget.js` ≥ 4.

```bash
git add apps/shopify-extension/extensions/tryon-theme-extension/snippets/tryon-widget.liquid apps/shopify-extension/extensions/tryon-theme-extension/assets/tryon-widget.js apps/shopify-extension/extensions/tryon-theme-extension/assets/tryon-widget.css
git commit -m "feat(shopify): widget login step and contact step for login-required stores"
```

(Plan 4 edits these three files too; stage only your hunks with `git add -p`.)

---

### Task 9: Verification and manual dev-store script (do not run `shopify app deploy`)

- [ ] **Step 1: Automated.** Run and report counts: `pnpm --filter @aivastra/types test`, `pnpm --filter @aivastra/api test`, and from `apps/api`: `npx vitest run --config vitest.integration.config.ts shopify-login-required shopify-shopper-phone shopify-limits shopify-refusal-events shopify-customer shopify-customer-app-proxy shopify-shoppers`, plus `pnpm --filter @aivastra/shopify-admin test`, `pnpm typecheck` for the packages you touched, and `node --check` on the widget.
- [ ] **Step 2: Write the manual script into your final report** for whoever has a dev store (staging deploy is the manager's decision): (1) turn on Make Login Required in Settings; (2) logged out: open a product, click Try It On → "Log in" step, link returns to the product; (3) logged in, account has email and phone → upload works, no extra step, shopper row has phone; (4) logged in, no phone on the account → "Enter your phone number" step, then success; (5) logged in on **new customer accounts** and **classic accounts**: confirm Shopify actually sends `logged_in_customer_id` on `/apps/widget/...` (check the API log for a non-null `shopifyLoggedInCustomerId`); if new accounts do not, report immediately: login-required stores would refuse every shopper; (6) `curl` the direct `/v1/shopify/customer/jobs` with the store key: `login_required`.
- [ ] **Step 3: Report** (no commit).

---

## Final report additions for the manager

- Behaviour changes for `docs/progress.md`: onboarding page 3 now writes `limits.loginRequired` (not `emailAfterNTryOns`); login-required stores fail closed without a signed proxy id; shopper phone stored (migration number); the Analytics page does not yet chart `refused_login_gate`/`refused_contact_gate`.
- Open risk to record: email/phone are shopper-asserted; only the customer id is verified; new-customer-accounts behaviour of `logged_in_customer_id` unconfirmed until the dev-store script step 5.
- Whether GDPR purge deletes the row (so phone is erased) or needed a patch (Task 2 finding).

## Self-review (spec coverage)

| Spec requirement | Task |
|---|---|
| `limits.loginRequired`, onboarding checkbox, Settings toggle, legacy email control kept | 1, 6 |
| Signed proxy verified id; direct path refused; body id ignored | 3, 5 |
| `login_required` / `contact_required` before deduct, ordering, race recheck | 4, 5 |
| Shopper phone column + migration; GDPR | 2 |
| Body `contact`/phone validated, stored | 1, 2, 5 |
| Liquid `data-customer-phone`; widget prefill; ask only for the missing field | 8 |
| `enabled` response carries `loginRequired` | 5, 8 |
| Logged-out: login link returning to the product | 8 |
| Per-shopper cap unchanged and spans browsers by customer id | 5 (case 10) |
| Risks: proxy down fails closed; new accounts | 5, 9 |
| Merchants can see collected phone | 7 |
