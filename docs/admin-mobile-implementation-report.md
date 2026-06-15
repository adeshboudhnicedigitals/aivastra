# Implementation Report — Admin Mobile App (Phase 1)

## Overview

Built the foundation for a React Native (Expo) admin mobile application targeting
Android 12+. Package: `@aivastra/admin-mobile` at `apps/admin-mobile`.
Three backend endpoints were added to `apps/api` to support mobile auth
(body-based tokens — no cookies). Zero existing web flows were touched.

---

## 1. Backend Changes (`apps/api`)

### 1.1 Three new mobile auth endpoints in `src/modules/auth/routes.ts`

**`POST /v1/auth/login-mobile`** (line 319-358)
- Accepts `{ email, password }` (same schema as web login)
- Verifies credentials against **`adminUsers.passwordHash`** (NOT `users.passwordHash`)
- Checks `adminUsers.status === 'active'`
- Creates a new refresh token family with `portal: 'mobile'`
- Returns `{ accessToken, refreshToken }` in JSON body (no cookies)
- Rate limited: 5 req/min
- JWT signed with `audience: 'admin'`

**`POST /v1/auth/refresh-body`** (line 361-398)
- Accepts `{ refreshToken: string }` in body
- Uses shared `rotateTokenFamily(app, plain, 'mobile')` function
- Returns `{ accessToken, refreshToken: string | null }` in JSON
- On reissue: returns `refreshToken: null` (existing token retained)
- On rotated: returns new `refreshToken`
- On invalid: returns 401
- Rate limited: 5 req/min
- JWT signed with `audience: 'admin'`

**`POST /v1/auth/logout-mobile`** (line ~400-430)
- Accepts `{ refreshToken: string }` in body
- Hashes the token, finds the family, marks `revokedAt` on all rows in that family
- Rate limited: 10 req/min

### 1.2 Shared rotation helper + web refresh

- Extracted the core rotation logic into `rotateTokenFamily(app, plain, portal)`
  (line 28-95) — a standalone async function used by `refresh-body`
- The existing `/v1/auth/refresh` retains its own **inlined** transaction with a
  `portal !== 'web'` guard (upstream conflict resolution kept it inline; it does
  **not** call `rotateTokenFamily`)
- `refresh-body` calls `rotateTokenFamily(app, plain, 'mobile')` — the only caller
- No behavior change to the web cookie-based flow

### 1.3 Key design decisions

| Decision | Reasoning |
|----------|-----------|
| Separate endpoint (`/v1/auth/login-mobile`) instead of modifying web login | Prevents raw refreshToken from leaking into web response bodies |
| Body-based token delivery (no cookies) | React Native `fetch()` cannot read HTTP-only `Set-Cookie` headers |
| `rotateTokenFamily()` used by mobile refresh only | Avoids duplicating rotation logic in `refresh-body`; web refresh retains its own inlined transaction |
| `adminUsers.passwordHash` for auth | The admin portal now has independent credentials (migration 0042). The mobile app mirrors `admin/auth.routes.ts` behavior |
| `audience: 'admin'` on all JWTs | The remote commit added `verifyAdminAccess()` which rejects tokens without `aud: 'admin'` |
| `portal: 'mobile'` on refresh tokens | Allows isolation — a mobile session can't be refreshed via the web endpoint (and vice versa) |

---

## 2. Types Package Changes (`packages/types`)

### 2.1 Added CJS build for Metro bundler

File: `packages/types/package.json`

