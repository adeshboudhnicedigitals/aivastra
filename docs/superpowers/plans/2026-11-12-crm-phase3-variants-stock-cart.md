# CRM Phase 3: Sizes, Variants, Per-branch Stock and the In-store Cart

**Spec:** `docs/superpowers/specs/2026-11-12-instore-crm-analytics-design.md` §6.1 (cart), §6.2
(inventory, option C), §9 (POS and mobile readiness). **Decided 2026-11-12:** in kiosk mode the
shopper can add to the cart (Q3); staff confirm billing.

## Decisions this plan makes

| # | Decision | Why |
|---|---|---|
| P1 | **v1 checkout handoff = barcodes on screen + a cart code** (spec Q1 was deferred with POS) | Works with any POS today, no integration; the stable `cart_code` keeps POS lookup open (§9) |
| P2 | **A billed cart line also writes the existing `session_items` `sold` row and `sale_recorded` event** (props carry `cartLineId`, `variantId`, `source`) | Every current dashboard, the staff leaderboard and the analytics parity test keep working; "sold" stays one fact whatever confirmed it |
| P3 | **Confirmation has a `source`** (`staff` now; `pos` later) and stores the billed price per line | §9: POS is a new source, not a rewrite; real revenue line by line |
| P4 | **Standard size sets are seeded by migration and attached to garment types** (`garment_subcategories.size_set_id`); admin CRUD API now, admin-web screen later | Curated by AiVastra (spec §6.2) without blocking on an admin UI |
| P5 | **Stock is `variant × branch` with a required `status`**; a feed-owned row (`source <> 'manual'`) refuses manual edits | Spec option C: two sources never fight |
| P6 | **Kiosk carts are billed by staff at the counter through Merchant Web** (look up the cart code), assisted carts on the tablet | A kiosk has no signed-in staff; the counter does |

## Slice 3a — sizes, variants, stock (migration 0266)
- [x] `size_sets` (name, ordered `sizes` jsonb, active) seeded: tops XS–XXXL, trousers 26–44, kids by age, free size; `garment_subcategories.size_set_id` (nullable).
- [x] `merchant_catalog_variants` (item, `size`, `is_custom`, `colour`, `sku`, `barcode`, `price_override_paise`, active, sort) — unique (item, size, colour).
- [x] `variant_branch_stock` (variant, branch unique; `status` in_stock|low|out; `quantity` null; `source`; `updated_at`, `updated_by_staff_id`).
- [x] API (merchant team, catalogue rules): list/create/update/delete variants of an item; set stock (staff: own branch only, feed-owned rows refused); audited. Admin: size-set CRUD.
- [x] Device: item variants with this branch's stock + "available at" other branches.
- [x] Tests.

*(Done 2026-11-12: migration `0266_sizes_variants_stock` (+ seeded `tops-alpha`, `bottoms-waist`, `kids-age`, `free-size`), `modules/inventory/routes.ts`, `inventory` 8 tests; merchant-catalog / garment-type suites still pass.)*

## Slice 3b — cart (migration 0267)
- [x] `carts` (session unique, `cart_code` unguessable, status open|billed|abandoned), `cart_lines` (variant, qty, added_by `shopper|staff`, `billed_at`, `billed_source`, `billed_price_paise`, `billed_by_staff_id`, `session_item_id`, `removed_at`).
- [x] Device: get cart, add line (Idempotency-Key; out-of-stock at this branch refused), remove line; events `cart_added`, `cart_removed`.
- [x] Billing: device (assisted, staff header) and Merchant Web `GET/POST /v1/merchant/carts/:code[/bill]` (staff of the cart's branch, or admin) → per line `billed` + `sold` session item + `sale_recorded` (P2). ~~Session end marks unbilled carts abandoned.~~ *Revised: a kiosk shopper reaches the counter after the tablet has ended the session, so a cart outlives its session; carts open > 24h are abandoned by an hourly sweeper.*
- [x] Tests incl. parity: billed lines show up in `itemTotals.sold`.

*(Done 2026-11-12: migration `0267_carts`, `modules/cart/routes.ts`, `cart` 9 tests incl. dashboard parity.)*

## Slice 3c — tablet + merchant-web screens
- [x] Tablet: size picker with availability, other-branch / buy-online hints (`oos_viewed`, `other_branch_shown`, `buy_online_click`), cart screen with barcodes + cart code, assisted "billed".
- [x] Merchant Web: product variants + per-branch stock in the product screen; "Bill a cart" page.

*(Done 2026-11-12: tablet `CartComponents.kt` (size sheet with availability, other branches, buy-online QR reported as `qr_shown`, never as a click; cart with CODE-128 barcodes and the cart code; assisted "Mark billed"), staff header added for `/cart/bill`. Merchant Web `VariantsPanel` in the product editor (edit mode) and `/carts` "Bill a Cart" page + nav. Compiled and unit-tested; not opened on a device or in a browser.)*
