# Merchant Web 3a Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `apps/merchant-web`, a new Next.js app where a merchant admin or staff member signs in and, by role, manages branches, staff and devices.

**Architecture:** New app on its own domain, copying (not sharing) catalogues-web's BFF-auth conventions. The browser only talks to the app's own `/api/*` route handlers for auth; data calls go to Fastify with a Bearer token held in module memory. All authorization stays in the API (`requireMerchantMember` / `requireMerchantAdmin`); the UI only hides things. Two small additive API changes: `/org/me` gains read-only limit fields, and a new admin-only staff password-reset route.

**Tech Stack:** Next.js 15 / React 19, Tailwind 3, TanStack Query, Vitest (new for this app), Fastify 5 + Drizzle (API changes), Biome.

**Spec:** `docs/superpowers/specs/2026-11-06-v1-merchant-web-design.md` (decomposition and 3a). HLD: `docs/architecture/v1-hld.md`. Handoff: `docs/handovers/2026-11-06-v1-merchant-platform-handoff.md`.

## Global Constraints

- Nothing may change behaviour for existing customers. Merchant Web is additive; `/tryon` and all `catalogues-web` code stay untouched. API changes are additive only.
- Package `@aivastra/merchant-web`, dir `apps/merchant-web`, ESM, pnpm workspace member. No npm/yarn lockfiles.
- Cookie names prefixed `mw_` (refresh cookie `mw_refresh`). Access token in a module-level variable only, never a cookie.
- Design tokens via `C` from `src/components/tokens.ts`, never raw hex. Dropdowns via `PremiumSelect`, never a raw `<select>`.
- Public paths: `/login` only. No signup, no Google sign-in, no forgot-password in 3a.
- Roles: `admin` | `staff`. Staff see Overview, and a read-only Devices list for their own branch only; `/branches` and `/staff` are hidden from staff.
- Staff limit per branch shown as "n of limit"; at the limit the create button is disabled and `STAFF_LIMIT_REACHED` is shown in plain words.
- Pairing code is shown once, with an expiry countdown (15 min TTL) and a copy button.
- Confirm dialog before deactivating a branch or device. Loading, empty and error state on every list. Phone-width layout.
- Staff initial password is set at creation; the admin can reset it any time but never view it. Min 8, max 128 chars.
- Prod host port 3010, staging 3110 (`3008`/`3009` and `3108`/`3109` are taken by support/gpu-ops), bound to `127.0.0.1`. Domain `merchant.aivastra.com` (vhost is out-of-repo; record in `docs/progress.md`).
- No `console.log` in committed API code. Commit only when the user asks; the commit steps below are for the executor once authorised. Do not push.
- Never run schema work against production. This plan has no migration.

## Review Focus

- Login as a shopper/other AiVastra user (no merchant row): the BFF must clear cookies and show the generic "no merchant access" message, not leak which check failed.
- Staff clicks a hidden admin URL (`/staff`, `/branches`) directly: redirect to `/`, and any API call that slips through gets 403 and a toast.
- Password reset for a staff member of another merchant, or an owner: 404 / 403, never changes the password.
- Reset must revoke the staff member's existing refresh tokens, so an old session cannot outlive the reset.
- Access token expired mid-session: one coalesced refresh through `mw_refresh`; refresh failure signs out cleanly.
- Pairing code lost (modal closed): it cannot be recovered. UI must say so before closing.

## File Structure

