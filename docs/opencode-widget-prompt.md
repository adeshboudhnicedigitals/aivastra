# OpenCode Implementation Prompt — Aivastra Widget Merchant System

## Your task

Implement the Aivastra widget merchant system exactly as specified in `docs/widget-merchant-plan.md`.
Read that file completely before writing a single line of code.

**Do not deviate from the plan.** Do not add extra features, do not restructure existing code,
do not rename existing patterns. If something is unclear, follow the nearest existing pattern
in the codebase rather than inventing a new one.

**Stop at Step 11.** Do NOT implement Step 12 (dispatcher changes). That step is explicitly
blocked and marked as awaiting a workflow JSON file. Leave `processor.ts` unchanged.

---

## Context you must understand first

This is a pnpm monorepo. Read these files before starting:

- `CLAUDE.md` — project conventions, stack, invariants
- `docs/widget-merchant-plan.md` — the complete spec (your source of truth)
- `apps/api/src/server.ts` — how routes are registered (you will add to this)
- `apps/api/src/plugins/auth.ts` — how `requireUser` works (mirror this for `requireWidgetClient` and `requireMerchant`)
- `apps/api/src/modules/auth/service.ts` — `hashPassword`, `verifyPassword`, `signAccess`, `verifyAccess` (reuse these directly, do not reimplement)
- `apps/api/src/modules/credits/ledger.ts` — `atomicDeduct`, `refund`, `adminGrant` (mirror this pattern for widget credit ledger)
- `apps/api/src/modules/admin/guard.ts` — `requireAdmin` (reuse on all /v1/admin/widget-clients/* routes)
- `apps/api/src/lib/errors.ts` — `AppError` (use for all error throwing)
- `packages/db/src/schema/users.ts` — DB column conventions to follow
- `packages/db/src/schema/jobs.ts` — modify this file (add 2 columns)
- `packages/db/src/migrations/meta/_journal.json` — update after writing migration SQL
- `apps/web/src/middleware.ts` — update this for merchant/widget route rules
- `apps/web/src/lib/auth-cookies.ts` — cookie helper to reuse for merchant cookies
- `apps/web/src/app/(auth)/login/page.tsx` — mirror this pattern for merchant login/signup pages
- `apps/web/src/app/api/auth/login/route.ts` — mirror this BFF pattern for /api/merchant/* routes
- `apps/web/src/components/tokens.ts` — `C` and `grad` (use these for all styling, never hardcode colors)
- `apps/admin/src/App.tsx` — how routes are registered in the admin SPA

---

## What the widget does (critical — read carefully)

The widget is a **customer-facing virtual try-on** embedded as an iframe on a merchant's product page.

**NOT** a catalogue tool. There is NO face selection, NO pose selection, NO background selection.

Flow:
1. Merchant product page passes `garment_image` URL via `postMessage({ type: 'INIT_TRYON', payload: { garment_image } })`
2. Customer uploads their own photo in the iframe
3. System generates the customer wearing that garment
4. Customer sees result, can download, then closes (sends `postMessage({ type: 'TRYON_CLOSED' })`)

The widget iframe lives at `/widget/render/[key]` inside `apps/web` (not a separate app).
The merchant portal lives at `/merchant/*` inside `apps/web` (not a separate app).

---

## Build order — follow exactly, do not skip steps

### Step 1 — DB schema and migration

Create `packages/db/src/schema/widget.ts` with three tables exactly as specified in the plan:
- `widgetClients`
- `widgetClientCredits`
- `widgetCreditLedger`

Modify `packages/db/src/schema/jobs.ts` — add these two nullable columns to the `jobs` table:
```typescript
widgetClientId: uuid('widget_client_id')
  .references(() => widgetClients.id, { onDelete: 'set null' }),
customerPhotoKey: text('customer_photo_key'),
```

Add `export * from './widget.js'` to `packages/db/src/schema/index.ts`.

Write `packages/db/src/migrations/0054_widget_clients.sql` with the exact SQL from the plan.

Update `packages/db/src/migrations/meta/_journal.json` — add the 0054 entry following the same
format as the existing entries. The `when` field is a Unix timestamp — use current time.

Run `pnpm db:migrate` and confirm it applies cleanly.

---

### Step 2 — Types package

Create `packages/types/src/widget.ts` with these four Zod schemas exactly as in the plan:
- `WidgetClientSignup`
- `WidgetClientLogin`
- `WidgetJobRequest`
- `WidgetPresignRequest`
- `WidgetConfigResponse`

Add `export * from './widget.js'` to `packages/types/src/index.ts`.

Run `pnpm --filter @aivastra/types build`.

---

### Step 3 — API auth plugin

Create `apps/api/src/plugins/widget-auth.ts`.

It must export a fastify-plugin that decorates the app with two methods:
- `app.requireWidgetClient` — reads `X-Widget-Key` header, looks up `widgetClients` table, throws
  `AppError('UNAUTHORIZED', 401, ...)` if missing/invalid/inactive, sets `req.widgetClientId`
  and `req.widgetClient`
- `app.requireMerchant` — reads `merchant_access_token` cookie OR `Authorization: Bearer` header,
  calls `verifyAccess` from `apps/api/src/modules/auth/service.ts` with audience check `'merchant'`,
  sets `req.merchantClientId`

Update `apps/api/src/types/fastify.d.ts` — add the new request and instance properties as
specified in the plan.

Register in `apps/api/src/server.ts` immediately after the existing auth plugin registration:
```typescript
await app.register(widgetAuthPlugin);
```

---

### Step 4 — Widget credit ledger

Create `apps/api/src/modules/widget/ledger.ts`.

Copy the structure of `apps/api/src/modules/credits/ledger.ts` exactly.
Replace:
- `userCredits` table → `widgetClientCredits` table
- `creditLedger` table → `widgetCreditLedger` table
- `userId` parameter → `widgetClientId` parameter

Export three functions: `atomicWidgetDeduct`, `widgetRefund`, `widgetAdminGrant`.

---

### Step 5 — API routes

#### Merchant routes
Create `apps/api/src/modules/merchant/routes.ts`.

Implement these routes exactly:
- `POST /v1/merchant/signup` — uses `hashPassword`, inserts `widgetClients` + `widgetClientCredits`
- `POST /v1/merchant/login` — uses `verifyPassword`, issues JWT with `signAccess(..., 'merchant')`,
  sets `merchant_access_token` httpOnly cookie (30 day expiry, path `/`)
- `POST /v1/merchant/logout` — clears `merchant_access_token` cookie, returns 204
- `GET /v1/merchant/me` — preHandler: `app.requireMerchant`, returns client + credit balance
- `GET /v1/merchant/jobs` — preHandler: `app.requireMerchant`, returns last 50 widget jobs

#### Widget public routes
Create `apps/api/src/modules/widget/routes.ts`.

Implement these routes exactly:
- `GET /v1/widget/config/:key` — no auth, validates widget key, returns `WidgetConfigResponse`
- `POST /v1/widget/presign` — preHandler: `app.requireWidgetClient`, generates presigned R2 PUT URL
  for customer photo. Key format: `widget-inputs/<widgetClientId>/<uuid>/photo.<ext>`.
  Store upload ownership in Redis: `SET widget:upload:<r2Key> <widgetClientId> EX 600`.
  Return `{ uploadUrl, r2Key, expiresIn }`.
- `POST /v1/widget/jobs` — preHandler: `app.requireWidgetClient`:
  1. Validate `customerPhotoKey` ownership (check Redis + `storage.headObject`)
  2. Download `garmentImageUrl` (fetch, max 10MB, 15s timeout)
  3. Upload garment to R2: `widget-garments/<widgetClientId>/<uuid>/garment.<ext>`
  4. DB transaction: INSERT jobs (widget_client_id, customer_photo_key, status QUEUED),
     INSERT job_inputs (upper_garment_key = garment R2 key, all other FK fields null),
     `atomicWidgetDeduct(tx, widgetClientId, WIDGET_JOB_COST, jobId)`
  5. `XADD jobs:normal { jobId, type: 'WIDGET_TRYON' }`
  6. Return 201 `{ jobId }`
- `GET /v1/widget/jobs/:id` — preHandler: `app.requireWidgetClient`, returns job status
- `GET /v1/widget/jobs/:id/events` — preHandler: `app.requireWidgetClient`, SSE stream.
  Mirror the existing SSE route in `apps/api/src/modules/jobs/routes.ts` exactly.
  Verify `job.widgetClientId === req.widgetClientId` before streaming.

Set `WIDGET_JOB_COST = 10` as a named constant at the top of the file.

#### Admin widget client routes
Create `apps/api/src/modules/admin/widget-clients.routes.ts`.

Implement these routes using `requireAdmin` guard exactly as specified in the plan:
- `GET /v1/admin/widget-clients` — paginated list
- `POST /v1/admin/widget-clients` — create merchant (admin-side)
- `GET /v1/admin/widget-clients/:id` — full detail
- `PATCH /v1/admin/widget-clients/:id` — partial update
- `POST /v1/admin/widget-clients/:id/credits` — top up credits via `widgetAdminGrant`

#### Register all three in `apps/api/src/server.ts`:
```typescript
import { merchantRoutes } from './modules/merchant/routes.js';
import { widgetRoutes } from './modules/widget/routes.js';
import { adminWidgetClientsRoutes } from './modules/admin/widget-clients.routes.js';

// Add after existing user routes:
await app.register(merchantRoutes);
await app.register(widgetRoutes);

// Add after existing admin routes:
await app.register(adminWidgetClientsRoutes);
```

---

### Step 6 — Web BFF routes

Create these three Next.js API route files:
- `apps/web/src/app/api/merchant/signup/route.ts`
- `apps/web/src/app/api/merchant/login/route.ts`
- `apps/web/src/app/api/merchant/logout/route.ts`

Mirror the pattern in `apps/web/src/app/api/auth/login/route.ts` exactly.
Use `apps/web/src/lib/auth-cookies.ts` for cookie setting.
Cookie name: `merchant_access_token`. Cookie path: `/`. Max age: 30 days.

---

### Step 7 — Web middleware

Modify `apps/web/src/middleware.ts`.

Add `/merchant/dashboard` to protected routes (check `merchant_access_token` cookie — if missing,
redirect to `/merchant/login`).

Add to public (no auth check):
- `/merchant/signup`
- `/merchant/login`
- `/widget` (entire subtree — widget key is the auth, not a cookie)

---

### Step 8 — Merchant portal pages

Create `apps/web/src/app/(merchant)/layout.tsx`.
Simple layout — minimal top navbar with Aivastra logo on the left and a logout button on the right.
Logout button calls `POST /api/merchant/logout` then redirects to `/merchant/login`.
Use `C` tokens from `@/components/tokens` for colors.

Create `apps/web/src/app/(merchant)/merchant/signup/page.tsx`.
`'use client'` component. Use React Hook Form + `zodResolver(WidgetClientSignup)`.
Fields exactly as listed in the plan (10 fields + checkbox).
Mirror the visual layout of `apps/web/src/app/(auth)/register/page.tsx` — same split-panel,
same use of `LogoAuth` and `C` tokens.
POST to `/api/merchant/signup`. On success → `router.push('/merchant/dashboard')`.

Create `apps/web/src/app/(merchant)/merchant/login/page.tsx`.
`'use client'` component. Email + password. POST to `/api/merchant/login`.
On success → `router.push('/merchant/dashboard')`.
Mirror layout of `apps/web/src/app/(auth)/login/page.tsx`.

Create `apps/web/src/app/(merchant)/merchant/dashboard/page.tsx`.
Server component. Read `merchant_access_token` cookie, call `GET /v1/merchant/me` from the
server. If no cookie or 401 → `redirect('/merchant/login')`.

Render three cards + jobs table as described in the plan:
1. Widget Key card (show `widgetKey` with copy-to-clipboard button)
2. Embed Code card (show the two script tags with the merchant's actual `widgetKey` filled in,
   with a "Copy snippet" button)
3. Credits card (show `creditBalance`)
4. Recent jobs table (fetch `GET /v1/merchant/jobs`, show date, status, credits used)

For the embed code card, the snippet to show is:
```html
<script>
  window.AIVASTRA_WIDGET = { widget_key: "THEIR_WIDGET_KEY_HERE" };
</script>
<script src="https://app.aivastra.com/widget/loader.js"></script>
```
And a usage example:
```javascript
AIVASTRA_OPEN_WIDGET({ garment_image: "YOUR_PRODUCT_IMAGE_URL" })
```

---

### Step 9 — Widget iframe page

Create `apps/web/src/app/(widget)/layout.tsx`.
Bare layout — no html/body wrapper conflict with Next.js root layout. Just renders children.
No navbar, no sidebar.

Create `apps/web/src/app/(widget)/widget/render/[key]/page.tsx`.
`'use client'` component.

Implement this exact state machine:

```
'validating' → 'waiting' → 'uploading' → 'processing' → 'result'
                                        ↘ 'error' (from any state)
```

**'validating':** On mount, call `GET /v1/widget/config/:key` (no auth header needed).
If key invalid/inactive → go to 'error' with message "This widget is not active."

**'waiting':** Listen for `window.addEventListener('message', handler)`.
On `event.data.type === 'INIT_TRYON'` → store `garmentImageUrl = event.data.payload.garment_image`,
go to 'uploading'.

**'uploading':** Show:
- Small garment image preview at top (img src=garmentImageUrl)
- Upload zone: dashed border box, click to open file picker, accept `image/*`
- After file selected: show photo thumbnail preview + "Change photo" link
- "Generate Try-On →" button using `GradBtn` (disabled until file selected and upload complete)
- On "Generate Try-On →" click:
  1. Call `POST /v1/widget/presign` with `X-Widget-Key: key` header,
     body: `{ contentType: file.type, contentLength: file.size }`
  2. XHR PUT to the returned `uploadUrl` with the file — show progress bar
  3. On upload complete: go to 'processing', call `POST /v1/widget/jobs` with
     `{ garmentImageUrl, customerPhotoKey: r2Key, aspectRatio: '2:3' }`
     and `X-Widget-Key: key` header

**'processing':** Show:
- Small garment image + small customer photo side by side at top
- Centered animated spinner
- Text: "Generating your try-on..."
- Subtext: "Usually takes 30–60 seconds"
- Open SSE: `GET /v1/widget/jobs/:id/events` with `X-Widget-Key: key` header
  (use EventSource or fetch with ReadableStream — mirror existing SSE client in studio page)
- On COMPLETED event: store resultUrl from event data, go to 'result'
- On FAILED event: go to 'error' with message from event

**'result':** Show:
- Result image full width
- Two buttons side by side:
  - "Download" — `<a href={resultUrl} download>` styled as secondary button
  - "Try Another Photo" — resets to 'uploading' state (keeps garmentImageUrl)
- Close (X) button top-right → `window.parent.postMessage({ type: 'TRYON_CLOSED' }, '*')`

**'error':** Show:
- Error message text
- "Try Again" button → reset to 'uploading' (or 'waiting' if garmentImageUrl not set)
- Close (X) button

**Styling rules:**
- Use `C` tokens from `@/components/tokens` for all colors — NEVER hardcode hex colors
- Use `grad` for gradient buttons/accents (pink → amber)
- Use `GradBtn` from `@/components/ui/grad-btn` for primary action button
- Fixed close (X) button always visible in top-right corner
- "Powered by Aivastra" badge at bottom in small grey text
- All content must fit in 437px width (the iframe width from loader.js)
- No scrolling — content must fit viewport height

---

### Step 10 — Static widget loader

Create `apps/web/public/widget/loader.js`.

Copy the exact content of the `loadernew.js` code from the senior.
Change only this one line:
```javascript
// FROM:
iframe.src = "https://api.aivastra.com/widget/render/" + window.AIVASTRA_WIDGET.widget_key;
// TO:
iframe.src = "https://app.aivastra.com/widget/render/" + window.AIVASTRA_WIDGET.widget_key;
```
No other changes to the loader script.

---

### Step 11 — Admin SPA

Create `apps/admin/src/pages/WidgetClients.tsx`.

Table with columns: Company Name | Email | Widget Key (first 8 chars + "..." + copy button) |
Credit Balance | Status (Active/Inactive badge) | Actions ("View" link to detail).
Fetch from `GET /v1/admin/widget-clients`. Support search input (debounced, 300ms).

Create `apps/admin/src/pages/WidgetClientDetail.tsx`.

Sections:
1. Info section — display all client fields, Edit button opens inline form for
   `companyName` and `allowedOrigins`. PATCH to `/v1/admin/widget-clients/:id`.
2. Status section — toggle button "Deactivate" / "Activate". PATCH `{ isActive: !current }`.
3. Credits section — display current balance. Form: integer input + reason text + "Add Credits"
   button. POST to `/v1/admin/widget-clients/:id/credits`. Show success/error inline.
4. Recent Jobs section — table of last 20 jobs: Date | Status | Credits Used.

Modify `apps/admin/src/App.tsx`:
```tsx
import { WidgetClients } from './pages/WidgetClients';
import { WidgetClientDetail } from './pages/WidgetClientDetail';

// Add to router:
<Route path="/widget-clients" element={<WidgetClients />} />
<Route path="/widget-clients/:id" element={<WidgetClientDetail />} />
```

Modify `apps/admin/src/components/Sidebar.tsx` (or equivalent nav component):
Add a "Widget Clients" navigation item pointing to `/widget-clients`.

---

## Hard rules — do not break these

1. **Never touch `apps/dispatcher/`** — dispatcher changes are blocked pending workflow JSON
2. **Never touch existing user auth routes** (`/v1/auth/*`) — merchant auth is separate
3. **Never touch existing job creation route** (`POST /v1/jobs/tryon`) — widget jobs use `/v1/widget/jobs`
4. **Never use `console.log`** — use pino logger via `createLogger` from `@aivastra/logger`
5. **Never use raw hex colors in web** — always use `C.xxx` tokens from `@/components/tokens`
6. **Never use npm or yarn** — this is a pnpm workspace. Run `pnpm install` if needed.
7. **All API errors must go through `AppError`** — never throw plain Error objects in route handlers
8. **Credit deduction must be inside a DB transaction** — never deduct outside a transaction
9. **The `jobs` table `user_id` column is nullable** — widget jobs set `user_id: null` and
   `widget_client_id: <id>`. Do not make `user_id` required.
10. **All new DB schema must be re-exported from `packages/db/src/schema/index.ts`**
11. **All new types must be re-exported from `packages/types/src/index.ts`**
12. **After any change to `packages/*`**, rebuild the affected package:
    `pnpm --filter @aivastra/<pkg> build`

---

## After completing all 11 steps

Run the full verification from the plan:
1. `pnpm db:migrate` — confirm clean
2. Start the app: `pnpm dev`
3. Run the curl smoke tests from section 12 of the plan
4. Open `http://localhost:3000/widget/render/<WIDGET_KEY>` and test postMessage flow
5. Open `http://localhost:3000/merchant/signup` and complete registration
6. Open `http://localhost:5173/widget-clients` and confirm merchant appears

Report any failures with the exact error message. Do not attempt to fix the dispatcher.
