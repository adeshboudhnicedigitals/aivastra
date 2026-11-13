# Merchant Web — AiVastra account console (design)

**Status:** Draft · **Date:** 2026-11-12
**Builds on:** `docs/architecture/v1-hld.md`, `2026-11-06-v1-merchant-web-design.md`

## 1. Goal

Split AiVastra's internal tooling in two:

| Surface | Owns |
|---|---|
| **admin-web** (unchanged home) | Application management — assets, workflows, workers, jobs, telemetry, workflow configs, catalog, app settings |
| **merchant-web, new account console** | User/merchant management — onboarding retailers, their org (branches, staff, devices), credits, Shopify stores, and account analytics |

The console exists because admin-web is user-centric (merchant org is a 143-line panel inside a
user drawer on `UsersPage`, devices have no admin UI at all) and cannot serve enterprise chains
running hundreds of kiosks across branches.

## 2. Decisions (agreed 2026-11-12)

| # | Decision | Chosen |
|---|---|---|
| 1 | Where the console lives | Inside `apps/merchant-web`, same deployment, **same hostname** |
| 2 | How the two account types are kept apart | **Separate APIs**: merchants on `/v1/merchant/*` (untouched), console on `/admin/*`. The server enforces both directions (§4) |
| 3 | Who uses it | AiVastra internal accounts (`admin_users`) with a console role. Used by sales and as the super-admin for merchant management |
| 4 | Scope | All merchant-related management moves to the console (§6) |
| 5 | Visibility | Every account with the role sees **all** merchants. No per-rep account ownership |
| 6 | 2FA | Deferred to a later phase, but **required before the console is enabled in production** (§7) |
| 7 | Login | **Explicit "AiVastra team" mode** on the login page. No auto-detection |
| 8 | Console roles | The existing **SUPER_ADMIN and ADMIN** roles. No new role |
| 9 | Credit grants | Their own permission, assignable per role by SUPER_ADMIN in the existing Roles & Permissions editor (§5) |
| 10 | Onboarding | **Invite email** with a set-password link replaces the random password (§5.1) |

## 3. Architecture

```
merchant-web (one host)
├── /login           merchant admin + staff  ─▶ BFF /api/auth/*     ─▶ /v1/auth/*, /v1/merchant/*
└── /hq/login        AiVastra console        ─▶ BFF /api/hq-auth/*  ─▶ /admin/auth/*, /admin/*
     /hq/*           own layout, own session provider (/admin/me), own middleware gate
```

- **Identity.** Console users are `admin_users` rows. Login goes through the existing
  `/admin/auth/login`, which already checks the separate `admin_users.passwordHash` and issues tokens
  with audience `admin` (`verifyAdminAccess`, `apps/api/src/modules/auth/service.ts:41`) and refresh rows
  with `portal = 'admin'`. No new auth system is needed.
- **Sessions.** The HQ BFF stores the admin refresh token in its own httpOnly cookie
  (`mw_hq_refresh`, path-scoped to `/api/hq-auth`), never sharing the merchant `mw_refresh` cookie.
  Access token in memory only, same as the merchant side.
- **Routing at login.** The login page offers an explicit "AiVastra team" mode, which posts to
  `/api/hq-auth/login` and lands on `/hq`. It does not auto-detect by trying both logins: the two
  accounts have different passwords, admin login is rate-limited to 5/min, and a fallback chain
  doubles failed attempts and timing signals.
- **UI reuse.** `/hq/accounts/[merchantId]/*` renders the existing dashboard, performance,
  branches, staff and devices components, driven by the admin API instead of `/v1/merchant/*`.
  Components take their data source as a prop or hook argument, never by detecting which session
  is active.

## 4. Server-side enforcement

| Token | `/v1/merchant/*` | `/admin/*` |
|---|---|---|
| Merchant admin / staff (user portal) | ✓ own merchant only (unchanged) | ✗ rejected: `requireAdminUser` requires audience `admin` (already true) |
| AiVastra console (audience `admin`) | ✗ **must be rejected (gap today)** | ✓ via `requirePermission` |

**Gap found 2026-11-12:** `userIdFromBearer` in `apps/api/src/plugins/portal-auth.ts` and
`requireUser` in `apps/api/src/plugins/auth.ts` verify with no audience check, so an admin-audience
token is accepted on merchant and user routes. Today this only matters for an admin who is also a
merchant member, but the console makes admin tokens common in merchant-web's browser context.
Fix: reject `aud === 'admin'` in both. **Before changing it, audit admin-web for calls to
non-`/admin` routes with its admin token** (e.g. `/v1/models/*`). Any such call would break, and
needs an `/admin` equivalent first.

Also: an AiVastra console account must not be a merchant owner or staff member (twin of
`assertUserIsNotStaff`). Check existing overlap read-only in production before enforcing.

## 5. API

Existing routes the console uses as-is: `/admin/merchants` (list, create, `:id`, logo/loading-video
presign, `:id/credits`), `/admin/merchants/:id/org`, `/branches/:branchId`, `/staff/:staffId`,
`/admin/merchants/:id/devices`, `/devices/:deviceId`, `/admin/shopify-stores*`,
`/admin/shopify/purchases*`, `/admin/credits/*`.

New:
- `GET /admin/accounts` — merchant list with health columns: credit balance and 30-day burn,
  branches, active/paired devices, last activity, connected channels (in-store, Shopify, API key).
  Paged and filterable. Built for chains with 100+ devices.
