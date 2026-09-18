# Eager mannequin-drape pre-generation (alternative design, not built)

Dated 2026-09-17. Companion to the shipped lazy-cache feature (PR #372→dev,
PR #373→main, commit `6aa98880`). Recorded so the eager alternative doesn't
need to be re-derived if it's ever worth revisiting.

## Context

The merchant two-input (body + pallu) customer try-on flow runs two ComfyUI
jobs per customer request: a 0-credit mannequin-drape step (`source:
SAREE_MANNEQUIN`, body+pallu → one composited image) followed by an ordinary
single-garment try-on step against the real customer's photo. Step 1's output
depends only on the merchant's uploaded body/pallu photos — it's identical for
every customer who tries on the same catalog item.

**Shipped design (lazy cache):** `merchant_catalog_items.mannequinResultKey`
starts null, gets populated as a side effect of `saree-step2-promoter.ts`'s
existing promotion sweep the first time a customer tries the item on, and
`resolveTryonGarment` checks it first on every subsequent request — skipping
straight to a single-image job once warm. Self-healing, no backfill needed, no
invalidation logic required (catalog item images are immutable after upload —
see `packages/db/src/schema/merchant.ts`).

This doc is the **alternative that was considered and not built**: generate
the drape **eagerly**, at upload time, instead of waiting for the first
customer try-on.

## Eager design sketch

- **Trigger point:** the merchant catalog create/update route
  (`POST`/`PATCH /v1/merchant/catalog`, `apps/api/src/modules/merchant/catalog.routes.ts`)
  fires a mannequin-drape job (`source: SAREE_MANNEQUIN`) as soon as both the
  body and pallu images are saved for a two-input item, instead of waiting for
  `createMerchantTryonJobTwoStep` to create one on first customer request.
- **Flow:** same underlying job — one `SAREE_MANNEQUIN` job against the
  body+pallu keys — just moved earlier and decoupled from any specific
  customer request. `saree-step2-promoter.ts` would need a variant path (or
  the same one, keyed only off `merchantCatalogItemId` in `job_inputs.params`)
  to write `mannequinResultKey` onto the catalog item on completion, exactly
  as the lazy design already does.
  a customer tries on before pre-generation finishes, `resolveTryonGarment`
  still needs the existing two-input fallback path — so the lazy code path
  can't be deleted, only short-circuited earlier when the cache warms sooner.
- **What changes vs. lazy:** nothing in `resolveTryonGarment` or the promoter's
  cache-write logic — only *when* the first `SAREE_MANNEQUIN` job is created
  (upload time vs. first customer try-on).

## Lazy (shipped) vs. eager

| | Lazy (shipped) | Eager |
|---|---|---|
| Dev complexity | Small — reuses the existing promoter sweep, no new trigger | New trigger off the catalog create/update route; still needs the lazy fallback for the race window before pre-generation finishes |
| Ops / GPU blast radius | Zero extra GPU work unless the item is actually tried on | GPU work for every uploaded two-input item, including ones never tried on (test items, abandoned catalog entries, browsing-only items) |
| First-customer latency | First customer after upload pays the two-step cost | Fast path for (almost) every customer, *if* generation finishes before their first try-on |
| Correctness risk | None — cache population is best-effort and self-healing (null just means recompute) | Race: a customer can try on before async pre-generation finishes, so the lazy fallback path is still required regardless |

## Recommendation / status

Lazy was shipped and is the right call for now: eager is strictly more code
(new trigger + still needs the lazy fallback for the race window) for a
benefit that mostly doesn't matter, since GPU cost is paid either way once an
item is actually tried on — eager just moves the latency hit from "first
customer" to "upload time," while adding wasted GPU spend on items nobody
ever tries on.

**Worth revisiting if:** merchants report the first-customer delay on newly
uploaded two-input items is a real UX complaint, *and* the catalog's
upload-to-first-tryon ratio is high enough that eager generation wouldn't be
mostly wasted work. Neither condition holds today.
