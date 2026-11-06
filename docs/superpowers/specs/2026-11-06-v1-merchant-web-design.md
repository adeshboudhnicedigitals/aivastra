# v1.0 step 3: Merchant Web

Step 3 of `docs/architecture/v1-hld.md` §10 (HLD §3.1). Builds on step 1 (org model) and step 2
(devices, sessions). Status: draft for review, written 2026-11-06. This document decomposes step 3
and specifies sub-project **3a** in full; 3b and 3c get their own specs.

## Compatibility rule (binding)

Nothing here may change behaviour for existing customers; they migrate slowly, on our schedule.
Concretely for step 3:
- Merchant Web is a **new app** on its **own domain**. It adds, and removes nothing.
- `/tryon` in `catalogues-web` keeps working exactly as today. The HLD says "moved, with a
  redirect"; that is **superseded** by this rule. 3b ports the catalogue manager into Merchant Web
  and leaves the original in place. Removing or redirecting `/tryon` is a later, per-customer
  decision, outside step 3.
- Existing API routes keep their behaviour. Any API change in step 3 is additive.

## Decomposition

| Sub-project | Scope | Depends on |
|---|---|---|
| **3a Foundation** (this spec) | App scaffold, login, role-aware shell, branch / staff / device management, read-only plan limits, deploy wiring | steps 1–2 |
| **3b Catalogue** | Port the `/tryon` catalogue manager (~3,800 lines: `CatalogueManagerContent`, `ProductModal`, `BulkUploadModal`, `SubcategoryModal`, `api.ts`); make `/v1/merchant/catalog/*` accept staff (today `requireMerchant`, owner-only) via an additive gate; decide copy vs shared package for the ported UI | 3a |
| **3c Dashboards and brand settings** | Performance dashboards (sessions, unique shoppers, try-ons, sold items, conversion, credit usage; drill-down branch → staff → device), brand settings (logo, colours, `store_url`) | 3a; data from step 2; shopper figures arrive with step 5 |

Order: 3a → 3b → 3c. Each is independently shippable behind the new domain.

## 3a: goal

A merchant admin or staff member signs in at the new domain and sees an app shaped by their role.
The admin sets up the physical estate (branches, staff accounts, tablets). Staff see their branch.
No dashboards and no catalogue yet.

## Stack and conventions

`apps/merchant-web`, package `@aivastra/merchant-web`. Next.js 15 / React 19, mirroring
`apps/catalogues-web` (same versions, ESLint, Tailwind, `@/` alias). Conventions copied from
catalogues-web:
- **BFF auth.** Next.js route handlers under `src/app/api/auth/*` call the Fastify API server-side
  and set httpOnly cookies (`src/lib/auth-cookies.ts` pattern). The browser never calls Fastify for
  auth. The access token lives in a module-level variable only, seeded at login and refreshed on 401
  through the httpOnly refresh cookie (`src/lib/api.ts` pattern).
- **Cookie names** are prefixed `mw_` so a developer running both Next apps on `localhost` (cookies
  ignore ports) does not clobber catalogues-web's session. On the real domain they are host-scoped anyway.
- **Design tokens.** `C` from a local `src/components/tokens.ts`; never raw hex.
- **Dropdowns.** `PremiumSelect` (per CLAUDE.md), never a raw `<select>`.
- **Middleware.** Guards non-public routes on the access cookie; public paths are `/login` only.
  CSP via a local `buildCsp` like catalogues-web's.
- **Copy, not share.** `tokens.ts`, `PremiumSelect`, `cn`, `errors.ts` and `bff.ts` are copied into
  merchant-web. Extracting a shared UI package needs `transpilePackages` across apps and is deferred
  until 3b shows what actually repeats.

## Authentication and roles

1. Login form posts to `POST /api/auth/login` (merchant-web BFF), which calls the same email +
   password endpoint catalogues-web uses (web login, not the kiosk/mobile device login, so no device cap applies).
2. On success the BFF immediately calls `GET /v1/merchant/org/me` with the new access token.
   - `200`: sets cookies, returns `{ role, branchId, … }`.
   - `403` (user is neither a merchant owner nor active staff): clears cookies and returns a
     generic "this account has no merchant access". Shoppers and other AiVastra users are never let into the shell.
3. `role` (`admin` | `staff`) is held in client state from `/org/me` and re-fetched on load. The UI uses it
   to hide actions, but **the API stays the authority**: every route is already gated by
   `requireMerchantMember` / `requireMerchantAdmin`, and a hidden button that is clicked anyway gets a 403 toast.
