# Shopify basket routing — per-product workflow selection

## Purpose

Every Shopify storefront try-on currently runs the same ComfyUI workflow. The
job-creation path resolves it with `resolveWorkflowTemplate`
(`apps/api/src/modules/shopify/customer.routes.ts:191`), which returns the single
`shopify_funnel_templates` row flagged `is_default` and ignores everything about
the product being tried on. A shirt and a saree get the same graph.

This spec restores per-product workflow routing, in the shape the merchant and
admin surfaces actually need:

- A **basket** is a named bucket bound to one ComfyUI workflow template
  (`saree`, `upper`, `lower`, `shoes`). Aivastra owns baskets.
- A **funnel rule** decides which basket a Shopify product falls into, by
  matching the product's own Shopify metadata (`product_type`, `tags`, `vendor`,
  `collections`).
- A merchant refines that for their own store: add store rules, disable an
  Aivastra global rule for their store only, or pin an individual product to a
  basket by hand.

Per-product routing existed once and was removed on 2026-07-31 during the
Shopify app restructure (`docs/progress.md:2581`) — the UI and API were deleted
and replaced by the single `is_default` flag, but the tables were left standing.
So this is largely a re-wiring of a skeleton still in the schema, not a build
from zero.

**Not in scope:**

- The widget and theme extension. The shopper journey is unchanged — one photo,
  one result — so `apps/shopify-extension` and the widget JS are untouched and
  merchants need no theme republish.
- The dispatcher and `apps/dispatcher/src/workflow/patcher.ts`. The API still
  pins the resolved workflow into `job_inputs.params.workflowTemplateId` at
  enqueue and the dispatcher still trusts it.
