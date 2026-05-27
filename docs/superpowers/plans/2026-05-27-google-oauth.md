# Google OAuth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Google Sign-In alongside existing email/password auth using Fastify-owned OAuth flow and a one-time OTP handoff to the Next.js web app.

**Architecture:** Fastify API handles `/v1/auth/google/init` (redirect to Google) and `/v1/auth/google/callback` (exchange code, upsert user, generate 60s Redis OTP). Next.js route handler at `/api/auth/google/callback` exchanges the OTP with Fastify's `/v1/auth/google/exchange`, then sets `access_token` + `refresh` cookies and redirects to `/studio`. A new `oauth_accounts` DB table links Google identities to `users` rows, keeping `passwordHash` nullable for Google-only users.

**Tech Stack:** Fastify + `@fastify/cookie`, ioredis (GETDEL), Drizzle ORM 0.36, Next.js 15 route handlers, raw `fetch` to Google OAuth2 endpoints (no SDK).

---

## File Map

| Status | Path | Purpose |
|--------|------|---------|
| **Create** | `packages/db/src/migrations/0011_oauth_accounts.sql` | Raw SQL migration |
| **Modify** | `packages/db/src/migrations/meta/_journal.json` | Register migration |
| **Modify** | `packages/db/src/schema/users.ts` | Add `oauthAccounts` table, make `passwordHash` nullable |
| **Modify** | `apps/api/src/env.ts` | Add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`, `WEB_URL` |
| **Modify** | `.env.example` | Document new Google vars |
| **Create** | `apps/api/src/modules/auth/tokens.ts` | Shared `issueTokens` + `parseDuration` helpers |
| **Modify** | `apps/api/src/modules/auth/routes.ts` | Import `issueTokens`/`parseDuration` from `tokens.ts` |
| **Create** | `apps/api/src/modules/auth/google.routes.ts` | `/v1/auth/google/init`, `/callback`, `/exchange` |
| **Modify** | `apps/api/src/server.ts` | Register `googleAuthRoutes` |
| **Create** | `apps/web/src/app/api/auth/google/callback/route.ts` | OTP→cookies→redirect handler |
| **Modify** | `apps/web/src/components/ui/google-btn.tsx` | Change to `<a>` tag pointing to `/v1/auth/google/init` |
| **Create** | `apps/api/test/integration/google-oauth.test.ts` | Integration tests |

---

## Task 1: DB Schema + Migration

**Files:**
- Create: `packages/db/src/migrations/0011_oauth_accounts.sql`
- Modify: `packages/db/src/migrations/meta/_journal.json`
- Modify: `packages/db/src/schema/users.ts`

- [ ] **Step 1: Create migration SQL file**

Create `packages/db/src/migrations/0011_oauth_accounts.sql`:

```sql
-- make password_hash nullable (Google-only users have no password)
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;

-- new table for OAuth provider identities
CREATE TABLE IF NOT EXISTS "oauth_accounts" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"      uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "provider"     text NOT NULL,
  "provider_id"  text NOT NULL,
  "email"        text,
  "display_name" text,
  "avatar_url"   text,
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "oauth_accounts_provider_provider_id_unique" UNIQUE ("provider", "provider_id")
);
```

- [ ] **Step 2: Add journal entry**

Open `packages/db/src/migrations/meta/_journal.json`. Append to the `entries` array (before the closing `]`):

```json
        ,{
            "idx": 11,
            "version": "7",
            "when": 1779926400005,
            "tag": "0011_oauth_accounts",
            "breakpoints": true
        }