4. Logout clears cookies and the in-memory token. A deactivated staff account fails its next API
   call (step 1's `requireMerchantMember`) and the shell signs out on the resulting 403.

No self-signup, no Google sign-in, no password reset in 3a. Staff accounts are created by the
merchant admin; password reset for them is an open question (below).

## Screens (3a)

| Route | Admin | Staff |
|---|---|---|
| `/login` | ✓ | ✓ |
| `/` Overview | Counts: branches, staff (used / limit per branch), devices (paired / active); plan limits read-only | Own branch name, own branch's device count |
| `/branches` | List, create, rename, edit address, deactivate / reactivate | hidden |
| `/staff` | List by branch, create (email, display name, initial password, branch), deactivate / reactivate, move branch. Shows "n of limit" per branch; at the limit the create button is disabled and `STAFF_LIMIT_REACHED` is shown in plain words | hidden |
| `/devices` | List, add (branch + name) → pairing code shown **once** with expiry countdown and copy button, rename, move, deactivate / reactivate | Read-only list of own branch's devices |

Confirm dialog before deactivating a branch or device (step 1's review flagged the missing
confirm). Loading, empty and error states on every list. Mobile-friendly layout (merchants use phones).

## API changes (additive only)

1. `GET /v1/merchant/org/me` (a step 1 route, no existing customer calls it) gains read-only
   `companyName`, `staffLimitPerBranch`, `deviceQuotaPerMonth` so the UI can show limits without a
   new endpoint. Existing step 1 test assertions must be updated to match the extra fields. This
   is the only API change in 3a.
2. Nothing else: branch, staff and device routes already exist (steps 1–2).

## Deploy wiring (new files and additions only)

- `apps/merchant-web/Dockerfile` (like `catalogues-web`'s) and a `merchant-web` service in
  `infra/docker-compose.staging.yml` and `.prod.yml` (the dev `infra/docker-compose.yml` has no app services). Host ports: next free port above
  the highest in use (support 3008, gpu-ops 3009 in prod at time of writing; verify at plan time),
  staging = production + 100, bound to `127.0.0.1`.
- `scripts/ci/detect-affected.mts` and the CI workflow learn the new app so it builds and
  deploys when its files change, and nothing else is rebuilt because of it.
- Server-side env `API_URL` for the BFF (runtime, not baked). Any `NEXT_PUBLIC_*` value is
  build-time; the plan lists them explicitly and checks the output hash changes on rebuild.
- **Domain:** the HLD leaves the name open (suggestion `merchant.aivastra.com`). Needed before
  production exposure; the compose service can ship without a vhost. CloudPanel vhost and any
  Cloudflare rules are out-of-repo state and must be recorded in `docs/progress.md` when done.
- CORS: only the auth BFF (login, refresh, logout) calls the API server-to-server. Data calls (org, branches,
  staff, devices) go from the browser straight to the API, so `CORS_ORIGIN` in each environment's `.env` must
  include the Merchant Web origin (dev `http://localhost:3010`).

## Testing

- Vitest for pure logic: login BFF handler (success sets `mw_` cookies; `403` from `/org/me` clears
  them and returns the generic message; bad credentials propagate), role helper, and the
  staff-limit presentation helper. (catalogues-web has no test setup; merchant-web adds Vitest.)
- API: update the step 1 `merchant-org` test for the three new `/org/me` fields.
- `pnpm --filter @aivastra/merchant-web typecheck`, `lint`, `build` clean.
- Manual browser checklist, run and recorded before the task is called done (never claimed from
  code alone): login as admin and as staff; staff cannot see `/branches` or `/staff`; create a
  branch, a staff member (hit the limit), a device (copy the code, pair via `POST /v1/device/pair`); deactivate
  and see the device rejected on its next request; confirm dialogs; phone-width layout.

## Out of scope for 3a

Catalogue / `/tryon` (3b); dashboards and brand settings (3c); Google sign-in, signup, password
reset; a shared UI package; removing or redirecting anything in catalogues-web; the shopper page;
Android work.

## Open questions

Answered for 3a (2026-11-06):

- Domain name for Merchant Web: `merchant.aivastra.com`.
- Password reset for staff: the admin sets a new password in Merchant Web via
  `POST /v1/merchant/org/staff/:id/password`. Resetting also signs the staff member out everywhere.
- Initial staff password: set once at creation. The admin can reset it but never view it. Staff changing
  their own password is not in 3a.
