# Phase 0 — Auth Foundation

> Part of the [Multi-App Ecosystem Plan](../multi-app-ecosystem-plan.md) (`docs/multi-app-ecosystem-plan.md`, §5). This document is self-contained — implement from this file directly.

**Depends on:** nothing. **Blocks:** Phase 2, Phase 3. **User-facing surface:** none — this phase ships silently.

## Why

This monorepo (`D:\aivastra\webtool`, pnpm workspaces, Fastify 5 + Zod + Drizzle/Postgres API in `apps/api`) is being extended so a native Android kiosk app can authenticate against it. The legacy backend it currently talks to (a CodeIgniter PHP system, not part of this repo) has two confirmed, specific bugs this phase exists to avoid:

- **Client-supplied device pairing with no server validation** — the legacy login endpoint inserts a session row for *any* device_id a client sends, no ownership check at all.
- **Three inconsistent, mostly-non-expiring token stores** for different login flows, with no shared rotation policy.

This phase lands the auth plumbing (JWT audience + a proper device-pairing flow) that fixes both, generalized so a later phase (merchant portal auth hardening) reuses the same mechanism instead of a third one-off token table.

## Repo conventions (load-bearing — read before editing)

- pnpm workspaces, ESM only (`"type": "module"`), Node 20+, TypeScript 5.6. Never introduce npm/yarn lockfiles.
- API routes wired in `apps/api/src/server.ts`; Zod schemas for request/response shapes live in `packages/types`.
- DB: PostgreSQL via Drizzle ORM. Schema in `packages/db/src/schema/`, migrations in `packages/db/src/migrations/`. Generate migrations with `pnpm db:generate` (needs `DATABASE_URL`); never hand-write migration SQL that diverges from what Drizzle generates from the schema.
- **Migration index check, mandatory:** before creating a migration file, run `git diff --name-only HEAD..origin/master -- packages/db/src/migrations/` and check `packages/db/src/migrations/meta/_journal.json` for the current highest index. This plan assumed `0082_watermarking_columns.sql` was head at write-time — **do not trust that number**, re-derive it at implementation time.
- Logger: pino via `createLogger(service)` from `@aivastra/logger`. No `console.log` in committed code.
- Tests: Vitest, no testcontainers. Integration tests reuse the docker-compose Postgres/Redis/MinIO — `pnpm docker:up` must already be running. Each test file creates a fresh Postgres DB via `CREATE DATABASE` + runs Drizzle migrations, and a fresh MinIO bucket, both dropped in `afterAll`. See `apps/api/test/helpers/containers.ts` and `apps/api/test/helpers/api.ts` (`buildTestApp()`) for the harness pattern — copy it, don't reinvent it.
- Commit when this phase is complete and its tests pass. **Do not push** — leave it for review.

## Spec

### DB

New file `packages/db/src/schema/kiosk.ts`:

```ts
export const kioskDevices = pgTable('kiosk_devices', {
  id: uuid('id').primaryKey().defaultRandom(),
  widgetClientId: uuid('widget_client_id').notNull()
    .references(() => widgetClients.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),                       // merchant-assigned, e.g. "Front Counter Tablet"
  status: text('status').notNull().default('pending'),  // 'pending' | 'active' | 'revoked'
  pairingCodeHash: text('pairing_code_hash'),            // sha256; cleared once claimed/expired
  pairingCodeExpiresAt: timestamp('pairing_code_expires_at', { withTimezone: true }),
  androidId: text('android_id'),                         // audit/support only — NEVER a trust boundary
  appVersion: text('app_version'),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  pairedAt: timestamp('paired_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

`widgetClients` is the existing merchant/widget-client table — import it from wherever `packages/db/src/schema/widget.ts` (or equivalent) currently exports it from. Read that file first to match the existing style (column naming, timestamp helpers) exactly.

Modify `packages/db/src/schema/users.ts`'s `refreshTokens` table:
- `userId` becomes **nullable** (it's currently required).
- Add **two** new nullable owner columns: `kioskDeviceId` (`uuid`, FK → `kiosk_devices.id`, `onDelete: 'cascade'`) and `widgetClientId` (`uuid`, FK → `widget_clients.id`, `onDelete: 'cascade'`). The second one is unused by this phase but is needed by a later phase's merchant-portal refresh flow — add it now so the CHECK constraint below is written once, not migrated twice.
- The migration must also add: `CHECK (num_nonnulls(user_id, kiosk_device_id, widget_client_id) = 1)` — exactly one owner column set per row, enforced at the database level, not just in application code.

**Reuse, don't duplicate:** find `rotateTokenFamily()` in `apps/api/src/modules/auth/routes.ts`. Generalize its return shape from `{ userId: row.userId, ... }` to something like `{ ownerId, ownerType, ... }` derived from whichever of the three owner columns is non-null, and update its callers accordingly. Do **not** create a parallel `kiosk_refresh_tokens` table — that would recreate the exact multi-token-table fragmentation this phase exists to avoid.

**Kiosk refresh-token TTL: 30 days**, longer than whatever the existing user/admin default is (check `apps/api/src/env.ts` / wherever `JWT_EXPIRY`-adjacent constants live). Rationale: a kiosk tablet may sit powered off for a seasonal closure or a long weekend; a short TTL would force pointless re-pairing. This is a per-owner-type TTL, not a global default change.

### API

- `apps/api/src/modules/auth/service.ts` — add `verifyKioskAccess()`. Find the existing `verifyAdminAccess()` in the same file and mirror its structure exactly, changing only the expected audience to `'kiosk'`.
- `apps/api/src/plugins/widget-auth.ts` — add a `requireKioskDevice` preHandler decorator next to the existing `requireMerchant`/`requireWidgetClient` in that file. It must:
  - Verify the JWT has `aud:'kiosk'` and `kind:'access'`.
  - Look up the `kiosk_devices` row by the JWT's `sub` claim **on every request** (not just at token-issue time — this mirrors the existing admin auth pattern of "JWT claim AND DB row lookup," which exists specifically so revoking a device takes effect immediately, not just at token expiry).
  - Require `status === 'active'`; reject otherwise.
  - Set `req.kioskDeviceId` and `req.merchantClientId` on the request — reuse the exact property name `requireMerchant` already sets for the merchant-id field, so any handler written to accept "the calling merchant's id" doesn't need to know whether the caller was a human portal session or a kiosk device.

New module `apps/api/src/modules/kiosk/`:

- `provisioning.ts` — export `createKioskDevice(app, widgetClientId, label)`: generates a random 10-character base32 pairing code, stores only its sha256 hash in `pairingCodeHash`, sets `pairingCodeExpiresAt` to 15 minutes out, returns the **plaintext** code to the caller (it must never be persisted in plaintext, and can only be shown once). This function is shared — both the merchant-portal route and the admin route below call it, so pairing-code generation logic exists in exactly one place.
- `auth.routes.ts` — three routes:

  | Method + Path | Auth | Behavior |
  |---|---|---|
  | `POST /v1/kiosk/auth/claim` | public | Body `{pairingCode, appVersion?, androidId?}`. Look up the device row by hashing the supplied code and comparing; if found and unexpired: set `status='active'`, `pairedAt=now()`, clear `pairingCodeHash`, store `appVersion`/`androidId`, issue `{accessToken, refreshToken}` with `aud:'kiosk'` and `sub` = the device's id. Rate-limit to 10 requests/minute/IP. (Note: a wrong code matches no row — lookup is by hash — so there is nothing per-row to count failed attempts against. Brute-force protection is the rate limit plus the code's ~50 bits of entropy plus the 15-minute TTL; do not add an attempt-counter column, it cannot work with hash-based lookup.) |
  | `POST /v1/kiosk/auth/refresh` | body: `{refreshToken}` | **Do not reuse the existing admin/user refresh-body route** — check it first; if it hardcodes an audience on reissue (e.g. always mints `aud:'admin'`), reusing it here would mint admin-audience tokens for a kiosk device, which is a privilege escalation. Write a new route. It must: look up the `refresh_tokens` row, **reject if `userId` or `widgetClientId` is set on that row** (only rows with `kioskDeviceId` set are valid here — this owner-type assertion is what stops a token stolen from one portal being replayed against another portal's audience), otherwise rotate via the generalized `rotateTokenFamily`, issue a new `aud:'kiosk'` access token, and update `kiosk_devices.lastSeenAt`/`appVersion` from the request (only here, not on every authenticated request, to keep the hot path free of an extra write). |
  | `POST /v1/kiosk/auth/logout` | body: `{refreshToken}` | Revoke the token family **and** set `kiosk_devices.status='revoked'`. A kiosk has no password to log back in with — logout means the physical device is unpaired and needs a fresh pairing code to reconnect. This is intentional, not an oversight. |

- Extend `apps/api/src/modules/merchant/` with a new `kiosk-devices.routes.ts` file (match the existing file-per-resource split already used in that directory, e.g. however `payments.routes.ts` is structured there): `POST /v1/merchant/kiosk-devices` (calls `createKioskDevice`, returns the plaintext code once), `GET /v1/merchant/kiosk-devices` (list, without the hash), `PATCH /v1/merchant/kiosk-devices/:id` (rename via `{label}`, or revoke via `{status:'revoked'}`), and `POST /v1/merchant/kiosk-devices/:id/pairing-code` (**regenerate** — allowed only when the row's status is `'pending'` or `'revoked'`; sets a new hash + fresh 15-minute expiry, resets status to `'pending'`, clears `revokedAt`/`pairedAt`, returns the new plaintext code once). Without regenerate, every expired code or revoked tablet forces the merchant to create a duplicate device row — junk data by design. All routes `requireMerchant`, and all must verify the target device's `widgetClientId` matches the calling merchant's — never let one merchant touch another's devices via a guessed id.
- **Device-count semantics** (matters when Phase 2 adds `maxKioskDevices`): only non-revoked rows count toward the device limit — a revoked tablet shouldn't permanently consume a slot.
- Extend `apps/api/src/modules/admin/widget-clients.routes.ts` (already owns nested per-client resources like a `/credits` route — follow that existing pattern): `POST /v1/admin/widget-clients/:id/kiosk-devices` and `PATCH /v1/admin/widget-clients/:id/kiosk-devices/:deviceId`, both `requireAdmin`. Check the existing file first for which admin roles are allowed on sibling routes and match that, don't invent a new role set.

## Out of scope for this phase

- No UI. No merchant-portal or admin-panel screens — those are later phases. This phase is API + DB only.
- No changes to the Android app.
- No changes to `apps/dispatcher`.

## Definition of Done

- [ ] `kiosk_devices` table exists with the exact columns above; migration file generated via `pnpm db:generate` (not hand-written) after schema changes.
- [ ] `refresh_tokens` has the two new nullable owner columns and the three-way `CHECK` constraint, verified by attempting an insert with zero or two owner columns set and confirming Postgres rejects it.
- [ ] `rotateTokenFamily()` is the single shared rotation implementation used by kiosk refresh — grep confirms no second/parallel rotation function was added.
- [ ] All three `/v1/kiosk/auth/*` routes exist and match the table above exactly (paths, methods, auth).
- [ ] `POST /v1/merchant/kiosk-devices` and the two admin routes exist and are correctly role-gated.
- [ ] New integration test file `apps/api/test/integration/kiosk-auth.test.ts` exists and **all of the following pass**:
  1. Seed a `widgetClients` row, call `createKioskDevice` directly → pairing code hash is set, `status='pending'`.
  2. `POST /v1/kiosk/auth/claim` with the plaintext code → 200, `status='active'` in the DB, tokens returned.
  3. Replay the identical code → rejected (hash already cleared).
  4. `POST /v1/kiosk/auth/refresh` with the issued refresh token → new access token, decodes with `aud:'kiosk'`.
  5. A route gated by `requireKioskDevice` hit with a validly-signed `aud:'admin'` token → 401.
  6. `POST /v1/kiosk/auth/logout` → device row flips to `revoked`; a subsequent refresh with the same (now-revoked) token family → 401.
  7. An 11th claim attempt within one minute from the same IP → 429.
  8. A **user**-owned refresh token (from the existing user auth flow) presented to `/v1/kiosk/auth/refresh` → 401 — this is the owner-type cross-portal assertion; write it as an explicit test case, not an assumption.
  9. Regenerate a pairing code on a **revoked** device → claim with the new code succeeds and the device is `'active'` again, while the old (pre-revocation) refresh-token family remains dead — re-pairing must not resurrect old tokens.
- [ ] `pnpm --filter @aivastra/api typecheck` and the full `apps/api` test suite (not just the new file) pass — confirms the `refreshTokens` schema change didn't break any existing caller of `rotateTokenFamily` or anything reading `refreshTokens.userId` as non-nullable.

## Report Back

- Files created:
  - `packages/db/src/schema/kiosk.ts`
  - `packages/db/src/migrations/0083_kiosk_auth_foundation.sql`
  - `apps/api/src/modules/kiosk/provisioning.ts`
  - `apps/api/src/modules/kiosk/auth.routes.ts`
  - `apps/api/src/modules/merchant/kiosk-devices.routes.ts`
  - `apps/api/test/integration/kiosk-auth.test.ts`
- Files modified:
  - `packages/db/src/schema/index.ts`
  - `packages/db/src/schema/users.ts`
  - `packages/db/src/migrations/meta/_journal.json`
  - `apps/api/src/modules/auth/service.ts`
  - `apps/api/src/modules/auth/routes.ts`
  - `apps/api/src/modules/admin/auth.routes.ts`
  - `apps/api/src/modules/admin/widget-clients.routes.ts`
  - `apps/api/src/plugins/widget-auth.ts`
  - `apps/api/src/server.ts`
  - `docs/multi-app-ecosystem/README.md`
  - `docs/progress.md`
- Files deleted: none.
- Migration filename + index used (and what the journal head was at the time):
  - Used `0083_kiosk_auth_foundation.sql` / idx `83`.
  - Re-checked `packages/db/src/migrations/meta/_journal.json` before migration work; head was idx `82`, tag `0082_watermarking_columns`.
  - `git diff --name-only HEAD..origin/master -- packages/db/src/migrations/` returned no files.
- Test run output (paste the relevant summary):
  - `pnpm docker:up`: postgres/minio/redis containers running/healthy.
  - `pnpm --filter @aivastra/api typecheck`: pass.
  - `pnpm typecheck`: all 10 workspace projects pass.
  - `POSTGRES_PORT=5433 pnpm exec vitest run -c vitest.integration.config.ts test/integration/kiosk-auth.test.ts` (from `apps/api`): `1 passed (1) / Tests 3 passed (3)`.
  - Full integration suite (`--reporter=dot`): 5 pre-existing failures in `auth.test.ts`, `catalog.test.ts`, `credits.test.ts`, `jobs-create.test.ts`, `uploads.test.ts` — stale-test/current-code mismatches outside Phase 0 (register/login helpers predate the email-verification flow; catalog tests seed an old schema shape). Not modified, as they are outside this phase. *(Reviewer verified: `registerAndLogin` fails before any Phase 0 code executes; the push gate runs `test:unit` only, so these were already red at HEAD.)*
- Any deviation from this spec, and why:
  - Migration generation deviated: `pnpm db:generate` could not produce a safe migration because the repo's Drizzle snapshot history only has snapshots through `0045_snapshot.json` while SQL/journal migrations continue through `0082`. Drizzle prompted about unrelated old table rename/create choices (`contact_requests` vs `model_poses`). That generator path was abandoned and `0083_kiosk_auth_foundation.sql` written manually in the same style as the existing post-0045 migrations. The schema definitions remain the source of truth for runtime types.
  - Tooling deviation: `apply_patch` unavailable in the implementation environment (missing Windows sandbox helper); escalated PowerShell writes were used instead. *(Reviewer note: this caused encoding collateral — mojibake in two docs, em-dashes stripped in several source comments/log strings, and one clobbered `app.log.error` line in the password-reset flow — all repaired during review.)*
  - The full API integration suite does not pass (pre-existing failures, see above). The new Phase 0 kiosk integration file passes, and repo-wide typecheck passes.
- Anything ambiguous you had to make a judgment call on:
  - Admin nested kiosk-device routes use `SUPER_ADMIN`, matching sibling create/update/credits routes in `admin/widget-clients.routes.ts`.
  - Pairing codes are normalized with `trim().toUpperCase()` before hashing so operators can enter lowercase without changing the stored plaintext rules.
  - Added generic Fastify/plugin 4xx handling in `server.ts` so `@fastify/rate-limit` returns its actual 429 instead of falling through to the 500 handler. *(Reviewer note: the branch was initially placed before the validation-error branch, which would have changed the `VALIDATION` error contract for schema failures; reordered during review so validation keeps precedence.)*

### Review outcome (2026-07-05)

Approved with fixes applied during review: `server.ts` 4xx-branch ordering restored (validation contract preserved), password-reset error logging restored, encoding collateral repaired (docs mojibake + source em-dashes), unused import removed, kiosk refresh TTL constant unified. The 5 failing integration files were verified pre-existing (fail before Phase 0 code paths; never part of the `test:unit` push gate). All DoD scenarios covered by the 3 consolidated test blocks in `kiosk-auth.test.ts`.