```

- [ ] **Step 3: Update Drizzle schema — `packages/db/src/schema/users.ts`**

Replace the entire file:

```typescript
import { pgTable, uuid, text, boolean, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash'),           // nullable — Google-only users have no password
  displayName: text('display_name'),
  tier: text('tier').notNull().default('FREE'),
  isBanned: boolean('is_banned').notNull().default(false),
  banReason: text('ban_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const refreshTokens = pgTable('refresh_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revoked: boolean('revoked').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const oauthAccounts = pgTable('oauth_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  providerId: text('provider_id').notNull(),
  email: text('email'),
  displayName: text('display_name'),
  avatarUrl: text('avatar_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('oauth_accounts_provider_provider_id_idx').on(t.provider, t.providerId),
]);
```

- [ ] **Step 4: Build the `@aivastra/db` package to verify TS compiles**

```bash
cd /path/to/repo && pnpm --filter @aivastra/db build
```

Expected: exits 0, no TypeScript errors.

- [ ] **Step 5: Run migration against local DB**

```bash
pnpm db:migrate
```

Expected: `0011_oauth_accounts` applied, exits 0.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/schema/users.ts \
        packages/db/src/migrations/0011_oauth_accounts.sql \
        packages/db/src/migrations/meta/_journal.json
git commit -m "feat(db): add oauth_accounts table, make passwordHash nullable"
```

---

## Task 2: Env Config

**Files:**
- Modify: `apps/api/src/env.ts`
- Modify: `.env.example`

- [ ] **Step 1: Add Google env vars to `apps/api/src/env.ts`**

Add these four lines inside the `z.object({...})` block, after the `COOKIE_SECRET` line:

```typescript
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CALLBACK_URL: z.string().url().optional(),
  WEB_URL: z.string().url().default('http://localhost:3000'),
```

Full file after edit:

```typescript
import { z } from 'zod';
const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.string().default('debug'),
  API_PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(16),
  JWT_EXPIRY: z.string().default('15m'),
  REFRESH_TOKEN_EXPIRY: z.string().default('7d'),
  R2_ENDPOINT: z.string().url(),
  R2_ACCESS_KEY_ID: z.string(),
  R2_SECRET_ACCESS_KEY: z.string(),
  R2_BUCKET: z.string(),
  R2_PUBLIC_URL: z.string().url(),
  R2_FORCE_PATH_STYLE: z.coerce.boolean().default(true),
  R2_PUBLIC_PRESIGN_BASE: z.string().url().optional(),
  ADMIN_BOOTSTRAP_EMAIL: z.string().email().optional(),
  ADMIN_BOOTSTRAP_PASSWORD: z.string().min(8).optional(),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  COOKIE_SECRET: z.string().min(16),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CALLBACK_URL: z.string().url().optional(),
  WEB_URL: z.string().url().default('http://localhost:3000'),
});
export type Env = z.infer<typeof Env>;
export function loadEnv(): Env {
  return Env.parse(process.env);
}
```

- [ ] **Step 2: Add Google vars to `.env.example`**

Append this section to `.env.example`:

```
# ---- Google OAuth ----
# Create credentials at: https://console.cloud.google.com → APIs & Services → Credentials
# Authorized redirect URI to register: http://localhost:4000/v1/auth/google/callback
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=http://localhost:4000/v1/auth/google/callback
WEB_URL=http://localhost:3000
```

- [ ] **Step 3: Build API to verify TS compiles**

```bash
pnpm --filter @aivastra/api build
```

Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/env.ts .env.example
git commit -m "feat(api): add Google OAuth env vars to schema"
```

---

## Task 3: Shared Token Helper

**Files:**
- Create: `apps/api/src/modules/auth/tokens.ts`
- Modify: `apps/api/src/modules/auth/routes.ts`

- [ ] **Step 1: Create `apps/api/src/modules/auth/tokens.ts`**

```typescript
import type { FastifyInstance } from 'fastify';
import { signAccess, newRefreshToken } from './service.js';
import { schema } from '@aivastra/db';

export async function issueTokens(app: FastifyInstance, userId: string, reply: any, status: number) {
  const secret = new TextEncoder().encode(app.env.JWT_SECRET);
  const accessToken = await signAccess(secret, userId, { kind: 'access' }, app.env.JWT_EXPIRY);
  const r = newRefreshToken();
  const expiresAt = new Date(Date.now() + parseDuration(app.env.REFRESH_TOKEN_EXPIRY));
  await app.db.insert(schema.refreshTokens).values({ userId, tokenHash: r.hash, expiresAt });
  reply.setCookie('refresh', r.plain, {
    httpOnly: true,
    secure: app.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/v1/auth',
    expires: expiresAt,
    signed: false,
  });
  reply.code(status);
  return { accessToken };
}

export function parseDuration(s: string): number {
  const m = /^(\d+)([smhd])$/.exec(s);
  if (!m) throw new Error(`bad duration: ${s}`);
  const n = Number(m[1]);
  return n * ({ s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 } as Record<string, number>)[m[2]!]!;
}
```

- [ ] **Step 2: Update `apps/api/src/modules/auth/routes.ts` to import from tokens.ts**

Replace the entire file:

```typescript
import type { FastifyInstance } from 'fastify';
import { RegisterBody, LoginBody } from '@aivastra/types';
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { AppError } from '../../lib/errors.js';
import { hashPassword, verifyPassword } from './service.js';
import { issueTokens } from './tokens.js';
import { z } from 'zod';

export async function authRoutes(app: FastifyInstance) {
  app.post('/v1/auth/register', { schema: { body: RegisterBody } }, async (req, reply) => {
    const { email, password, displayName } = req.body as any;
    const exists = await app.db.select().from(schema.users).where(eq(schema.users.email, email));
    if (exists.length) throw new AppError('EMAIL_TAKEN', 409, 'email already registered');
    const passwordHash = await hashPassword(password);
    const [user] = await app.db.insert(schema.users).values({ email, passwordHash, displayName }).returning();
    await app.db.insert(schema.userCredits).values({ userId: user.id, balance: 0 });
    return issueTokens(app, user.id, reply, 201);
  });

  app.post('/v1/auth/login', {
    schema: { body: LoginBody },
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { email, password } = req.body as any;
    const [user] = await app.db.select().from(schema.users).where(eq(schema.users.email, email));
    if (!user || user.isBanned) throw new AppError('INVALID', 401, 'invalid credentials');
    if (!user.passwordHash) throw new AppError('INVALID', 401, 'invalid credentials');
    if (!(await verifyPassword(user.passwordHash, password))) throw new AppError('INVALID', 401, 'invalid credentials');
    return issueTokens(app, user.id, reply, 200);
  });

  app.post('/v1/auth/refresh', async (req, reply) => {
    const plain = req.cookies['refresh'];
    if (!plain) throw new AppError('NO_REFRESH', 401, 'no refresh token');
    const { hashRefresh } = await import('./service.js');
    const tokenHash = hashRefresh(plain);
    const [row] = await app.db.select().from(schema.refreshTokens).where(eq(schema.refreshTokens.tokenHash, tokenHash));
    if (!row || row.revoked || row.expiresAt < new Date()) throw new AppError('INVALID_REFRESH', 401, 'refresh invalid');
    await app.db.update(schema.refreshTokens).set({ revoked: true }).where(eq(schema.refreshTokens.id, row.id));
    return issueTokens(app, row.userId, reply, 200);
  });

  app.get('/v1/me', { preHandler: app.requireUser }, async (req) => {
    const [user] = await app.db.select({
      id: schema.users.id,
      email: schema.users.email,
      displayName: schema.users.displayName,
      tier: schema.users.tier,
    }).from(schema.users).where(eq(schema.users.id, req.userId));
    if (!user) throw new AppError('NOT_FOUND', 404, 'user not found');
    return user;
  });

  app.patch('/v1/me', {
    preHandler: app.requireUser,
    schema: {
      body: z.object({ displayName: z.string().min(1).max(60).optional() }),
    },
  }, async (req) => {
    const { displayName } = req.body as { displayName?: string };
    const [updated] = await app.db.update(schema.users)
      .set({ ...(displayName !== undefined ? { displayName } : {}) })
      .where(eq(schema.users.id, req.userId))
      .returning({ id: schema.users.id, email: schema.users.email, displayName: schema.users.displayName, tier: schema.users.tier });
    if (!updated) throw new AppError('NOT_FOUND', 404, 'user not found');
    return updated;
  });

  app.post('/v1/auth/logout', { preHandler: app.requireUser }, async (req, reply) => {
    const plain = req.cookies['refresh'];
    if (plain) {
      const { hashRefresh } = await import('./service.js');
      await app.db.update(schema.refreshTokens).set({ revoked: true })
        .where(eq(schema.refreshTokens.tokenHash, hashRefresh(plain)));
    }
    reply.clearCookie('refresh', { path: '/v1/auth' });
    return { ok: true };
  });
}
```

> Note: `hashRefresh` is now imported inline to avoid a circular import through `tokens.ts`. Alternatively, keep the import at the top — either works since there's no actual cycle.

Actually, simpler — just add `hashRefresh` to the top imports. Here is the cleaner version of the top of `routes.ts`:

```typescript
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { RegisterBody, LoginBody } from '@aivastra/types';
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { AppError } from '../../lib/errors.js';
import { hashPassword, verifyPassword, hashRefresh } from './service.js';
import { issueTokens } from './tokens.js';
```

And remove the dynamic `import('./service.js')` calls — just use the top-level `hashRefresh` import.

Full corrected `routes.ts`:

```typescript
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { RegisterBody, LoginBody } from '@aivastra/types';
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { AppError } from '../../lib/errors.js';
import { hashPassword, verifyPassword, hashRefresh } from './service.js';
import { issueTokens } from './tokens.js';

export async function authRoutes(app: FastifyInstance) {
  app.post('/v1/auth/register', { schema: { body: RegisterBody } }, async (req, reply) => {
    const { email, password, displayName } = req.body as any;
    const exists = await app.db.select().from(schema.users).where(eq(schema.users.email, email));
    if (exists.length) throw new AppError('EMAIL_TAKEN', 409, 'email already registered');
    const passwordHash = await hashPassword(password);
    const [user] = await app.db.insert(schema.users).values({ email, passwordHash, displayName }).returning();
    await app.db.insert(schema.userCredits).values({ userId: user.id, balance: 0 });
    return issueTokens(app, user.id, reply, 201);
  });

  app.post('/v1/auth/login', {
    schema: { body: LoginBody },
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { email, password } = req.body as any;
    const [user] = await app.db.select().from(schema.users).where(eq(schema.users.email, email));
    if (!user || user.isBanned) throw new AppError('INVALID', 401, 'invalid credentials');
    if (!user.passwordHash) throw new AppError('INVALID', 401, 'invalid credentials');
    if (!(await verifyPassword(user.passwordHash, password))) throw new AppError('INVALID', 401, 'invalid credentials');
    return issueTokens(app, user.id, reply, 200);
  });

  app.post('/v1/auth/refresh', async (req, reply) => {
    const plain = req.cookies['refresh'];
    if (!plain) throw new AppError('NO_REFRESH', 401, 'no refresh token');
    const tokenHash = hashRefresh(plain);
    const [row] = await app.db.select().from(schema.refreshTokens).where(eq(schema.refreshTokens.tokenHash, tokenHash));
    if (!row || row.revoked || row.expiresAt < new Date()) throw new AppError('INVALID_REFRESH', 401, 'refresh invalid');
    await app.db.update(schema.refreshTokens).set({ revoked: true }).where(eq(schema.refreshTokens.id, row.id));
    return issueTokens(app, row.userId, reply, 200);
  });

  app.get('/v1/me', { preHandler: app.requireUser }, async (req) => {
    const [user] = await app.db.select({
      id: schema.users.id,
      email: schema.users.email,
      displayName: schema.users.displayName,
      tier: schema.users.tier,
    }).from(schema.users).where(eq(schema.users.id, req.userId));
    if (!user) throw new AppError('NOT_FOUND', 404, 'user not found');
    return user;
  });

  app.patch('/v1/me', {
    preHandler: app.requireUser,
    schema: {
      body: z.object({ displayName: z.string().min(1).max(60).optional() }),
    },
  }, async (req) => {
    const { displayName } = req.body as { displayName?: string };
    const [updated] = await app.db.update(schema.users)
      .set({ ...(displayName !== undefined ? { displayName } : {}) })
      .where(eq(schema.users.id, req.userId))
      .returning({ id: schema.users.id, email: schema.users.email, displayName: schema.users.displayName, tier: schema.users.tier });
    if (!updated) throw new AppError('NOT_FOUND', 404, 'user not found');
    return updated;
  });

  app.post('/v1/auth/logout', { preHandler: app.requireUser }, async (req, reply) => {
    const plain = req.cookies['refresh'];
    if (plain) {
      await app.db.update(schema.refreshTokens).set({ revoked: true })
        .where(eq(schema.refreshTokens.tokenHash, hashRefresh(plain)));
    }
    reply.clearCookie('refresh', { path: '/v1/auth' });
    return { ok: true };
  });
}
```

- [ ] **Step 3: Build API to confirm TS is clean**

```bash
pnpm --filter @aivastra/api build
```

Expected: exits 0, no TypeScript errors.

- [ ] **Step 4: Run existing auth tests to confirm no regression**

```bash
pnpm --filter @aivastra/api test -- auth
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/auth/tokens.ts \
        apps/api/src/modules/auth/routes.ts
git commit -m "refactor(api): extract issueTokens/parseDuration to tokens.ts"
```

---

## Task 4: Google Auth Routes (API)

**Files:**
- Create: `apps/api/src/modules/auth/google.routes.ts`
- Modify: `apps/api/src/server.ts`
- Create: `apps/api/test/integration/google-oauth.test.ts` (written first — TDD)

- [ ] **Step 1: Write failing integration test**

Create `apps/api/test/integration/google-oauth.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, vi, afterEach } from 'vitest';
import { startContainers, type Containers } from '../helpers/containers';
import { buildServer } from '../../src/server';

async function buildGoogleApp(c: Containers) {
  const app = await buildServer({
    NODE_ENV: 'test', LOG_LEVEL: 'silent', API_PORT: 0,
    DATABASE_URL: c.pgUrl, REDIS_URL: c.redisUrl,
    JWT_SECRET: 'test-jwt-secret-1234567890', JWT_EXPIRY: '15m', REFRESH_TOKEN_EXPIRY: '7d',
    R2_ENDPOINT: c.r2Endpoint, R2_ACCESS_KEY_ID: c.r2Key, R2_SECRET_ACCESS_KEY: c.r2Secret,
    R2_BUCKET: c.r2Bucket, R2_PUBLIC_URL: c.r2Endpoint + '/' + c.r2Bucket,
    R2_FORCE_PATH_STYLE: true, CORS_ORIGIN: 'http://localhost:3000',
    COOKIE_SECRET: 'test-cookie-secret-1234567890',
    GOOGLE_CLIENT_ID: 'test-google-client-id',
    GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
    GOOGLE_CALLBACK_URL: 'http://localhost:4000/v1/auth/google/callback',
    WEB_URL: 'http://localhost:3000',
  });
  await app.listen({ port: 0 });
  return app;
}

describe('google oauth', () => {
  let c: Containers;
  let app: Awaited<ReturnType<typeof buildGoogleApp>>;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildGoogleApp(c);
  }, 60000);

  afterAll(async () => { await app?.close(); await c?.stop(); });
  afterEach(() => vi.restoreAllMocks());

  it('GET /v1/auth/google/init redirects to Google with state cookie', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/auth/google/init' });
    expect(res.statusCode).toBe(302);
    const location = res.headers.location as string;
    expect(location).toContain('accounts.google.com/o/oauth2/v2/auth');
    expect(location).toContain('client_id=test-google-client-id');
    expect(location).toContain('scope=openid+email+profile');
    const cookieHeader = res.headers['set-cookie'];
    expect(cookieHeader).toBeTruthy();
    const cookies = Array.isArray(cookieHeader) ? cookieHeader : [cookieHeader];
    expect(cookies.some((c: string) => c.startsWith('google_state='))).toBe(true);
  });

  it('POST /v1/auth/google/exchange with valid OTP returns accessToken', async () => {
    // Seed a valid OTP in Redis directly
    const otp = 'test-otp-1234';
    // First create a user to get a real userId
    const regRes = await app.inject({
      method: 'POST', url: '/v1/auth/register',
      payload: { email: 'otp-test@example.com', password: 'password123' },
    });
    expect(regRes.statusCode).toBe(201);
    const { accessToken: regToken } = regRes.json() as { accessToken: string };

    // Decode userId from JWT (sub claim)
    const parts = regToken.split('.');
    const claims = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString());
    const userId: string = claims.sub;

    // Seed OTP in Redis
    await app.redis.set(`oauth:otp:${otp}`, userId, 'EX', 60);

    // Exchange OTP
    const res = await app.inject({
      method: 'POST', url: '/v1/auth/google/exchange',
      payload: { code: otp },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ accessToken: expect.any(String) });

    // OTP must be consumed (cannot reuse)
    const res2 = await app.inject({
      method: 'POST', url: '/v1/auth/google/exchange',
      payload: { code: otp },
    });
    expect(res2.statusCode).toBe(400);
    expect(res2.json()).toMatchObject({ error: { code: 'INVALID_OTP' } });
  });

  it('POST /v1/auth/google/exchange with expired/missing OTP returns 400', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/auth/google/exchange',
      payload: { code: 'nonexistent-otp' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'INVALID_OTP' } });
  });

  it('GET /v1/auth/google/callback upserts new user and redirects with OTP code', async () => {
    // Mock Google API calls
    const state = 'test-csrf-state-abc123';
    vi.spyOn(global, 'fetch').mockImplementation(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'mock-google-access-token' }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }
      if (urlStr.includes('googleapis.com/oauth2/v3/userinfo')) {
        return new Response(JSON.stringify({
          sub: 'google-sub-001',
          email: 'newgoogleuser@example.com',
          name: 'New Google User',
          picture: 'https://example.com/pic.jpg',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`Unexpected fetch to: ${urlStr}`);
    } as typeof fetch);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/auth/google/callback?code=auth_code_123&state=${state}`,
      headers: { cookie: `google_state=${state}` },
    });

    expect(res.statusCode).toBe(302);
    const location = res.headers.location as string;
    expect(location).toContain('http://localhost:3000/api/auth/google/callback?code=');

    // Extract OTP from redirect and verify it exists in Redis
    const otp = new URL(location).searchParams.get('code')!;
    expect(otp).toBeTruthy();
    const storedUserId = await app.redis.get(`oauth:otp:${otp}`);
    expect(storedUserId).toBeTruthy();
  });

  it('GET /v1/auth/google/callback with mismatched state returns 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/auth/google/callback?code=auth_code&state=wrong-state',
      headers: { cookie: 'google_state=correct-state' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /v1/auth/google/callback returns 400 when state cookie is missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/auth/google/callback?code=auth_code&state=some-state',
    });
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails (routes not yet defined)**

```bash
pnpm --filter @aivastra/api test -- google-oauth
```

Expected: tests fail — `GET /v1/auth/google/init` returns 404, exchange returns 404.

- [ ] **Step 3: Create `apps/api/src/modules/auth/google.routes.ts`**

```typescript
import type { FastifyInstance } from 'fastify';
import { randomBytes, randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { issueTokens } from './tokens.js';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

export async function googleAuthRoutes(app: FastifyInstance) {
  // Skip registration if Google OAuth is not configured
  if (!app.env.GOOGLE_CLIENT_ID || !app.env.GOOGLE_CLIENT_SECRET || !app.env.GOOGLE_CALLBACK_URL) {
    app.log.warn('Google OAuth not configured — /v1/auth/google/* routes disabled');
    return;
  }

  const clientId = app.env.GOOGLE_CLIENT_ID;
  const clientSecret = app.env.GOOGLE_CLIENT_SECRET;
  const callbackUrl = app.env.GOOGLE_CALLBACK_URL;
  const webUrl = app.env.WEB_URL;

  // ── Init ─────────────────────────────────────────────────────────────────
  app.get('/v1/auth/google/init', async (_req, reply) => {
    const state = randomBytes(32).toString('base64url');
    reply.setCookie('google_state', state, {
      httpOnly: true,
      secure: app.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/v1/auth/google',
      maxAge: 60,
      signed: false,
    });
    const url = new URL(GOOGLE_AUTH_URL);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', callbackUrl);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', state);
    return reply.redirect(302, url.toString());
  });

  // ── Callback ──────────────────────────────────────────────────────────────
  app.get('/v1/auth/google/callback', async (req, reply) => {
    const { code, state } = req.query as { code?: string; state?: string };
    const storedState = req.cookies['google_state'];

    if (!code || !state || !storedState || state !== storedState) {
      throw new AppError('INVALID_STATE', 400, 'invalid OAuth state');
    }

    reply.clearCookie('google_state', { path: '/v1/auth/google' });

    // Exchange code for Google access token
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: callbackUrl,
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenRes.ok) throw new AppError('GOOGLE_TOKEN_FAILED', 400, 'Google token exchange failed');
    const { access_token: googleAccessToken } = await tokenRes.json() as { access_token: string };

    // Fetch Google user profile
    const userRes = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${googleAccessToken}` },
    });
    if (!userRes.ok) throw new AppError('GOOGLE_USERINFO_FAILED', 400, 'Google userinfo fetch failed');
    const googleUser = await userRes.json() as {
      sub: string; email: string; name?: string; picture?: string;
    };

    // Upsert user in a transaction
    const userId = await app.db.transaction(async (tx) => {
      // 1. Find existing OAuth link
      const [existing] = await tx
        .select({ userId: schema.oauthAccounts.userId })
        .from(schema.oauthAccounts)
        .where(and(
          eq(schema.oauthAccounts.provider, 'google'),
          eq(schema.oauthAccounts.providerId, googleUser.sub),
        ));

      if (existing) {
        await tx
          .update(schema.oauthAccounts)
          .set({ displayName: googleUser.name, avatarUrl: googleUser.picture })
          .where(and(
            eq(schema.oauthAccounts.provider, 'google'),
            eq(schema.oauthAccounts.providerId, googleUser.sub),
          ));
        const [user] = await tx
          .select({ isBanned: schema.users.isBanned })
          .from(schema.users)
          .where(eq(schema.users.id, existing.userId));
        if (user?.isBanned) throw new AppError('BANNED', 403, 'account banned');
        return existing.userId;
      }

      // 2. Find user by email (link Google to existing account)
      let uid: string;
      const [byEmail] = await tx
        .select({ id: schema.users.id, isBanned: schema.users.isBanned })
        .from(schema.users)
        .where(eq(schema.users.email, googleUser.email));

      if (byEmail) {
        if (byEmail.isBanned) throw new AppError('BANNED', 403, 'account banned');
        uid = byEmail.id;
      } else {
        // 3. Create new user
        const [newUser] = await tx
          .insert(schema.users)
          .values({ email: googleUser.email, passwordHash: null, displayName: googleUser.name ?? null })
          .returning({ id: schema.users.id });
        uid = newUser!.id;
        await tx.insert(schema.userCredits).values({ userId: uid, balance: 0 });
      }

      // 4. Create OAuth link
      await tx.insert(schema.oauthAccounts).values({
        userId: uid,
        provider: 'google',
        providerId: googleUser.sub,
        email: googleUser.email,
        displayName: googleUser.name ?? null,
        avatarUrl: googleUser.picture ?? null,
      });

      return uid;
    });

    // Issue one-time OTP for web handoff
    const otp = randomUUID();
    await app.redis.set(`oauth:otp:${otp}`, userId, 'EX', 60);

    return reply.redirect(302, `${webUrl}/api/auth/google/callback?code=${otp}`);
  });

  // ── Exchange ──────────────────────────────────────────────────────────────
  app.post('/v1/auth/google/exchange', {
    schema: { body: z.object({ code: z.string().min(1) }) },
  }, async (req, reply) => {
    const { code } = req.body as { code: string };
    const userId = await app.redis.getdel(`oauth:otp:${code}`);
    if (!userId) throw new AppError('INVALID_OTP', 400, 'invalid or expired OTP');
    return issueTokens(app, userId, reply, 200);
  });
}
```

- [ ] **Step 4: Register `googleAuthRoutes` in `apps/api/src/server.ts`**

Add import after the `authRoutes` import line:

```typescript
import { googleAuthRoutes } from './modules/auth/google.routes.js';
```

Add registration after `await app.register(authRoutes);`:

```typescript
  await app.register(googleAuthRoutes);
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm --filter @aivastra/api test -- google-oauth
```

Expected: all 6 tests pass.

- [ ] **Step 6: Run full test suite to confirm no regression**

```bash
pnpm --filter @aivastra/api test
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/auth/google.routes.ts \
        apps/api/src/server.ts \
        apps/api/test/integration/google-oauth.test.ts
git commit -m "feat(api): Google OAuth routes — init, callback, exchange"
```

---

## Task 5: Web Callback Handler + GoogleBtn

**Files:**
- Create: `apps/web/src/app/api/auth/google/callback/route.ts`
- Modify: `apps/web/src/components/ui/google-btn.tsx`

- [ ] **Step 1: Create `apps/web/src/app/api/auth/google/callback/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { setAuthCookies } from '@/lib/auth-cookies';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');

  if (!code) {
    const url = new URL(`${BASE_PATH}/login`, req.url);
    url.searchParams.set('error', 'oauth_failed');
    return NextResponse.redirect(url);
  }

  let data: { accessToken?: string };
  let setCookieHeader: string | null = null;

  try {
    const res = await fetch(`${API_URL}/v1/auth/google/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });

    if (!res.ok) {
      const url = new URL(`${BASE_PATH}/login`, req.url);
      url.searchParams.set('error', 'oauth_failed');
      return NextResponse.redirect(url);
    }

    data = await res.json() as { accessToken?: string };
    setCookieHeader = res.headers.get('set-cookie');
  } catch {
    const url = new URL(`${BASE_PATH}/login`, req.url);
    url.searchParams.set('error', 'oauth_failed');
    return NextResponse.redirect(url);
  }

  const response = NextResponse.redirect(new URL(`${BASE_PATH}/studio`, req.url));
  setAuthCookies(response, data.accessToken!, setCookieHeader);
  return response;
}
```

- [ ] **Step 2: Update `apps/web/src/components/ui/google-btn.tsx`**

Replace the entire file:

```typescript
'use client';
import { C } from '../tokens';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export function GoogleBtn({ label }: { label: string }) {
  return (
    <a
      href={`${API_URL}/v1/auth/google/init`}
      style={{
        width: '100%', height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        background: C.white, border: `1px solid ${C.border2}`, borderRadius: 8, cursor: 'pointer',
        fontFamily: 'inherit', fontWeight: 500, fontSize: 14, color: C.text,
        textDecoration: 'none', transition: 'background .15s',
      }}
      onMouseOver={(e) => { (e.currentTarget as HTMLAnchorElement).style.background = '#f7f7f7'; }}
      onMouseOut={(e) => { (e.currentTarget as HTMLAnchorElement).style.background = C.white; }}
    >
      <svg width="18" height="18" viewBox="0 0 48 48">
        <path fill="#EA4335" d="M24 9.5c3.5 0 6.3 1.2 8.4 3.2l6.3-6.3C34.9 2.7 29.8.5 24 .5 14.8.5 7 6.1 3.3 14l7.4 5.7C12.5 13.4 17.8 9.5 24 9.5z" />
        <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.7c-.6 3-2.3 5.4-4.8 7.1l7.4 5.7c4.3-4 6.8-9.8 7.2-16.8z" />
        <path fill="#FBBC05" d="M10.7 28.3A14.9 14.9 0 019.5 24c0-1.5.3-3 .7-4.3L2.8 14C1 17.1 0 20.4 0 24s1 6.9 2.8 10l7.9-5.7z" />
        <path fill="#34A853" d="M24 47.5c5.8 0 10.7-1.9 14.3-5.1l-7.4-5.7c-2 1.3-4.4 2.1-6.9 2.1-6.2 0-11.5-4-13.3-9.5l-7.4 5.7C7 41.9 14.8 47.5 24 47.5z" />
      </svg>
      {label}
    </a>
  );
}
```

> `onClick` prop removed — navigation is handled by the `href`. The `label` prop is preserved (login page passes `"Continue with Google"`).

- [ ] **Step 3: TypeScript check for the web app**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/api/auth/google/callback/route.ts \
        apps/web/src/components/ui/google-btn.tsx
git commit -m "feat(web): Google OAuth callback handler + wire up GoogleBtn"
```