- `garment_subcategories` and the Studio / merchant-catalog paths. Baskets are
  deliberately a Shopify-only taxonomy (see "Why not reuse garment
  subcategories" below).
- Merchant-created baskets. Merchants get rules and pins only.
- AND-composition across condition fields, image-based classification, and any
  materialization or backfill of resolved baskets. All rejected as YAGNI below,
  each additive later.

## Why not reuse `garment_subcategories`

`garment_subcategories` (`packages/db/src/schema/models.ts:98`) already binds
garment types to workflows — `mannequinWorkflowTemplateId`,
`sareeStep2WorkflowTemplateId`, `requiresMannequinStep`, plus per-pose overrides
through `pose_garment_configs` — and the dispatcher already resolves against it
(`apps/dispatcher/src/job/processor.ts:387-470`). Reusing it would give one
taxonomy and one place to configure a workflow.

It was rejected deliberately. Those rows are per-gender and carry Studio-only
concerns (upload labels, instruction images, two-step mannequin gating, default
lower/shoe catalog ids) that mean nothing to a widget that takes one customer
photo. Coupling Shopify routing to them makes every Studio garment-type change a
potential Shopify regression. The cost accepted in exchange: two taxonomies, so
an admin fixing an upper-body workflow must fix it in both places if both should
change.

## Model

### Baskets — `shopify_funnel_templates`, unchanged

Already `(slug, label, workflow_template_id, is_active, is_default, sort_order)`
with a partial unique index enforcing exactly one default. Full admin CRUD exists
at `apps/api/src/modules/admin/shopify-funnels.routes.ts`. No schema change.

The table name stays `shopify_funnel_templates`; the concept is called a
**basket** in all UI copy. A rename migration was considered and declined — it
touches five source files and three test files to buy vocabulary alignment.
Revisit only if the mismatch causes real confusion.

### Rules — `shopify_funnel_rules`, three changes

One row per (scope, basket), holding an array of `FunnelRuleCondition`
(`packages/db/src/schema/shopify.ts:81`). Conditions within a row are **OR**'d —
the row reads as "this basket claims anything matching any of these".

| Change | Reason |
|---|---|
| `store_id` → nullable; `NULL` means a global, Aivastra-authored rule | The global tier this design requires |
| Add partial `unique (funnel_template_id) where store_id is null`, keeping the existing `unique (store_id, funnel_template_id)` | Postgres treats NULLs as distinct, so the existing constraint alone would silently permit unlimited duplicate global rules per basket |
| Drop column `mode` | Dead. No code reads it, and assignment source is now derivable — a pin exists or it does not |

AND across fields (`vendor = X` *and* `tags contains saree`) is not expressible.
That is deliberate: the one-row-per-basket shape keeps the merchant UI a simple
claim list. Relaxing the unique constraint later adds AND-composition without a
data migration.

### Suppression — new table `shopify_store_disabled_funnel_rules`

```
store_id    uuid  → shopify_stores(id)        on delete cascade
rule_id     uuid  → shopify_funnel_rules(id)  on delete cascade
created_at  timestamptz not null default now()
primary key (store_id, rule_id)
```

Lets a merchant switch off a global rule for their store alone. Keyed on
`rule_id` rather than `funnel_template_id` so it keeps meaning if global rules
ever go multi-per-basket. Cascading from both sides means deleting a global rule
cleans up every store's suppression of it automatically.

### Product pin — `shopify_product_garments`, semantics narrowed

`funnel_template_id` non-null now means exactly one thing: **someone pinned this
by hand**. It is never written by rule evaluation.

`funnel_assignment_source` records which hand: `'manual'` (merchant chose it in
the embedded admin) or `'admin_reassign'` (written by the existing
reassign-on-basket-delete path, `admin/shopify-funnels.routes.ts:154`). Support
will be asked "did the merchant pick this, or did we move it?" — the column
answers that.

`job_inputs` and the dispatcher are unchanged.

## Resolution

```
resolveBasket(store, garment) → { basketId, workflowTemplateId, source } | null

1  manual pin      garment.funnel_template_id, if that basket is active   → 'manual'
2  store rules     store_id = store.id        ORDER BY priority, id       → 'rule'
3  global rules    store_id IS NULL, minus this store's suppressions
                                              ORDER BY priority, id       → 'rule'
4  default basket  is_default AND is_active                               → 'default'
5  nothing resolves → refuse before deducting credits
```

Four decisions inside that, each a bug if taken the other way:

**The store tier resolves entirely before the global tier.** A store rule at
priority 100 beats a global rule at priority 1. Interleaving both tiers by
priority would let a merchant's own rule silently lose to a global rule whose
priority they cannot see.

**Tie-break on `id` after `priority`.** Equal priorities otherwise give
Postgres-order-dependent results — the same non-determinism the single-default
partial index exists to prevent.

**An inactive pinned basket falls through rather than refusing.** If an admin
deactivates a basket, every product a merchant pinned to it would otherwise
dead-end into "not available for try-on" with no merchant-visible cause.

**All matching is case-insensitive.** Shopify tags are free text typed by
merchants. `"Saree"` failing to match a rule written as `saree` would be the
largest single source of support tickets this feature could create.

| `field` | garment column | `equals` | `contains` |
|---|---|---|---|
| `product_type` | `product_type` | ci exact, trimmed | ci substring |
| `vendor` | `vendor` | ci exact, trimmed | ci substring |
| `tags` | `tags[]` | any tag ci-equals | any tag ci-contains |
| `collections` | `collections[]` | any ci-equals | any ci-contains |

A null or empty column never matches and never throws.

### No caching, no materialization

Resolution is computed on read. It is **not** stored on the product row and
there is no backfill pipeline.

This is affordable because the matching inputs are already denormalized onto
`shopify_product_garments` by the existing product sync, and the try-on handler
already loads the whole row (`customer.routes.ts:371` selects `*`). Classifying
costs an in-memory array match over data the request holds anyway. Materializing
it would mean building a rule-change backfill — progress, idempotency, resync
ordering — to cache a function that is free, and would introduce a stale-row
failure mode where a product's stored basket disagrees with the rules.

Rule sets are likewise not cached in Redis. One small query per *request* (not
per product), on a path that then runs a GPU job, does not merit a cache whose
invalidation for global-rule edits would have to fan out across every store.
Add one only if profiling asks for it.

Correctness under concurrent edits comes from the existing enqueue-time pin, not
from freshness: the resolved `workflowTemplateId` is written into
`job_inputs.params` inside the credit-deduct transaction
(`customer.routes.ts:476-498`), so a rule edited mid-flight can never change the
workflow under a job whose credits are already deducted.

### Code shape

New file `apps/api/src/modules/shopify/funnel-resolution.ts`, mirroring the
split in `activation.ts` — whose comment ("the one place the activation
precedence rule is allowed to live") applies verbatim here, because basket
precedence has the same "every caller must go through this" hazard.

| Export | Kind |
|---|---|
| `matchesCondition(condition, garment)` | pure |
| `resolveBasketFrom(ruleSet, garment)` | pure — **the one place precedence lives** |
| `loadRuleSet(app, storeId)` | one query; suppression already applied |
| `resolveBasket(app, store, garment)` | DB wrapper for single-product callers |

The pure/loader split is what keeps list endpoints cheap: `loadRuleSet` once per
request, `resolveBasketFrom` per product in the page, no N+1.

`resolveWorkflowTemplate` (`customer.routes.ts:191`) is deleted and its callsite
switches to `resolveBasket`, preserving both the refuse-before-deduct behaviour
and the enqueue-time pin.

## API

### Merchant (`requireShopifySession`)

| Route | Notes |
|---|---|
| `GET /v1/shopify/baskets` | Active baskets: `id`, `slug`, `label`, `sortOrder`. **Never returns `workflowTemplateId`** — merchants have no need for workflow identity, and once it is in a payload it is in a support screenshot |
| `GET /v1/shopify/funnel-rules` | `{ storeRules[], globalRules[] }`; each global rule carries `disabled: boolean` for this store, and the response carries per-basket product counts (see cap below) |
| `POST /v1/shopify/funnel-rules` | Create a store rule. Violating `unique (store_id, funnel_template_id)` returns **409** — "you already have a rule for this basket, edit it" |
| `PATCH /v1/shopify/funnel-rules/:id` | Guard: `row.storeId === store.id`, else 404. A merchant must never patch a global rule |
| `DELETE /v1/shopify/funnel-rules/:id` | Same guard |
| `PUT /v1/shopify/funnel-rules/:id/disabled` | Body `{ disabled }`; insert/delete in `shopify_store_disabled_funnel_rules`. Guard: the target must be **global** — disabling your own rule is deleting it |

Two extensions rather than new endpoints:

- **`GET /v1/shopify/products`** — add `product_type`, `tags`, `vendor`,
  `collections`, `funnel_template_id` to the existing column list
  (`products.routes.ts:96`), call `loadRuleSet` once, then `resolveBasketFrom`
  per row. Response gains `basket: { id, label, source }`. No extra query.
- **`PATCH /v1/shopify/products/:id`** — add `funnelTemplateId?: string | null`
  to `PatchProductBody`. A uuid pins the product and sets
  `funnel_assignment_source = 'manual'`; **`null` clears the pin** and returns
  the product to rule-based routing. That null case is the one merchants need
  most and the easiest to leave unimplemented.

Per-basket counts are computed by loading `(id, product_type, tags, vendor,
collections, funnel_template_id)` for the store's non-deleted products and
resolving in memory. **Capped**: when the store's non-deleted product count
exceeds 10,000, omit the counts and return `countsOmitted: true`, which the UI
renders as "catalog too large to summarize" — rather than letting a large store
turn its Routing page into a slow query.

### Admin (`requirePermission('shopify_funnels.write')`)

`GET/POST/PATCH/DELETE /admin/shopify/funnel-rules`, mirroring the merchant
routes with `store_id` forced NULL. `GET` includes, per rule, **how many stores
have disabled it** — a global rule half your merchants have switched off is a
rule that is wrong, and that signal is otherwise invisible.

Global-rule mutations must write `audit_logs` through `recordAudit(tx, …)`
inside the mutation's transaction, per the CLAUDE.md invariant. Note that the
existing basket CRUD in `admin/shopify-funnels.routes.ts` does **not** do this —
`recordAudit` has zero matches in that file. Adding new unaudited admin writes
beside it is not acceptable; closing the pre-existing basket-CRUD gap is a
separate small fix, tracked but not bundled here.

The admin basket-delete confirmation must state how many store rules across how
many stores the cascade will remove (`schema/shopify.ts:280` already cascades).
Per CLAUDE.md, state what will be lost before a cascade.

## UI

### Merchant — a new Routing page, not a fourth Manage tab

`ManagePage`'s tabs (`collections | individual | exclusion`) are each gated by
`isTabEditable(mode, …)` because all three are facets of *activation* (global vs
selective mode). Basket routing is orthogonal — it applies identically in both
modes — so a fourth tab would inherit that gating and be wrong in global mode.
Routing gets its own entry in `NAV_ITEMS` (`apps/shopify/src/App.tsx`).

```
Routing
├ Your rules                                          [+ Add rule]
│   Saree   ← tags contains "saree"  OR  product_type = "Saree"   pri 10  ⋮
│   Upper   ← product_type = "Shirt"                              pri 20  ⋮
│
├ Default rules  (from AiVastra)
│   Saree   ← tags contains "saree"                             [ on  ● ]
│   Lower   ← product_type = "Pants"                            [ off ○ ]
│
└ Where your products land
    Saree 214 · Upper 96 · Lower 41 · Shoes 12 · Default 8
```

That counts row is what makes rules trustable rather than mysterious.

Per-product pinning goes where per-product controls already live: a **Basket**
column in the Individual Products tab with a selector, a source badge
(`Pinned` / `Rule` / `Default`), and "Reset to automatic" sending
`funnelTemplateId: null`. When a pinned basket has been deactivated, the row
shows "pinned basket unavailable, using X".

### Admin — `apps/admin-web/src/pages/ShopifyFunnelsPage.tsx`

A **Global rules** card beneath the existing baskets table: one row per basket,
an inline condition editor (field / operator / value), priority, and the
disabled-by-N-stores count.

## Rollout

**The feature must be inert on deploy.** Ship with zero global rules authored,
so resolution falls straight through to step 4 and every live store behaves
exactly as today. Global rules are then authored deliberately, watching the
counts. A migration that seeded rules would silently re-route live catalogs onto
different workflows on deploy — a visible output-quality change nobody asked for
and nobody could attribute.

Two production reads to perform **before** writing the migration (reads against
production are permitted; writes are not):

1. `select count(*) from shopify_funnel_rules` — assumed empty because no code
   writes it, but the partial unique index is only safe to add on an empty
   table, and "no writer today" is not proof of "no rows ever".
2. `select count(*) from shopify_product_garments where funnel_template_id is
   not null` — these rows become merchant-visible **Pinned** badges under the
   new semantics. They originate from the admin reassign-on-delete path, so
   `funnel_assignment_source` needs backfilling where null, or the Manage page
   renders a pin with no explanation of who set it.

Migration, generated locally and shipped push → CI → `db:migrate:prod`, never
run against production directly:

```
1  shopify_funnel_rules.store_id           drop NOT NULL
2  shopify_funnel_rules                    drop column `mode`
3  + partial unique (funnel_template_id) where store_id is null
4  + shopify_store_disabled_funnel_rules   (+ both FK cascades)
5  backfill funnel_assignment_source = 'admin_reassign'
   where funnel_template_id is not null and funnel_assignment_source is null
```

## Failure modes

| Situation | Behaviour | Reason |
|---|---|---|
| Nothing resolves, no active default | Refuse **before** credit deduct — today's 202 soft message plus `log.error` | Unchanged from current code. Enqueueing would burn a credit and produce a `FAILED` row no merchant can fix |
| Pinned basket deactivated | Fall through to rules → default; UI shows the substitution | A silent dead-end for every pinned product is worse than a visible downgrade |
| Rule with empty conditions | Matches **nothing**. `min(1)` enforced on write, and treated as no-match at read regardless | Read as "matches everything", a half-filled form becomes a catalog-wide hijack. Fail closed |
| Basket deleted | Rules cascade (`schema/shopify.ts:280`), suppressions cascade from there | Already correct; the admin confirmation must state the counts |
| Rule edited while a job is enqueuing | No effect | Workflow pinned into `params.workflowTemplateId` at enqueue |
| Runaway rule sets | ≤20 conditions per rule, ≤50 rules per store, condition `value` ≤200 chars — all enforced by the Zod route schemas | Bounds a per-product loop that is otherwise merchant-controlled |

## Tests

**Unit — pure, no DB.** `resolveBasketFrom` / `matchesCondition` carry the real
coverage, because the precedence rule is the feature:

- each tier wins in turn: manual > store rule > global rule > default
- a store rule at priority 100 beats a global rule at priority 1
- equal priorities tie-break deterministically by `id`
- an inactive pinned basket falls through; an inactive basket is never claimed
  by a rule
- a suppressed global rule is skipped **for that store only**
- all four fields × both operators, case-insensitively
- null and empty columns never match and never throw
- an empty conditions array matches nothing
- no active default configured returns `null`

**Integration** (`apps/api/test/integration/`, the containers harness, unique
slugs per CLAUDE.md):

- a try-on runs the resolved basket's workflow and pins it into
  `job_inputs.params.workflowTemplateId`
- when nothing resolves, the store credit balance is unchanged and no `jobs` row
  exists — asserting the refusal precedes the deduct, not merely that it refused
- a merchant `PATCH`/`DELETE` against a global rule returns 404, and a merchant
  cannot disable their own rule through the suppression route
- `PATCH` product with `funnelTemplateId: null` clears the pin and routing
  reverts to rules
- store A's suppression is invisible to store B

Existing files needing updates: `apps/api/test/shopify-funnel-templates-admin.test.ts`,
`apps/api/test/integration/shopify-customer.test.ts`, and
`apps/api/test/shopify-refusal-events.test.ts` (it seeds funnel templates at
line 84).

Run integration files individually. The full-suite rate-limiter cascade
documented at `docs/progress.md:2604` is pre-existing and would otherwise mask
real failures.

## Open questions

- **Per-store default basket.** Unmatched products currently fall to the single
  global default. A store might reasonably want its own fallback (a saree-only
  store wanting `saree`, not `upper`). Not built — it needs only a nullable
  `settings.defaultFunnelTemplateId` on `shopify_stores` and one extra step
  between 3 and 4, so it stays cheap to add once a merchant asks.
- **Basket-CRUD audit gap.** `admin/shopify-funnels.routes.ts` writes no
  `audit_logs`. Flagged above; needs its own fix.
