# WordPress / WooCommerce Plugin — Integration Design

> **Status:** Design proposal, not yet implemented. No code exists for this yet.
> **Scope:** How a self-hosted WordPress/WooCommerce plugin connects to this
> platform, analogous to the existing Shopify integration (`apps/shopify`,
> `apps/shopify-extension`). Based on the live Shopify code and the current
> `merchants`/dev-API surface — not `docs/multi-app-ecosystem-plan.md`, which
> is stale and does not reflect the current codebase.

---

## 1. Goal & non-goals

**Goal:** a merchant installs a WordPress plugin on their self-hosted
WooCommerce store, connects it to their aivastra account, and a "Try It On"
button appears on product pages, backed by the same job/dispatcher pipeline
every other surface uses.

**Non-goals for v1:**
- A product/catalog sync API. WooCommerce product data (image, title, ID)
  lives on the merchant's own server and is read directly by the plugin's PHP
  at render time — nothing to sync or cache.
- Marketplace billing. WordPress.org plugins can't charge; credits stay
  Razorpay-based through the existing merchant portal.
- A new per-site multi-domain account model. `merchants` is already 1:1 with
  a `users` row (`merchants.userId` unique, `packages/db/src/schema/merchant.ts:53-56`);
  a WordPress site is just another API-key holder against that same account.

## 2. Why this isn't a straight port of the Shopify architecture

| Shopify mechanism | Why it exists | WordPress reality |
|---|---|---|
| Managed install + App Bridge session tokens (embedded iframe) | Shopify hosts the admin surface inside its own iframe | No iframe, no session-token concept — the plugin is plain server-side PHP |
| Session-token exchange for offline token (no OAuth `code` flow) | Shopify's managed-installation contract | No install-time handshake at all — WP just downloads a zip and activates it |
| App Proxy HMAC-signed storefront calls (`shopify-widget-auth.ts`) | Lets an embedded key sit in page source safely — Shopify signs each call server-side | No App Proxy equivalent off-platform; needs a different way to keep a page-embedded key safe (§4.2) |
| Billing via Shopify App Pricing, polled subscriptions | Shopify's marketplace billing has no webhooks | No marketplace billing exists; reuse the existing Razorpay/credits flow |
| Theme app extension (Liquid block dragged into template) + shop metafield cache for widget config | Shopify data lives in Shopify's systems; the storefront can't call our API live for config on every page load | A WooCommerce hook renders server-side PHP with live access to product/site data — no cache-staleness problem to solve |

## 3. What already exists and gets reused as-is

Traced directly in the current codebase, not the old ecosystem plan:

- **`merchants`** (`packages/db/src/schema/merchant.ts:16`) — account, credit
  balance (via `user_credits`), catalog CRUD, Razorpay checkout
  (`apps/api/src/modules/merchant/payments.routes.ts`). A WordPress connection
  is just another way to reach an existing merchant account.
- **Dev API** (`apps/api/src/modules/dev/`, mounted at `/v1/dev/*`) — already
  platform-agnostic:
  - `POST /v1/dev/tryon` — job creation, multipart or JSON/base64,
    `{category, person, garment}` (`routes.ts:104`). No Shopify assumptions.
  - `GET /v1/dev/jobs/:id` — poll status/result (`routes.ts:368`).
  - `GET /v1/dev/me` — `{merchantId, companyName, credits}` (`routes.ts:68`).
  - Auth: Bearer `sk_live_[A-Za-z0-9_-]{43}`, sha256-hashed and looked up
    against `api_keys` joined to `merchants`
    (`apps/api/src/plugins/dev-api-auth.ts:20-37`); 60/min per-key rate limit.
- **`POST/DELETE /v1/merchant/api-keys`** — self-serve key issuance/revocation,
  gated by the merchant's own JWT session so a leaked dev-API key can never
  mint another key (`api-keys.routes.ts:12-14`).

Net: the account, credit, and job-execution machinery needs **no changes**.

## 4. What's new

### 4.1 Connection flow: paste an API key, not OAuth

Merchant logs into their aivastra merchant account → generates an API key
under **Settings → API Keys** → pastes it into the WP plugin's own settings
screen (**Settings → Aivastra Try-On**). The plugin stores the key server-side
in `wp_options` — never rendered into a page the browser can read — and
verifies it on save via `GET /v1/dev/me`.

| | Paste-key (recommended) | OAuth-style "Connect" button |
|---|---|---|
| **Dev cost** | Zero new backend surface — reuses existing key issuance and `dev-api-auth` verbatim | New authorize/callback/state-nonce endpoint pair, open-redirect hardening, a hosted consent screen — real net-new surface and attack surface |
| **User cost** | One manual copy/paste step | One-click, no copy/paste, but WordPress store owners are already comfortable pasting API keys (this is the standard pattern for Akismet/Yoast/Jetpack-style plugins) |

**Recommendation:** ship paste-key for v1. Revisit a Connect-button flow only
if onboarding friction shows up in support tickets — building OAuth machinery
speculatively is exactly the kind of premature abstraction this repo's own
conventions warn against.

### 4.2 The one real gap: a storefront-safe key scope

**Problem:** a full `sk_live_` dev-API key has no per-request restriction — it
can read account info, generate catalogs, everything. The storefront widget
needs *some* key embedded in the public product page so the shopper's browser
can call the try-on API directly (matching the existing "browser uploads
direct, API never proxies binary payloads" pattern used everywhere else in
this system). Embedding the full account key would hand any page visitor
complete account access.

Shopify already solved the identical problem with a separate, restricted
`storeKey`/`widget_key` validated via `x-widget-key`
(`apps/api/src/plugins/shopify-widget-auth.ts:53-77`) — this is precedent, not
a new class of risk being introduced.

**Proposal:** add a `scope` column to `api_keys` (`'full' | 'widget'`,
default `'full'` — no behavior change for existing keys), enforced by an
explicit per-route allowlist, not a vague "restricted" designation:

| Route | Full | Widget |
|---|---|---|
| `GET /v1/dev/me` | Yes | No |
| `POST /v1/dev/tryon` | Yes | Yes |
| `GET /v1/dev/jobs/:id` | Yes | Yes |
| `POST /v1/dev/saree-mannequin` | Yes | No |
| `GET/POST /v1/dev/catalog/*` | Yes | No |

Widget keys also get a tighter, per-site rate limit than the account-wide
60/min, and are issued through the same `/v1/merchant/api-keys` route with
`{label, scope: 'widget'}`.

**Enforcement is centralized, not scattered per-handler** — this codebase
already has the exact pattern to follow:
`apps/api/src/modules/admin/guard.ts:35`'s `requirePermission(permission)` is
a factory returning a `preHandler`, composed on top of the base auth
decorator. Mirror it with `requireDevScope(scope: 'full' | 'widget')` in
`dev-api-auth.ts`, composed as
`preHandler: [app.requireApiKey, requireDevScope('full')]` on the
full-only routes above. No route reads `req.apiKeyScope` and branches inline.

**Job-polling ownership is already correct today, unchanged by this design.**
`GET /v1/dev/jobs/:id` (`apps/api/src/modules/dev/routes.ts:415`) already
rejects with 404 when `job.apiKeyMerchantId !== req.merchantId` — ownership is
resolved server-side from the authenticated key, never the request. A
`wordpress_tryon` job created through the same `createDevTryonJob` path
inherits this automatically; stating it here so the invariant isn't only
implicit in code a future reader of this doc wouldn't otherwise check.

This is the **only** backend/schema change this design requires. Everything
else is new WordPress plugin code consuming endpoints that already exist.

**Decided: ship the `widget` scope at launch**, not deferred to a later
release. The risk it closes (full account key sitting in public page source)
is live from the first WordPress install, so there's no "v1 without it" that
isn't just shipping the vulnerability first and patching later.

**Key minting stays JWT-only — no exception, including for full-scoped keys.**
`api-keys.routes.ts:11-14` gates `POST /v1/merchant/api-keys` on the
merchant's session JWT specifically so a leaked key — of any scope — can never
mint another key or enumerate its siblings. The WordPress plugin must not be
given a path that lets it call that route with a stored API key, even a full
one, because that would be a new, permanent exception to an existing,
deliberate invariant, carved out for one integration's convenience. The
plugin never mints keys itself: the merchant generates *both* keys they need
in the merchant portal (browser, JWT session) — the existing full key, and a
second key created with `{label, scope: 'widget'}` — and pastes both into WP
settings. §4.3 reflects this: two paste fields, not a generate-in-plugin
button.

### 4.2a Job source attribution — reuse the existing registry, don't invent one

