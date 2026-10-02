# Accessory images — design

Date: 2026-10-01
Status: approved, pending implementation plan

## Problem

Garment types currently support a fixed set of optional admin-curated inputs:
one upper garment, one lower, one pair of shoes, one "third" generic role —
each is a single node ID on `workflow_templates` and a single catalog
selection in `job_inputs`. We need to add **accessories**: admin-curated
images (necklaces, watches, belts, etc.) grouped into categories, optionally
selectable by the user, where the selected images must be combined into a
single image before being handed to the ComfyUI workflow, because each
accessory-enabled workflow exposes exactly **one** accessory `LoadImage` node.

## Scope

This pass covers the **studio wizard only**
(`apps/catalogues-web` → `/v1/jobs/tryon`). Shopify widget, kiosk, and
merchant catalogue flows are explicitly out of scope and may get accessory
support in a later iteration.

Accessories are a **free add-on** — selecting them does not change job credit
cost, and no changes are needed to credit-deduction logic.

## Data model

Reuses the existing lower/shoe catalog machinery verbatim — **no new tables**.
Verified directly against `apps/admin-web/src/pages/assets/CatalogTab.tsx` and
`apps/api/src/modules/admin/catalog.routes.ts`: lower/shoe mapping to garment
types already happens at the individual **item** level via the existing
`catalog_item_subcategories` join table (the admin UI's per-item "garment
types this item applies to" checklist and its bulk "Map to garment types"
action), not at the category level. `typeSlug` is handled as a free `z.string()`
throughout the admin routes and `packages/storage/src/keys.ts` — nothing
hardcodes `'lower' | 'shoe'` server-side, so a third type slug needs no backend
schema or route change at all.

- `catalog_types`: one new row, `slug: 'accessory'` (seed migration, same
  pattern as migration `0006_catalog_types_seed.sql`).
- `catalog_categories`: rows with `typeId` = the accessory type's id are
  accessory categories (e.g. "Necklaces", "Watches", "Belts"). Existing
  `sortOrder` column doubles as the fixed stacking order (see "Stacking"
  below) — no new column needed.
- `catalog_items`: rows with `type: 'accessory'`, `categoryId` pointing at an
  accessory category, are the individual admin-uploaded images. Reuses
  `r2Key`, `thumbnailKey`, `isActive`, `sortOrder` unchanged.
- `catalog_item_subcategories` (existing table, unchanged): maps an
  **individual accessory item** to the garment type(s) it should appear
  under, exactly like it already does for lower/shoe items today. A category
  is not itself owned by one garment type — different items in the same
  category can map to different garment types, same flexibility lower/shoe
  already has.
- `job_inputs`: new column `accessoryCatalogIds: uuid[]` default `'{}'` — the
  selected item IDs, at most one per category, zero or more categories.
- `workflow_templates` (+ `workflow_template_archives`): new nullable column
  `accessoryNodeId: text`, following the exact precedent of `lowerNodeId` /
  `shoeNodeId`.

A garment type "has accessories" is derived, not flagged: it has ≥1 active
`catalog_items` row of `type: 'accessory'` mapped to it via
`catalog_item_subcategories`. Same derivation style as `hasLower`/`hasShoes`,
no new boolean column on `garment_subcategories`.

## Admin UI + API

No new backend routes needed — `apps/api/src/modules/admin/catalog.routes.ts`
already treats `typeSlug` generically. The only change is in
`apps/admin-web`:

- `AssetsContext.tsx`'s `AssetTab` union and `VALID_TABS` array: add
  `'accessory'`.
- `AssetsPage.tsx`: add an `{ k: 'accessory', l: 'Accessories' }` tab entry,
  and widen the existing `(activeTab === 'lower' || activeTab === 'shoe')`
  render guard to include `'accessory'` so it renders `<CatalogTab />` —
  the same component used for lower/shoe today, unmodified in structure.
- `CatalogTab.tsx`: widen the `typeSlug`/`tabLabel`/button-copy ternaries
  (currently binary `activeTab === 'shoe' ? 'shoe' : 'lower'`) to a 3-way
  switch including `'accessory'`. Everything else — category CRUD, item
  upload, per-item "garment types this item applies to" mapping, bulk mapping
  — works unchanged, since none of it is type-specific logic.
- `BatchCatalogUploadModal.tsx`: widen its `typeSlug: 'lower' | 'shoe'` prop
  type to include `'accessory'`, and its `typeLabel` ternary.
- **Workflow template editor**: add an "Accessory Node ID" field alongside the
  existing lower/shoe/third node ID fields, validated the same way (must
  exist in the template's JSON if set).
- New read path for the studio wizard: active accessory categories (with
  their active items mapped to the given garment type, ordered by
  `sortOrder`) for a given garment type, exposed either as a new endpoint or
  folded into the existing garment-type detail response.

## Studio wizard UI (`apps/catalogues-web`)

A new, fully optional step after pose (and lower/shoe, where present)
selection:

- Shown only when the selected garment type has ≥1 mapped accessory category
  — same conditional-rendering pattern as today's `hasLower`/`hasShoes`.
- One row per category, in `sortOrder`, each a horizontally scrollable grid of
  that category's active items (reuses the existing picker component used for
  lower/shoe/pose).