| File | Responsibility |
|---|---|
| `packages/types/src/merchant-org.ts` (modify) | add `MerchantStaffPasswordBody`, `MerchantOrgMe` response type |
| `apps/api/src/modules/merchant/org.routes.ts` (modify) | `/org/me` extra fields; `POST /v1/merchant/org/staff/:id/password` |
| `apps/api/test/integration/merchant-org.test.ts` (modify), `merchant-staff-password.test.ts` (create) | API tests |
| `apps/merchant-web/package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `postcss.config.mjs`, `vitest.config.ts` | scaffold |
| `src/lib/{auth-cookies,bff,errors,cn,csp,api}.ts` | copied/adapted infra |
| `src/lib/{roles,staff-limit}.ts` | pure helpers (unit tested) |
| `src/middleware.ts` | cookie guard + CSP |
| `src/app/api/auth/{login,logout,refresh}/route.ts` | BFF |
| `src/app/login/page.tsx` | login form |
| `src/components/{tokens.ts, ui/premium-select.tsx, ui/confirm-dialog.tsx, ui/state.tsx, shell.tsx, session-provider.tsx}` | shared UI |
| `src/app/(app)/{layout,page}.tsx`, `branches/page.tsx`, `staff/page.tsx`, `devices/page.tsx` | screens |
| `apps/merchant-web/Dockerfile`, `infra/docker-compose{,.staging,.prod}.yml`, `config/ci-targets.json`, `scripts/ci/detect-affected.mts` | deploy wiring |

---

### Task 1: API additions (`/org/me` fields, staff password reset)

**Files:**
- Modify: `packages/types/src/merchant-org.ts`, `apps/api/src/modules/merchant/org.routes.ts`, `apps/api/test/integration/merchant-org.test.ts`
- Create: `apps/api/test/integration/merchant-staff-password.test.ts`

**Interfaces:**
- Produces: `GET /v1/merchant/org/me` → `{ merchantId, role, branchId, staffId, companyName: string, staffLimitPerBranch: number, deviceQuotaPerMonth: number | null }`. `POST /v1/merchant/org/staff/:id/password` body `MerchantStaffPasswordBody = { password: string(8..128) }` → `{ ok: true }`. Zod types exported from `@aivastra/types`; rebuild `@aivastra/types` and `@aivastra/db` dist after editing.

- [ ] **Step 1: Failing tests.** In `merchant-org.test.ts` extend the two `/org/me` assertions to `toMatchObject({ ..., companyName: <the test merchant's company>, staffLimitPerBranch: 2 })` for admin and staff. New file `merchant-staff-password.test.ts` (copy harness setup from `merchant-org.test.ts`), cases: (a) admin resets own staff → 200, staff can log in with the new password via `/v1/auth/login`, old password fails; (b) staff's pre-existing refresh tokens have `revokedAt` set; (c) staff caller → 403; (d) staff id belonging to another merchant → 404 and password unchanged; (e) audit row `merchant_staff.password_reset` exists for that resource id and its `after` JSON contains no password or hash; (f) password of 7 chars → 400.
- [ ] **Step 2:** `cd apps/api && npx vitest run --config vitest.integration.config.ts merchant-org merchant-staff-password` → FAIL.
- [ ] **Step 3: Implement.** Add `MerchantStaffPasswordBody` to `packages/types/src/merchant-org.ts`. In `merchantOrgRoutes`: extend `/org/me` to also select `companyName`, `staffLimitPerBranch`, `deviceQuotaPerMonth` from `merchants` by `m.merchantId`. Add `POST /v1/merchant/org/staff/:id/password` with `preHandler: app.requireMerchantAdmin`: in one transaction load the staff row scoped by `merchantId` (404 if absent), `hashPassword` (from `../auth/service.js`), update `users.passwordHash`, set `refreshTokens.revokedAt = now()` for that user, `recordAudit` with action `merchant_staff.password_reset`, actor role `MERCHANT_ADMIN`, no secret in `after`. Does not touch `isActive`.
- [ ] **Step 4:** rerun the command in Step 2 → PASS. Also run `npx vitest run --config vitest.integration.config.ts merchant-staff-account-guards admin-merchant-org` → PASS (no regression).
- [ ] **Step 5:** `pnpm --filter @aivastra/types build && pnpm --filter @aivastra/db build && pnpm --filter @aivastra/api typecheck && pnpm biome check apps/api packages/types --diagnostic-level=error`. Commit `feat(merchant): org/me limits and admin staff password reset`.

---

### Task 2: Scaffold `apps/merchant-web`

**Files:** Create `apps/merchant-web/{package.json,tsconfig.json,next.config.ts,tailwind.config.ts,postcss.config.mjs,vitest.config.ts,next-env.d.ts}`, `src/app/layout.tsx`, `src/app/globals.css`, `src/lib/{cn,errors,bff,csp}.ts`, `src/components/tokens.ts`, `src/components/ui/premium-select.tsx`. Test: `src/lib/errors.test.ts`.

**Interfaces:**
- Produces: `cn(...)`, `ApiError`, `httpStatusMessage`, `networkError`, `readResponseBody`, `responseError` (copied from catalogues-web `errors.ts`), `safeJson(res): Promise<[unknown, boolean]>`, `buildCsp(nonce: string): string`, `C` tokens, `PremiumSelect` (same props as catalogues-web's).

- [ ] **Step 1:** `package.json` name `@aivastra/merchant-web`, scripts: `dev` = `node --env-file=../../.env node_modules/next/dist/bin/next dev --hostname 0.0.0.0 --port 3010`, `build`, `start --port 3010`, `typecheck`, `lint` = `biome check src/`, `test` = `vitest run`. Dependencies/devDependencies: the same versions as `apps/catalogues-web/package.json` for next, react, react-dom, @tanstack/react-query, tailwind stack, clsx, tailwind-merge, lucide-react, zod, `@aivastra/types: workspace:*`; add `vitest`. No Sentry, jszip, razorpay. Then `pnpm install` (lockfile updates are expected; the workspace glob already covers `apps/*`).
- [ ] **Step 2: Failing test** `src/lib/errors.test.ts`: `httpStatusMessage(502)` returns a non-empty string; `safeJson` of a non-JSON 502 response returns `[{error:{code:'UPSTREAM_ERROR',...}}, false]`.
- [ ] **Step 3:** Copy `cn.ts`, `errors.ts`, `bff.ts`, `tokens.ts`, `premium-select.tsx` from catalogues-web verbatim; adapt `csp.ts`: drop Razorpay/chatbot/Sentry origins, keep nonce + `'strict-dynamic'`, derive the API origin from `API_URL` (server) falling back to `NEXT_PUBLIC_API_URL`. `next.config.ts`: `transpilePackages: ['@aivastra/types']`, same security headers, no redirects, `images.unoptimized`, `.js`→`.ts` extensionAlias. Root layout sets `<title>AiVastra Merchant`, reads `x-nonce`, applies `C` background.
- [ ] **Step 4:** `pnpm --filter @aivastra/merchant-web test && pnpm --filter @aivastra/merchant-web typecheck && pnpm --filter @aivastra/merchant-web build` → all pass.
- [ ] **Step 5:** Commit `feat(merchant-web): scaffold app`.

---

### Task 3: Auth BFF, API client, middleware, login, session

**Files:** Create `src/lib/{auth-cookies,api,roles}.ts`, `src/middleware.ts`, `src/app/api/auth/{login,logout,refresh}/route.ts`, `src/app/login/page.tsx`, `src/components/session-provider.tsx`. Tests: `src/lib/roles.test.ts`, `src/app/api/auth/login/route.test.ts`.

**Interfaces:**
- Consumes: Task 1 `/org/me` shape; Task 2 `safeJson`, `ApiError`.
- Produces:
  - `type OrgMe = { merchantId: string; role: 'admin'|'staff'; branchId: string|null; staffId: string|null; companyName: string; staffLimitPerBranch: number; deviceQuotaPerMonth: number|null }`.
  - `canManageOrg(role: OrgMe['role']): boolean` (true only for `admin`) in `roles.ts`.
  - `api.ts`: `initToken(t)`, `getToken()`, `apiFetch<T>(path, init?): Promise<T>` (Bearer, single-flight refresh via `POST /api/auth/refresh` on 401, throws `ApiError`), `signOut(): Promise<void>`.
  - `useSession(): { me: OrgMe | null; status: 'loading'|'ready'|'signed-out' }` from `session-provider.tsx`; on any 403 `FORBIDDEN` from `apiFetch` the provider signs out.

- [ ] **Step 1: Failing tests.** `roles.test.ts`: `canManageOrg('admin') === true`, `'staff' === false`. `login/route.test.ts` (mock global `fetch`): (a) good creds + `/org/me` 200 → 200 JSON `{ok:true, accessToken, me}` and a `Set-Cookie` for `mw_refresh` httpOnly; (b) good creds + `/org/me` 403 → 403 JSON with message `This account has no merchant access.`, and both `mw_refresh` and any access cookie cleared (`Max-Age=0`); (c) API 401 → 401 propagated, no cookies; (d) fetch throws → 503.
- [ ] **Step 2:** `pnpm --filter @aivastra/merchant-web test` → FAIL.
- [ ] **Step 3: Implement.** `auth-cookies.ts` = catalogues-web version with names `mw_refresh` (path `/`, httpOnly, sameSite lax, 7 days, secure in prod) and a `clearAuthCookies`. Login handler: POST `${API_URL}/v1/auth/login` (server env `API_URL`, fallback `NEXT_PUBLIC_API_URL`, then `http://localhost:4000`), on success GET `/v1/merchant/org/me` with the new token; on 403 clear cookies and return the generic message; the cookie parsing for the upstream `refresh=` Set-Cookie is the same as catalogues-web. Refresh handler: forward `mw_refresh` as `refresh` cookie to `/v1/auth/refresh`, re-set the rotated cookie. Logout handler clears cookies and calls `/v1/auth/logout`. Middleware: allow `/login`, `/api/auth/*`, static; otherwise require `mw_refresh` cookie else redirect to `/login`; attach CSP and `x-nonce` like catalogues-web. Login page: email + password form with Polaris-free Tailwind + `C` tokens, error text, posts to `/api/auth/login`, calls `initToken`, routes to `/`. Provider: on mount calls `apiFetch('/v1/merchant/org/me')` (triggers refresh if token empty), exposes `me`.
- [ ] **Step 4:** tests pass; `typecheck` clean.
- [ ] **Step 5:** Commit `feat(merchant-web): login, BFF auth and session`.

---

### Task 4: Shell, Overview, shared UI states

**Files:** Create `src/components/{shell.tsx,ui/confirm-dialog.tsx,ui/state.tsx}`, `src/app/(app)/layout.tsx`, `src/app/(app)/page.tsx`, `src/lib/staff-limit.ts`. Test: `src/lib/staff-limit.test.ts`.

**Interfaces:**
- Produces: `staffLimitState(used: number, limit: number): { label: string; atLimit: boolean }` where label is `"${used} of ${limit}"`; `<ConfirmDialog open title body confirmLabel onConfirm onCancel />` (copy catalogues-web's, restyle to `C`); `<ListState status isEmpty emptyText error onRetry>{children}</ListState>` handling loading/empty/error; `<Shell>` nav that renders Branches and Staff links only when `canManageOrg(me.role)`; `(app)/layout.tsx` redirects to `/login` when `status==='signed-out'`.

- [ ] **Step 1: Failing test** `staff-limit.test.ts`: `(1,2)` → `{label:'1 of 2', atLimit:false}`; `(2,2)` → `atLimit:true`; `(3,2)` → `atLimit:true` (over-limit data after a limit decrease); `(0,0)` → `atLimit:true`.
- [ ] **Step 2:** run, FAIL. **Step 3:** implement helper, components and layout. Overview: admin sees counts from `GET /v1/merchant/org/branches` (count + `staffLimitPerBranch`), `GET /v1/merchant/org/staff` (active count), `GET /v1/merchant/org/devices` (paired vs active); plan limits read-only from `me` (`staffLimitPerBranch`, `deviceQuotaPerMonth` shown as "Not set" when null). Staff sees own branch name and own branch's device count. Bottom-nav/hamburger layout at phone width.
- [ ] **Step 4:** test passes, typecheck, `pnpm --filter @aivastra/merchant-web build`. **Step 5:** Commit `feat(merchant-web): shell and overview`.

---

### Task 5: Branches screen (admin)

**Files:** Create `src/app/(app)/branches/page.tsx`. Page redirects to `/` when `!canManageOrg(me.role)`.

**Interfaces:** Consumes `GET/POST /v1/merchant/org/branches`, `PATCH /v1/merchant/org/branches/:id` (`MerchantBranchCreateBody`, `MerchantBranchUpdateBody`); `ListState`, `ConfirmDialog`.

- [ ] **Step 1:** Build list (name, city, address, active badge), create form (name required, city, address), edit inline (rename, address), deactivate with `ConfirmDialog` stating that staff and devices of the branch stop working, reactivate without confirm. Use TanStack Query; invalidate the branches query on success; surface API error messages in a toast area, with `STAFF_LIMIT`-style codes mapped through `errors.ts`.
- [ ] **Step 2:** `typecheck` and `build` pass. **Step 3:** Commit `feat(merchant-web): branches screen`. (UI verified in Task 9's manual checklist, not by unit tests.)

---

### Task 6: Staff screen (admin) with password reset

**Files:** Create `src/app/(app)/staff/page.tsx`. Same admin-only redirect.

**Interfaces:** Consumes `GET/POST /v1/merchant/org/staff`, `PATCH /v1/merchant/org/staff/:id`, `POST /v1/merchant/org/staff/:id/password`, `staffLimitState`, branch list for a `PremiumSelect`.

- [ ] **Step 1:** Staff grouped by branch with "n of limit" per branch from `staffLimitState`. Create form (email, display name, initial password with show/hide toggle, branch select); create button disabled with the text "This branch already has its maximum number of staff" when `atLimit`; if the API still returns `STAFF_LIMIT_REACHED` or 409 `CONFLICT`, show the API message. Row actions: deactivate/reactivate, move branch (`PremiumSelect`; a 409 limit error shown inline), **Reset password** (modal: new password field, 8-128 chars, confirm; never displays the old one). Staff never see the password after the modal closes.
- [ ] **Step 2:** `typecheck` and `build` pass. **Step 3:** Commit `feat(merchant-web): staff screen`.

---

### Task 7: Devices screen (admin full, staff read-only)

**Files:** Create `src/app/(app)/devices/page.tsx`.

**Interfaces:** Consumes `GET/POST /v1/merchant/org/devices` (create returns `{ id, branchId, name, pairingCode, pairingExpiresAt }`), `PATCH /v1/merchant/org/devices/:id` (`MerchantDeviceUpdateBody`: rename, move, active).

- [ ] **Step 1:** Admin: list (name, branch, paired yes/no, last seen, active), add (branch select + name) → modal showing the pairing code once, a countdown to `pairingExpiresAt`, a copy button, and the warning "This code cannot be shown again"; closing asks to confirm if the code was not copied. Rename, move, deactivate (with `ConfirmDialog`: tablet stops working and its open sessions end), reactivate. Staff: same list read-only, no action buttons rendered (API returns only their branch's devices).
- [ ] **Step 2:** `typecheck`, `lint`, `build` pass. **Step 3:** Commit `feat(merchant-web): devices screen`.

---

### Task 8: Deploy wiring

**Files:** Create `apps/merchant-web/Dockerfile`. Modify `infra/docker-compose.yml`, `infra/docker-compose.staging.yml`, `infra/docker-compose.prod.yml`, `config/ci-targets.json`, `scripts/ci/detect-affected.mts:187-188`, and any other Dockerfile that lists workspace manifests (verify with `grep -ln "apps/catalogues-web/package.json" apps/*/Dockerfile`: `pnpm install --filter` needs every workspace `package.json` present, so add `COPY apps/merchant-web/package.json apps/merchant-web/` to each).

**Interfaces:** Target `{ name: "merchant-web", dir: "apps/merchant-web", packageName: "@aivastra/merchant-web", dockerfile: "apps/merchant-web/Dockerfile", composeService: "merchant-web" }`.

- [ ] **Step 1:** Dockerfile modelled on catalogues-web's: `--filter @aivastra/merchant-web...`, builds `@aivastra/types` first, `EXPOSE 3010`, `CMD pnpm --filter @aivastra/merchant-web start`. Build args: only `NEXT_PUBLIC_API_URL`. Runtime env `API_URL` (server-side, read at start, no rebuild needed).
- [ ] **Step 2:** Add the `merchant-web` service to the three compose files (prod container `aivastra-prod-merchant-web`, port `127.0.0.1:3010:3010`; staging `aivastra-staging-merchant-web`, `127.0.0.1:3110:3010`; dev file mirrors the pattern used for `web`), `API_URL: http://api:4000` (staging `http://api:4000` on its own network). Add the target to `ci-targets.json` and both `fallback` strings in `detect-affected.mts` (`merchant-web` in the `services` JSON and the `compose_services` list).
- [ ] **Step 3:** Verify: `docker compose -f infra/docker-compose.prod.yml config --quiet` and the staging equivalent exit 0 (grep only the `merchant-web` lines; never use `-A/-B/-C` on compose output). `pnpm vitest run scripts/ci` (or the existing detect-affected test) passes, including `assertTargetsMatchWorkspace`; if that test enumerates services, update its expected list.
- [ ] **Step 4:** Commit `chore(merchant-web): docker, compose and CI wiring`.

---

### Task 9: Manual browser verification and records

**Files:** Modify `docs/progress.md` (newest entry on top).

- [ ] **Step 1:** `pnpm docker:up`, `pnpm db:migrate`, rebuild `@aivastra/db` and `@aivastra/types`, start API, `pnpm --filter @aivastra/merchant-web dev` (port 3010). Seed a merchant admin and branch via the existing test helpers' equivalent or admin-web.
- [ ] **Step 2:** Run the spec's checklist in a browser and record pass/fail for each: admin login; staff login; staff cannot reach `/branches` or `/staff`; shopper account refused with the generic message; create branch; create staff until the limit; reset a staff password and log in with it; create device, copy code, `POST /v1/device/pair` with it; deactivate device and see it rejected on its next request; confirm dialogs; 375px-wide layout; token expiry (delete the cookie-less in-memory token by reloading) refreshes silently.
- [ ] **Step 3:** Write the `docs/progress.md` entry: what shipped, what was verified (only items actually run), the out-of-repo items still to do (CloudPanel vhost for `merchant.aivastra.com`, Cloudflare rules, server `.env` has `API_URL` default), and the decisions taken (admin password reset route; domain).
- [ ] **Step 4:** Commit `docs: merchant-web 3a progress`.

---

## Self-review notes

- Spec coverage: auth/roles (T3), screens (T4-T7), `/org/me` change (T1), deploy (T8), testing/manual checklist (T1-3 unit/API, T9). Password reset is a deliberate spec extension (user decision 2026-11-06), recorded in T1/T6/T9; update the spec's open-questions section when executing.
- `OrgMe` fields match across T1, T3, T4. `canManageOrg` and `staffLimitState` names are used consistently.
- Biome lint for merchant-web uses the repo-root config; CI picks the new app up through `ci-targets.json`.
