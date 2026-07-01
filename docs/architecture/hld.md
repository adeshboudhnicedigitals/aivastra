# Aivastra — High-Level Design (HLD)

**Status:** Draft v1 · **Date:** 2026-06-24
**Context:** The system is transitioning from a single application into a suite of
applications (merchant-facing + delivery channels) all governed by one Aivastra
admin control plane. This HLD defines the applications, their use cases, the
identity model, and how everything is controlled centrally.

> This is the agreed high-level design. Detailed (next-level) design — converged
> data model + migration, SSO mechanics, subscription/entitlement engine,
> dynamic widget CORS, and QR delivery — follows in separate documents.

---

## 1. Business model

- **B2B.** Aivastra sells **three products** to merchants, **each with its own
  subscription plan**. A merchant may subscribe to any subset (not all three).
- **One merchant account / one login** governs everything the merchant has.
- The merchant's **Console** shows subscribed products (manage) and **advertises
  the products not yet purchased** (upsell).
- **End shoppers are anonymous** (both online and in-store). All usage is metered
  to the merchant.
- **Aivastra builds and ships one in-store app**; the merchant logs in and their
  catalogue + branding loads.
- **Admin** is the single control plane over all merchants, subscriptions,
  shared assets, and infrastructure.

---

## 2. Actors

| Actor | Identity | Notes |
|---|---|---|
| **Merchant** | One account, one login (SSO across Console + Studio) | Owns catalogues, subscribes per product, manages channels & billing |
| **Online shopper** | Anonymous | Uses the Widget on the merchant's e-commerce site |
| **In-store shopper** | Anonymous | Uses kiosk/tablet/mobile; downloads results via QR |
| **Aivastra admin/staff** | Admin account (roles) | Operates the control plane |

---

## 3. Application inventory & use cases

### A. Merchant Console — `console.aivastra.com` (new)
*Web app. Actor: Merchant. The control center and entry point.*
- Sign-up / log-in / first-run; account, team, profile
- **Subscriptions** per product (Studio / Widget / In-store): plan, status, validity
- **Upsell:** products not yet purchased shown with a "Subscribe" CTA
- **Credits & billing:** top-ups (Razorpay), usage, invoices/history
- **Channel mapping:** decide which catalogue items are live on Widget vs In-store
- **Channel setup:** widget keys + allowed domains; register/deactivate kiosk devices
- **Analytics:** try-ons per channel, QR-download stats, credit burn
- Launches the Studio (SSO, no re-login)

> Seeded by the existing `apps/catalogues-web/(merchant)` portal + Razorpay billing flow —
> promoted to its own app on its own subdomain.

### B. Studio — `app.aivastra.com`
*Web app. Actor: Merchant. Creation tool only.*
- Upload flat garment images → build try-on-ready **catalogues**
- Generate preview try-ons (uses admin-curated faces/poses/backgrounds)
- Gated by the merchant's **Studio** subscription

> Boundary: Studio = catalogue **creation/editing**. Console = catalogue
> **distribution / channel mapping** + all business/control concerns.

### C. Widget — embedded JS (`cdn.aivastra.com/loader.js`)
*Runs on the merchant's e-commerce site. Actor: anonymous online shopper.*
- Load a catalogue product → shopper uploads/selects a photo → try-on → view/download
- Auth: `widgetKey` + **per-key allowed origins** (dynamic CORS)
- Gated by the merchant's **Widget** subscription; metered to the merchant

### D. In-store Try-On App — one Aivastra app (kiosk / tablet / mobile)
*Aivastra-built & shipped. Device logs in as the merchant. Actor: anonymous walk-in shopper.*
- Device authenticates as the merchant → loads that merchant's catalogue + branding
- Shopper browses catalogue → tries on → **scans QR to download images**
- Gated by the merchant's **In-store** subscription; metered to the merchant

### E. Admin Console — `admin.aivastra.com`
*Internal web SPA (Vite). Actor: Aivastra staff (roles). The control plane.*
- Merchants: CRUD, approve/activate, suspend
- **Subscriptions & plans:** define per-product plans; assign/adjust merchant
  subscriptions; grant/adjust credits & quotas
- Channels: issue/revoke widget keys & origins; register/deactivate in-store devices
- Shared assets: faces / poses / backgrounds / workflow templates; catalog library
  (lowers/shoes)
- Operations: jobs across **all sources**, worker health, payments & ledgers,
  analytics, support

### F. Backing services (shared)
- **API** — `api.aivastra.com` — single Fastify control plane for every app above
- **Dispatcher + GPU workers** — generation pipeline (shared by all channels)
- **Admin Mobile** (Expo) — on-the-go subset of the Admin Console

---

## 4. System context diagram

