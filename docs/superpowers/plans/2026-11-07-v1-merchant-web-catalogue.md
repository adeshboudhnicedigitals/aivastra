# Merchant Web 3b Catalogue Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merchant admin and staff manage the brand's catalogue (subcategories, products, bulk upload, AI generation) from `/catalogue` in `apps/merchant-web`, with staff edits audited and staff deletes reversible.

**Architecture:** An additive API gate `requireMerchantTeam` lets owners and active staff reach the existing `/v1/merchant/catalog/*` routes; owners behave exactly as today. Staff item deletes become soft deletes (additive nullable columns) and every reader of `merchant_catalog_items` gains a `deleted_at IS NULL` predicate. The catalogue UI is a straight copy of catalogues-web's `/tryon` manager, adapted to merchant-web's client, tokens and BFF; `/tryon` is not touched.

**Tech Stack:** Fastify 5 + Drizzle (Postgres), Vitest integration harness (API); Next.js 15 / React 19, TanStack Query, Vitest (merchant-web).

**Spec:** `docs/superpowers/specs/2026-11-06-v1-merchant-web-catalogue-design.md`. Parent: `docs/superpowers/specs/2026-11-06-v1-merchant-web-design.md`. 3a plan for conventions: `docs/superpowers/plans/2026-11-06-v1-merchant-web-foundation.md`.

## Global Constraints

- Nothing may change behaviour for existing customers. `apps/catalogues-web` (incl. `/tryon`) is not edited. Owner behaviour on every `/v1/merchant/catalog/*` route is byte-for-byte unchanged (owner `DELETE` still hard-deletes and removes storage objects). Staff access is purely additive.
- Schema changes are additive and nullable only. No production DB work: migrations are generated locally and ship via push → CI/CD → `db:migrate:prod` (CLAUDE.md, Production safety). Rebuild `@aivastra/db` and `@aivastra/types` `dist` after editing them.
- Staff-initiated mutations are audited in the same transaction via `recordAudit(tx, …)` with actor role `MERCHANT_STAFF`; owner mutations are NOT newly audited.
- `is_active` on `merchant_catalog_items` carries admin moderation and is never reused for soft delete.
- Dropdowns use `PremiumSelect`, colours use `C` tokens (no raw hex), no `console.log`, copy catalogues-web code faithfully ("straight port: no redesign, no behaviour change") except where this plan names a deviation.
- Staff may trigger paid AI generation (spends the merchant wallet); the generate job carries `jobs.staff_id`.
- pnpm-lock.yaml in the working tree carries unrelated local changes: stage explicit paths only and never stage it unless a task says so.

## Rulings carried into this plan (controller decisions, spec open questions)

- Owner deletes stay hard (default). Restore UI is out of scope (default). Staff may generate (default).
- **Subcategory DELETE is owner-only.** The existing route cascades: deleting a subcategory hard-deletes every product in it and its R2 objects (`catalog.routes.ts` ~436-486). A staff member must not be able to do that irreversibly, and soft-deleting subcategories is out of scope. So `DELETE /v1/merchant/catalog/subcategories/:id` keeps `requireMerchant` (staff get 403) and the UI hides the delete control for staff. This narrows the spec's "subcategory create/update/delete" for staff to create/update. Cost if wrong: staff cannot remove a subcategory; the admin does it.

## Review Focus

- A staff token of merchant A must get 404 (never 200/403-leak) for merchant B's items, subcategories and generate jobs on every switched route.
- Soft-deleted items must vanish from: manager lists, the customer try-on garment resolution (404), `merchantCanReferenceCatalogItem`, the Android catalogue/demo reads, and admin moderation lists, but must still exist in the DB with storage objects intact.
- A staff `DELETE` of an already soft-deleted item is 404; a re-created item with the same SKU/label is unaffected.
- A deactivated staff member, or staff of a deactivated branch/merchant, gets 403 on every switched route.
- Owner `DELETE` of a soft-deleted item (hard delete of a row staff already hid) still works or 404s predictably, not 500.
- Bulk upload / generate by staff: wallet is the merchant's, audit row written once per request, `jobs.staff_id` set.

## File Structure

