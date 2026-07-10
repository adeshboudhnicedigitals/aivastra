# Phase 6 — Merchant Catalogue Manager

> Status: **Planned** (UI prototype built in `apps/catalogues-web`; backend not yet implemented)
> Depends on: Phase 2 (merchant portal / identity unification), the existing studio pipeline (catalogue creation)

---

## 1. Context & product framing

The company sells **two products**. Every web app, mobile app, and e‑commerce plugin is only an *integration surface* over these two — the products are the fixed core:

1. **Catalogue creation** — turns a flat garment image into photoshoot-style images (model + background + pose). This is the existing **studio pipeline**.
2. **Virtual try-on** — lets a customer see how a product looks on themselves, using catalogue images that already contain a model (kiosk / mobile / e‑commerce plugins).

Target market: clothing merchants and retailers who manufacture garments but can't justify the cost of physical photoshoots for a catalogue, and retailers who want to cut physical try‑on friction and reduce e‑commerce returns/refunds.

### What a "merchant" is

A merchant is **not** a separate identity or a separate pipeline. It is a **user** who purchased a plan and was then admin‑enabled for virtual try‑on. This was unified earlier in the multi-app work: a merchant **is** a `users` row (`merchants.userId`), and `requireMerchant` authorizes off the user's own catalogues-web session (no separate merchant login/token).

### What this phase adds

A **Catalogue Manager** in the merchant-facing surface where a merchant organizes the products their virtual try‑on will display:

```
Category (fixed: Men / Women / Boys / Girls)
  └── Subcategory (merchant-created, dynamic — e.g. "Casual Shirts")
        └── Product (SKU, actual price, offer price, image)
```

- **Categories** are fixed (Men / Women / Boys / Girls), same as admin.
- **Subcategories** are merchant-created and dynamic (add/rename/delete). Each subcategory is attached to one **admin-defined garment type** (e.g. "Shirt", "Saree"). Many subcategories may point at the same garment type (many-to-one). The garment type is what carries the try‑on workflow binding.
- **Products** live under a subcategory and carry SKU + actual price + offer price + an image. Prices are **display-only** (no checkout/payment on this platform).

### The key architectural realization

A merchant "generating a catalogue image from a flat garment" **is product #1 (catalogue creation)**, run by a user, with the creative inputs locked down. It is an **ordinary `jobs.userId`-owned studio job**.