A job-taxonomy registry already exists and has shipped:
`packages/types/src/job-taxonomy.ts` (`JOB_SOURCE`, 13 canonical values stored
in `jobs.source` — `packages/db/src/schema/jobs.ts:38-42`), rationale in
`docs/superpowers/specs/2026-07-30-job-taxonomy-registry-design.md`. Every
value is a flat platform+operation combo (`shopify`, `merchant_tryon`,
`api_tryon`, `api_saree_mannequin`, `api_catalog`, …) — that design doc's §9/§10
explicitly considered and rejected splitting source into orthogonal
`source`/`type` dimensions or relating source to worker pool via a table,
because pool selection is driven by job *shape*, not `source`, and at least
one real case (`merchant_catalog`) can't be expressed as a static one-to-one
mapping. WordPress attribution should follow the existing convention, not
reopen that decision.

**Add one value:** `WORDPRESS_TRYON: 'wordpress_tryon'` to `JOB_SOURCE`, named
like its `api_tryon`/`merchant_tryon` siblings.

**Never trust the client to declare its own source.** Extend `api_keys` with
an `integration` column (`'generic' | 'wordpress'`, independent of the
`scope` column above — one gates *what a key can call*, the other gates *what
source gets stamped*). `dev-api-auth.ts`'s key lookup resolves
`req.integration` server-side from the authenticated key row, the same place
it already resolves `req.merchantId`
(`apps/api/src/plugins/dev-api-auth.ts:20-37`). `createDevTryonJob` then picks
`JOB_SOURCE.WORDPRESS_TRYON` vs `JOB_SOURCE.API_TRYON` based on that resolved
value — mirroring exactly how today's `api` job creators are already chosen by
server-side context, never a request-body field
(`apps/api/src/modules/dev/create-job.ts:25,44,164`).

**Dispatcher impact: none.** A `wordpress_tryon` job has the identical shape as
today's `api_tryon` job (no `faceId`/`backgroundId`/`poseId`,
`params.personKey` set) and lands in the same `tryon` worker pool
automatically, since pool selection is shape-based by explicit design. No new
migration is needed on `jobs.source` itself — it's unconstrained `text` with no
CHECK constraint, by the same deliberate choice documented in the registry
spec. If a WordPress-originated saree-mannequin flow is ever needed, add
`wordpress_saree_mannequin` then, following the identical pattern — not now.

### 4.3 WordPress plugin structure (spec — no implementation here)

- `aivastra-tryon.php` — bootstrap, activation/deactivation hooks. No external
  calls on activation; connection happens explicitly in settings.
- `admin/settings-page.php` — native WP Settings API page: two paste fields —
  the full API key and the widget-scoped key (both generated by the merchant
  in the merchant portal, not by the plugin — see §4.2), held server-side
  only; accent color, button copy, per-product-category enable toggle.

  **Do not persist the full key.** It's used exactly once, at save time, for a
  `GET /v1/dev/me` connection check (company name, credit balance), then
  discarded — only the resulting snapshot (`companyName`, `creditsAsOf`
  timestamp) and the widget key are stored in `wp_options`. WordPress installs
  vary enormously in hosting security, and a plugin holding a full
  account-level credential at rest indefinitely is a materially larger blast
  radius than the widget key that's already accepted as page-source-exposed —
  the entire reason for the scope split (§4.2) is to keep the powerful
  credential out of the least-trusted environment; discarding it after use
  extends that same reasoning to storage, not just transport. Cost: the
  displayed credit balance goes stale until the merchant re-enters the full
  key via an explicit "Refresh connection" action — an acceptable trade for
  not keeping a standing full-account secret on infrastructure this platform
  doesn't control.
- **Key lifecycle / error handling** — the storefront widget and the admin
  settings page must handle an invalid key distinctly, since a widget key can
  be revoked out from under a live storefront at any time:
  - Widget JS: a 401 from `/v1/dev/tryon` or `/v1/dev/jobs/:id` shows "Try-on
    is temporarily unavailable" and stops — no automatic retry loop.
  - Admin settings page: no background health-check/cron polling the key
    (nothing here justifies that infrastructure yet — detect lazily). The
    "Widget Key: Invalid" state is set the next time any admin-initiated
    action (saving settings, an explicit "Test connection" button) gets a 401,
    not proactively.