```
            ┌──────────────────────── MERCHANT (one login / SSO) ───────────────────────┐
            │                                                                            │
   console.aivastra.com (Control center)              app.aivastra.com (Studio)
       billing, subscriptions, channels,                 build catalogues,
       mapping, analytics, upsell                         generate try-ons
            │                                                  │
            └──────────────────────────┬───────────────────────┘
                                        ▼
   ┌──────────────────────────────  api.aivastra.com  ──────────────────────────────┐
   │   one API · one DB · authz by merchant identity + per-product entitlements      │
   └──────────┬──────────────────────────┬────────────────────────┬─────────────────┘
              │                           │                         │
   admin.aivastra.com           widget (cdn loader)        in-store app (kiosk/tab/mobile)
   (Aivastra staff)             on merchant's site         logs in as merchant
   control plane                      │                          │
              │               anonymous online           anonymous walk-in
              │                  shopper                  shopper + QR download
              ▼
        dispatcher → GPU workers (generation, shared by all channels)
```

---

## 5. Identity, SSO & entitlements

- **One `merchant` identity** (login). Converges today's `users` (Studio) and
  `widget_clients` (portal) into a single account.
- **SSO across Console + Studio** — the merchant authenticates once and moves
  between the two subdomains without re-login.
- **Per-product entitlements** drive everything: a merchant's feature access in
  Console, Studio, Widget, and In-store is gated by their active subscriptions.
- **Admin sets state** (merchant status, subscription, entitlements, keys); apps
  read it on every request. One admin change propagates to all surfaces.

Auth realms remain separate by audience:
- **Merchant** — Console + Studio (shared session)
- **Shopper** — none (anonymous; widget key / device session)
- **Admin** — Aivastra staff

---

## 6. Subscription, credits & billing

- **Per-product subscription plans** (Studio / Widget / In-store), admin-managed.
- **Usage accounting: Option B (per-product quota) — provisional.** Each product's
  subscription carries its own usage quota/credits, tracked separately per product.
  *(To be revisited; Option A = single shared wallet was the alternative.)*
- **Payments:** Razorpay (server-computed amounts, signature-verified, webhook
  idempotent) — already implemented for merchant checkout; extends to per-product.

---

## 7. Channels

### Widget
- Distributed via `cdn.aivastra.com/loader.js`, embedded on third-party sites.
- **Dynamic CORS:** reflect the request `Origin` only if it is in that widget
  client's `allowedOrigins`. First-party apps keep a strict allowlist.

### In-store (kiosk / tablet / mobile)
- One Aivastra app; device logs in as the merchant; catalogue + branding load
  from the merchant account.
- **QR delivery:** kiosk generates a try-on → result stored → QR encodes a
  short-lived signed token → public "claim images" endpoint lets the shopper
  download on their phone. No shopper account required.

---

## 8. Domain / deployment topology

| Subdomain | App | Type |
|---|---|---|
| `console.aivastra.com` | Merchant Console | Next.js |
| `app.aivastra.com` | Studio | Next.js |
| `admin.aivastra.com` | Admin Console | Vite SPA |
| `api.aivastra.com` | API | Fastify |
| `cdn.aivastra.com` | Widget loader + assets | static / R2 |

First-party frontends call the API **same-origin via proxy/BFF** (no browser CORS).
Only the Widget makes cross-origin API calls (handled by dynamic CORS). In-store /
admin-mobile are native clients (no CORS).

---

## 9. Target data-model implications (for next-level design)

| Entity | Purpose / change |
|---|---|
| `merchant` (+ auth) | Single merchant identity ← merge `users` / `widget_clients` |
| `products` + `plans` | Per-application plans, admin-managed ← replaces hardcoded plans |
| `merchant_subscriptions` | Per product: plan, status, validity, **quota (Option B)** |
| `merchant_channels` | Widget: key + allowed origins · In-store: device registrations |
| `jobs.merchant_id` + `jobs.source` | Attribute every job to a merchant + channel (`studio` \| `widget` \| `instore`) |
| In-store QR delivery | Short-lived signed token → public claim-images endpoint |

Migration is non-trivial (identity convergence + credit/quota model) and is
covered in the next-level design.

---

## 10. Glossary (avoid conflation)

- **Studio** — the catalogue-creation web app (`app.aivastra.com`).
- **Console** — the merchant control center (`console.aivastra.com`).
- **Catalogue (merchant)** — the merchant's try-on-ready garments built from his
  flat images. Distinct from the **catalog module** below.
- **catalog module** (`/v1/catalog/*`) — admin-curated library of lower garments &
  shoes used as inputs.
- **models module** (`/v1/models/*`) — admin-curated faces / poses / backgrounds /
  workflow templates.
- **Channel** — a delivery surface for a merchant's catalogue: Widget or In-store.

---

## 11. Open decisions / parking lot

- **Credit accounting A vs B** — using **B (per-product quota)** for now; revisit
  whether a single shared wallet (A) is simpler at scale.
- **Merchant sub-users / teams** — single owner login today; multi-user (merchant-
  admin role) is a likely future need.
- **In-store app white-label** — single Aivastra app with per-merchant branding
  loaded at login; degree of customization TBD.
- **Studio identity migration** — sequencing of merging `users` into `merchant`
  without disrupting existing Studio logins.
```
