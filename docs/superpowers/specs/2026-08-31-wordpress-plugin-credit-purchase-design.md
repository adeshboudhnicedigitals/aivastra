# WordPress plugin — in-plugin plan browsing & credit purchase

## Purpose

Today, `Settings → Aivastra Try-On` (the WooCommerce plugin merchants install on
their own store, `wordpress-plugin/`) only lets a merchant connect two API keys
and map WooCommerce categories to aivastra workflows. There is no way to see
plans or buy credits without leaving WordPress — the merchant has to already
know to log into the separate aivastra web app. Shopify merchants get this
inside their embedded admin (`apps/shopify`'s `PricingPage`: balance, one-time
pack purchase, auto-refill). This spec closes that gap for WordPress: a
"Plans & Credits" card on the settings page showing live plan tiers and a
"Buy" button per plan that completes a Razorpay purchase without leaving
wp-admin.

**Not in scope:**
- An auto-refill equivalent. Shopify's auto-refill rides Shopify's own
  subscription billing, which has no WordPress analogue — a real product
  decision on its own, not assumed here.
- wordpress.org or WooCommerce Marketplace submission. The plugin ships as a
  direct-download zip (existing design doc §4.4, reaffirmed here); the
  compliance questions below are recorded for when that changes, not acted on
  now.
- Catalogue creation inside wp-admin (already an open question in
  `docs/wordpress-plugin-design.md` §6.5, untouched by this work).

## Two different "WordPress"s — do not confuse them

- `aivastra.com` (the company's own marketing site, itself WordPress, outside
  this repo) already has a "Buy Now → auto-checkout" deep link:
  `app.aivastra.com/pricing?plan=<slug>` (see
  `docs/superpowers/specs/2026-08-18-pricing-plan-deep-link-design.md`). That
  mechanism is unrelated to this spec.
- `wordpress-plugin/` (this repo) is the WooCommerce plugin an **end-merchant**
  installs on **their own** store. This spec is about that plugin's admin
  settings screen.

## Compliance check (recorded, not blocking — direct-zip distribution chosen)

Verified against `developer.wordpress.org/plugins/wordpress-org/detailed-plugin-guidelines/`:

- **Guideline 6** explicitly permits a plugin that requires payment for an
  external SaaS service, including one where continued use depends on a paid
  balance, provided the service delivers real functionality (GPU inference
  has real marginal cost — this is not the prohibited "license-key-only, all
  functionality local" case) and is documented in the readme with a link to
  the Terms of Use.
- **Guideline 5**'s trialware ban ("functionality disabled after a quota is
  met") does not apply here because of the Guideline 6 carve-out above.
- **Guideline 7** requires disclosed consent for external server calls —
  already owed for the existing key/job API calls regardless of this feature.
- Nothing in these guidelines constrains *how* payment is collected; embedding
  Razorpay checkout in wp-admin is not against wordpress.org policy.
- WooCommerce Marketplace (Woo's own paid-extension marketplace, separate from
  the free wordpress.org directory) has no authoritative public rule found in
  this pass for "free extension requiring a paid external account" — common in
  practice there (shipping/marketing SaaS connectors), but needs a dedicated
  check against Woo's current partner docs if that channel is ever pursued.

Since distribution is direct-zip only for now, none of this blocks the design
below — recorded so a future decision to list on either channel starts from
verified ground instead of re-litigating it.

## Decisions

1. **Purchase happens inside wp-admin** (embedded Razorpay checkout), not a
   deep-link to the web app. Chosen over the lower-risk deep-link alternative
   for UX parity with Shopify.
2. **The full API key becomes a persisted credential**, reversing the existing
   design doc's explicit "used once, discarded" decision
   (`docs/wordpress-plugin-design.md` §4.3). This is required because Razorpay
   order creation is a money-committing, account-identifying action that
   needs full-scope authority, and embedding the purchase in wp-admin (rather
   than asking the merchant to re-paste the full key at every purchase) was
   chosen for UX parity with Shopify's single-click buy flow. Consequence: a
   compromised WordPress install now exposes a standing full-account
   credential, not just the already-page-source-exposed widget key. This is
   an accepted, deliberate tradeoff — not an oversight.
3. **Verification does not need the full key.** Confirming a completed
   Razorpay payment is a signature check against an order already tied to a
   specific merchant at creation time — the persisted widget key is
   sufficient and keeps the full key's use as narrow as possible (order
   creation only).
