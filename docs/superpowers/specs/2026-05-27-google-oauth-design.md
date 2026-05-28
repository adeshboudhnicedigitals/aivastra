# Google OAuth Design — Aivastra

**Date:** 2026-05-27  
**Status:** Approved  
**Scope:** Add Google Sign-In alongside existing email/password auth

---

## 1. Goals

- Allow users to sign in with Google on the login and register pages
- Auto-register new users on first Google sign-in
- Link to existing account if same email already exists with email/password
- Keep existing email/password auth fully intact
- Support future OAuth providers (Apple, GitHub) without schema changes

---

## 2. Database Changes

### New table: `oauth_accounts`

```sql
CREATE TABLE oauth_accounts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider     TEXT NOT NULL,           -- 'google', 'apple', etc.
  provider_id  TEXT NOT NULL,           -- stable Google sub ID
  email        TEXT,                    -- snapshot from provider
  display_name TEXT,
  avatar_url   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, provider_id)
);
```

### Modify `users.password_hash`

Change from `NOT NULL` to nullable. Google-only users have no password. Existing email/password users are unaffected.

```sql
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
```

**Migration file:** `packages/db/src/migrations/0011_oauth_accounts.sql`

### Drizzle schema updates

- `packages/db/src/schema/users.ts` — `passwordHash` becomes `.notNull()` removed
- `packages/db/src/schema/users.ts` — add `oauthAccounts` table export

---

## 3. OAuth Flow

```
User clicks "Continue with Google"
  ↓
window.location.href → GET /v1/auth/google/init
  ↓
Fastify: generate cryptographically random state (32 bytes, base64url)
         store state in signed httpOnly cookie (60s TTL)
         build Google auth URL: scope=openid email profile, response_type=code
         → 302 redirect to Google
  ↓
Google → GET /v1/auth/google/callback?code=CODE&state=STATE
  ↓
Fastify:
  1. validate state cookie matches query param (CSRF protection)
  2. POST to https://oauth2.googleapis.com/token with code
  3. GET https://www.googleapis.com/oauth2/v3/userinfo with access_token
     → { sub, email, name, picture }
  4. DB transaction:
     a. SELECT from oauth_accounts WHERE provider='google' AND provider_id=sub
     b. if not found: SELECT from users WHERE email=email
     c. if user not found: INSERT users (passwordHash=null) + user_credits (balance=0)
     d. UPSERT oauth_accounts (update display_name, avatar_url on conflict)
  5. generate OTP: uuid v4, store in Redis key `oauth:otp:{uuid}` with 60s TTL, value = userId
  6. clear state cookie
  → 302 redirect to {WEB_URL}/api/auth/google/callback?code={otp}
  ↓
Next.js GET /api/auth/google/callback?code=OTP
  ↓
Web route handler:
  POST {API_URL}/v1/auth/google/exchange { code: otp }
  ↓
Fastify POST /v1/auth/google/exchange:
  1. GET + DELETE redis key `oauth:otp:{code}` (single-use)
  2. if not found or expired: 400 INVALID_OTP
  3. issueTokens(userId) → accessToken + refresh cookie
  → { accessToken } + Set-Cookie: refresh=...
  ↓
Web route handler:
  mirrors refresh cookie, sets access_token cookie
  → 302 redirect to /studio
```

### Security properties

- State cookie: httpOnly, signed, 60s TTL — prevents CSRF
- OTP: 60s TTL, deleted on first use — prevents replay; meaningless UUID in URL (no token in URL)
- Tokens never appear in URL bar or server access logs
- `GOOGLE_CLIENT_SECRET` stays server-side (never in browser)

---

## 4. New Files

| File                                                 | Purpose                                                 |
| ---------------------------------------------------- | ------------------------------------------------------- |
| `packages/db/src/migrations/0011_oauth_accounts.sql` | DB migration                                            |
| `packages/db/src/schema/users.ts`                    | Updated: passwordHash nullable, add oauthAccounts table |
| `apps/api/src/modules/auth/google.routes.ts`         | `/v1/auth/google/init`, `/callback`, `/exchange`        |
| `apps/web/src/app/api/auth/google/callback/route.ts` | Exchange OTP → cookies → redirect                       |

---

## 5. Modified Files

| File                                        | Change                                                                           |
| ------------------------------------------- | -------------------------------------------------------------------------------- |
| `apps/api/src/env.ts`                       | Add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`, `WEB_URL` |
| `apps/api/src/server.ts`                    | Register `googleAuthRoutes`                                                      |
| `apps/web/src/components/ui/google-btn.tsx` | Change to `<a>` tag pointing to `/v1/auth/google/init`                           |
| `.env` / `.env.example`                     | Add Google OAuth env vars                                                        |
| `packages/types/src/auth.ts`                | No change needed (no new request bodies required)                                |

---

## 6. Environment Variables

### Fastify API (`.env`)

```
GOOGLE_CLIENT_ID=       # from Google Cloud Console
GOOGLE_CLIENT_SECRET=   # from Google Cloud Console
GOOGLE_CALLBACK_URL=http://localhost:4000/v1/auth/google/callback
WEB_URL=http://localhost:3000
```

### Google Cloud Console Setup (manual, one-time)

1. Create project at https://console.cloud.google.com
2. APIs & Services → OAuth consent screen → External → fill app name, email
3. APIs & Services → Credentials → Create OAuth 2.0 Client ID → Web application
4. Authorized redirect URIs: `http://localhost:4000/v1/auth/google/callback`
5. Copy Client ID + Secret to `.env`

---

## 7. User Account Linking Rules

| Scenario                                                    | Behavior                                              |
| ----------------------------------------------------------- | ----------------------------------------------------- |
| First Google sign-in, no account                            | Auto-register: new `users` row + `oauth_accounts` row |
| Google sign-in, same email already registered with password | Link: create `oauth_accounts` row for existing user   |
| Google sign-in, same Google account previously used         | Normal login: find via `oauth_accounts.provider_id`   |
| Banned user signs in via Google                             | Check `users.isBanned` after lookup → 403             |

---

## 8. Dependencies

**Fastify API — no new npm packages needed.** Google OAuth token exchange uses raw `fetch` to Google's endpoints. No SDK required.

**Next.js web — no new packages.** Route handler uses existing `fetch` + `setAuthCookies` helper.

---

## 9. Out of Scope

- Password reset / "forgot password" flow
- Account unlinking (remove Google from account)
- Apple Sign-In (schema supports it, implement separately)
- Profile picture sync from Google
- Forced re-authentication
