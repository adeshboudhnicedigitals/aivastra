# AiVastra v1.0 — High-Level Design (HLD)

**Status:** Draft · **Date:** 2026-11-06
**Supersedes:** `docs/architecture/hld.md` (Draft v1, 2026-06-24) wherever the two conflict —
notably anonymous in-store shoppers (now phone-identified) and the single in-store app
logging in "as the merchant" (now devices registered per branch, plus staff logins).
**Decision record:** CEO decisions doc — https://claude.ai/artifact/75cr9J8DKr3TMh7im65JtK

This document describes the finished v1.0 product: what each face does and how the
backend supports it. It deliberately carries no timeline.

---

## 1. Decisions this design rests on

| # | Decision | Chosen |
|---|---|---|
| 0 | Dedicated shopper Android app? | **No.** Shoppers get WhatsApp + a mobile web page |
| 1 | Shopper-facing identity | Brand-first, on **one shared AiVastra WhatsApp number and one common domain**, branded per brand |
| 2 | In-store visitor data | **Identify at start** — phone OTP before the first try-on; consent recorded per brand; no face recognition |
| 3 | Org structure | Merchant (one merchant admin) → branches → **1–2 staff per branch** + many devices per branch |
| 4 | Roles | `admin` (merchant admin) and `staff` only — no store-manager role |
| 5 | Staff limit | Per-merchant field, default 2 per branch; editable only from the AiVastra admin panel |
| 6 | AiVastra admin powers | Can alter **any** merchant setting; every change audited |
| 7 | Staff catalogue access | **Full edit** of the brand-wide catalogue; deletes are soft and every change is audited |
| 8 | In-store sales source | Staff **"Sold" button** now; per-merchant POS connectors later become the source of truth (no POS integration exists today) |
| 9 | Billing | **Hybrid:** (a) credits — one merchant wallet shared by all devices; (b) monthly subscription — per-device price set per brand in AiVastra admin (N devices × price) |
| 10 | Subscribed device usage | **Unlimited by default**; AiVastra admin may set a per-brand monthly quota per device, overflow then draws credits |
| 11 | Shopper web page | Looks + wishlist + similar items + **"Buy online"** link to the brand's store. No reserve-in-store until POS stock data exists |
| 12 | Merchant Web build | **New Next.js app `apps/merchant-web`** on its own domain; `/tryon` catalogue manager **moved** (not copied) from catalogues-web |

The subscription module (plans, per-brand device prices, invoicing) is being built
separately by another developer. This design defines only the seam it plugs into (§6).

---

## 2. System overview

```
                         AiVastra Admin (admin-web, existing)
              any merchant setting · staff limit · plan price per brand · quota
                                        │
   ┌────────────────────────────────────┼────────────────────────────────────┐
   │                        api.aivastra.com (Fastify, existing)             │
   │   new modules: org (branches/staff/devices) · sessions · sales ·        │
   │                shopper-page · entitlement (credits ⇄ subscription)      │
   └──────┬───────────────────┬────────────────────┬───────────────────┬─────┘
          │                   │                    │                   │
   Merchant Web (NEW)   Merchant Android     Shopper web page     Existing channels
   apps/merchant-web    kiosk + Sales Asst   common domain,       Studio, Shopify,
   merchant admin +     one device = one     branded per brand,   WordPress, widget
   staff, /tryon moved  branch               opened from WhatsApp (unchanged)
          │                   │                    ▲
          └───────────────────┴──── WhatsApp lane (one AiVastra number) ─┘
                                        │
                     dispatcher → GPU pool (unchanged)
```

**Unchanged:** dispatcher, GPU pool, ComfyUI workflows, Studio, Shopify app, WordPress
plugin, widget. The WhatsApp lane is reused as the shopper delivery channel.

**New backend concepts:** the org model (merchant → branch → staff/devices), in-store
sessions tied to a phone number, sales, and a pre-try-on entitlement check.

---

## 3. The faces

### 3.1 Merchant Web — `apps/merchant-web` (new, own domain)

Next.js 15, following catalogues-web patterns: BFF auth with httpOnly cookies
(`src/lib/auth-cookies.ts` pattern), access token in memory only, `C` design tokens,
`PremiumSelect` for dropdowns.

| Capability | Merchant admin | Staff |
|---|---|---|
| Performance dashboard | All branches | Own branch + own numbers |
| Create / deactivate staff (up to the limit) | ✓ | ✗ |
| Create branches, register / deactivate devices | ✓ | ✗ |
| Sign in on a branch device (Sales Assistant) | ✓ | ✓ (own branch only) |
| Customers served, sessions, sales | All | Own |
| Brand settings (logo, colours, WhatsApp copy, `store_url`) | ✓ | ✗ |
| Catalogue (`/tryon`, moved) — add, edit, delete | ✓ | ✓ (brand-wide) |
| Staff limit, device quota, plan price | Read-only | ✗ |