4. **Plans reuse `MERCHANT_PLAN_BILLING` as-is** (`packages/types/src/widget.ts`:
   Basic/Advanced/Pro/Ultra), the same tiers already defined for merchant
   Razorpay billing. No new plan model.
5. **Reuse, don't duplicate, the existing Razorpay logic.**
   `apps/api/src/modules/merchant/payments.routes.ts` already implements order
   creation, signature verification, and idempotent credit granting, gated on
   `requireMerchant` (browser JWT) — and has **no frontend consumer anywhere
   in this repo today**. This spec extracts that logic into a shared helper
   callable from both the existing JWT route (unchanged) and the new dev-API
   routes below, rather than reimplementing it.

## Backend: new dev-API routes (`apps/api/src/modules/dev/`)

| Route | Scope | Behavior |
|---|---|---|
| `GET /v1/dev/plans` | widget | Returns `MERCHANT_PLAN_BILLING` (slug, name, priceInr, credits) — pure display data, no secrets, safe for the widget key |
| `POST /v1/dev/payments/orders` | **full only**, via `preHandler: [app.requireApiKey, app.requireDevScope('full')]` | Body `{ planSlug }`. Creates the Razorpay order via the shared helper, inserts a `merchantPayments` row scoped to `req.merchantId` (resolved server-side from the authenticated key, never client input — same pattern as `createDevTryonJob`'s source attribution) |
| `POST /v1/dev/payments/verify` | widget | Body `{ razorpayOrderId, razorpayPaymentId, razorpaySignature }`. Verifies the HMAC signature against the order row (already merchant-scoped from creation) and grants credits via the shared helper |

**Shared helper extraction:** move `createRazorpayOrder` and
`grantMerchantCredits` out of `payments.routes.ts` into a module both the
existing `/v1/merchant/payments/*` routes and the new `/v1/dev/payments/*`
routes import — no behavior change to the existing JWT-gated routes.

**Why the scope split is safe:** a leaked widget key (the storefront's
accepted exposure) gaining `/v1/dev/payments/verify` access cannot forge a
valid Razorpay signature, so it can at most attempt verification on an order
it didn't create, which fails. Order creation — the only step that commits to
"charge merchant X" — stays behind the full-scope check.

## WordPress plugin changes

### `Aivastra_Connection_Settings`

- New field `full_key` in the plugin's `wp_options` row, **encrypted at rest**
  via `openssl_encrypt`/`openssl_decrypt` (AES-256-CBC) using a key derived
  from `wp_salt('auth')` — WordPress's own per-install secret defined in
  `wp-config.php`, not stored in the database, so a raw DB dump does not
  trivially expose the key. This is the standard pattern WordPress plugins use
  to persist secrets without an external KMS (comparable to how payment
  gateway plugins store secret keys in `wp_options`).
- `handle_connect()` now stores the encrypted full key alongside the widget
  key and snapshot (previously discarded after the `GET /v1/dev/me` check).
- `handle_disconnect()` / `clear()` wipes it along with everything else.
- Settings-page copy for the full-key field changes from *"Verified once
  against your account, then discarded — never stored."* to accurately
  describe that it is now stored (encrypted) to authorize future purchases.

### `Aivastra_Connection_Service`

- New method `list_plans(string $widgetKey)`, mirroring `list_categories()` —
  calls `GET /v1/dev/plans`.
- New method `create_order(string $planSlug)` — decrypts the stored full key,
  calls `POST /v1/dev/payments/orders`, returns the public order fields
  (`orderId`, `amount`, `currency`, `keyId`) needed to open Razorpay
  checkout — never returns the decrypted key itself to any caller outside
  this method.
- New method `verify_payment(array $razorpayResponse)` — calls
  `POST /v1/dev/payments/verify` with the stored widget key, then updates the
  balance snapshot via the existing `update_credits()` on success.

### Settings page UI (`admin/class-settings-page.php`)

A new "Plans & Credits" card, rendered alongside the existing status card once
connected:
- Plan tiles for Basic/Advanced/Pro/Ultra, fetched via `list_plans()` on every
  page load (widget key, no extra auth step) — same "always visible, no
  health-check infrastructure" philosophy as the existing category-mapping
  card.
- Each tile has a "Buy" button. Click → `admin-post` action
  (`aivastra_tryon_create_order`) calls `create_order($planSlug)` server-side,
  then renders a page with the returned public order fields
  `wp_localize_script`'d into a new `admin/assets/checkout.js`.
- `checkout.js` loads Razorpay's `checkout.js` SDK and opens the payment
  modal using only the public order fields (mirrors
  `apps/catalogues-web`'s existing `buy()` function).
- On success, `checkout.js` posts the Razorpay response to a new
  `admin-ajax` action (`aivastra_tryon_verify_payment`), which calls
  `verify_payment()` server-side and returns the updated balance for the page
  to display without a full reload.

### Error handling

| Case | Behavior |
|---|---|
| Full key rejected/revoked at order-creation time | Same "Widget Key: Invalid"-style notice as today's lazy-detection pattern; prompts reconnect via the existing "Update connection keys" accordion |
| Razorpay modal dismissed by the merchant | Silent — no error notice, matching the web app's `dismissed` handling |
| Order created but never paid | Left as a `created`-status row — audit trail, identical reasoning to the existing Shopify one-time-purchase design (`purchase.ts`'s comment on insert-before-charge) |
| Payment succeeded but `verify` call fails (network blip, etc.) | Distinct message: "Payment received but not yet reflected — click Refresh balance." Must never look like a silent failure, since real money moved |

## Testing

- Integration tests for `GET /v1/dev/plans`, `POST /v1/dev/payments/orders`
  (scope enforcement: full key succeeds, widget key gets 403), and
  `POST /v1/dev/payments/verify` (valid/invalid signature), in
  `apps/api/test/integration/`, following the existing harness
  (`test/helpers/containers.ts`, `test/helpers/api.ts`).
- PHP unit tests for any new pure logic (e.g., plan-tile formatting), matching
  the existing `Aivastra_Category_Mapping::resolve()/sanitize()` pattern of
  keeping business logic in WordPress-mock-free functions.
- Manual QA of the full buy round-trip against the `local-wp` docker stack
  (`wordpress-plugin/local-wp`), including a deliberately dismissed payment
  and a deliberately wrong/revoked full key.

## Files touched

- `apps/api/src/modules/merchant/payments.routes.ts` — extract
  `createRazorpayOrder`/`grantMerchantCredits` into a shared helper.
- `apps/api/src/modules/dev/routes.ts` — add `/v1/dev/plans`,
  `/v1/dev/payments/orders`, `/v1/dev/payments/verify`.
- `apps/api/test/integration/` — new test file for the three routes above.
- `wordpress-plugin/includes/class-connection-settings.php` — persist
  encrypted `full_key`; wipe it on disconnect.
- `wordpress-plugin/includes/class-connection-service.php` — `list_plans()`,
  `create_order()`, `verify_payment()`.
- `wordpress-plugin/admin/class-settings-page.php` — "Plans & Credits" card,
  new `admin-post`/`admin-ajax` handlers, updated full-key copy.
- `wordpress-plugin/admin/assets/checkout.js` — new file, Razorpay modal
  wiring.
- `docs/wordpress-plugin-design.md` §4.3 — correct the "full key is never
  persisted" statement to reflect the new behavior (implementation-time edit,
  not part of this spec's write-up).

## Open questions (for a later pass, not blocking this spec)

- Auto-refill equivalent for WordPress — needs its own product decision on
  what "automatic" means without Shopify's subscription billing underneath.
- wordpress.org / WooCommerce Marketplace submission — the compliance
  findings above are recorded but not acted on while distribution stays
  direct-zip.