| File | Responsibility |
|---|---|
| `apps/api/src/plugins/portal-auth.ts` (modify) + Fastify type decl | `requireMerchantTeam` decorator |
| `packages/db/src/schema/merchant.ts` (modify), new migration `packages/db/src/migrations/0258_*.sql` + meta | nullable `deleted_at`, `deleted_by_staff_id`, `updated_by_staff_id` |
| `apps/api/src/modules/merchant/catalog.routes.ts` (modify) | gate switch, soft delete, read predicates, audit, attribution |
| `apps/api/src/modules/merchant/{resolve-tryon-garment,create-tryon-job}.ts`, `modules/admin/merchant-catalog.routes.ts` (modify) | `deleted_at IS NULL` predicates |
| `apps/api/test/integration/merchant-catalog-team.test.ts` (create) | staff access, tenancy, soft delete, audit |
| `apps/merchant-web/src/lib/{api-client.ts,sse.ts}`, `src/components/{job-stream-provider.tsx,icons.tsx,ui/grad-btn.tsx,ZoomableImage.tsx}`, `src/lib/{garment-icons.ts,breakpoints.ts}` (create) | supporting modules the ported UI imports |
| `apps/merchant-web/src/app/(app)/catalogue/{page.tsx,api.ts,CatalogueManagerContent.tsx,ProductModal.tsx,BulkUploadModal.tsx,SubcategoryModal.tsx}` (create) | the ported manager |
| `apps/merchant-web/src/components/shell.tsx` (modify) | nav link `/catalogue` for both roles |
| `docs/progress.md` (modify) | record the copy pair |

---

### Task 1: `requireMerchantTeam` gate

**Files:** Modify `apps/api/src/plugins/portal-auth.ts` (+ the Fastify `declare module` block where `requireMerchantMember` is declared); Create `apps/api/test/integration/merchant-catalog-team.test.ts` (this task adds its first cases).

**Interfaces:**
- Produces: `app.requireMerchantTeam(req, reply): Promise<void>` — runs `requireMerchantMember`, then sets `req.merchantClientId = req.merchantMember.merchantId`; owner → role `admin`, staff → active staff + active branch + active merchant else 403. `requireMerchant` unchanged.

- [ ] **Step 1: Failing tests** (harness copied from `merchant-org.test.ts`; helpers `createTestMerchant`, `createTestBranch`, `createTestStaff` in `test/helpers/merchant.ts`), against `GET /v1/merchant/catalog/subcategories` once the route is switched (Task 3 switches it; for now test a temporary probe route registered only in the test app via `app.get('/__team', { preHandler: app.requireMerchantTeam }, r => ({ id: r.merchantClientId }))` if the harness allows decorating late, else defer these assertions to Task 3 and test the decorator by unit-calling it): owner → `merchantClientId` = merchant id; staff → same merchant id; inactive staff, staff of inactive branch, inactive merchant → 403; a user who is neither → 403; a `Device <token>` header → 401.
- [ ] **Step 2:** run `cd apps/api && npx vitest run --config vitest.integration.config.ts merchant-catalog-team` → FAIL.
- [ ] **Step 3: Implement** the decorator exactly as in the interface; add it to the Fastify instance typing next to `requireMerchantAdmin`.
- [ ] **Step 4:** test passes; `pnpm --filter @aivastra/api typecheck`; `pnpm biome check apps/api --diagnostic-level=error`.
- [ ] **Step 5:** commit `feat(merchant): requireMerchantTeam gate for owner and staff`.

---

### Task 2: Schema and migration for soft delete

**Files:** Modify `packages/db/src/schema/merchant.ts` (`merchantCatalogItems`); Create migration via `pnpm db:generate` (local only) → `packages/db/src/migrations/0258_*.sql` + `meta/0258_snapshot.json` + `_journal.json` update (format with `npx biome format --write` on the snapshot and journal).

**Interfaces:**
- Produces: `merchantCatalogItems.deletedAt: timestamp (nullable)`, `.deletedByStaffId: uuid → merchant_staff.id ON DELETE SET NULL (nullable)`, `.updatedByStaffId: uuid → merchant_staff.id ON DELETE SET NULL (nullable)`; a partial index `merchant_catalog_items_live_idx on (merchant_id, is_active) WHERE deleted_at IS NULL` is NOT added (plain additive columns only; skip the index to keep the migration lock-free).

