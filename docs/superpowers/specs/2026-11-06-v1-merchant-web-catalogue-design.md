# v1.0 step 3b: Merchant Web — catalogue manager

Sub-project 3b of `docs/superpowers/specs/2026-11-06-v1-merchant-web-design.md` (step 3, HLD §3.1).
Depends on 3a (the `apps/merchant-web` app, login, shell). Status: draft for review, 2026-11-06.

## Compatibility rule (binding)

Existing customers migrate slowly. So:
- **`/tryon` in `apps/catalogues-web` is not touched, moved, redirected or removed.** The HLD said
  "moved, with a redirect"; that is superseded. 3b builds a second copy in Merchant Web.
- Existing `/v1/merchant/catalog/*` behaviour is unchanged for merchant owners. Staff access is purely additive.
- All schema changes are additive (nullable columns). Every existing read gains a predicate that is
  true for all existing rows.

## Goal

Merchant admin **and staff** manage the brand's catalogue (subcategories, products, bulk upload,
AI generation) from Merchant Web, brand-wide, with staff edits audited and staff deletes reversible.

## What is built

### 1. UI port (copy)
Copy `apps/catalogues-web/src/app/(app)/tryon/` (`CatalogueManagerContent` 1,400 lines, `ProductModal`
1,084, `BulkUploadModal` 939, `SubcategoryModal` 231, `api.ts` 117) into
`apps/merchant-web/src/app/(app)/catalogue/`, adapted to merchant-web's tokens, `api` client and BFF.
Route: `/catalogue`. Both roles see it.

**Why copy, not a shared package.** A shared package would change catalogues-web's build and
risk the live `/tryon`. The cost is duplicated UI until `/tryon` is retired (per customer, later);
bug fixes during that window must be applied to both, and `docs/progress.md` records the pair. The
copy is a straight port: no redesign, no behaviour change. Dropdowns that are raw `<select>` today
become `PremiumSelect`.

### 2. API: staff-aware gate (additive)
The catalogue routes use `app.requireMerchant` (owner-only) and read `req.merchantClientId`.
- Add `app.requireMerchantTeam` in `plugins/portal-auth.ts`: runs `requireMerchantMember`
  (owner → admin, else active staff + active branch + active merchant), then sets
  `req.merchantClientId = req.merchantMember.merchantId`. `requireMerchant` stays as is.
- Switch **only the routes Merchant Web calls** to `requireMerchantTeam`: the exact list is derived
  at plan time from the ported UI's `api.ts` and the page's calls (expected: subcategories CRUD,
  `saree-subcategories`, `saree-styles`, `presign`, item create / patch / delete, `import`,
  `generate`, `generate-bulk`, `generate/status`, `generate/:jobId`, `reconcile-held`, `catalogues`).
- Observable difference for owners: none. For a caller who is neither an owner nor staff, the status
  is still 403; only the message text differs ("not a merchant member" vs "not a merchant account").
- Device tokens never reach these routes (`Device` scheme is rejected by the bearer parser).

### 3. Soft delete for staff
Today `DELETE /v1/merchant/catalog/:id` hard-deletes the row and its storage objects.
- Add nullable columns to `merchant_catalog_items`: `deleted_at`, `deleted_by_staff_id`
  (→ `merchant_staff`, `SET NULL`), `updated_by_staff_id`. (`is_active` already exists and carries
  admin moderation, so it is **not** reused.)
- **Staff DELETE:** sets `deleted_at` and `deleted_by_staff_id`, keeps the row and the storage
  objects. **Owner DELETE:** unchanged (hard delete). Rationale: reversibility where a staff member
  may delete by mistake, no change for existing customers.
- Reads exclude `deleted_at IS NOT NULL`. The modules that read the table are few:
  `modules/merchant/catalog.routes.ts`, `modules/admin/merchant-catalog.routes.ts`,
  `modules/merchant/resolve-tryon-garment.ts` (incl. `merchantCanReferenceCatalogItem`), and the
  catalogue-item joins in `create-tryon-job.ts`; the plan re-greps for others (Android catalogue
  app routes, demo reads) and adds the predicate to each. A deleted item cannot be tried on or wishlisted.
- No restore UI in 3b (open question).

### 4. Audit and attribution
- Every **staff-initiated** mutation (subcategory create/update/delete, item create/patch/delete,
  import, generate) calls `recordAudit(tx, …)` in the same transaction, actor = the staff user,
  role `MERCHANT_STAFF`. Owner mutations are **not** newly audited (adding fail-closed audit to a
  legacy path would be a behaviour change); owner audit is a separate decision.
- `updated_by_staff_id` is set on staff PATCH.
- AI generation by staff spends the merchant's credits (existing behaviour, same wallet). Jobs
  created by staff carry `jobs.staff_id` (column exists from step 2) so spend can be attributed in 3c.

## Out of scope for 3b
Removing/redirecting `/tryon`; a restore-deleted UI; audit of owner edits; changing admin-side
moderation; dashboards and brand settings (3c); the Android catalogue app (`tryon-library-app`).

## Testing
API integration (docker harness), written first:
- Staff can list, create, patch, bulk-create and soft-delete in their merchant; a staff token of
  merchant A gets 404 on merchant B's items and subcategories (tenancy per route); inactive staff /
  inactive branch → 403.
- Owner `DELETE` still hard-deletes and removes storage objects (pins legacy behaviour); staff
  `DELETE` leaves the row and objects and sets `deleted_*`.
- Soft-deleted items are absent from the manager list, the tryon garment resolution (404) and
  `merchantCanReferenceCatalogItem`.
- Audit rows exist for staff mutations with role `MERCHANT_STAFF`; none are newly written for owner mutations.
- Legacy guard: the existing `merchant-catalog*.test.ts` (7 files) and `merchant-tryon*.test.ts`
  pass unchanged with identical counts before and after.
- UI: typecheck / lint / build; manual browser checklist (admin and staff: add product, bulk
  upload, generate, delete as staff and see it vanish; as owner confirm hard delete).

## Open questions
- Should owner deletes also become soft (consistent, reversible) at some point? Default: no, not in 3b.
- Restore of staff-deleted items: AiVastra admin only, or merchant admin in Merchant Web? Default: neither in 3b.
- May staff trigger paid AI generation, or only add pre-made photos? Default: allowed (HLD says full
  edit); the merchant sees spend per staff in 3c.