- Added `"build:cjs": "tsc --module commonjs --moduleResolution node --outDir dist/cjs"` script
- Added `"require": "./dist/cjs/index.js"` to the `exports` field
- Metro (Expo's bundler) does not support ESM from `node_modules`. Pre-building
  to CJS avoids `require() of an ESM module` errors at bundle time.
- Ran `pnpm --filter @aivastra/types build:cjs` successfully — generates
  `dist/cjs/` with all barrel re-exports.

---

## 3. Mobile App Scaffold (`apps/admin-mobile`)

### 3.1 Config files

| File | Purpose |
|------|---------|
| `package.json` | Expo SDK 53, React Native 0.79, React 19, Zustand, all Expo modules |
| `app.config.js` | Android-only, `usesCleartextTraffic` (dev), image-picker + media-library plugins |
| `tsconfig.json` | Standalone (extends `expo/tsconfig.base`, not root `tsconfig.base.json`) |
| `metro.config.js` | SVG transformer + `@aivastra/types` CJS resolver + workspace watchFolders |
| `babel.config.js` | `babel-preset-expo` + `react-native-reanimated/plugin` |

### 3.2 Core infrastructure

| File | Description |
|------|-------------|
| `src/styles/tokens.ts` | Colors (light/dark), Spacing, Radius, Typography — ported from `apps/admin/src/styles/tokens.css` |
| `src/store/auth.ts` | Zustand store: `bootstrap()` (app-start token refresh), `login()`, `logout()`. Token in `expo-secure-store`. AdminRole: `'SUPER_ADMIN' \| 'MODERATOR' \| 'SUPPORT' \| 'ADMIN'` |
| `src/store/theme.ts` | Zustand store: dark/light toggle, persisted in `AsyncStorage` |
| `src/lib/api.ts` | `apiFetch<T>(path, init)` with 401 → refresh-body → retry interceptor |
| `src/lib/roles.ts` | `canAccessAssets()`, `canManageUsers()`, `isSuperAdmin()` with `ROLE_LEVEL` map |

### 3.3 Screens (all dark-themed, Expo Router file-based routing)

| Route | File | Description |
|-------|------|-------------|
| Root | `src/app/_layout.tsx` | `GestureHandlerRootView` + `AuthGate` (redirects unauthenticated to login) + `AppState` foreground token refresh |
| `/login` | `src/app/(auth)/login.tsx` | Email/password form with error states (403 = not admin, 401 = bad creds) |
| Tabs | `src/app/(tabs)/_layout.tsx` | 4-tab bottom navigator. Assets tab hidden for SUPPORT role (via `canAccessAssets()`) |
| Home | `src/app/(tabs)/home.tsx` | Placeholder |
| Jobs | `src/app/(tabs)/jobs.tsx` | Placeholder |
| Assets | `src/app/(tabs)/assets.tsx` | Placeholder (visible only to MODERATOR+) |
| More | `src/app/(tabs)/more.tsx` | Menu: Users, Workflows, Recycle Bin, Workers, Settings (SUPER_ADMIN), Config (SUPER_ADMIN) + Logout |

### 3.4 Typecheck

Both `@aivastra/api` and `@aivastra/admin-mobile` pass `tsc --noEmit` with
zero errors.

---

## 4. Documentation Created

| File | Description |
|------|-------------|
| `docs/admin-mobile-implementation.md` | 11-section design document: scaffold, navigation, auth, 14 screen specs, components, styling, API reuse, CI/CD, 8-phase plan, risks, file migration map. Reviewed and fixed across 6+ review rounds. |
| `docs/admin-mobile-phase2-plus-plan.md` | Detailed Phase 2-8 implementation plan: 61 files, 41 screens, shared prerequisites, per-phase build order, data flow, UI states (loading/empty/error), types reference, cross-cutting checklist |

---

## 5. Review Fixes Applied (across all sessions)

### Round 1 (initial plan review)
- Added login-mobile + refresh-body endpoints (mobile can't use cookies)
- ESM/Metro: pre-build types to CJS + metro.config.js resolver
- Missing deps: expo-media-library, async-storage, gesture-handler
- Fixed Android minimum to single value (12+)
- Role helpers: `canAccessAssets()` etc.

### Round 2 (SDK + architecture)
- Bumped Expo from 52 → 53, RN from 0.78 → 0.79
- New Architecture compatibility checklist
- `pnpm dev` exclusion (mobile not started by root runner)
- `/admin/workers` → use `stats.workers` on dashboard
- Presign endpoint mapping table (6 asset types)
- MinIO dev note (127.0.0.1 unreachable from physical device)
- SSE explicit path `/admin/jobs/stream`
- `AppState` foreground token refresh

### Round 3 (pseudocode bugs)
- `--moduleResolution node10` → `node` (invalid TSC flag)
- login-mobile rewritten to NOT call `createSessionTokens()` (would leak 2nd refresh token)
- `@aivastra/types/admin` → `@aivastra/types` (no subpath export)
- `PlanBody` → local `CreditPlanBody` definition
- SVG transformer in metro.config.js
- Rate limiting on all 3 mobile auth endpoints

### Round 4 (Android-specific)
- `GestureHandlerRootView` in root layout
- `expo-image-picker` + `expo-media-library` plugins in app.config.js
- `usesCleartextTraffic: true` for Android dev
- `APP_ENV=production` in EAS production profile

### Round 5 (security + correctness)
- `logout-mobile` endpoint added (old logout couldn't revoke without cookies)
- admin_users check added to login-mobile (any user could auth before)
- `consumedAt` → `usedAt` (wrong DB column name)
- Body schema added to logout-mobile

### Round 6 (minor cleanup)
- Old logout flow in prose updated to use `/v1/auth/logout-mobile`
- Phase table updated: `/v1/auth/logout` → `/v1/auth/logout-mobile`
- Dead null-guard removed from logout-mobile
- Bootstrap prose documents `refreshToken: null` reissue case

### Round 7 (remote commit conflicts)
- Added `'admin'` audience to all 3 `signAccess()` calls (remote commit requires `aud: 'admin'`)
- Changed login-mobile to verify against `adminUsers.passwordHash` (not `users.passwordHash`)
- Stats field names corrected in plan: `recentFailures`, `stuckJobs`, `chart → jobsPerDay`
- `JobEvent.type` → `JobEvent.eventType`
- Removed `status`/`workerId` from `JobEvent` (in `payload`)

---

## 6. Key Architecture Invariants Preserved

- **No cookies** in mobile auth — all tokens in JSON body
- **Separate endpoints** — web login/refresh untouched
- **`rotateTokenFamily()`** — called by mobile `refresh-body` only; web refresh uses its own inlined transaction
- **`portal` column** — mobile sessions (`'mobile'`) isolated from web (`'web'`) and admin panel (`'admin'`)
- **`audience: 'admin'`** — all mobile JWTs include admin audience
- **Role-gated UI** — `canAccessAssets()`, `canManageUsers()`, `isSuperAdmin()`
- **SecureStore** — refresh tokens on device, not in-memory
- **Foreground refresh** — `AppState` listener refreshes token on app resume