Consequences:
- **No dispatcher changes.** Because the job is `userId`-owned, `transitionJob` / `terminateJob` / credit refund / SSE all work natively. (There is deep `userId` coupling in the dispatcher's regular pipeline — SSE channel `sse:events:${userId}`, refund against `userCredits`/`credit_ledger` — that would break for a `merchantId`-owned job. This feature avoids all of it by simply not creating merchant‑owned jobs.)
- **No new workflow type, no new processor, no new queue, no owner-aware refactor.**

---

## 2. Two ways an image enters a virtual-try-on product

Both are kept. Both end in the same operation: copy a completed studio job's **output** into a `merchant_catalog_items` row.

### Path A — Import from the catalogues page (already exists)
In the studio a user generates a spread of poses / models / backgrounds; some are try‑on-suitable, some aren't. The user hand-picks the good ones and pushes them into products. This is the existing `GET /v1/merchant/catalogue s` + `POST /v1/merchant/catalog/import` flow — **kept as-is**, just surfaced from the new UI.

### Path B — Constrained generate (new)
The merchant uploads **only the garment image**. Background, model, and pose are **fixed and admin-controlled** — the merchant gets no creative freedom here, by design, so every generated image is guaranteed suitable for virtual try‑on. This runs the **same studio engine** with inputs locked instead of user-chosen.

Path B has a **single** and a **bulk** variant (upload many flat images at once, generate them as a queue).

---

## 3. Credits

| Action | Credit pool | Mechanism |
|--------|-------------|-----------|
| Catalogue creation — studio **and** merchant generate (Path B) | **User / studio pool** (`userCredits` / `credit_ledger`) | existing `atomicDeduct` / `refund` |
| Each virtual try‑on at kiosk / mobile | `merchant_credits` / `merchant_credit_ledger` | already built (kiosk work) — out of scope here |

Because Path B generation uses the user/studio pool via `userId`-owned jobs, credit deduction and failure-refund are entirely native and unchanged.

---

## 4. Data model

All in `packages/db/src/schema/merchant.ts` unless noted.

### New table `merchant_catalog_subcategories`
```ts
export const merchantCatalogSubcategories = pgTable('merchant_catalog_subcategories', {
  id: uuid('id').primaryKey().defaultRandom(),
  merchantId: uuid('merchant_id').notNull()
    .references(() => merchants.id, { onDelete: 'cascade' }),
  category: text('category').notNull(),            // 'men' | 'women' | 'boys' | 'girls'
  name: text('name').notNull(),                     // merchant free-text
  garmentSubcategoryId: uuid('garment_subcategory_id').notNull()
    .references(() => garmentSubcategories.id),      // admin garment type — drives workflow; many→one
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('merchant_catalog_subcategories_merchant_idx').on(t.merchantId, t.category)]);
```
Imports `garmentSubcategories` from `./models.js`. No cascade on the garment-type FK (admin rows aren't hard-deleted in practice).

### Modify `merchant_catalog_items`
- **Drop** `gender`, `category` (free-text) — now derivable via `subcategoryId → category`.
- **Add:**
  - `subcategoryId uuid notNull references(merchant_catalog_subcategories, onDelete: 'cascade')` — deleting a subcategory cascades its products (confirmed delete behavior).
  - `actualPricePaise integer notNull`
  - `offerPricePaise integer notNull`
  - `sourceKind text notNull default 'uploaded'` — `'uploaded' | 'generated' | 'imported'`
  - `flatSourceKey text` (nullable) — the original flat upload, set only when `sourceKind='generated'`
- Keep existing `sourceJobId` (both `imported` and `generated` reference a real job).
- **Prices in paise** (integers) — matches `credit_plans` / `merchant_payments`; convert to/from rupees at the route boundary. Never store rupee floats.
- `sourceKind` becomes a stored field, replacing the computed `sourceJobId ? 'imported' : 'uploaded'` in `serializeCatalogItem`.

### Admin: default pose per garment type
New nullable column in `packages/db/src/schema/models.ts`:
```ts
// on garment_subcategories
defaultPoseId: uuid('default_pose_id').references(() => modelPoseAssets.id, { onDelete: 'set null' }),
```
Pose lives on the garment type because pose selection drives workflow selection (`model_pose_assets.workflowTemplateId` / `pose_garment_configs`). Null → Path B generation is unavailable for that type (clear 400).

### Gender vocabulary
Standardize `category` and all lookups on **`men / women / boys / girls`** (plural — what `model_faces.gender` uses). Confirm `garment_subcategories.genderSlug`'s actual values at implementation and align. Do **not** reuse the singular `MerchantCatalogGender` (`boy / girl`) enum — that's the known-inconsistent one.

---

## 5. Admin configuration (the fixed generate inputs)

These make Path B "constrained". Both are prerequisites for Phase 3 below.

### 5a. Pose — per garment type
`garment_subcategories.defaultPoseId` (above). Edited on the garment-type/subcategories admin editor in `apps/admin-web`.

### 5b. Face + background — per category, plus a default aspect ratio
Extend the existing `config:system` Redis JSON blob — the same mechanism `maxOutputPx` already uses (`apps/api/src/lib/resolution-config.ts`, exposed via `GET/PATCH /admin/config`):
```ts
merchantCatalogDefaults: {
  men?:   { faceId: string; backgroundId: string },
  women?: { faceId: string; backgroundId: string },
  boys?:  { faceId: string; backgroundId: string },
  girls?: { faceId: string; backgroundId: string },
}
merchantCatalogAspectRatio: '2:3'   // no per-item resolution picking
```
No new table — genuine key-value config with an existing admin-UI-wired pattern.

### Admin UI
- A "Default pose (merchant catalogue generation)" field on the garment-type editor.
- One new card in `apps/admin-web/src/pages/SettingsPage.tsx`: 4 rows (Men / Women / Boys / Girls), each with a face picker + a background picker, reusing the existing admin asset pickers. Same size/shape as the "Max Output Resolution" card.

> **Granularity note:** the recommendation is pose *per garment type* + face/background *per category* (the model's look is gender-bound; pose must be per-type for the workflow). Making all three per garment type is a trivial alternative if preferred.

---

## 6. API surface

Everything under `apps/api/src/modules/merchant/catalog.routes.ts`, all `requireMerchant`, ownership-checked against `req.merchantClientId`.

### Subcategory CRUD (Phase 1)
| Method + Path | Notes |
|---|---|
| `GET /v1/merchant/catalog/subcategories` | list caller's subcategories (optionally filtered by category) |
| `POST /v1/merchant/catalog/subcategories` | `{ category, name, garmentSubcategoryId }` |
| `PATCH /v1/merchant/catalog/subcategories/:id` | rename / reorder / re-point garment type |
| `DELETE /v1/merchant/catalog/subcategories/:id` | cascades products in DB; still runs R2 cleanup over each child product's `r2Key`/`thumbnailKey`/`flatSourceKey` (select children first, `Promise.allSettled([...deleteObject])`) |

### Product CRUD (Phase 1, updated)
Existing routes updated to take `subcategoryId` + `actualPrice`/`offerPrice` instead of `gender`/`category`; verify the subcategory belongs to the caller; reuse `assertMerchantUploadKey`. Presign (`/v1/merchant/catalog/presign`) unchanged.

### Generate — single (Phase 3)
| Method + Path | Notes |
|---|---|
| `POST /v1/merchant/catalog/generate` | `{ subcategoryId, flatImageKey }` → `{ jobId }`. Creates a **regular `userId` studio job** with admin-fixed inputs. |
| `GET /v1/merchant/catalog/generate/:jobId` | status poll — mirrors kiosk `GET /v1/kiosk/jobs/:id` (status, presigned result URL on COMPLETED, errorCode on FAILED) |

### Generate — bulk (Phase 4)
| Method + Path | Notes |
|---|---|
| `POST /v1/merchant/catalog/generate-bulk` | `{ subcategoryId, flatImageKeys[] }` → `{ jobIds[] }`. One `userId` job + one `atomicDeduct` per image; partial-failure tolerant. |
| `GET /v1/merchant/catalog/generate/status?jobIds=...` | batch status for the queue grid (one request for N) |

### Types
`packages/types/src/widget.ts`: extend `MerchantCatalogCreateBody`/`UpdateBody`/`Item` with `subcategoryId`, `actualPrice`, `offerPrice` (rupees on the wire), `sourceKind`; add `MerchantCatalogSubcategory` create/update/item schemas.

---

## 7. Generate handler design (Path B)

`POST /v1/merchant/catalog/generate`:
1. Resolve the caller's merchant subcategory → `garmentSubcategoryId` + `category` (ownership-checked).
2. Read `garment_subcategories.defaultPoseId` (400 if null: "admin has not configured a default pose for this garment type") and `config:system.merchantCatalogDefaults[category]` (400 if face/background missing).
3. Build a **regular studio job** by reusing the core of `createJob` (`apps/api/src/modules/jobs/create.ts`):
   - Same workflow resolution (`poseGarmentConfigs` override / `modelPoseAssets.workflowTemplateId` default, `create.ts:~207-245`).
   - Same active-asset validation (`create.ts:~131-160`).
   - Same `getMaxOutputPx` clamp and `getResolutionCreditCost` + `atomicDeduct` on **`userCredits`**.
   - Inputs are server-resolved/fixed: `faceId` + `backgroundId` from config, `poseId = defaultPoseId`, `garmentTypeId = garmentSubcategoryId`, `upperGarmentKey = flatImageKey`, aspect ratio from config.
   - `jobs.userId = req user's id`, `merchantId = null`, `watermark = false`, `queueStream = 'normal'`.
   - Tag `job_inputs.params.kind = 'merchant_catalog'` + `subcategoryId` for traceability.
   - **Prefer extracting a small shared core** from `createJob` (it currently accepts the client `CreateTryOnJobRequest` shape) so the merchant endpoint can pass server-resolved inputs without synthesizing a fake client body. If extraction is heavy, synthesize a body — decide at implementation.
4. Enqueue on `jobs:normal` exactly as `createJob` does (`XADD ... jobId, userId`). The dispatcher processes it as an ordinary studio job — **no dispatcher changes**.

**On COMPLETED → create the product (client-driven):** the finished studio output (`keys.output(jobId)` + its thumbnail) is copied into a `merchant-catalog/...` R2 key and a `merchant_catalog_items` row (`sourceKind='generated'`, `sourceJobId`, `flatSourceKey`, subcategory + SKU + prices). This is the **same "copy a completed job's output into a product" operation the existing `/import` route performs** — factor that copy into a shared helper used by both `/import` and the generate-completion path.

> Implementation check: verify exactly which key the current `/import` route copies — it must copy the job's **output**, not the source garment — and reconcile the shared helper accordingly.

Bulk (Phase 4) is architecturally just N × the above; the Redis Streams queue already provides "process as workers free up". The queue-grid UI batch-polls `.../generate/status`; each item's product is created on its own completion via the shared copy helper. No dependency on merchant SSE → still zero dispatcher changes.

---

## 8. Implementation phases

| Phase | Scope | Unlocks |
|-------|-------|---------|
| **1** | `merchant_catalog_subcategories` table; `merchant_catalog_items` column changes; subcategory + product CRUD; types | "Catalogue Image" direct-upload mode + existing import, fully working |
| **2** | `defaultPoseId` column; `config:system` defaults + aspect ratio; admin UI (garment-type editor field + Settings card) | Admin can configure the fixed generate inputs |
| **3** | `POST /v1/merchant/catalog/generate` + status poll; shared job-output→product copy helper | Path B single flat-image generation |
| **4** | `generate-bulk` + batch status endpoint | Path B bulk generation |

---

## 9. Verification

- `pnpm --filter @aivastra/db build` + `drizzle-kit generate` + apply; confirm **zero drift** (`drizzle-kit generate` reports "No schema changes").
- New `apps/api/test/integration/merchant-catalog-generate.test.ts`:
  - seed a garment type with `defaultPoseId` + `config:system.merchantCatalogDefaults`, `POST /v1/merchant/catalog/generate` → assert a `jobs` row with `userId` = the merchant's user and `merchantId` **null** (proves it's a studio job), `job_inputs` carries the fixed face/bg/pose, `userCredits` decremented.
  - `defaultPoseId` unset → **400**.
  - on a COMPLETED job, product-create copies output → `merchant_catalog_items` with `sourceKind='generated'`.
- Existing `merchant-catalog.test.ts` must still pass after the `gender/category → subcategoryId` change (update its seed helpers, as done for the earlier merchant-identity migration).
- Manual: `pnpm dev`, drive the built catalogues-web UI against the real endpoints — upload a flat garment, confirm a real ComfyUI catalogue image is generated with the admin-fixed model/background/pose and lands as a product; confirm importing an existing studio image (Path A) still works.

---

## 10. Critical files

- `apps/api/src/modules/jobs/create.ts` — `createJob` core to reuse (workflow resolution ~207-245, asset validation ~131-160, dims/cost/deduct/enqueue). **No merchantId path — these are `userId` jobs.**
- `apps/api/src/modules/merchant/catalog.routes.ts` — subcategory + product CRUD, presign, import; new generate endpoints; shared job-output→product copy helper.
- `apps/api/src/lib/resolution-config.ts` — `config:system` read/write to extend with `merchantCatalogDefaults` + aspect ratio.
- `packages/db/src/schema/merchant.ts` / `models.ts` — new table, item columns, `defaultPoseId`.
- `packages/types/src/widget.ts` — schema additions.
- `apps/admin-web/src/pages/SettingsPage.tsx` + garment-type editor — admin config UI.
- **Dispatcher: untouched.**

---

## 11. Out of scope (add only when the trigger fires)

- Checkout / payment on product prices (display-only for now).
- Merchant SSE for the bulk queue — polling suffices; add SSE only if polling proves too chatty at scale (would require making the shared `transitionJob` merchant-aware).
- Per-item creative control in Path B (that's what Path A / the studio is for).
- Recycle-bin parity for merchant catalog deletes (hard delete for v1).