---

## Task 6: End-to-End Smoke Test

**No new files — manual verification.**

- [ ] **Step 1: Start the stack**

```bash
pnpm docker:up   # starts Postgres, Redis, MinIO
pnpm dev         # starts api (port 4000) + web (port 3000)
```

- [ ] **Step 2: Verify the GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are in `.env`**

```bash
grep GOOGLE .env
```

Expected: all four Google vars present and non-empty.

- [ ] **Step 3: Open `http://localhost:3000/login` in a browser**

- [ ] **Step 4: Click "Continue with Google"**

Expected:
- Browser navigates to `localhost:4000/v1/auth/google/init`
- Immediately redirected to `accounts.google.com` OAuth consent screen
- Google consent screen shows "Aivastra" app name

- [ ] **Step 5: Complete Google sign-in**

Expected:
- Browser redirected back to `localhost:4000/v1/auth/google/callback?code=...`
- Redirected to `localhost:3000/api/auth/google/callback?code=...`
- Redirected to `localhost:3000/studio`
- App shows authenticated state (sidebar renders user info if wired)

- [ ] **Step 6: Check DB for new user + oauth_accounts row**

```bash
psql $DATABASE_URL -c "SELECT id, email, display_name FROM users ORDER BY created_at DESC LIMIT 1;"
psql $DATABASE_URL -c "SELECT provider, provider_id, email FROM oauth_accounts ORDER BY created_at DESC LIMIT 1;"
```