- `public/widget-loader.php` — hooked to `woocommerce_single_product_summary`;
  reads `$product->get_id()`, `get_image_id()`, `get_permalink()` directly
  (always fresh — no cache-sync problem, unlike Shopify's metafield mirror);
  enqueues `widget.js`/`widget.css`; passes config via `wp_localize_script`
  (`{widgetKey, apiBase, productImage, productId, productTitle}`).
  **Variable products:** the garment image must track the shopper's selected
  variation, not the parent product — WooCommerce fires
  `found_variation`/`show_variation` JS events with the variation's image on
  selection. `widget.js` listens for that event and swaps its `productImage`
  config value; before any selection (or for a simple product), it falls back
  to the parent image `widget-loader.php` already localized. Getting this
  wrong sends the wrong garment into the try-on job — a functional bug, not a
  cosmetic one — so it belongs in v1, not a follow-up.
- `assets/widget.js` — **new, WordPress-specific.** Not shared with Shopify's
  `tryon-widget.js`, which is tightly coupled to App Proxy HMAC signing,
  Liquid globals (`product`, `customer`, `shop.metafields`), and Shopify's own
  `/cart/add.js` AJAX API — none of that is portable. Calls the dev API
  directly (`Authorization: Bearer <widgetKey>`) for job creation + polling;
  on completion, offers download and WooCommerce's own add-to-cart AJAX
  contract (`?add-to-cart={id}`).
- No PHP-side proxying of image uploads or job calls — the shopper's browser
  talks to the API directly with the restricted widget key, so image bytes
  never round-trip through the merchant's own (often size/timeout-capped) WP
  hosting.

**Decision not taken here:** extracting a shared "widget core" package
between Shopify's and WordPress's frontend JS. With exactly two platforms and
Shopify's implementation deeply coupled to Shopify-only mechanisms, extracting
a generic core now is speculative generalization from a sample size of two.
Revisit if a third platform integration is actually scheduled.

### 4.4 Distribution

| | Direct-download zip | WordPress.org plugin directory |
|---|---|---|
| **Dev cost** | No review cycle, fast iteration, full control over release cadence | GPL-compatible licensing, strict code review (readme.txt format, sanitized output, no obfuscation, disclosed external requests), SVN-based releases outside this repo's tooling |
| **User cost** | Merchant must self-update, no organic discovery | One-click install/update from wp-admin, discoverable via search |

**Recommendation:** build and validate as a direct-download zip first (fastest
path to a working plugin on a real test store); submit to WordPress.org once
stable, since discoverability is that channel's only real advantage over
direct distribution.

### 4.5 Repo placement

PHP shares no tooling with this pnpm/TypeScript monorepo — no build step, no
CI job type, nothing analogous to `make shopify-deploy` to hook into.
**Recommendation: a separate repository** for the plugin itself, with only
this design doc staying here as the API-contract reference. A monorepo folder
is a defensible minority choice if cross-repo doc discoverability matters more
than tooling cleanliness — flagging it as your call, not re-deciding it here.

## 5. Decided

- **`api_keys.scope` (`'full' | 'widget'`) ships at launch** (§4.2), not
  deferred — the full-key-in-page-source risk it closes exists from the first
  install. Key issuance (both scopes) stays JWT-only through the merchant
  portal; the plugin never mints keys itself, preserving
  `api-keys.routes.ts:11-14`'s invariant unmodified.
- **`api_keys.integration` and `JOB_SOURCE.WORDPRESS_TRYON` ship at launch**
  (§4.2a), not deferred. Confirmed: one `api_keys` column, one registry value,
  one `dev-api-auth.ts` resolution point, one branch in `createDevTryonJob` —
  small enough that deferring it only costs clean per-platform reporting from
  day one for no real savings. No `source + type` redesign, no new taxonomy:
  this is an addition to the existing `JOB_SOURCE` registry
  (`packages/types/src/job-taxonomy.ts`), following the same convention as
  `api_tryon`/`merchant_tryon`/`shopify`. Attribution is always resolved
  server-side from the authenticated key's `integration` column — never from a
  client-supplied field on the job-creation request body.

## 6. Open questions

1. **Repo placement** (§4.5) — new separate repo (recommended) or a folder in
   this monorepo?
2. **Distribution** (§4.4) — direct zip first, then WordPress.org (recommended)
   or WordPress.org from day one?
3. **Add-to-cart in v1** — does the try-on result need WooCommerce add-to-cart
   integration immediately, or is download-only sufficient for a first
   release?