The `/tryon` route group (`CatalogueManagerContent`, `ProductModal`, `SubcategoryModal`,
`BulkUploadModal`, `api.ts`) moves from `apps/catalogues-web/src/app/(app)/tryon` into
merchant-web. catalogues-web keeps a redirect from `/tryon` to the new domain. Studio
stays in catalogues-web.

### 3.2 Merchant Android (existing app, extended)

One device is registered to one branch. Two faces on the same device:

- **Kiosk face** — no staff login. Shopper verifies phone via OTP, accepts consent, browses
  and tries on.
- **Sales Assistant face** — a staff member of that branch logs in, runs a session for a
  customer, taps **"Sold"** on purchased items.

The existing Quick Try-On flow (`/v1/merchant/quick-tryon/jobs`) runs inside a session
like any other try-on.

### 3.3 Shopper web page (new, common domain)

Opened from a WhatsApp link; branded per brand from the merchant's settings. No login.

- The shopper's looks (view / download / share)
- Wishlist (tried items plus ones they mark)
- Similar items — same subcategory first, then shared tags
- **"Buy online"** → the merchant's `store_url` (their Shopify / WordPress store)

### 3.4 AiVastra Admin (admin-web, existing, extended)

New screens under the existing permission system: branches, staff, devices per merchant;
`staff_limit_per_branch`; `device_quota_per_month`; ability to edit any merchant setting.
Per-brand plan prices are owned by the subscription module.

---

## 4. Data model

### 4.1 New tables

| Table | Key columns | Notes |
|---|---|---|
| `merchant_branches` | merchant_id, name, city, address, is_active | |
| `merchant_staff` | merchant_id, branch_id, user_id (unique), is_active | Staff only. The merchant owner (`merchants.user_id`) is the implicit merchant admin and has no row, so no merchant-creation path changes. Login is a `users` row (`emailVerified: true`) |
| `merchant_devices` | merchant_id, branch_id, name, device_token_hash, pairing_code_hash, pairing_expires_at, last_seen_at, is_active | sha256-hashed token, like `api_keys` |
| `shoppers` | merchant_id, phone_e164, consent_at, consent_version, anonymised_at | Unique on (merchant_id, phone_e164). Never linked across merchants |
| `instore_sessions` | merchant_id, branch_id, device_id, staff_id?, shopper_id, mode (`kiosk`\|`assisted`), consent_by_staff, started_at, ended_at | One visit |
| `session_items` | session_id, catalog_item_id, job_id?, action (`tried`\|`wishlisted`\|`sold`), staff_id?, voided_at?, voided_by? | "Sold" undo sets `voided_at` — never a delete |
| `shopper_page_events` | session_id, event (`opened`\|`viewed_item`\|`buy_online_click`), catalog_item_id? | Advisory only — never read for credit, limit or authorization decisions |

### 4.2 Changes to existing tables

- `merchants`: `staff_limit_per_branch int not null default 2`, `device_quota_per_month int`
  (null = unlimited), `store_url text`.
- `jobs`: nullable `branch_id`, `device_id`, `session_id`, `staff_id`.
- `merchant_catalog_items`: `is_active`, `updated_by_staff_id`; deletes become
  `is_active = false`.

### 4.3 Removed

`kiosk_result_likes` and `kiosk_result_cart_items` are replaced by `session_items`. Before
the drop migration, check row counts in production (read-only) and state what is lost.

---

## 5. Key flows

### 5.1 Device registration
1. Merchant admin picks a branch → "Add device" → one-time pairing code (short expiry).
2. Code entered on Merchant Android → API issues a long-lived device token; only its hash is stored.
3. Every device request resolves merchant + branch from the token.
4. Deactivating the device (Merchant Web or AiVastra admin) rejects its next request.

### 5.2 Kiosk session
1. Shopper enters phone → OTP over WhatsApp → verify + accept versioned, per-brand consent.
2. Upsert `shoppers`; create `instore_sessions` (`mode=kiosk`).
3. Each try-on: entitlement check (§6) → job created with session/device/branch IDs →
   existing dispatcher + SSE → `session_items` row `tried`.
4. Session ends on "Done" or 10 minutes idle → WhatsApp sends the shopper-page link.