- [ ] **Step 1:** Edit the schema (import `merchantStaff` from the org-model schema file without creating a circular import; check where `merchantStaff` lives). 
- [ ] **Step 2:** Run `pnpm db:generate` (local dev DB only; never against staging/prod). Inspect the SQL: it must be three `ALTER TABLE … ADD COLUMN` (nullable, no default) and two FK constraints, nothing else. If the number differs from 0258 because `origin/dev` moved, report; do not renumber blindly.
- [ ] **Step 3:** `pnpm db:migrate` locally; verify with `docker exec aivastra-postgres psql -U tryon -d tryon_dev -Atc "\d merchant_catalog_items"` that the columns exist.
- [ ] **Step 4:** `pnpm --filter @aivastra/db build && pnpm --filter @aivastra/types build`; run the legacy guard `cd apps/api && npx vitest run --config vitest.integration.config.ts merchant-catalog` and record the file/test counts (these must be identical after Task 3).
- [ ] **Step 5:** commit `feat(db): soft-delete columns on merchant_catalog_items`.

---

### Task 3: Switch catalogue routes to the team gate, soft delete, audit, attribution

**Files:** Modify `apps/api/src/modules/merchant/catalog.routes.ts`, `resolve-tryon-garment.ts`, `create-tryon-job.ts`, `apps/api/src/modules/admin/merchant-catalog.routes.ts`; Test `apps/api/test/integration/merchant-catalog-team.test.ts`.

