# Phase 5 — E-commerce Platform Plugins (Shopify, Wix)

> Part of the [Multi-App Ecosystem Plan](../multi-app-ecosystem-plan.md) (`docs/multi-app-ecosystem-plan.md`, §10). This document is self-contained — implement from this file directly.

**Depends on:** Phase 2 (the merchant portal hosts the Connect/Disconnect flow and is where the merchant identity for binding a shop lives). **Blocks:** nothing. Independent of Phase 3 — can be built in parallel with the kiosk migration. **User-facing surface:** two new installable marketplace apps, plus an Integrations page in the merchant portal.

## Why

The goal is letting a merchant add virtual try-on to their Shopify or Wix store without writing any code. This turns out to be a small amount of new work because the existing widget job API already accepts an external image URL as the garment source — exactly what a product image URL on a store page is. The entire job pipeline (widget-key auth, credit deduction, dispatcher routing, SSE progress) is reused completely unchanged. What's actually new is platform install/OAuth plumbing, keeping the widget's allowed-origins list in sync automatically, and a storefront snippet.

**Read `apps/api/src/modules/widget/routes.ts` in full before starting**, specifically the `POST /v1/widget/jobs` handler and its `garmentImageUrl` handling, and read `apps/catalogues-web/public/widget/loader.js` to understand its current data-attribute/config contract before deciding whether it needs a new attribute or already supports what a storefront snippet needs.

## Repo conventions (load-bearing — read before editing)

- Same as prior phases: pnpm workspaces, Drizzle migrations via `pnpm db:generate`, `createLogger` not `console.log`, `apps/api/src/server.ts` for route wiring.
- Secrets at rest: this phase introduces the first case in this repo of a third-party OAuth access token needing encryption at rest (not just hashing, since it must be decryptable to make platform API calls later). Check if the repo already has an AES-GCM helper anywhere (search `packages/` for existing crypto utilities) before writing a new one from scratch.
- Commit when this phase is complete and its tests pass. **Do not push.**

## Spec

### DB

New table in `packages/db/src/schema/widget.ts`:

```ts
export const merchantIntegrations = pgTable('merchant_integrations', {
  id: uuid('id').primaryKey().defaultRandom(),
  widgetClientId: uuid('widget_client_id').notNull()
    .references(() => widgetClients.id, { onDelete: 'cascade' }),
  platform: text('platform').notNull(),        // 'shopify' | 'wix'
  shopDomain: text('shop_domain').notNull(),   // e.g. mystore.myshopify.com / Wix site id
  accessTokenEnc: text('access_token_enc'),    // platform OAuth token, AES-GCM encrypted at rest
  installedAt: timestamp('installed_at', { withTimezone: true }),
  uninstalledAt: timestamp('uninstalled_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ uniq: unique('merchant_integrations_platform_shop_unique').on(t.platform, t.shopDomain) }));
```

New env vars, all added to `apps/api/src/env.ts`'s schema and documented in `.env.example`/`.env.production.example`:

- `INTEGRATION_TOKEN_KEY` — the AES-GCM key for `accessTokenEnc`.
- `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` — the Shopify app's credentials (from the Shopify Partners dashboard), required for OAuth and webhook HMAC verification.
- `WIX_APP_ID` / `WIX_APP_SECRET` — same for the Wix app.

The OAuth callback URLs registered in each platform's app configuration must be the publicly reachable API host — i.e. `https://app.aivastra.com/v1/integrations/shopify/callback` (and the Wix equivalent), since `/v1/` is already proxied to the API on that host. Note this in the app-registration steps; a mismatch between the registered callback and the deployed route is the classic silent OAuth failure.

### API

New module `apps/api/src/modules/integrations/`:

| Method + Path | Auth | Notes |
|---|---|---|
| `GET /v1/integrations` | `requireMerchant` | List the calling merchant's connected platforms and their state — powers the portal's Integrations page |
| `GET /v1/integrations/shopify/install` | `requireMerchant` | Begins Shopify OAuth. The merchant must click "Connect" from inside the authenticated portal first — this is what lets the callback know which `widgetClientId` to bind the shop to, rather than having to guess from the OAuth callback alone |
| `GET /v1/integrations/shopify/callback` | OAuth `state` param (encode the merchant's id in the state, verify it round-trips) | Verify the request HMAC per Shopify's OAuth spec, exchange the code for an access token, encrypt and store it, upsert the `merchant_integrations` row, and **automatically append the shop's domains (both the `*.myshopify.com` domain and any custom domain) to `widget_clients.allowedOrigins`** |
| `POST /v1/integrations/shopify/webhooks` | Shopify HMAC signature verification | Handle `app/uninstalled` (set `uninstalledAt`, remove the shop's domains from `allowedOrigins`) and Shopify's three mandatory GDPR webhooks (`customers/data_request`, `customers/redact`, `shop/redact` — acknowledge and confirm there is nothing shopper-identifying stored beyond what existing job/photo retention policy already governs) |
| `GET /v1/integrations/wix/install`, `GET /v1/integrations/wix/callback`, `POST /v1/integrations/wix/webhooks` | same shapes as the Shopify equivalents | Wix's OAuth and app-removal webhook, same shop-binding and `allowedOrigins` sync behavior |

**The `allowedOrigins` automation is not optional polish — build it as specified.** Today merchants hand-maintain that array in portal settings. For a marketplace install (where the merchant may never think about "allowed origins" at all), the single most likely support ticket is "the widget says it's blocked on my site." Keeping origins in sync on install/uninstall removes that failure mode entirely rather than requiring a support runbook to fix it per-merchant.

### Extension code

- `apps/shopify-app/` — a Shopify CLI project implementing a **theme app extension** (an app embed block) that injects the existing `loader.js` with the merchant's widget key and the product image URL pulled from Liquid (`{{ product.featured_image }}` or equivalent). The app's own settings page just shows connect/install status — the actual configuration UI lives in the merchant portal (2A below), not duplicated here. Check `loader.js`'s current contract for how it receives its config (data attributes on the script tag, a global config object, etc.) and add a per-page garment-image-URL override to that contract only if it doesn't already support one — the widget job API already accepts an external `garmentImageUrl`, so this should be a loader-only change, not an API change.
- `apps/wix-app/` — a Wix app doing the equivalent script injection for Wix product pages, using Wix's app framework/SDK conventions.
- **Merchant-web** (`apps/merchant-web`, built in Phase 2): a new **Integrations** page listing each supported platform with Connect/Disconnect actions, current install state, and the bound shop domain — backed by `GET /v1/integrations`.

**How the storefront snippet obtains the widget key — specify this, don't leave it to chance:** at OAuth install time (in the callback handler), write the merchant's `widgetKey` to a **shop metafield** (Shopify) / **site property** (Wix) so the theme extension reads it from platform storage and injects it into the script tag. A marketplace install must never require the merchant to manually copy-paste their key — that path exists in the portal for hand-rolled embeds and stays there, but the whole point of the plugin is zero-configuration. (The widget key appearing in the storefront DOM is by design and already true of existing embeds; `allowedOrigins` is the enforcement boundary, not key secrecy.)

## Out of scope for this phase

- Marketplace listing polish — app-store copy, screenshots, and the platform review/approval process are real work but not engineering design; don't block this phase's completion on external approval timelines.
- Per-product enable/disable rules (e.g. letting a merchant exclude specific products from try-on).
- Any platform beyond Shopify and Wix (WooCommerce, Magento, etc.) — add only when a real merchant asks for one.

## Definition of Done

- [ ] `merchant_integrations` table exists exactly as specified; migration generated via `pnpm db:generate`.
- [ ] All `/v1/integrations/*` routes exist as specified, with correct auth on each.
- [ ] Integration test: a forged/invalid HMAC on either platform's callback or webhook route → 401.
- [ ] Integration test: attempting to install for a shop domain already bound to a **different** merchant's `widgetClientId` → 409 (the unique index enforces this — write a test that actually attempts the conflicting insert, don't just assert the index exists).
- [ ] End-to-end manual test against a real Shopify dev store: install from the portal → product page shows the try-on entry point → complete a shopper flow (upload photo → job completes) through the **existing, unmodified** widget pipeline → uninstall from the Shopify admin → confirm the webhook fires, `uninstalledAt` is set, and the shop's domains are removed from `allowedOrigins`. Document each step's result in your report.
- [ ] Same end-to-end loop against a Wix test site.
- [ ] All new env vars present in `.env.example` and `.env.production.example` with a one-line comment each.
- [ ] The installed storefront snippet works with zero manual key entry (the metafield/site-property path) — verify by inspecting the injected script tag on the dev store.
- [ ] `apps/api` typecheck and full test suite pass.

## Report Back

_Codex: fill this in when the phase is complete._

- Files created:
- Files modified:
- Migration filename + index used:
- Test run output:
- Shopify dev-store walkthrough result (step by step):
- Wix test-site walkthrough result (step by step):
- Any deviation from this spec, and why:
- Anything ambiguous you had to make a judgment call on:
