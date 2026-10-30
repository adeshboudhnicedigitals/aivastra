# Shopify: single workflow, funnel removal, onboarding page 1 progress

Sub-project 1 of 4 in the Shopify simplification (see also the contact-phone,
login-required and theme-block specs of the same date).

## Goal

Every Shopify try-on runs one admin-selected workflow. Baskets (funnel
templates), routing rules, per-product pins and the garment-type picker are
removed. Onboarding page 1 only imports the catalogue, shows progress, and lets
the merchant continue.

## Decisions (agreed)

- **Activation:** completing onboarding sets `settings.activation.mode = 'global'`
  (all products on; merchant narrows via Manage exclusions/collections). Stores
  that already finished onboarding keep their current mode.
- **DB teardown:** two releases. Release 1 removes every code read/write.
  Release 2 (separate PR, later) drops the tables/columns via a migration shipped
  through CI and `db:migrate:prod`, never a live session.
- **Setting location:** top-level `config:system.shopifyWorkflowTemplateId` in
  Redis JSON, edited from the admin Shopify workflow page.

## Design

### Job path (API)
- `customer.routes.ts` stops calling `resolveBasket`. A new
  `resolveShopifyWorkflow(app)` reads the configured template id, verifies the
  `workflow_templates` row exists and is active, and returns
  `{ workflowTemplateId, workflowTemplateVersion }`.
- Unset or inactive: refuse before the credit deduct (`202`, "not available",
  same shape as today's no-basket refusal) and log a warning. Never enqueue a job
  that would fail `NO_WORKFLOW_CONFIGURED`.
- The id is still pinned into `job_inputs.params.workflowTemplateId` at enqueue;
  the dispatcher already reads only the pinned value (processor.ts, "funnel
  removal" comment) and needs no change.
- The widget `enabled` endpoint replaces its `resolveBasket` check with the same
  resolver.

### Release-1 transition shim
If the config value is unset, fall back to the sole workflow shared by all active
funnel templates. This avoids a window where all Shopify try-ons refuse between
deploy and the admin choosing a workflow. The shim, and its read of the funnel
tables, is deleted in release 2. Admin must set the value explicitly before
release 2.

### Admin (`apps/admin-web`)
- Remove `ShopifyFunnelsPage`, its route, sidebar entry (`shopify-funnels`,
  permission `shopify_funnels.write`) and `BasketImageField`.
- Add a "Shopify workflow" `SearchableSelect` over workflow templates to the
  Shopify settings, saved through `PATCH /admin/config` (audited like the other
  config fields). The permission reuses the existing config write permission.

### Merchant app (`apps/shopify`)
- `OnboardingProductsPage`: import on arrival (existing sync + poll), replace the
  spinner with a progress bar showing `imported / total` (e.g. 50/50) driven by
  the sync status, then enable Continue. `/v1/shopify/products/sync/status`
  returns only `{ state }` today, so it gains `imported` and `total` (the sync
  consumer already knows both; check `products.sync.ts` for where to record them,
  Redis counters keyed by store); until `total` is known the bar is indeterminate. No picker, no garment type, no baskets.
  Empty store keeps the "couldn't find any products" state with Import again.
- Continue calls `/v1/shopify/onboarding/complete` flow as today; the API sets
  global mode when the store has never completed onboarding.
- `getOnboardingStep` / `isSelectionDone` / `isBasketsDone` collapse: the products
  step is done when `syncedProductCount > 0`.
- Delete `RoutingPage`, `BasketAssignmentStage`, `ProductSelectionStage`,
  `lib/baskets`, `lib/productSelection`, `lib/productBaskets.test`. Redirect the
  old `/routing` path to `/manage`.
- `ManagePage`: drop basket/routing sections and unrouted warnings; keep
  activation, exclusions, collections.
- `AnalyticsPage` / `BarChart`: the existing conversion funnel is unrelated to
  baskets and remains unchanged.

### API removal
- Delete `funnel-resolution.ts`, `funnel-rules.routes.ts`,
  `admin/shopify-funnels.routes.ts`, `admin/shopify-funnel-rules.routes.ts` and
  their `server.ts` registrations.
- Strip `funnelTemplateId` from `products.routes.ts` (PATCH + list) and
  `products.bulk.ts`; strip basket and `unroutedEnabled` counts from `me.routes.ts`
  and analytics; remove funnel handling in `workflows.routes.ts`,
  `workflow-mapping-reassign.ts`, `workflow-change-requests.routes.ts`,
  `activation*.ts`, `products.sync.ts`, `dev/analytics`.
- Delete the funnel test files; prune funnel cases from the remaining suites.

### Release 2 (separate PR)
Migration drops `shopify_store_disabled_funnel_rules`, `shopify_funnel_rules`,
`shopify_funnel_templates`, and `shopify_product_garments.funnel_template_id` /
`funnel_assignment_source`; remove the shim; update CLAUDE.md (Shopify "Product
routing" paragraph, schema map, key files) and `docs/progress.md`. Before
writing the drop, state what is lost (rule and basket rows, pins) per CLAUDE.md.

## Tradeoff: where the setting lives

| | Developers | Merchants / admins |
|---|---|---|
| Admin config (chosen) | Existing pattern, no migration | Safe with the shim; if Redis config were lost, try-on refuses until re-picked |
| New DB column/table | Atomic backfill, durable | New schema just before dropping schema; extra migration risk |

## Behaviour change to record

Live stores' products pinned to or routed by baskets now all run the one
workflow. Intended; note it in `docs/progress.md`.

## Testing

- API: resolver unit tests (set / unset / inactive / shim fallback); integration:
  try-on creation pins the configured workflow, refuses before deduct when none;
  `enabled` endpoint parity; onboarding complete sets global mode only on first
  completion.
- Admin: config PATCH round-trip for the new field.
- SPA: onboarding step derivation, progress bar states (running, done, empty,
  failed with retry).
- `pnpm typecheck` and the API unit + integration suites; run, don't infer.

## Out of scope

Dropping tables (release 2); WhatsApp baskets (`whatsapp-baskets.routes.ts` is a
separate system); per-merchant workflow choice.
