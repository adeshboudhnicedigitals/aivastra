# Shopify onboarding page 3: "Make Login Required"

Sub-project 3 of 4 in the Shopify simplification.

## Goal

A merchant can require shoppers to be logged in to the store before using
try-on, enforced by the server. The shopper's email and phone are collected:
taken from the Shopify account when present, otherwise asked in the widget.

## Current state

- Onboarding limits page: "Make Email Required" writes
  `limits.emailAfterNTryOns = 0`.
- `limits.ts` `checkShopperLimits` refuses `email_required` once the shopper's
  lifetime job count reaches the threshold and no email is on file.
- The widget reads `customer.id` / `customer.email` from Liquid
  (`data-customer-id`, `data-customer-email`) and sends `shopifyCustomerId` in
  the request body, which the API trusts. Not safe as an enforcement signal.
- A signed App Proxy already exists (`[app_proxy]`, `/v1/shopify/proxy/...`);
  `customer.routes.ts` registers each route on both a direct and a proxied path,
  and `requireShopifyStoreKey` verifies the proxy signature or the legacy
  `X-Widget-Key`.

## Decisions (agreed)

- Real enforcement: a logged-out shopper must not be able to use try-on, even by
  calling the API directly.
- Login state is verified through the existing signed App Proxy.

## Design

### Setting
- New `limits.loginRequired?: boolean` in `ShopifyStoreLimits` (DB type) and the
  limits Zod schema in `packages/types/src/widget.ts`. Default off; no migration
  (settings is JSONB).
- Onboarding limits page: the checkbox becomes "Make Login Required" with help
  text "Customers must log in to your store before using virtual try-on. We'll
  ask for their email and phone number if their account doesn't have them."
  Writes `loginRequired`. The page no longer touches `emailAfterNTryOns`.
- Settings → Limits keeps its fuller email control and gains a matching Login
  required toggle. The legacy `emailAfterNTryOns` keeps working unchanged.

### Server enforcement
- Shopify appends `logged_in_customer_id` (empty when logged out) to every
  proxied request and includes it in the HMAC. Extend the widget-auth plugin to
  expose it on the request only when the signature verified
  (`req.shopifyLoggedInCustomerId: number | null`); never from a direct-path
  request.
- Job creation, when `limits.loginRequired`:
  - request not via the signed proxy, or no `logged_in_customer_id` → refuse
    `login_required` before the deduct.
  - shopper identity uses the verified id; the body's `shopifyCustomerId` is
    ignored for such stores.
  - shopper row has no email or no phone → refuse `contact_required`.
- Order inside `checkShopperLimits`: login, then contact, then existing limits.
  Runs in the same fast-path and locked recheck as today.
- The direct (`X-Widget-Key`) path is a public value and so cannot satisfy login;
  for login-required stores the widget must use the proxy path (it already does
  on a real storefront; verify the dev-mode fallback in `tryon-widget.js`).

### Contact capture
- `shopify_shoppers` gains `phone text` and `phone_captured_at timestamptz`
  (migration through CI). GDPR redaction (`gdpr.ts`) clears phone with email.
- The create-job body accepts optional `contact: { email, phone }`; the API
  validates (email format, phone 7+ digits as in the contact-phone spec),
  stores on the shopper row, then proceeds. Values already on the row win only if
  the new ones are absent.
- Liquid passes `data-customer-phone` alongside email. The widget prefills from
  Liquid; an account missing either is asked for just the missing field(s).

### Widget
- Knows `loginRequired` from the existing first call (`customer/products/:id/enabled`
  response gains `loginRequired` and `loggedIn`), so no flash of an unusable form.
- Logged out: the upload step shows "Log in to try on" linking to
  `/account/login?return_url=<product url>`. Copy uses the existing `cfg.copy`
  override pattern.
- `contact_required` refusal: show an email and phone form, then retry with
  `contact`. Reuses the existing email-capture step's markup and styling.
- Result history and shopper cap behave as today.

## Risks

- App Proxy path must be live on each environment (prod, staging, dev tomls
  already define it). If it is down for a store, login-required stores fail
  closed (no try-on), by design.
- New customer accounts: the Liquid `customer` object is set when logged in;
  confirm the login URL (`routes.account_login_url`) on a new-accounts dev store.

## Testing

- Unit: auth plugin exposes the verified id only on a valid signature; tampered
  or direct requests yield null.
- Integration: login-required store refuses direct-path, anonymous proxy and
  missing-contact requests with the right codes; succeeds with verified id +
  contact; body customer id is ignored; limits unchanged for stores without the
  flag.
- SPA: limits page writes `loginRequired`, no longer writes `emailAfterNTryOns`.
- Widget: manual pass on a dev store (logged out, logged in w/ and w/o phone).

## Out of scope

Replacing Shopify's login, OTP for phone, marketing consent changes.