- Single-select per category, with a visible "clear" affordance — unlike
  lower/shoe, nothing here is ever mandatory, and skipping the whole step is
  valid.
- On submit, collects selected item IDs into `accessoryCatalogIds` and
  includes it in the `/v1/jobs/tryon` payload.

## API job creation (`apps/api/src/modules/jobs/create.ts`)

Deliberately minimal — accessories are **never** mandatory, even when the
resolved pose's workflow has an `accessoryNodeId` set. This is the key
divergence from lower/shoe, which become mandatory the moment their node id
is mapped (`pw.lowerNodeId && !lowerCatalogId` style checks) — that pattern
must **not** be applied to accessories.

- Accept `accessoryCatalogIds?: string[]` on the `/v1/jobs/tryon` payload
  (Zod schema in `packages/types`).
- Validate each ID: must reference an active `catalog_items` row of
  `type: 'accessory'`. Reject if two selected IDs share the same category
  (defensive — the wizard already enforces this, but cheap to double-check
  server-side).
- Store the array as-is on `job_inputs.accessoryCatalogIds`. No R2
  resolution, no credit math happens here.

## Dispatcher (`apps/dispatcher/src/job/processor.ts`, `workflow/patcher.ts`)

Mirrors the **actual** (not documented) lower/shoe resolution pattern: the API
stores only the catalog ID(s); the dispatcher resolves live R2 keys and
downloads bytes at dispatch time (see `processor.ts:590-612`). Note this
contradicts CLAUDE.md's stated invariant ("Catalog ID → R2 key resolution
happens in api before enqueue") — the real code already does it live in the
dispatcher for lower/shoe, and accessories follow that real behavior, not the
stale doc.

**Stacking** (triggered only when `accessoryCatalogIds` is non-empty):

1. Query `catalog_items` joined to `catalog_categories` for the selected IDs,
   ordered by the category's `sortOrder` — this fixed category order is the
   vertical stack order, independent of user selection order.
2. Download each item's bytes from storage (`storage.getObject(r2Key)`), same
   bytes-fetch path already used for other garment roles.
3. Resize each image to a common width (the widest of the selected images,
   preserving aspect ratio) and vertically concatenate with `sharp` (already a
   dispatcher dependency, used today in `watermark.ts`) — a tightly-packed
   strip containing only the selected images, no blank slots for unselected
   categories, no transparency/z-axis layering involved.
4. Upload the single resulting buffer to ComfyUI once via the existing
   `uploadImageToComfy`, producing one filename.
5. Pass that filename as a new `accessoryGarmentFile?: string` field on
   `WorkflowInputs`.

**Patching** (`applyWorkflowPatch` in `patcher.ts`), following the lower/shoe
pattern with one deliberate difference:

- `accessoryNodeId` set + file provided → patch the node with the stacked
  image filename.
- `accessoryNodeId` set + no file (nothing selected) → **leave the node
  untouched**. The template JSON's own placeholder/default image (whatever
  the admin uploaded the workflow with) stays in place and must itself be a
  no-op for the graph. This differs from lower/shoe's "throw if node mapped
  but no image" behavior, since accessories are never mandatory.
- `accessoryNodeId` unset + file provided (shouldn't happen given the wizard
  only offers categories mapped to the resolved garment type, but defensive)
  → warn and skip, same as lower/shoe/third today.

**Failure handling**: if any selected accessory's image fails to
download/stack, the whole job fails (not a silent skip-and-continue) —
credits refund through the existing transactional refund path, same as other
missing-required-input failures. This deliberately diverges from lower/shoe's
current lenient "catalog item not found — skipping" behavior, since an
accessory was an explicit user choice and silently dropping it produces a
result the user didn't ask for.

## Testing

- Unit test for `applyWorkflowPatch`'s new accessory branch
  (`patcher.test.ts`): node patched when file+nodeId present, untouched when
  file absent, warn-and-skip when nodeId absent but file present.
- Unit/integration test for the stacking function with 1, 2, and 3 images of
  differing widths — verify resize-to-widest and correct category-order
  concatenation.
- Integration test for a full job dispatch with accessories selected through
  `processor.ts`, including the fail-the-job path when a selected accessory's
  storage fetch fails.
- API integration test for `/v1/jobs/tryon` accepting/rejecting
  `accessoryCatalogIds` (inactive item, wrong type, duplicate category).

## Out of scope (explicitly deferred)

- Shopify widget, kiosk, and merchant catalogue job-creation surfaces.
- Extra credit cost for accessories.
- Per-accessory positional/placement config (x/y/scale) — stacking is a
  simple vertical concatenation, not compositing onto the output canvas.
- Multiple selections within a single accessory category.
