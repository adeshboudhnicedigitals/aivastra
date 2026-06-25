# Widget Merchant System — Full Implementation Plan (v2)

## Context

Aivastra offers two distinct products:

| Product | Who uses it | Purpose |
|---|---|---|
| **Catalogue tool** (this webtool) | Merchants | Generate model photos of garments for e-commerce listings |
| **Widget** (this plan) | End customers | Try on a specific garment using their own uploaded photo |

**Widget user journey:**
1. Customer browses a merchant's product page (e.g. a shirt on Myntra/their own site)
2. Clicks "Try Now" button (injected by the merchant's widget embed)
3. An iframe opens — the garment is already known (passed by the merchant)
4. Customer uploads their own photo (selfie or full-body)
5. We submit a job to ComfyUI using the **customer try-on workflow** (different from catalogue workflow)
6. Result: generated image of the customer wearing the garment
7. Customer can download/share, then close the iframe

**Key difference from catalogue tool:**
- No face selection (customer IS the face)
- No pose selection (pose comes from customer's own photo)
- No background selection (from customer's photo or transparent)
- Uses a dedicated ComfyUI try-on workflow (already live on a VPS — JSON TBD)

---

## Architecture

```
Merchant product page
  └─ <script> (loader.js — served from apps/web/public/widget/loader.js)
       window.AIVASTRA_WIDGET = { widget_key: "abc" }
       window.AIVASTRA_OPEN_WIDGET({ garment_image: "https://cdn.merchant.com/shirt.jpg" })
       └─ iframe → app.aivastra.com/widget/render/[key]
            │
            ├─ 1. mount: GET /v1/widget/config/:key  (validate key, get merchant name)
            ├─ 2. postMessage INIT_TRYON { garment_image }  (from parent page)
            ├─ 3. customer uploads their photo (presigned PUT direct to R2)
            ├─ 4. POST /v1/widget/jobs  (X-Widget-Key header auth)
            ├─ 5. GET /v1/widget/jobs/:id/events  (SSE — poll for result)
            ├─ 6. show result image + download button
            └─ 7. close → postMessage TRYON_CLOSED
```

---

## 1. DB Schema

### New file: `packages/db/src/schema/widget.ts`

```typescript
import { pgTable, uuid, text, integer, boolean, timestamp } from 'drizzle-orm/pg-core';

export const widgetClients = pgTable('widget_clients', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyName: text('company_name').notNull(),
  contactName: text('contact_name').notNull(),
  email: text('email').notNull().unique(),
  phone: text('phone').notNull(),
  websiteUrl: text('website_url').notNull(),
  companySize: text('company_size').notNull(),
  // '1-10' | '11-50' | '51-200' | '200+'
  purpose: text('purpose').notNull(),
  // 'ecommerce' | 'fashion_brand' | 'tailoring' | 'marketplace' | 'enterprise'
  businessAddress: text('business_address').notNull(),
  passwordHash: text('password_hash').notNull(),
  widgetKey: uuid('widget_key').notNull().unique().defaultRandom(),
  isActive: boolean('is_active').notNull().default(true),
  allowedOrigins: text('allowed_origins').array().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const widgetClientCredits = pgTable('widget_client_credits', {
  widgetClientId: uuid('widget_client_id').primaryKey()
    .references(() => widgetClients.id, { onDelete: 'cascade' }),
  balance: integer('balance').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const widgetCreditLedger = pgTable('widget_credit_ledger', {
  id: uuid('id').primaryKey().defaultRandom(),
  widgetClientId: uuid('widget_client_id').notNull()
    .references(() => widgetClients.id, { onDelete: 'cascade' }),
  delta: integer('delta').notNull(),
  reason: text('reason').notNull(), // 'JOB_DISPATCH' | 'REFUND' | 'ADMIN_GRANT'
  jobId: uuid('job_id'),
  adminId: uuid('admin_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

Re-export in `packages/db/src/schema/index.ts`:
```typescript
export * from './widget.js';
```

### Modify: `packages/db/src/schema/jobs.ts`

Add two nullable columns to the `jobs` table:
```typescript
widgetClientId: uuid('widget_client_id')
  .references(() => widgetClients.id, { onDelete: 'set null' }),
customerPhotoKey: text('customer_photo_key'), // R2 key for the uploaded customer photo
```

### Migration: `packages/db/src/migrations/0054_widget_clients.sql`

```sql
CREATE TABLE "widget_clients" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_name"     text NOT NULL,
  "contact_name"     text NOT NULL,
  "email"            text NOT NULL UNIQUE,
  "phone"            text NOT NULL,
  "website_url"      text NOT NULL,
  "company_size"     text NOT NULL,
  "purpose"          text NOT NULL,
  "business_address" text NOT NULL,
  "password_hash"    text NOT NULL,
  "widget_key"       uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  "is_active"        boolean NOT NULL DEFAULT true,
  "allowed_origins"  text[] NOT NULL DEFAULT '{}',
  "created_at"       timestamptz NOT NULL DEFAULT now(),
  "updated_at"       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "widget_client_credits" (
  "widget_client_id" uuid PRIMARY KEY REFERENCES "widget_clients"("id") ON DELETE CASCADE,
  "balance"          integer NOT NULL DEFAULT 0,
  "updated_at"       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "widget_credit_ledger" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "widget_client_id" uuid NOT NULL REFERENCES "widget_clients"("id") ON DELETE CASCADE,
  "delta"            integer NOT NULL,
  "reason"           text NOT NULL,
  "job_id"           uuid,
  "admin_id"         uuid,
  "created_at"       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "jobs"
  ADD COLUMN "widget_client_id"    uuid REFERENCES "widget_clients"("id") ON DELETE SET NULL,
  ADD COLUMN "customer_photo_key"  text;
```

Update `packages/db/src/migrations/meta/_journal.json` — add entry for `0054_widget_clients`.

---

## 2. packages/types additions

### New file: `packages/types/src/widget.ts`

```typescript
import { z } from 'zod';

export const WidgetClientSignup = z.object({
  companyName: z.string().min(1),
  contactName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(1),
  websiteUrl: z.string().url(),
  companySize: z.enum(['1-10', '11-50', '51-200', '200+']),
  purpose: z.enum(['ecommerce', 'fashion_brand', 'tailoring', 'marketplace', 'enterprise']),
  businessAddress: z.string().min(1),
  password: z.string().min(8),
});
export type WidgetClientSignup = z.infer<typeof WidgetClientSignup>;

export const WidgetClientLogin = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type WidgetClientLogin = z.infer<typeof WidgetClientLogin>;

export const WidgetJobRequest = z.object({
  garmentImageUrl: z.string().url(), // public product image URL from merchant page
  customerPhotoKey: z.string(),      // R2 key after customer uploads their photo
  aspectRatio: z.enum(['1:1', '2:3', '3:4', '4:5']).default('2:3'),
});
export type WidgetJobRequest = z.infer<typeof WidgetJobRequest>;

export const WidgetPresignRequest = z.object({
  contentType: z.string(),
  contentLength: z.number().int().positive().max(10 * 1024 * 1024), // 10MB max
});
export type WidgetPresignRequest = z.infer<typeof WidgetPresignRequest>;

export const WidgetConfigResponse = z.object({
  widgetClientId: z.string().uuid(),
  companyName: z.string(),
  isActive: z.boolean(),
});
export type WidgetConfigResponse = z.infer<typeof WidgetConfigResponse>;
```

Re-export in `packages/types/src/index.ts`:
```typescript
export * from './widget.js';
```

---

## 3. API — New middleware: `requireWidgetClient`

### New file: `apps/api/src/plugins/widget-auth.ts`

```typescript
import fp from 'fastify-plugin';
import { AppError } from '../lib/errors.js';
import * as schema from '@aivastra/db/schema';
import { eq } from 'drizzle-orm';

export const widgetAuthPlugin = fp(async (app) => {
  app.decorate('requireWidgetClient', async (req, _reply) => {
    const key = req.headers['x-widget-key'];
    if (!key || typeof key !== 'string') {
      throw new AppError('UNAUTHORIZED', 401, 'Missing X-Widget-Key header');
    }
    const [client] = await app.db
      .select()
      .from(schema.widgetClients)
      .where(eq(schema.widgetClients.widgetKey, key))
      .limit(1);
    if (!client || !client.isActive) {
      throw new AppError('UNAUTHORIZED', 401, 'Invalid or inactive widget key');
    }
    req.widgetClientId = client.id;
    req.widgetClient = client;
  });
});
```

### Modify: `apps/api/src/types/fastify.d.ts`

Add to FastifyRequest and FastifyInstance interfaces:
```typescript
import type { widgetClients } from '@aivastra/db/schema';
import type { InferSelectModel } from 'drizzle-orm';

declare module 'fastify' {
  interface FastifyRequest {
    widgetClientId?: string;
    widgetClient?: InferSelectModel<typeof widgetClients>;
  }
  interface FastifyInstance {
    requireWidgetClient: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
```

Register in `apps/api/src/server.ts` after other plugins:
```typescript
import { widgetAuthPlugin } from './plugins/widget-auth.js';
await app.register(widgetAuthPlugin);
```

---

## 4. Widget credit helpers

### New file: `apps/api/src/modules/widget/ledger.ts`

Mirror `apps/api/src/modules/credits/ledger.ts` exactly but for widget credit tables.
Functions to implement:

```typescript
// Deduct credits atomically inside a transaction. Throws AppError('INSUFFICIENT_CREDITS', 402) if balance < amount.
export async function atomicWidgetDeduct(
  tx: DbTransaction,
  widgetClientId: string,
  amount: number,
  jobId: string,
): Promise<void>

// Idempotent refund — checks ledger for existing refund for jobId+reason before inserting.
export async function widgetRefund(
  db: Db,
  widgetClientId: string,
  amount: number,
  jobId: string,
  reason: string,
): Promise<void>

// Admin credit top-up — upserts widget_client_credits and inserts ledger entry.
export async function widgetAdminGrant(
  db: Db,
  widgetClientId: string,
  amount: number,
  reason: string,
  adminId: string,
): Promise<void>
```

Tables used: `widget_client_credits` (balance column), `widget_credit_ledger`.
Pattern is identical to existing ledger — substitute table names only.

---

## 5. API Routes

### New file: `apps/api/src/modules/merchant/routes.ts`

Merchant auth — JWT with `audience: 'merchant'` using existing `signAccess` from `apps/api/src/modules/auth/service.ts`.

```
POST /v1/merchant/signup
  Body: WidgetClientSignup
  - hashPassword(body.password)  [from apps/api/src/modules/auth/service.ts]
  - INSERT widgetClients row
  - INSERT widgetClientCredits row with balance: 0
  - return 201 { id, email, companyName, widgetKey }

POST /v1/merchant/login
  Body: WidgetClientLogin
  - SELECT widgetClients WHERE email = body.email
  - verifyPassword(client.passwordHash, body.password)
  - if !client.isActive → throw AppError('FORBIDDEN', 403, 'Account inactive')
  - signAccess(JWT_SECRET, client.id, { email: client.email }, '30d', 'merchant')
  - set httpOnly cookie 'merchant_access_token':
      { httpOnly: true, sameSite: 'lax', path: '/', secure: prod, maxAge: 30d }
  - return 200 { accessToken }

POST /v1/merchant/logout
  - clear cookie 'merchant_access_token'
  - return 204

GET /v1/merchant/me
  preHandler: requireMerchant  (reads merchant_access_token cookie or Authorization header,
                                verifyAccess with audience: 'merchant', sets req.merchantClientId)
  - SELECT widgetClients + widgetClientCredits WHERE id = req.merchantClientId
  - return { id, companyName, contactName, email, phone, websiteUrl,
             widgetKey, creditBalance, isActive, createdAt }

GET /v1/merchant/jobs
  preHandler: requireMerchant
  - SELECT jobs WHERE widget_client_id = req.merchantClientId ORDER BY created_at DESC LIMIT 50
  - return { jobs: [{ id, status, credits_charged, created_at, completed_at }] }
```

`requireMerchant` decorator — same pattern as `requireUser` in `apps/api/src/plugins/auth.ts`
but reads `merchant_access_token` cookie and checks `audience === 'merchant'`.
Add it to `apps/api/src/plugins/widget-auth.ts` alongside `requireWidgetClient`.

---

### New file: `apps/api/src/modules/widget/routes.ts`

```
GET /v1/widget/config/:key
  No auth — fully public
  - SELECT widgetClients WHERE widget_key = params.key
  - if not found or !isActive → 404
  - return { widgetClientId, companyName, isActive }

POST /v1/widget/presign
  preHandler: app.requireWidgetClient
  Body: WidgetPresignRequest { contentType, contentLength }
  - validate contentType is image/* 
  - generate R2 key: widget-inputs/<widgetClientId>/<uuid>/<filename>
  - call storage.presignPut(key, contentType, contentLength, 300)
  - store upload ownership in Redis: SET widget:upload:<key> <widgetClientId> EX 600
  - return { uploadUrl, r2Key, expiresIn }

POST /v1/widget/jobs
  preHandler: app.requireWidgetClient
  Body: WidgetJobRequest { garmentImageUrl, customerPhotoKey, aspectRatio }
  
  Validation:
  - verify customerPhotoKey starts with 'widget-inputs/<widgetClientId>/'
    (prevents using another merchant's customer photo)
  - verify Redis key widget:upload:<customerPhotoKey> exists (upload ownership)
  - storage.headObject(customerPhotoKey) — confirm file exists in R2
  - fetch garmentImageUrl HEAD to confirm it's reachable (5s timeout)
  
  Processing:
  - download garmentImageUrl (max 10MB, 15s timeout)
  - upload to R2 at key: widget-garments/<widgetClientId>/<uuid>/garment.<ext>
    using storage.putObject()
  
  Job creation (single DB transaction):
  - INSERT jobs { widget_client_id, customer_photo_key: customerPhotoKey,
                  status: 'QUEUED', credits_charged: WIDGET_JOB_COST }
  - INSERT job_inputs { upper_garment_key: garmentR2Key, ... }
    NOTE: face_id, background_id, pose_id are null for widget jobs
  - atomicWidgetDeduct(tx, widgetClientId, WIDGET_JOB_COST, jobId)
  
  Enqueue:
  - XADD jobs:normal { jobId, type: 'WIDGET_TRYON' }
    (widget jobs always normal priority — no tier system)
  
  return 201 { jobId }

GET /v1/widget/jobs/:id
  preHandler: app.requireWidgetClient
  - SELECT jobs WHERE id = params.id AND widget_client_id = req.widgetClientId
  - if not found → 404
  - return { id, status, resultKey, error, createdAt, completedAt }

GET /v1/widget/jobs/:id/events
  preHandler: app.requireWidgetClient
  - SSE stream — same pattern as existing /v1/jobs/:id/events in apps/api/src/modules/jobs/routes.ts
  - verify job belongs to this widgetClientId before streaming
  - stream job_events until status COMPLETED or FAILED
  - on COMPLETED: include resultUrl = storage.publicUrl(resultKey)
```

**`WIDGET_JOB_COST`** — define as a constant (e.g. `10` credits). Exact value to be decided by business.

---

### New file: `apps/api/src/modules/admin/widget-clients.routes.ts`

```
GET /v1/admin/widget-clients
  preHandler: requireAdmin(['SUPER_ADMIN', 'ADMIN'])
  Query: { page?, limit?, search? }
  - paginated SELECT widgetClients JOIN widgetClientCredits
  - search by email or companyName (ILIKE)
  - return { clients: [...], total, page, limit }

POST /v1/admin/widget-clients
  preHandler: requireAdmin(['SUPER_ADMIN'])
  Body: WidgetClientSignup & { initialCredits?: number }
  - same as merchant signup
  - if initialCredits > 0: widgetAdminGrant(db, clientId, initialCredits, 'Initial grant', adminId)
  - return 201 { id, widgetKey }

GET /v1/admin/widget-clients/:id
  preHandler: requireAdmin(['SUPER_ADMIN', 'ADMIN'])
  - full detail: client + creditBalance + last 20 ledger entries + last 20 jobs

PATCH /v1/admin/widget-clients/:id
  preHandler: requireAdmin(['SUPER_ADMIN'])
  Body: { isActive?, companyName?, allowedOrigins? }
  - partial UPDATE widgetClients
  - return updated client

POST /v1/admin/widget-clients/:id/credits
  preHandler: requireAdmin(['SUPER_ADMIN'])
  Body: { amount: number (positive int), reason: string }
  - widgetAdminGrant(db, params.id, body.amount, body.reason, req.adminId)
  - return { newBalance }
```

### Register in `apps/api/src/server.ts`:

```typescript
import { widgetAuthPlugin }        from './plugins/widget-auth.js';
import { merchantRoutes }          from './modules/merchant/routes.js';
import { widgetRoutes }            from './modules/widget/routes.js';
import { adminWidgetClientsRoutes } from './modules/admin/widget-clients.routes.js';

// after existing plugins:
await app.register(widgetAuthPlugin);

// after existing user routes:
await app.register(merchantRoutes);
await app.register(widgetRoutes);

// after existing admin routes:
await app.register(adminWidgetClientsRoutes);
```

---

## 6. Dispatcher changes (PARTIAL — awaiting workflow JSON)

### What is known:

Widget jobs are identified by `job.widgetClientId !== null` OR by a new `type` field on the Redis stream message. The dispatcher must handle `WIDGET_TRYON` differently from the standard catalogue job:

- **Input 1:** customer photo — already in R2 at `customerPhotoKey` (no upload needed)
- **Input 2:** garment image — already in R2 at `upper_garment_key` on `job_inputs`
- **No face/pose/background patching** — these fields are null for widget jobs
- **Single output** — one generated image (not multiple poses)
- **Refund on failure:** call `widgetRefund(db, widgetClientId, creditsCharged, jobId, 'FAILED')`

### What needs the workflow JSON (TO BE DONE after VPS is located):

The workflow JSON must be exported from ComfyUI in API format (`Workflow → Export (API format)`).
From that JSON, identify:

- Node ID for customer photo input (LoadImage node)
- Node ID for garment image input (LoadImage node)
- Node ID for the output image (SaveImage node)
- Any parameter nodes (steps, cfg, etc.)

Then create:
- `templates/qwen-widget-tryon-v1.json` — the workflow template file
- `workflow_templates` DB row for the widget workflow
- New patcher logic in `apps/dispatcher/src/workflow/patcher.ts` for widget jobs
  (patch customer photo node + garment node, skip face/pose/bg)

### Placeholder in dispatcher: `apps/dispatcher/src/job/processor.ts`

Add a branch for widget jobs:
```typescript
if (job.widgetClientId) {
  return await processWidgetJob(job, worker, log);
}
// existing catalogue job logic continues...
```

`processWidgetJob` — to be implemented once workflow JSON is obtained.

---

## 7. Web — apps/web new pages

### Route group: `apps/web/src/app/(widget)/`

No navbar, no sidebar, iframe-optimised. Minimal layout.

**`apps/web/src/app/(widget)/layout.tsx`**
```tsx
export default function WidgetLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#fff', fontFamily: 'system-ui, sans-serif' }}>
        {children}
      </body>
    </html>
  );
}
```

**`apps/web/src/app/(widget)/widget/render/[key]/page.tsx`**

`'use client'` component. Complete flow:

```
State machine steps:
  'validating'  → on mount: GET /v1/widget/config/:key
  'waiting'     → config loaded, waiting for postMessage INIT_TRYON from parent
  'uploading'   → customer is uploading their photo (file picker shown)
  'processing'  → job submitted, SSE open, waiting for result
  'result'      → result image ready, show download button
  'error'       → any failure, show retry button

Step UI (shown in the 437px wide iframe):

── VALIDATING ──
  Loading spinner + "Powered by Aivastra"

── WAITING ──
  This state is very brief, normally skipped since INIT_TRYON fires on iframe.onload.
  Show spinner. Parent page sends: postMessage({ type: 'INIT_TRYON', payload: { garment_image } })

── UPLOADING ──
  Top: small preview of the garment image (from garmentImageUrl)
  Center:
    Upload zone (dashed border, click or drag):
      Icon + "Upload your photo"
      Subtext: "Full body or half body photo works best"
    OR after selection: photo preview thumbnail + "Change photo" link
  Progress bar during upload (XHR PUT to presigned R2 URL)
  Bottom: "Generate Try-On →" GradBtn (disabled until upload complete)

── PROCESSING ──
  Garment preview (small, top)
  Customer photo preview (small, top, next to garment)
  Center: animated spinner / progress indicator
  Text: "Generating your try-on..." + estimated time "Usually takes 30–60 seconds"
  SSE: GET /v1/widget/jobs/:id/events with X-Widget-Key header

── RESULT ──
  Full-width result image
  Two buttons: "Download" (anchor download) | "Try Another Photo" (reset to UPLOADING)
  Close button (X) top right → postMessage({ type: 'TRYON_CLOSED' }, '*')

── ERROR ──
  Error message
  "Try Again" button → reset to UPLOADING

API calls from widget page (all include header X-Widget-Key: params.key):
  GET /v1/widget/config/:key          — on mount
  POST /v1/widget/presign             — before upload
  PUT <presigned R2 url>              — direct browser upload (XHR for progress)
  POST /v1/widget/jobs                — after upload complete
  GET /v1/widget/jobs/:id/events      — SSE for progress
```

Design tokens: use `C` from `@/components/tokens` and `grad` (pink→amber gradient) to match Aivastra brand. Close button and "Powered by Aivastra" footer badge always visible.

---

### Route group: `apps/web/src/app/(merchant)/`

Merchant portal — separate from `(app)` (studio) and `(auth)` (user login).

**`apps/web/src/app/(merchant)/layout.tsx`**
- Minimal top navbar: Aivastra logo left, "Merchant Portal" label, Logout button right
- No sidebar

**`apps/web/src/app/(merchant)/merchant/signup/page.tsx`**
- `'use client'` with React Hook Form + zodResolver(WidgetClientSignup)
- Same split-panel layout as `/register` — reuse `LogoAuth` and `C` tokens
- Fields in order:
  1. Company Name
  2. Your Name
  3. Email Address
  4. Phone Number
  5. Website URL
  6. Company Size (select: 1-10, 11-50, 51-200, 200+)
  7. Purpose (select: E-commerce, Fashion Brand, Tailoring, Marketplace, Enterprise)
  8. Business Address
  9. Password
  10. Confirm Password
  11. Checkbox: agree to Terms & Privacy Policy
- POST to `/api/merchant/signup` (BFF)
- On success → redirect to `/merchant/dashboard`

**`apps/web/src/app/(merchant)/merchant/login/page.tsx`**
- Email + Password fields
- POST to `/api/merchant/login`
- On success → redirect to `/merchant/dashboard`
- Reuse `LogoAuth`, `C` tokens

**`apps/web/src/app/(merchant)/merchant/dashboard/page.tsx`**
- Server component — reads `merchant_access_token` cookie, calls `GET /v1/merchant/me`
- If no cookie → redirect to `/merchant/login`
- Layout: 3 cards across the top, jobs table below

Card 1 — **Widget Key**
```
Your Widget Key
[ abc123-xxxx-xxxx-xxxx ]  [Copy]
```

Card 2 — **Embed Code**
```
Add this to your product page:

<script>
  window.AIVASTRA_WIDGET = { widget_key: "YOUR_KEY" };
</script>
<script src="https://app.aivastra.com/widget/loader.js"></script>

Then trigger the widget on your "Try Now" button:
  AIVASTRA_OPEN_WIDGET({ garment_image: "YOUR_PRODUCT_IMAGE_URL" })
```
Copy button for the full snippet.

Card 3 — **Credits**
```
Credit Balance
1,240 credits

[Request Credits →]
```

Below cards: **Recent Jobs** table
Columns: Date | Status | Credits Used
Last 20 rows from `GET /v1/merchant/jobs`

---

### BFF API routes: `apps/web/src/app/api/merchant/`

**`signup/route.ts`**
```typescript
// POST: forward body to Fastify POST /v1/merchant/signup
// On success: set cookie merchant_access_token (30d, httpOnly, sameSite: lax)
// return { ok: true }
```

**`login/route.ts`**
```typescript
// POST: forward body to Fastify POST /v1/merchant/login
// On success: set cookie merchant_access_token (30d, httpOnly, sameSite: lax)
// return { ok: true }
```

**`logout/route.ts`**
```typescript
// POST: delete cookie merchant_access_token
// return 204
```

Cookie helper: mirror existing pattern in `apps/web/src/lib/auth-cookies.ts`.

---

### Middleware update: `apps/web/src/middleware.ts`

Add to **protected** routes (check `merchant_access_token` cookie):
```
/merchant/dashboard
```

Add to **public** routes (no auth check):
```
/merchant/signup
/merchant/login
/widget/render    ← entire /widget/* subtree is public (widget key = auth)
```

---

## 8. Static widget loader

### File: `apps/web/public/widget/loader.js`

Copy the `loadernew.js` content from the senior's code. Update one line:

```javascript
// CHANGE:
iframe.src = "https://api.aivastra.com/widget/render/" + window.AIVASTRA_WIDGET.widget_key;
// TO:
iframe.src = "https://app.aivastra.com/widget/render/" + window.AIVASTRA_WIDGET.widget_key;
```

This file is served as a static asset at `https://app.aivastra.com/widget/loader.js`.
Merchants include it via:
```html
<script src="https://app.aivastra.com/widget/loader.js"></script>
```

---

## 9. Admin SPA — apps/admin

Add a "Widget Clients" section to the existing Vite React admin panel.

### New file: `apps/admin/src/pages/WidgetClients.tsx`

Table columns: Company | Email | Widget Key (truncated + copy) | Credits | Status | Actions
Actions: View, Deactivate/Activate

### New file: `apps/admin/src/pages/WidgetClientDetail.tsx`

Sections:
1. **Info** — all client fields, editable (PATCH endpoint)
2. **Status** — Active/Inactive toggle button
3. **Credits** — current balance + form: Amount + Reason + "Add Credits" button
4. **Recent Jobs** — last 20 widget jobs for this client

Wire into `apps/admin/src/App.tsx`:
```tsx
<Route path="/widget-clients" element={<WidgetClients />} />
<Route path="/widget-clients/:id" element={<WidgetClientDetail />} />
```

Add to `apps/admin/src/components/Sidebar.tsx`:
```tsx
<NavItem to="/widget-clients" icon={<WidgetIcon />} label="Widget Clients" />
```

---

## 10. Complete File Tree

### New files:
```
packages/db/src/schema/widget.ts
packages/db/src/migrations/0054_widget_clients.sql

packages/types/src/widget.ts

apps/api/src/plugins/widget-auth.ts
apps/api/src/modules/merchant/routes.ts
apps/api/src/modules/widget/routes.ts
apps/api/src/modules/widget/ledger.ts
apps/api/src/modules/admin/widget-clients.routes.ts

apps/web/src/app/(widget)/layout.tsx
apps/web/src/app/(widget)/widget/render/[key]/page.tsx
apps/web/src/app/(merchant)/layout.tsx
apps/web/src/app/(merchant)/merchant/signup/page.tsx
apps/web/src/app/(merchant)/merchant/login/page.tsx
apps/web/src/app/(merchant)/merchant/dashboard/page.tsx
apps/web/src/app/api/merchant/signup/route.ts
apps/web/src/app/api/merchant/login/route.ts
apps/web/src/app/api/merchant/logout/route.ts
apps/web/public/widget/loader.js

apps/admin/src/pages/WidgetClients.tsx
apps/admin/src/pages/WidgetClientDetail.tsx

templates/qwen-widget-tryon-v1.json        ← PLACEHOLDER: add after VPS located
```

### Modified files:
```
packages/db/src/schema/index.ts            — add export * from './widget.js'
packages/db/src/schema/jobs.ts             — add widgetClientId, customerPhotoKey columns
packages/db/src/migrations/meta/_journal.json — add 0054 entry

packages/types/src/index.ts               — add export * from './widget.js'

apps/api/src/server.ts                    — register widgetAuthPlugin + 3 new route modules
apps/api/src/types/fastify.d.ts           — add widgetClientId, widgetClient, requireWidgetClient types
apps/api/src/job/processor.ts             — add widget job branch (PARTIAL — awaiting workflow)

apps/web/src/middleware.ts                — add merchant/widget route rules

apps/admin/src/App.tsx                    — add WidgetClients routes
apps/admin/src/components/Sidebar.tsx     — add Widget Clients nav item
```

---

## 11. Build Order

```
Step 1 — DB (blocker for everything else)
  - Create packages/db/src/schema/widget.ts
  - Modify packages/db/src/schema/jobs.ts (add 2 columns)
  - Re-export from packages/db/src/schema/index.ts
  - Write 0054_widget_clients.sql
  - Update _journal.json
  - Run: pnpm db:migrate

Step 2 — Types
  - Create packages/types/src/widget.ts
  - Re-export from packages/types/src/index.ts
  - Run: pnpm --filter @aivastra/types build

Step 3 — API auth plugin
  - Create apps/api/src/plugins/widget-auth.ts
  - Update apps/api/src/types/fastify.d.ts
  - Register in apps/api/src/server.ts

Step 4 — Widget credit ledger
  - Create apps/api/src/modules/widget/ledger.ts

Step 5 — API routes
  - Create apps/api/src/modules/merchant/routes.ts
  - Create apps/api/src/modules/widget/routes.ts
  - Create apps/api/src/modules/admin/widget-clients.routes.ts
  - Register all three in apps/api/src/server.ts

Step 6 — Web BFF routes
  - Create apps/web/src/app/api/merchant/{signup,login,logout}/route.ts

Step 7 — Web middleware
  - Update apps/web/src/middleware.ts

Step 8 — Merchant portal pages
  - (merchant)/layout.tsx
  - merchant/signup/page.tsx
  - merchant/login/page.tsx
  - merchant/dashboard/page.tsx

Step 9 — Widget iframe page
  - (widget)/layout.tsx
  - widget/render/[key]/page.tsx

Step 10 — Static loader
  - Copy loadernew.js → apps/web/public/widget/loader.js
  - Update iframe src domain

Step 11 — Admin SPA
  - WidgetClients.tsx + WidgetClientDetail.tsx
  - Wire into App.tsx + Sidebar.tsx

Step 12 — Dispatcher (BLOCKED: needs workflow JSON)
  - Get workflow JSON from VPS (export from ComfyUI → API format)
  - Save as templates/qwen-widget-tryon-v1.json
  - Add workflow_templates DB row with node ID mappings
  - Implement processWidgetJob() in processor.ts
  - Add patcher logic for widget job type
```

---

## 12. Verification

### After Step 5 (API routes):
```bash
# Merchant signup
curl -X POST http://localhost:4000/v1/merchant/signup \
  -H "Content-Type: application/json" \
  -d '{"companyName":"Test Co","contactName":"John","email":"merchant@test.com",
       "phone":"9999999999","websiteUrl":"https://test.com","companySize":"1-10",
       "purpose":"ecommerce","businessAddress":"123 Street","password":"password123"}'
# Expect: { id, email, companyName, widgetKey }

# Widget config (public)
curl http://localhost:4000/v1/widget/config/<WIDGET_KEY>
# Expect: { widgetClientId, companyName, isActive: true }

# Admin grant credits (need admin token first)
curl -X POST http://localhost:4000/v1/admin/widget-clients/<ID>/credits \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{"amount":100,"reason":"Trial grant"}'
# Expect: { newBalance: 100 }

# Widget presign
curl -X POST http://localhost:4000/v1/widget/presign \
  -H "X-Widget-Key: <WIDGET_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"contentType":"image/jpeg","contentLength":500000}'
# Expect: { uploadUrl, r2Key, expiresIn }
```

### After Step 9 (Widget iframe):
1. Open `http://localhost:3000/widget/render/<WIDGET_KEY>` in browser
2. In console: `window.postMessage({ type: 'INIT_TRYON', payload: { garment_image: 'https://example.com/shirt.jpg' } }, '*')`
3. Verify: upload zone appears showing the garment image preview
4. Upload a test photo → verify progress bar works → verify "Generate Try-On" button enables
5. Submit → verify job created → SSE events stream in Network tab

### After Step 11 (Admin SPA):
1. Open `http://localhost:5173/widget-clients`
2. Merchant created above appears in list
3. Click → detail page shows, add 50 credits → verify balance updates

### After Step 12 (Dispatcher — once workflow JSON is obtained):
1. Create a widget job via curl (Step 5 above)
2. Watch dispatcher logs: should pick up `WIDGET_TRYON` job type, patch workflow, submit to ComfyUI
3. Job status → COMPLETED, result image accessible via storage.publicUrl(resultKey)
4. Full iframe flow: garment_image → upload photo → Generate → result displayed

---

## Open Items (must resolve before Step 12)

| Item | Owner | Action |
|---|---|---|
| Locate VPS with customer try-on workflow | Senior/colleague | Identify IP/hostname |
| Export workflow JSON from ComfyUI | VPS owner | Workflow → Export (API format) |
| Identify node IDs in workflow | OpenCode | After JSON obtained: find LoadImage nodes for person + garment, SaveImage output node |
| Decide WIDGET_JOB_COST (credits per job) | Business decision | Set constant in widget/routes.ts |