**Interfaces:**
- Consumes: `app.requireMerchantTeam` (Task 1), new columns (Task 2), `recordAudit(tx, {actor, action, resourceType, resourceId, before?, after?, request})`, `JobAttribution` in `create-tryon-job.ts` (`{branchId, deviceId, sessionId, staffId}`).
- Produces: the same routes, now callable by staff. Exact switch list (derive the final list by reading the ported UI's calls and confirm against this): `GET /v1/merchant/catalog/subcategories` (+ `GET …/saree-subcategories`, `GET …/saree-styles`), `POST` and `PATCH /v1/merchant/catalog/subcategories(/:id)`, `POST …/presign`, `GET /v1/merchant/catalog` (item list), `POST /v1/merchant/catalog`, `PATCH /v1/merchant/catalog/:id`, `DELETE /v1/merchant/catalog/:id`, `GET /v1/merchant/catalogues`, `POST …/import`, `POST …/generate`, `POST …/generate-bulk`, `GET …/generate/status`, `GET …/generate/:jobId`, `POST …/reconcile-held`. **Stays `requireMerchant`:** `DELETE …/subcategories/:id` (ruling above) and every other merchant route.
- Behaviour: a helper `isStaff(req)` = `req.merchantMember?.role === 'staff'`. **Staff `DELETE /v1/merchant/catalog/:id`**: UPDATE `deleted_at = now()`, `deleted_by_staff_id = staffId` where id + merchant match and `deleted_at IS NULL` (404 otherwise), keep storage objects, audit `merchant_catalog.soft_delete`, 204. **Owner `DELETE`**: unchanged hard delete (also removes rows staff soft-deleted). **Staff PATCH**: also sets `updated_by_staff_id`, audit `merchant_catalog.update`. **Staff create/import/generate/subcategory create+update**: audit rows (`merchant_catalog.create`, `merchant_catalog.import`, `merchant_catalog.generate`, `merchant_catalog_subcategory.create|update`) in the same transaction as the write where the write is a DB transaction; where the existing code performs the write outside a transaction, wrap only the staff path's DB write + audit in `app.db.transaction` without altering owner flow. Staff generate/generate-bulk pass `attribution = { branchId, deviceId: null, sessionId: null, staffId }` into the job creators so `jobs.branch_id/staff_id` are set.
- Read predicates: add `isNull(schema.merchantCatalogItems.deletedAt)` to every SELECT of `merchantCatalogItems` in the four modules (manager list, subcategory item counts/children counts, `merchantCanReferenceCatalogItem`, `resolveTryonGarment`, the item joins in `create-tryon-job.ts`, admin moderation list and counts). `grep -rn "merchantCatalogItems" apps packages --include=*.ts` must be re-run: also check `apps/dispatcher/src/job/saree-step2-promoter.ts` (it updates `mannequinResultKey` by id; no predicate needed, say so in the report) and `apps/catalogues-web/src/app/tryon-library-app/catalog-app-helpers.ts` (only a comment; confirm no raw SQL/API read bypasses the predicate, including any Android/demo catalogue endpoint in `apps/api/src/modules/**` that reads items through a join on another table — grep for `catalogItemId`/`merchantCatalogItemId`).

- [ ] **Step 1: Failing tests** in `merchant-catalog-team.test.ts` (each with owner and staff fixtures): staff can list subcategories, create a subcategory, create an item (presign + POST), PATCH it (`updated_by_staff_id` set), and soft-delete it (row remains with `deleted_at` + `deleted_by_staff_id`, `deleteObject` NOT called — assert via the test storage/bucket that the objects still exist); the soft-deleted item is absent from the manager list, `resolveTryonGarment` returns 404 for it, and `merchantCanReferenceCatalogItem` is false; staff of merchant A gets 404 for merchant B's item PATCH/DELETE and subcategory PATCH, and an empty list rather than B's rows; inactive staff / inactive branch → 403; staff `DELETE …/subcategories/:id` → 403; owner `DELETE` of an item hard-deletes the row and the storage objects; owner hard-delete of a staff-soft-deleted item succeeds; second staff DELETE of the same item → 404; audit rows exist for each staff mutation with actor role `MERCHANT_STAFF` and `resourceId` = the item id (filter assertions by resource id), and NO new audit rows are written for the equivalent owner mutations; staff `generate` creates a job whose `staff_id` equals the staff id (use the existing generate test fixtures from `merchant-catalog*.test.ts`).
- [ ] **Step 2:** run the new file → FAIL.
- [ ] **Step 3:** Implement per Interfaces. Keep owner code paths textually unchanged where possible (branch on `isStaff`).
- [ ] **Step 4:** run `cd apps/api && npx vitest run --config vitest.integration.config.ts merchant-catalog merchant-tryon` → new file passes and the legacy files pass with the SAME file and test counts recorded in Task 2 Step 4 (write both numbers in the report). Also `pnpm --filter @aivastra/api test` (unit), `typecheck`, `pnpm biome check apps/api --diagnostic-level=error`.
- [ ] **Step 5:** commit `feat(merchant): staff access, soft delete and audit for catalogue routes`.

---

### Task 4: merchant-web supporting modules for the port

**Files:** Create in `apps/merchant-web/src`: `lib/api-client.ts`, `lib/sse.ts`, `components/job-stream-provider.tsx`, `components/icons.tsx`, `components/ui/grad-btn.tsx`, `components/ZoomableImage.tsx`, `lib/garment-icons.ts`, `lib/breakpoints.ts`; Modify `src/app/(app)/layout.tsx` to mount `JobStreamProvider` inside the session gate. Test: `src/lib/api-client.test.ts`.

**Interfaces:**
- Produces: `api` object compatible with the ported UI's calls: `api.get<T>(path)`, `api.post<T>(path, body)`, `api.patch<T>(path, body)`, `api.del<T>(path)`, `api.uploadToR2(uploadUrl, file)` — thin wrappers over merchant-web's existing `apiFetch` (so refresh, 403 re-check and Bearer all apply; `del` resolves `void` on 204); `JobStreamProvider` / `useJobStreamContext` / `JobStatusEvent` with the same shapes as catalogues-web's `job-stream-provider.tsx`, authenticated with merchant-web's token.
- Copy (faithfully) from catalogues-web: `lib/sse.ts` (adapt token source to `getToken` from merchant-web `lib/api`), `job-stream-provider.tsx`, only the icons the ported files import (`SpinnerIcon, UploadIcon, XIcon, TrashIcon, PlusIcon, ArrowLeft`), `grad-btn.tsx`, `ZoomableImage.tsx`, `garment-icons.ts` (only the exports used), `breakpoints.ts`. NOT copied: `TopBar`, `DemoVideoSection`/`GetAppButton` (try-on promo); the port removes those usages (named deviation).

- [ ] **Step 1: Failing tests** `api-client.test.ts` (mock global `fetch`): `api.get` sends the Bearer header and returns parsed JSON; `api.post` sends a JSON body; `api.del` resolves `undefined` on 204; `api.uploadToR2` PUTs the file with its content type and no Authorization header, and throws on a non-2xx status.
- [ ] **Step 2:** FAIL. **Step 3:** implement and copy as above; read each catalogues-web source before copying and keep behaviour identical.
- [ ] **Step 4:** `pnpm --filter @aivastra/merchant-web test`, `typecheck` (read full output), `lint`, `build`, `pnpm biome check apps/merchant-web --diagnostic-level=error`.
- [ ] **Step 5:** commit `feat(merchant-web): api client, job stream and shared UI for catalogue`.

---

### Task 5: Port the catalogue manager UI

**Files:** Create `apps/merchant-web/src/app/(app)/catalogue/{page.tsx,api.ts,CatalogueManagerContent.tsx,ProductModal.tsx,BulkUploadModal.tsx,SubcategoryModal.tsx}` as copies of `apps/catalogues-web/src/app/(app)/tryon/*`.

**Interfaces:**
- Consumes: Task 4 `api`, `useJobStreamContext`, icons, `GradBtn`, `ZoomableImage`, `getGarmentIcon`/`DEFAULT_GARMENT_ICON`, `BREAKPOINTS`; merchant-web `PremiumSelect`, `ConfirmDialog`, `C`; `useSession()` for `me.role`.
- Produces: route `/catalogue` for both roles. Named deviations only: remove `TopBar` and the promo imports/usages; replace any raw `<select>` with `PremiumSelect`; replace raw hex with `C` tokens where the copied code uses hex; hide the subcategory delete control when `me.role === 'staff'` (API returns 403 for staff) and show a short note in the confirm text for owners that deleting a subcategory removes its products; handle a 403 from any call by showing a message (the client already re-checks `/org/me` before signing out). The deleted-item confirm copy for staff: "This removes the product from your catalogue." (spec: no restore UI).

- [ ] **Step 1:** Copy the six files, then fix imports to merchant-web paths. Diff each copied file against its catalogues-web original (`diff`) and list every deviation in the report; anything beyond the named deviations needs justification.
- [ ] **Step 2:** `typecheck` (full output), `lint`, `build`, `biome check`; `pnpm --filter @aivastra/merchant-web test`.
- [ ] **Step 3:** commit `feat(merchant-web): catalogue manager (port of /tryon)`.

---

### Task 6: Navigation, verification and records

**Files:** Modify `apps/merchant-web/src/components/shell.tsx` (Catalogue link for admin and staff), `docs/progress.md`.

- [ ] **Step 1:** Add the nav link `/catalogue` (visible to both roles) and update the Overview if it has a quick-links area (optional, skip if none).
- [ ] **Step 2: Verify at API/BFF level** (no real browser, as in 3a): start `pnpm --filter @aivastra/merchant-web dev`, use the seeded local accounts from the 3a verification (`mw-verify-*@example.test`, local `tryon_dev` only; never print passwords) and curl: staff and admin can list subcategories and create an item; staff soft-delete leaves the DB row (check with `psql`), owner delete hard-deletes; staff subcategory delete is 403. Stop your dev server afterwards.
- [ ] **Step 3:** In `docs/progress.md` (newest entry on top): what shipped, what was verified, what is NOT RUN (the browser checklist: add product, bulk upload, generate, staff delete vanishes, owner hard delete, 375px layout), the **copy pair** note (bug fixes to `/tryon` manager files must be mirrored in `apps/merchant-web/src/app/(app)/catalogue/` until `/tryon` is retired), the subcategory-delete ruling, and the deferred items (restore UI, owner audit, owner soft delete).
- [ ] **Step 4:** commit `docs: merchant-web 3b progress`.

---

## Self-review notes

- Spec coverage: UI port (T4-T5), staff-aware gate (T1, T3), soft delete + read predicates (T2-T3), audit + attribution (T3), testing section (T3 tests, T6 verification), out-of-scope respected. Deviation from spec: staff cannot delete subcategories (ruling; spec text says staff subcategory delete is audited).
- `requireMerchantTeam` / `deletedAt` / `deletedByStaffId` / `updatedByStaffId` names are used identically across T1-T3.
- The exact route switch list in T3 is derived from the ported UI's `api.ts` and `CatalogueManagerContent` calls; the implementer must reconcile the two and report differences.