- `GET /admin/accounts/:merchantId/analytics/{summary,timeseries,breakdown}` — the same service
  functions behind `/v1/merchant/analytics/*`, with `merchantId` taken from the path instead of
  the session. No second analytics implementation.
- `GET /admin/accounts/overview` — cross-merchant totals: onboarding funnel (signed up → approved
  → first device paired → first try-on → first purchase), at-risk list (usage drop, devices
  offline N days, credits running out).

All mutations audited via `recordAudit` in the same transaction (existing invariant).

### Permissions

- Console access is for the existing **SUPER_ADMIN and ADMIN** roles. Screens are gated by the
  existing `merchants.read` / `merchants.write` plus new `accounts.read` (health list, overview,
  per-account analytics), all assigned through the `role_permissions` matrix like every other key.
- **Credit grants get a dedicated permission, `credits.grant`.** Which roles hold it is set by
  SUPER_ADMIN in admin-web's existing Roles & Permissions editor
  (`pages/settings/RolesPermissionsTab.tsx`, `/admin/role-permissions`). No new UI.
- **Loophole to close (found 2026-11-12):** `POST /admin/merchants/:id/credits` is guarded only by
  `merchants.write` (`merchants.routes.ts`), while user grants require `credits.write`
  (`credits.routes.ts`). So anyone who can edit a merchant can mint credits for it. Guard the
  merchant credit route with `credits.grant`. Before changing it, read the current matrix
  (read-only) and seed `credits.grant` onto every role that holds `credits.write` today, so no
  admin silently loses an ability they use. Deduct stays under `credits.write`. Whether to fold
  user grants onto `credits.grant` too is a follow-up.
- SUPER_ADMIN keeps everything, and only SUPER_ADMIN edits the matrix.

### 5.1 Onboarding invite

Replaces `password: crypto.randomUUID()` in `POST /admin/merchants` for **newly created** users.
An existing `userId` is not touched; they keep their password.

1. The console creates the merchant (existing route, same transaction and audit).
2. The API stores a single-use invite token, `email:invite:{token}` → userId, in Redis, with a
   **72h TTL**. That's longer than the 1h reset token because a retailer may not open it the same
   day. Same pattern as `email:reset:*` in `auth/routes.ts` (`getdel` makes it single-use).
3. A new mailer function `sendMerchantInviteEmail` links to merchant-web `/set-password?token=…`.
4. `POST /v1/auth/accept-invite` (token + new password) sets the password, marks the email verified,
   consumes the token, and revokes existing refresh-token families for that user.
5. The console shows "Invite sent / expired / accepted" and offers **Resend**, which issues a new
   token and invalidates the old one (store `email:invite:user:{userId}` → current token).

Accepting the invite is the only way an admin-created merchant gets a usable password. "Forgot
password" still works as a fallback. Staff accounts are unchanged: merchant admins set their
initial password in merchant-web.

## 6. Scope: what moves from admin-web

| Moves to console | admin-web page / API today |
|---|---|
| Merchant list, onboarding, edit, activate | `UsersPage` "Merchants" filter, `/admin/merchants*` |
| Branches, staff | `MerchantOrgPanel`, `/admin/merchants/:id/org`, branches, staff |
| Devices | **no UI today**; `/admin/merchants/:id/devices*` |
| Merchant credits | `UsersPage` credit actions, `/admin/merchants/:id/credits`, `/admin/credits/*` |
| Shopify stores, purchases | `ShopifyStoresPage`, `ShopifyPurchasesPage` |

Stays in admin-web: Assets, Workflows, Workers, Jobs, Telemetry, Saree/Try-on/Shopify/Quick-try-on
workflow config, Catalog, Settings, Workflow comparisons, Garment recognitions, WhatsApp classify,
Pixverse, Recycle bin, Audit logs.

Undecided (Q2): non-merchant Studio users on `UsersPage`, Payments (Razorpay), Refund requests,
Credit analysis, Contact requests, Chat inbox, Held batches, Demo catalog sets, Dev API.

admin-web pages are removed only after the console reaches parity. Until then both work. That is
internal-only duplication, and no retailer-facing behaviour changes.

## 7. Phases

1. **Foundation.** Audience fix (§4, after the admin-web audit), `credits.grant` guard (§5),
   HQ login + BFF + `/hq` shell, account list, account detail with org, devices and credits,
   onboarding with invite email (§5.1). Staging only.
2. **Analytics.** Per-account dashboards (reused components), cross-merchant overview.
3. **Shopify.** Stores and purchases pages, then linking `shopify_stores` to `merchants` (today only
   via nullable `owner_user_id`) so a merchant's channels roll up under one account.
4. **2FA (TOTP)** on `/admin/auth/login`, covering the console and admin-web together. **Gate for
   enabling the console in production.**
5. **Retire** the moved admin-web pages.

## 8. Security notes for a shared hostname

The console session lives in the same browser origin that renders retailer-controlled content
(product labels, company and staff names). Keep:
- no `dangerouslySetInnerHTML` on retailer-supplied content;
- the per-request nonce CSP (`src/lib/csp.ts`) strict, never `unsafe-inline`;
- separate cookie names and paths for the two session types.

## 9. Open questions

Answered 2026-11-12: login mode, console roles, credit-grant permission, invite email (§2 rows 7–10).

- **Q2** Which of the §6 "undecided" pages move?
- **Q6** Should admin-web keep its merchant credit-grant button during the overlap period, or hide it
  as soon as the console ships, so there is one place money is minted?