Expected: matching rows for the Google account used.

- [ ] **Step 7: Sign out and sign in again — confirm existing user found, no duplicate created**

```bash
psql $DATABASE_URL -c "SELECT COUNT(*) FROM users WHERE email = 'your-google-email@gmail.com';"
```

Expected: `1` — not `2`.

---

## Self-Review Notes

- **Spec §7 banned user**: Tested via `isBanned` check inside the transaction in `google.routes.ts` (403 for banned accounts). Not covered by a unit test — add if paranoia is high.
- **Spec §8 no new deps**: Confirmed — uses raw `fetch` and ioredis `getdel` (already a dep).
- **`parseDuration`**: Extracted to `tokens.ts` in Task 3; used by `issueTokens`. Consistent naming throughout.
- **`issueTokens` signature**: `(app, userId, reply, status)` — consistent across `routes.ts`, `tokens.ts`, `google.routes.ts`.
- **`oauthAccounts` in schema.index**: Exported via `export * from './users.js'` — no change to `schema/index.ts` needed.
- **Drizzle `null` insert**: `passwordHash: null` is valid when field is nullable (Drizzle infers type as `string | null`).
- **`google_state` cookie path**: Set to `/v1/auth/google` — scoped to the Google callback path only. Cookie is available when browser hits `/v1/auth/google/callback` (sub-path match).