### 5.3 Assisted session
1. Staff logs in on a device of **their own branch** and starts a session; customer gets the OTP.
2. As kiosk, with `staff_id` on every row.
3. Staff taps **"Sold"** → `session_items` `action=sold`. Undo: the staff member within
   24 hours, the merchant admin any time (sets `voided_at`).

### 5.4 Shopper page
- WhatsApp link carries a signed, session-scoped token valid 30 days.
- Page events go to `shopper_page_events`.
- After expiry, any message to the WhatsApp number returns a fresh link.

### 5.5 Dashboards
- **Merchant admin:** sessions, unique shoppers, try-ons, sold items, conversion
  (sold ÷ sessions), credit / quota usage, shopper-page clicks — drill-down
  branch → staff → device.
- **Staff:** the same figures for their branch and their own sessions.
- Computed directly from `instore_sessions`, `session_items`, `jobs`. No rollup tables
  until volume requires them.

---

## 6. Entitlement (credits ⇄ subscription seam)

Before every in-store try-on, one function decides how it is paid for:

```
isDeviceCovered(deviceId)            ← provided by the subscription module
  covered  → count this month's jobs for the device;
             under device_quota_per_month (null = unlimited) → no charge
             over quota → fall through to credits
  not covered → atomicDeduct(merchant's user_credits)
  neither → reject before any job row; kiosk shows "unavailable"; merchant admin alerted
```

- Until the subscription module ships, `isDeviceCovered` returns `false` (credits only).
- If the module errors or times out, treat as **not covered** — fall back to credits,
  never grant free usage.
- Credit deduct + job insert stay one transaction; refund on terminal failure is unchanged.

---

## 7. Security and privacy

- **Authorization in the API**, never only the UI: every Merchant Web request resolves the
  caller as the merchant owner (admin) or a `merchant_staff` row; staff queries are filtered server-side to their branch
  and their own sessions; only `admin` manages staff, branches, devices and brand settings.
- **Staff limit** is checked inside the same transaction as the staff insert, so
  concurrent creates cannot exceed it.
- **AiVastra admin edits** go through `requirePermission` and `recordAudit`.
- **Catalogue edits** by staff write an audit row with staff and branch.
- **Device tokens** hashed; a device token can never call a Merchant Web route.
- **DPDP:** phone stored once per brand with consent version and timestamp; never linked
  across brands; OTP rate-limited per phone and per device; erasure anonymises the shopper
  (null phone, set `anonymised_at`) so counts survive; no face recognition; photos keep
  today's storage and retention rules.
- **Shopper-page tokens** are signed, expiring, and session-scoped.

---

## 8. Failure handling

| Failure | Behaviour |
|---|---|
| Entitlement fails | Blocked before job creation; nothing charged |
| Job fails terminally | Existing transactional refund |
| WhatsApp send fails | Existing delivery loop retries; staff can show the link as a QR |
| OTP not delivered | In assisted mode staff may create the shopper manually; session marked `consent_by_staff` |
| Subscription module down | Treated as not covered → credits |
| Device deactivated mid-session | Next request rejected; session closed |

---

## 9. Testing

Integration tests on the existing docker-compose harness:

- Staff limit, including two concurrent creates
- Staff cannot read another branch's data
- Device pairing, token auth, deactivation
- Entitlement: covered, quota overflow → credits, no credits → rejected, module error → credits
- "Sold" undo window (staff 24h, admin any time)
- Shopper token expiry and scope
- Consent recorded per brand; shopper never shared across merchants
- Soft delete of catalogue items + audit row

Unit tests for the entitlement function with the subscription module stubbed.

---

## 10. Build order

1. Org model — branches, staff, AiVastra admin screens for limits and settings
2. Devices + in-store sessions + entitlement (credits only)
3. Merchant Web — auth, dashboards, staff/branch/device management, moved `/tryon`
4. Merchant Android — kiosk OTP flow, Sales Assistant login, "Sold"
5. Shopper page + WhatsApp link delivery
6. Plug in the subscription module when it ships
7. Later: POS connectors (sales source of truth, then reserve-in-store)

Each step gets its own detailed spec and implementation plan.

---

## 11. Out of scope for v1.0

- Shopper Android app
- Per-brand WhatsApp numbers or domains
- Face recognition
- POS integrations and reserve-in-store
- Cross-brand shopper identity
- Subscription plans, pricing and invoicing (owned by the subscription module)

## 12. Open questions

- Domain names for Merchant Web and the shopper page (e.g. `merchant.aivastra.com`,
  `looks.aivastra.com`).
- Consent text wording per brand (legal review).
- Exact dashboard layouts — to be designed with the Merchant Web spec.
