# WhatsApp bot — Plan 1: Connect and identity

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A seller can connect a WhatsApp number to their existing web account — started from the chat (a link) or from the web (a prefilled `CONNECT <code>` message) — see and disconnect it in Settings, and see its status in the studio.

**Architecture:** One new table, `messaging_accounts`, maps `(channel, external_id)` to `users.id`. Single-use connect tokens and codes live in Redis with a TTL and are redeemed with `GETDEL`, the same pattern as the WordPress connect flow (`apps/api/src/modules/merchant/wordpress-shared.ts`). A new api module `apps/api/src/modules/messaging/` holds the identity functions and the authenticated web routes; catalogues-web gets a `/connect/whatsapp` confirm page, a WhatsApp section in Settings and a status chip in the studio.

**Tech Stack:** Fastify 5 + `fastify-type-provider-zod`, Drizzle ORM (PostgreSQL 16), ioredis, Vitest; Next.js 15 + TanStack Query in `apps/catalogues-web`.

**Spec:** `docs/superpowers/specs/2026-10-12-whatsapp-catalog-bot-design.md` (sections 7, 12, 14; decisions D13, D15, D21, D27, D29).

**This is plan 1 of 5.** Plan 2 (conversation engine), plan 3 (WhatsApp adapter, inbound consumer, delivery), plan 4 (Amazon white-background removal) and plan 5 (garment recognition on our GPU) are separate. Nothing in this plan changed when the catalog flow was cut to five steps (spec D40). Plan 3 calls `createChatConnectToken`, `consumeWebConnectCode`, `connectAccount` and `findAccountByExternalId` from this plan; nothing here talks to Meta.

## Deviation from the spec (recorded in Task 6)

The spec's section 12 has a `messaging_connect_tokens` Postgres table. This plan stores tokens in Redis instead:

| | Developers | Users |
|---|---|---|
| Postgres token table (spec) | A second table and migration, a cleanup sweeper for expired rows, and a hand-written single-use `UPDATE … WHERE used_at IS NULL`. | None visible. |
| **Redis `SET EX` + `GETDEL` (this plan)** | No second table, no sweeper; single use and expiry are atomic Redis primitives; matches the existing WordPress connect flow. Lost on a Redis flush. | A flush only means asking for a fresh link. |

Tokens are never a record anyone needs later: the durable fact is the `messaging_accounts` row, which carries `linked_via` and `opted_in_at`.

## Global Constraints

- pnpm workspaces only; ESM; TypeScript 5.6. Import `@aivastra/db` as `workspace:*`, never by relative path into `packages/`.
- Feature flag `MESSAGING_WHATSAPP_ENABLED` accepts only the literal `'true'` (`z.preprocess((v) => v === 'true', z.boolean())`), and code compares it with `=== true`. Tests construct `Env` objects directly, so an unset flag is `undefined` there.
- No schema or data changes against production. The migration is generated locally and ships through push → CI/CD → `db:migrate:prod`.
- No `console.log` in committed code; use `app.log`.
- Secrets discipline: tokens and codes are stored only as a SHA-256 hash (in the Redis key), never logged, and sent in request **bodies**, not URLs or paths, so Fastify's request log never records them.
- catalogues-web: colours from `C` / `grad` in `src/components/tokens.ts`, never raw hex. No raw `<select>` (none is needed here).
- Comment the *why*, matching the surrounding files.
- Consent copy is the approved wording from spec section 14, verbatim.
- One number connects to one account: `UNIQUE (channel, external_id)`. One account may have several numbers.
- A match between the WhatsApp number and `users.phone` is a hint only (D29): it never connects anything, never blocks, and never rewrites `users.phone`.

## File structure

| File | Responsibility |
|---|---|
| `packages/db/src/schema/messaging.ts` (create) | `messaging_accounts` table |
| `packages/db/src/schema/index.ts` (modify) | export it |
| `packages/db/src/migrations/0224_*.sql` + `meta/` (generated) | migration |
| `packages/types/src/messaging.ts` (create) | Zod request/response shapes |
| `packages/types/src/index.ts` (modify) | export it |
| `apps/api/src/env.ts` (modify) | `MESSAGING_WHATSAPP_ENABLED`, `WHATSAPP_DISPLAY_NUMBER` |
| `apps/api/src/modules/messaging/identity.ts` (create) | phone helpers, Redis tokens/codes, account CRUD, DTO |
| `apps/api/src/modules/messaging/connect.routes.ts` (create) | authenticated web routes |
| `apps/api/src/server.ts` (modify) | register the routes |
| `apps/api/test/messaging-identity.test.ts` (create) | unit tests for pure helpers |
| `apps/api/test/integration/messaging-connect.test.ts` (create) | route + Redis + DB tests |
| `apps/catalogues-web/src/hooks/use-whatsapp-status.ts` (create) | status query |
| `apps/catalogues-web/src/app/connect/whatsapp/consent.ts` (create) | approved consent copy |
| `apps/catalogues-web/src/app/connect/whatsapp/page.tsx` (create) | chat-started confirm page |
| `apps/catalogues-web/src/app/(app)/settings/whatsapp-panel.tsx` (create) | Settings connect / list / disconnect |
| `apps/catalogues-web/src/app/(app)/settings/page.tsx` (modify) | render the panel |
| `apps/catalogues-web/src/components/whatsapp-status-chip.tsx` (create) | studio chip |
| `apps/catalogues-web/src/app/(app)/studio/page.tsx` (modify) | pass chip to `TopBar right` |
| `.env.example`, `.env.production.example` (modify) | document the two vars |

---

### Task 1: `messaging_accounts` table, migration and shared types

**Files:**
- Create: `packages/db/src/schema/messaging.ts`
- Modify: `packages/db/src/schema/index.ts`
- Generated: `packages/db/src/migrations/0224_<drizzle-name>.sql`, `packages/db/src/migrations/meta/0224_snapshot.json`, `packages/db/src/migrations/meta/_journal.json`
- Create: `packages/types/src/messaging.ts`
- Modify: `packages/types/src/index.ts`

**Interfaces:**
- Produces: `schema.messagingAccounts` (columns below); types `MessagingAccount`, `MessagingAccountsResponse`, `WebConnectCodeResponse`, `ChatConnectTokenBody`, `ChatConnectPreviewResponse`, `ChatConnectConfirmResponse` from `@aivastra/types`.

- [ ] **Step 1: Write the schema file**

`packages/db/src/schema/messaging.ts`:

```ts
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.js';

// One row per (channel, sender): "this WhatsApp number belongs to that user".
// The bot never creates users (spec D13) — a row only ever attaches a number to
// an existing web account, so users itself needs no new kind of row. Generic
// channel/external_id so Messenger (PSID) and Instagram (IGSID) fit later
// without a second table. Single-use connect tokens are NOT stored here: they
// live in Redis with a TTL (modules/messaging/identity.ts).
export const messagingAccounts = pgTable(
  'messaging_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // 'whatsapp' (later 'messenger' | 'instagram')
    channel: text('channel').notNull(),
    // E.164 for WhatsApp ('+919109516207'). Verified by construction: WhatsApp
    // delivered a message from it, unlike the unverified users.phone.
    externalId: text('external_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // When the seller confirmed the connect page (or sent the CONNECT code) — the
    // consent timestamp for the wording in spec section 14.
    optedInAt: timestamp('opted_in_at', { withTimezone: true }).notNull().defaultNow(),
    // Set by STOP; the bot sends nothing while it is set. The connection stays.
    optedOutAt: timestamp('opted_out_at', { withTimezone: true }),
    // Last inbound message; the 24-hour window check before any free-form send.
    lastInboundAt: timestamp('last_inbound_at', { withTimezone: true }),
    // 'chat_link' | 'web_code'
    linkedVia: text('linked_via').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('messaging_accounts_channel_external_id_uniq').on(t.channel, t.externalId),
    index('messaging_accounts_user_id_idx').on(t.userId),
  ],
);
```

- [ ] **Step 2: Export it**

In `packages/db/src/schema/index.ts`, add after the `merchant.js` line (keep the list alphabetical):

```ts
export * from './messaging.js';
```

- [ ] **Step 3: Generate the migration locally**

Run: `pnpm --filter @aivastra/db generate`
Expected: a new `packages/db/src/migrations/0224_<name>.sql` (the name is random) plus `meta/0224_snapshot.json` and an updated `meta/_journal.json`.

Check the SQL contains exactly one `CREATE TABLE "messaging_accounts"`, the FK to `users` with `ON DELETE cascade`, the unique index and the plain index, and nothing else. If it contains unrelated statements, stop: someone's schema change is unmigrated. If another branch has also taken `0224`, follow `docs/version-control.md` for migration conflicts.

- [ ] **Step 4: Apply it to the local database**

Run: `pnpm docker:up` (if not running), then `pnpm db:migrate`
Expected: exits 0. Confirm with:
`docker exec -i $(docker ps -qf name=postgres) psql -U tryon -d tryon -c '\d messaging_accounts'`
(adjust the container filter and DB name to your local `.env`). Expected: the table with the columns above.

- [ ] **Step 5: Write the shared types**

`packages/types/src/messaging.ts`:

```ts
import { z } from 'zod';

export const MessagingChannel = z.enum(['whatsapp']);
export type MessagingChannel = z.infer<typeof MessagingChannel>;

export const MessagingAccount = z.object({
  id: z.string().uuid(),
  channel: MessagingChannel,
  // E.164. Shown in full to the account's own owner only.
  externalId: z.string(),
  optedOut: z.boolean(),
  connectedAt: z.string(),
});
export type MessagingAccount = z.infer<typeof MessagingAccount>;

export const MessagingAccountsResponse = z.object({
  // false when MESSAGING_WHATSAPP_ENABLED is off: the web hides every WhatsApp UI.
  enabled: z.boolean(),
  accounts: z.array(MessagingAccount),
});
export type MessagingAccountsResponse = z.infer<typeof MessagingAccountsResponse>;

export const WebConnectCodeResponse = z.object({
  code: z.string(),
  // Digits only, e.g. '15556585373' — what wa.me expects.
  displayNumber: z.string(),
  waLink: z.string(),
  expiresInSeconds: z.number().int(),
});
export type WebConnectCodeResponse = z.infer<typeof WebConnectCodeResponse>;

// Sent in the body, never the URL, so request logs never capture it.
export const ChatConnectTokenBody = z.object({ token: z.string().min(20).max(100) });
export type ChatConnectTokenBody = z.infer<typeof ChatConnectTokenBody>;

export const ChatConnectPreviewResponse = z.object({
  phoneMasked: z.string(),
  // D29: a hint only. Never connects or blocks anything.
  matchesProfile: z.boolean(),
  profilePhoneLast4: z.string().nullable(),
  alreadyConnected: z.boolean(),
});
export type ChatConnectPreviewResponse = z.infer<typeof ChatConnectPreviewResponse>;

export const ChatConnectConfirmResponse = z.object({ account: MessagingAccount });
export type ChatConnectConfirmResponse = z.infer<typeof ChatConnectConfirmResponse>;
```

In `packages/types/src/index.ts`, add (alphabetical, before `refund.js`):

```ts
export * from './messaging.js';
```

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @aivastra/db typecheck && pnpm --filter @aivastra/types typecheck`
(If a package has no `typecheck` script, run `pnpm --filter <pkg> exec tsc --noEmit`.)
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/schema/messaging.ts packages/db/src/schema/index.ts packages/db/src/migrations packages/types/src/messaging.ts packages/types/src/index.ts
git commit -m "feat(db): messaging_accounts table and messaging types for the WhatsApp bot"
```

---

### Task 2: Identity functions

**Files:**
- Create: `apps/api/src/modules/messaging/identity.ts`
- Test: `apps/api/test/messaging-identity.test.ts`

**Interfaces:**
- Consumes: `schema.messagingAccounts` (Task 1), `MessagingAccount` type (Task 1).
- Produces (used by Task 3 and by plan 3):
  - `CHANNEL_WHATSAPP: 'whatsapp'`
  - `toE164FromWaId(waId: string): string` — throws `AppError('VALIDATION', 400)` on a malformed id
  - `maskPhone(e164: string): string`
  - `matchesProfilePhone(e164: string, profilePhone: string | null): boolean`
  - `waConnectLink(displayNumber: string, code: string): string`
  - `chatConnectUrl(webUrl: string, token: string): string`
  - `CHAT_TOKEN_TTL_SECONDS = 1800`, `WEB_CODE_TTL_SECONDS = 600`
  - `createChatConnectToken(redis, externalId: string): Promise<string>`
  - `peekChatConnectToken(redis, token: string): Promise<ChatTokenPayload | null>`
  - `consumeChatConnectToken(redis, token: string): Promise<ChatTokenPayload | null>`
  - `createWebConnectCode(redis, userId: string): Promise<string>`
  - `consumeWebConnectCode(redis, code: string): Promise<{ userId: string } | null>`
  - `parseConnectCommand(text: string): string | null` — returns the code from `CONNECT <code>`
  - `connectAccount(db, input: ConnectInput): Promise<{ account: MessagingAccountRow; created: boolean }>` — throws `NUMBER_IN_USE` (409)
  - `findAccountByExternalId(db, channel, externalId): Promise<MessagingAccountRow | null>`
  - `listAccounts(db, userId): Promise<MessagingAccountRow[]>`
  - `disconnectAccount(db, userId, id): Promise<boolean>`
  - `toMessagingAccountDto(row): MessagingAccount`
  - `connectTokenExpired(): AppError` (410 `CONNECT_TOKEN_EXPIRED`), `numberInUse(): AppError` (409 `NUMBER_IN_USE`)

- [ ] **Step 1: Write the failing unit tests for the pure helpers**

`apps/api/test/messaging-identity.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  chatConnectUrl,
  maskPhone,
  matchesProfilePhone,
  parseConnectCommand,
  toE164FromWaId,
  waConnectLink,
} from '../src/modules/messaging/identity';

describe('toE164FromWaId', () => {
  it('prefixes the digits WhatsApp sends with +', () => {
    expect(toE164FromWaId('919109516207')).toBe('+919109516207');
  });
  it('strips anything that is not a digit', () => {
    expect(toE164FromWaId('+91 91095-16207')).toBe('+919109516207');
  });
  it('rejects ids that cannot be a phone number', () => {
    expect(() => toE164FromWaId('1234')).toThrow();
    expect(() => toE164FromWaId('1234567890123456')).toThrow();
  });
});

describe('maskPhone', () => {
  it('keeps the country code, two digits and the last three', () => {
    expect(maskPhone('+919109516207')).toBe('+9191•••••207');
  });
});

describe('matchesProfilePhone', () => {
  it('matches when the last 10 digits equal the 10-digit profile number', () => {
    expect(matchesProfilePhone('+919109516207', '9109516207')).toBe(true);
  });
  it('does not match a different number', () => {
    expect(matchesProfilePhone('+919109516207', '9000000000')).toBe(false);
  });
  it('does not match when there is no profile number', () => {
    expect(matchesProfilePhone('+919109516207', null)).toBe(false);
  });
  it('does not match a profile value that is not 10 digits', () => {
    expect(matchesProfilePhone('+919109516207', '16207')).toBe(false);
  });
});

describe('parseConnectCommand', () => {
  it('returns the code, uppercased', () => {
    expect(parseConnectCommand('CONNECT ab2cd3ef')).toBe('AB2CD3EF');
  });
  it('tolerates surrounding whitespace and lower-case keyword', () => {
    expect(parseConnectCommand('  connect   AB2CD3EF \n')).toBe('AB2CD3EF');
  });
  it('returns null for anything else', () => {
    expect(parseConnectCommand('hello')).toBeNull();
    expect(parseConnectCommand('CONNECT')).toBeNull();
    expect(parseConnectCommand('CONNECT AB2CD3EF extra')).toBeNull();
  });
});

describe('links', () => {
  it('builds a wa.me link with the prefilled CONNECT message', () => {
    expect(waConnectLink('15556585373', 'AB2CD3EF')).toBe(
      'https://wa.me/15556585373?text=CONNECT%20AB2CD3EF',
    );
  });
  it('builds the connect page URL without a double slash', () => {
    expect(chatConnectUrl('https://app.aivastra.com/', 'tok')).toBe(
      'https://app.aivastra.com/connect/whatsapp?t=tok',
    );
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run (from `apps/api`): `npx vitest run test/messaging-identity.test.ts`
Expected: FAIL — cannot resolve `../src/modules/messaging/identity`.

- [ ] **Step 3: Implement `identity.ts`**

`apps/api/src/modules/messaging/identity.ts`:

```ts
import { createHash, randomBytes, randomInt } from 'node:crypto';
import type { DB } from '@aivastra/db';
import { schema } from '@aivastra/db';
import type { MessagingAccount } from '@aivastra/types';
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../../lib/errors.js';

type RedisClient = FastifyInstance['redis'];
const M = schema.messagingAccounts;
export type MessagingAccountRow = typeof M.$inferSelect;

export const CHANNEL_WHATSAPP = 'whatsapp' as const;
export type Channel = typeof CHANNEL_WHATSAPP;

// Chat-started tokens outlive web codes: the seller may have to register and
// verify their email before reaching the confirm page (T4). A token is not a
// credential — the confirm page requires the normal web login — so a longer
// life costs little.
export const CHAT_TOKEN_TTL_SECONDS = 30 * 60;
export const WEB_CODE_TTL_SECONDS = 10 * 60;
const CHAT_TOKEN_PREFIX = 'msg:connect:chat:';
const WEB_CODE_PREFIX = 'msg:connect:web:';
// No I, L, O, 0, 1: the code may be read off a screen and typed by hand when
// wa.me cannot prefill it. 31^8 ≈ 8.5e11 combinations against a 10-minute life
// and the inbound per-sender rate limit (plan 3).
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

export type ChatTokenPayload = { channel: Channel; externalId: string };
export type ConnectInput = {
  channel: Channel;
  externalId: string;
  userId: string;
  linkedVia: 'chat_link' | 'web_code';
};

// Only the hash is ever a Redis key, so a Redis dump does not hand out live links.
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export const connectTokenExpired = () =>
  new AppError(
    'CONNECT_TOKEN_EXPIRED',
    410,
    'This link has expired or was already used. Send any message to the Aivastra WhatsApp number to get a new one.',
  );

export const numberInUse = () =>
  new AppError(
    'NUMBER_IN_USE',
    409,
    'This WhatsApp number is connected to another Aivastra account. Disconnect it there first.',
  );

/** WhatsApp sends `wa_id` as bare digits ('919109516207'); stored as E.164. */
export function toE164FromWaId(waId: string): string {
  const digits = waId.replace(/\D/g, '');
  // E.164 allows at most 15 digits; nothing real is shorter than 8.
  if (digits.length < 8 || digits.length > 15) {
    throw new AppError('VALIDATION', 400, 'invalid WhatsApp number');
  }
  return `+${digits}`;
}

/** '+919109516207' → '+9191•••••207'. A forwarded connect link must not reveal the full number. */
export function maskPhone(e164: string): string {
  if (e164.length <= 8) return e164;
  return `${e164.slice(0, 5)}${'•'.repeat(e164.length - 8)}${e164.slice(-3)}`;
}

/**
 * D29: compares the WhatsApp number's last 10 digits with users.phone, which
 * PATCH /v1/me holds to exactly 10 digits with no country code — so this
 * assumes Indian numbers, which is all the profile field can hold today.
 */
export function matchesProfilePhone(e164: string, profilePhone: string | null): boolean {
  if (!profilePhone) return false;
  const profile = profilePhone.replace(/\D/g, '');
  if (profile.length !== 10) return false;
  return e164.replace(/\D/g, '').slice(-10) === profile;
}

export function waConnectLink(displayNumber: string, code: string): string {
  return `https://wa.me/${displayNumber}?text=${encodeURIComponent(`CONNECT ${code}`)}`;
}

export function chatConnectUrl(webUrl: string, token: string): string {
  return `${webUrl.replace(/\/+$/, '')}/connect/whatsapp?t=${encodeURIComponent(token)}`;
}

/** 'CONNECT ab2cd3ef' → 'AB2CD3EF'; anything else → null. */
export function parseConnectCommand(text: string): string | null {
  const match = /^\s*connect\s+([a-z0-9]+)\s*$/i.exec(text);
  return match ? match[1].toUpperCase() : null;
}

export async function createChatConnectToken(
  redis: RedisClient,
  externalId: string,
): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const payload: ChatTokenPayload = { channel: CHANNEL_WHATSAPP, externalId };
  await redis.set(
    CHAT_TOKEN_PREFIX + sha256(token),
    JSON.stringify(payload),
    'EX',
    CHAT_TOKEN_TTL_SECONDS,
  );
  return token;
}

/** Read without consuming — the confirm page shows the number before the seller confirms. */
export async function peekChatConnectToken(
  redis: RedisClient,
  token: string,
): Promise<ChatTokenPayload | null> {
  const raw = await redis.get(CHAT_TOKEN_PREFIX + sha256(token));
  return raw ? (JSON.parse(raw) as ChatTokenPayload) : null;
}

/** GETDEL: atomic, so two confirm clicks can never both redeem one token. */
export async function consumeChatConnectToken(
  redis: RedisClient,
  token: string,
): Promise<ChatTokenPayload | null> {
  const raw = await redis.getdel(CHAT_TOKEN_PREFIX + sha256(token));
  return raw ? (JSON.parse(raw) as ChatTokenPayload) : null;
}

export async function createWebConnectCode(redis: RedisClient, userId: string): Promise<string> {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  await redis.set(
    WEB_CODE_PREFIX + sha256(code),
    JSON.stringify({ userId }),
    'EX',
    WEB_CODE_TTL_SECONDS,
  );
  return code;
}

export async function consumeWebConnectCode(
  redis: RedisClient,
  code: string,
): Promise<{ userId: string } | null> {
  const raw = await redis.getdel(WEB_CODE_PREFIX + sha256(code.trim().toUpperCase()));
  return raw ? (JSON.parse(raw) as { userId: string }) : null;
}

/**
 * Idempotent for the same user; NUMBER_IN_USE for a different one. Insert-first
 * on the unique index instead of select-then-insert, so two concurrent connects
 * of one number can never both succeed.
 */
export async function connectAccount(
  db: DB,
  input: ConnectInput,
): Promise<{ account: MessagingAccountRow; created: boolean }> {
  const [inserted] = await db
    .insert(M)
    .values({
      channel: input.channel,
      externalId: input.externalId,
      userId: input.userId,
      linkedVia: input.linkedVia,
    })
    .onConflictDoNothing()
    .returning();
  if (inserted) return { account: inserted, created: true };

  const existing = await findAccountByExternalId(db, input.channel, input.externalId);
  if (!existing || existing.userId !== input.userId) throw numberInUse();
  return { account: existing, created: false };
}

export async function findAccountByExternalId(
  db: DB,
  channel: Channel,
  externalId: string,
): Promise<MessagingAccountRow | null> {
  const [row] = await db
    .select()
    .from(M)
    .where(and(eq(M.channel, channel), eq(M.externalId, externalId)))
    .limit(1);
  return row ?? null;
}

export async function listAccounts(db: DB, userId: string): Promise<MessagingAccountRow[]> {
  return db.select().from(M).where(eq(M.userId, userId)).orderBy(asc(M.createdAt));
}

/** Deletes the row (and with it the stored number). Scoped to the owner. */
export async function disconnectAccount(db: DB, userId: string, id: string): Promise<boolean> {
  const deleted = await db
    .delete(M)
    .where(and(eq(M.id, id), eq(M.userId, userId)))
    .returning({ id: M.id });
  return deleted.length > 0;
}

export function toMessagingAccountDto(row: MessagingAccountRow): MessagingAccount {
  return {
    id: row.id,
    channel: row.channel as Channel,
    externalId: row.externalId,
    optedOut: row.optedOutAt !== null,
    connectedAt: row.createdAt.toISOString(),
  };
}
```

- [ ] **Step 4: Run the unit tests**

Run (from `apps/api`): `npx vitest run test/messaging-identity.test.ts`
Expected: PASS, 13 tests.

If `import type { DB } from '@aivastra/db'` does not resolve, check how `apps/api/src/modules/jobs/refund-requests.ts` imports it (it uses exactly this line) before changing anything.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/messaging/identity.ts apps/api/test/messaging-identity.test.ts
git commit -m "feat(api): messaging identity helpers and Redis connect tokens"
```

---

### Task 3: Connect routes, env flag and wiring

**Files:**
- Modify: `apps/api/src/env.ts` (next to `SHOPIFY_WIDGET_VERBOSE`)
- Create: `apps/api/src/modules/messaging/connect.routes.ts`
- Modify: `apps/api/src/server.ts` (import + `await app.register(messagingConnectRoutes);` after `refundRequestsRoutes`)
- Modify: `.env.example`, `.env.production.example`
- Test: `apps/api/test/integration/messaging-connect.test.ts`

**Interfaces:**
- Consumes: everything in Task 2's Produces list.
- Produces (HTTP, all `requireUser`):
  - `GET /v1/messaging/accounts` → `MessagingAccountsResponse` (works with the flag off: `{ enabled: false, accounts: [] }`)
  - `DELETE /v1/messaging/accounts/:id` → 204; 404 if not the caller's
  - `POST /v1/messaging/connect/web-code` → `WebConnectCodeResponse`; 503 `NOT_CONFIGURED` without `WHATSAPP_DISPLAY_NUMBER`
  - `POST /v1/messaging/connect/chat/preview` body `{ token }` → `ChatConnectPreviewResponse`; 410 / 409
  - `POST /v1/messaging/connect/chat/confirm` body `{ token }` → `ChatConnectConfirmResponse`; 410 / 409
  - Every route except `GET /v1/messaging/accounts` returns 404 while the flag is off.
  - Plan 3 extends `confirm` to send "Connected" plus the main menu to the chat; nothing in this plan sends anything.

- [ ] **Step 1: Write the failing integration test**

`apps/api/test/integration/messaging-connect.test.ts`:

```ts
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CHANNEL_WHATSAPP,
  connectAccount,
  consumeWebConnectCode,
  createChatConnectToken,
} from '../../src/modules/messaging/identity';
import { buildTestApp, type TestApp } from '../helpers/api';
import { createVerifiedUserToken } from '../helpers/auth';
import { type Containers, startContainers } from '../helpers/containers';

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
// Unique per run: integration files share one Postgres process.
const uniq = () => Math.floor(Math.random() * 1e9).toString().padStart(9, '0');
const phone = () => `+91${uniq().slice(0, 1)}${uniq().slice(0, 9)}`;

describe('messaging connect (flag on)', () => {
  let c: Containers;
  let app: TestApp;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c, {
      MESSAGING_WHATSAPP_ENABLED: true,
      WHATSAPP_DISPLAY_NUMBER: '15556585373',
    });
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  it('requires a logged-in user', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/messaging/accounts' });
    expect(res.statusCode).toBe(401);
  });

  it('web-started: issues a single-use CONNECT code bound to the caller', async () => {
    const { token, userId } = await createVerifiedUserToken(app, `wa-web-${uniq()}@example.com`);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/messaging/connect/web-code',
      headers: auth(token),
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.code).toMatch(/^[A-HJKMNP-Z2-9]{8}$/);
    expect(body.displayNumber).toBe('15556585373');
    expect(body.waLink).toBe(`https://wa.me/15556585373?text=CONNECT%20${body.code}`);
    expect(body.expiresInSeconds).toBe(600);

    expect(await consumeWebConnectCode(app.redis, body.code.toLowerCase())).toEqual({ userId });
    expect(await consumeWebConnectCode(app.redis, body.code)).toBeNull();
  });

  it('chat-started: preview shows the masked number and the profile match', async () => {
    const { token, userId } = await createVerifiedUserToken(app, `wa-prev-${uniq()}@example.com`);
    const number = phone();
    await app.db
      .update(schema.users)
      .set({ phone: number.slice(-10) })
      .where(eq(schema.users.id, userId));
    const t = await createChatConnectToken(app.redis, number);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/messaging/connect/chat/preview',
      headers: auth(token),
      payload: { token: t },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      phoneMasked: `${number.slice(0, 5)}•••••${number.slice(-3)}`,
      matchesProfile: true,
      profilePhoneLast4: number.slice(-4),
      alreadyConnected: false,
    });

    // Preview does not consume: confirm still works afterwards.
    const confirm = await app.inject({
      method: 'POST',
      url: '/v1/messaging/connect/chat/confirm',
      headers: auth(token),
      payload: { token: t },
    });
    expect(confirm.statusCode).toBe(200);
  });

  it('chat-started: a different profile number is reported, not blocked', async () => {
    const { token, userId } = await createVerifiedUserToken(app, `wa-diff-${uniq()}@example.com`);
    await app.db
      .update(schema.users)
      .set({ phone: '9000001234' })
      .where(eq(schema.users.id, userId));
    const t = await createChatConnectToken(app.redis, phone());

    const res = await app.inject({
      method: 'POST',
      url: '/v1/messaging/connect/chat/preview',
      headers: auth(token),
      payload: { token: t },
    });
    expect(res.json()).toMatchObject({ matchesProfile: false, profilePhoneLast4: '1234' });

    const confirm = await app.inject({
      method: 'POST',
      url: '/v1/messaging/connect/chat/confirm',
      headers: auth(token),
      payload: { token: t },
    });
    expect(confirm.statusCode).toBe(200);
    // D29: a mismatch never rewrites the profile number.
    const [u] = await app.db
      .select({ phone: schema.users.phone })
      .from(schema.users)
      .where(eq(schema.users.id, userId));
    expect(u.phone).toBe('9000001234');
  });

  it('chat-started: confirm creates the row once and the token is single use', async () => {
    const { token, userId } = await createVerifiedUserToken(app, `wa-conf-${uniq()}@example.com`);
    const number = phone();
    const t = await createChatConnectToken(app.redis, number);

    const first = await app.inject({
      method: 'POST',
      url: '/v1/messaging/connect/chat/confirm',
      headers: auth(token),
      payload: { token: t },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().account).toMatchObject({
      channel: 'whatsapp',
      externalId: number,
      optedOut: false,
    });

    const second = await app.inject({
      method: 'POST',
      url: '/v1/messaging/connect/chat/confirm',
      headers: auth(token),
      payload: { token: t },
    });
    expect(second.statusCode).toBe(410);
    expect(second.json().error.code).toBe('CONNECT_TOKEN_EXPIRED');

    const rows = await app.db
      .select()
      .from(schema.messagingAccounts)
      .where(eq(schema.messagingAccounts.externalId, number));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId, linkedVia: 'chat_link' });
  });

  it('a number connected to another account is refused at preview and confirm', async () => {
    const owner = await createVerifiedUserToken(app, `wa-own-${uniq()}@example.com`);
    const other = await createVerifiedUserToken(app, `wa-oth-${uniq()}@example.com`);
    const number = phone();
    await connectAccount(app.db, {
      channel: CHANNEL_WHATSAPP,
      externalId: number,
      userId: owner.userId,
      linkedVia: 'web_code',
    });
    const t = await createChatConnectToken(app.redis, number);

    const preview = await app.inject({
      method: 'POST',
      url: '/v1/messaging/connect/chat/preview',
      headers: auth(other.token),
      payload: { token: t },
    });
    expect(preview.statusCode).toBe(409);
    expect(preview.json().error.code).toBe('NUMBER_IN_USE');

    const confirm = await app.inject({
      method: 'POST',
      url: '/v1/messaging/connect/chat/confirm',
      headers: auth(other.token),
      payload: { token: t },
    });
    expect(confirm.statusCode).toBe(409);
  });

  it('connecting the same number to the same user twice is idempotent', async () => {
    const { userId } = await createVerifiedUserToken(app, `wa-idem-${uniq()}@example.com`);
    const input = {
      channel: CHANNEL_WHATSAPP,
      externalId: phone(),
      userId,
      linkedVia: 'web_code' as const,
    };
    const a = await connectAccount(app.db, input);
    const b = await connectAccount(app.db, input);
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.account.id).toBe(a.account.id);
  });

  it('lists the caller’s numbers and disconnects only their own', async () => {
    const me = await createVerifiedUserToken(app, `wa-list-${uniq()}@example.com`);
    const stranger = await createVerifiedUserToken(app, `wa-str-${uniq()}@example.com`);
    const { account } = await connectAccount(app.db, {
      channel: CHANNEL_WHATSAPP,
      externalId: phone(),
      userId: me.userId,
      linkedVia: 'chat_link',
    });

    const list = await app.inject({
      method: 'GET',
      url: '/v1/messaging/accounts',
      headers: auth(me.token),
    });
    expect(list.json()).toEqual({
      enabled: true,
      accounts: [
        {
          id: account.id,
          channel: 'whatsapp',
          externalId: account.externalId,
          optedOut: false,
          connectedAt: account.createdAt.toISOString(),
        },
      ],
    });

    const theirs = await app.inject({
      method: 'DELETE',
      url: `/v1/messaging/accounts/${account.id}`,
      headers: auth(stranger.token),
    });
    expect(theirs.statusCode).toBe(404);

    const mine = await app.inject({
      method: 'DELETE',
      url: `/v1/messaging/accounts/${account.id}`,
      headers: auth(me.token),
    });
    expect(mine.statusCode).toBe(204);
    const after = await app.inject({
      method: 'GET',
      url: '/v1/messaging/accounts',
      headers: auth(me.token),
    });
    expect(after.json().accounts).toEqual([]);
  });

  it('deleting the user deletes their connected numbers', async () => {
    const { userId } = await createVerifiedUserToken(app, `wa-del-${uniq()}@example.com`);
    const number = phone();
    await connectAccount(app.db, {
      channel: CHANNEL_WHATSAPP,
      externalId: number,
      userId,
      linkedVia: 'chat_link',
    });
    await app.db.delete(schema.users).where(eq(schema.users.id, userId));
    const rows = await app.db
      .select()
      .from(schema.messagingAccounts)
      .where(eq(schema.messagingAccounts.externalId, number));
    expect(rows).toEqual([]);
  });
});

describe('messaging connect (flag off)', () => {
  let c: Containers;
  let app: TestApp;

  beforeAll(async () => {
    c = await startContainers();
    // Flag deliberately absent: tests build Env directly, so it is undefined here.
    app = await buildTestApp(c);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  it('reports disabled and hides every other route', async () => {
    const { token } = await createVerifiedUserToken(app, `wa-off-${uniq()}@example.com`);
    const list = await app.inject({
      method: 'GET',
      url: '/v1/messaging/accounts',
      headers: auth(token),
    });
    expect(list.json()).toEqual({ enabled: false, accounts: [] });

    const code = await app.inject({
      method: 'POST',
      url: '/v1/messaging/connect/web-code',
      headers: auth(token),
      payload: {},
    });
    expect(code.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run (from `apps/api`, with `pnpm docker:up` running): `npx vitest run --config vitest.integration.config.ts messaging-connect`
Expected: FAIL — the routes return 404 and `MESSAGING_WHATSAPP_ENABLED` is not part of `Env` (typecheck error or 404s).

If a delete of a `users` row in the cascade test fails on another FK, read the error: it names the table whose FK lacks `ON DELETE CASCADE`. Replace that test's delete with the account-erasure path the codebase already uses, rather than adding cascades to unrelated tables.

- [ ] **Step 3: Add the env vars**

In `apps/api/src/env.ts`, after `SHOPIFY_WIDGET_VERBOSE`:

```ts
  // WhatsApp catalog bot (docs/superpowers/specs/2026-10-12-whatsapp-catalog-bot-design.md).
  // Same literal-'true' pattern as SHOPIFY_ALLOW_TEST_SUBSCRIPTIONS: a stray 'false'
  // must not coerce to on. Off: GET /v1/messaging/accounts reports enabled:false and
  // every other messaging route 404s, so the web hides all WhatsApp UI.
  MESSAGING_WHATSAPP_ENABLED: z.preprocess((v) => v === 'true', z.boolean()).default(false),
  // The bot's number, digits only ('15556585373'), for wa.me links. Public, not a
  // secret. Blank in .env must not crash startup.
  WHATSAPP_DISPLAY_NUMBER: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().regex(/^\d{8,15}$/).optional(),
  ),
```

In `.env.example` and `.env.production.example`, add next to the Shopify flags:

```
# WhatsApp catalog bot — literal 'true' only. Display number is digits only.
MESSAGING_WHATSAPP_ENABLED=
WHATSAPP_DISPLAY_NUMBER=
```

- [ ] **Step 4: Write the routes**

`apps/api/src/modules/messaging/connect.routes.ts`:

```ts
import { schema } from '@aivastra/db';
import {
  type ChatConnectConfirmResponse,
  type ChatConnectPreviewResponse,
  ChatConnectTokenBody,
  type MessagingAccountsResponse,
  type WebConnectCodeResponse,
} from '@aivastra/types';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import {
  connectAccount,
  connectTokenExpired,
  consumeChatConnectToken,
  createWebConnectCode,
  disconnectAccount,
  findAccountByExternalId,
  listAccounts,
  maskPhone,
  matchesProfilePhone,
  numberInUse,
  peekChatConnectToken,
  toMessagingAccountDto,
  WEB_CODE_TTL_SECONDS,
  waConnectLink,
} from './identity.js';

function assertEnabled(app: FastifyInstance) {
  // `=== true`, not truthiness: tests build Env directly and leave the flag undefined.
  if (app.env.MESSAGING_WHATSAPP_ENABLED !== true) {
    throw new AppError('NOT_FOUND', 404, 'not found');
  }
}

/**
 * Web side of connecting a WhatsApp number (spec section 7). Both directions end
 * in one messaging_accounts row. Tokens and codes travel in request bodies, never
 * URLs, so the request log never records a live one.
 */
export async function messagingConnectRoutes(app: FastifyInstance) {
  // The one route that answers with the flag off: the web asks it to decide
  // whether to show any WhatsApp UI at all.
  app.get(
    '/v1/messaging/accounts',
    { preHandler: app.requireUser },
    async (req): Promise<MessagingAccountsResponse> => {
      if (app.env.MESSAGING_WHATSAPP_ENABLED !== true) return { enabled: false, accounts: [] };
      const rows = await listAccounts(app.db, req.userId);
      return { enabled: true, accounts: rows.map(toMessagingAccountDto) };
    },
  );

  app.delete(
    '/v1/messaging/accounts/:id',
    { preHandler: app.requireUser, schema: { params: z.object({ id: z.string().uuid() }) } },
    async (req, reply) => {
      assertEnabled(app);
      const { id } = req.params as { id: string };
      const removed = await disconnectAccount(app.db, req.userId, id);
      if (!removed) throw new AppError('NOT_FOUND', 404, 'connected number not found');
      return reply.code(204).send();
    },
  );

  // Web-started: the seller taps "Connect WhatsApp", WhatsApp opens with
  // "CONNECT <code>" prefilled, and the inbound consumer (plan 3) redeems it
  // against the sender's number.
  app.post(
    '/v1/messaging/connect/web-code',
    {
      preHandler: app.requireUser,
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req): Promise<WebConnectCodeResponse> => {
      assertEnabled(app);
      const displayNumber = app.env.WHATSAPP_DISPLAY_NUMBER;
      if (!displayNumber) {
        throw new AppError('NOT_CONFIGURED', 503, 'WhatsApp connection is not configured');
      }
      const code = await createWebConnectCode(app.redis, req.userId);
      return {
        code,
        displayNumber,
        waLink: waConnectLink(displayNumber, code),
        expiresInSeconds: WEB_CODE_TTL_SECONDS,
      };
    },
  );

  // Chat-started, step 1: show which number is about to be connected, without
  // consuming the token, so a seller who backs out can still use the link.
  app.post(
    '/v1/messaging/connect/chat/preview',
    {
      preHandler: app.requireUser,
      schema: { body: ChatConnectTokenBody },
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (req): Promise<ChatConnectPreviewResponse> => {
      assertEnabled(app);
      const { token } = req.body as ChatConnectTokenBody;
      const payload = await peekChatConnectToken(app.redis, token);
      if (!payload) throw connectTokenExpired();

      const existing = await findAccountByExternalId(app.db, payload.channel, payload.externalId);
      if (existing && existing.userId !== req.userId) throw numberInUse();

      const [user] = await app.db
        .select({ phone: schema.users.phone })
        .from(schema.users)
        .where(eq(schema.users.id, req.userId));
      const profilePhone = user?.phone ?? null;
      return {
        phoneMasked: maskPhone(payload.externalId),
        matchesProfile: matchesProfilePhone(payload.externalId, profilePhone),
        profilePhoneLast4: profilePhone ? profilePhone.slice(-4) : null,
        alreadyConnected: existing?.userId === req.userId,
      };
    },
  );

  // Chat-started, step 2. Consumed before connecting: a NUMBER_IN_USE failure
  // still burns the token, which is fine — the seller has to disconnect the
  // number elsewhere and ask the bot for a fresh link anyway.
  app.post(
    '/v1/messaging/connect/chat/confirm',
    {
      preHandler: app.requireUser,
      schema: { body: ChatConnectTokenBody },
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (req): Promise<ChatConnectConfirmResponse> => {
      assertEnabled(app);
      const { token } = req.body as ChatConnectTokenBody;
      const payload = await consumeChatConnectToken(app.redis, token);
      if (!payload) throw connectTokenExpired();
      const { account } = await connectAccount(app.db, {
        channel: payload.channel,
        externalId: payload.externalId,
        userId: req.userId,
        linkedVia: 'chat_link',
      });
      return { account: toMessagingAccountDto(account) };
    },
  );
}
```

- [ ] **Step 5: Register the routes**

In `apps/api/src/server.ts`, add the import next to the other module imports:

```ts
import { messagingConnectRoutes } from './modules/messaging/connect.routes.js';
```

and register it directly after `await app.register(refundRequestsRoutes);`:

```ts
  await app.register(messagingConnectRoutes);
```

- [ ] **Step 6: Run the integration test**

Run (from `apps/api`): `npx vitest run --config vitest.integration.config.ts messaging-connect`
Expected: PASS, 10 tests across both describe blocks.

- [ ] **Step 7: Run the api unit suite and typecheck**

Run: `pnpm --filter @aivastra/api test && pnpm --filter @aivastra/api typecheck && pnpm --filter @aivastra/api lint`
Expected: unit suite passes with the same count as before plus 13; typecheck and lint exit 0. Compare the pass count with the last entry in `docs/progress.md` (823 on 2026-10-12) plus 13.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/env.ts apps/api/src/modules/messaging/connect.routes.ts apps/api/src/server.ts apps/api/test/integration/messaging-connect.test.ts .env.example .env.production.example
git commit -m "feat(api): WhatsApp connect routes behind MESSAGING_WHATSAPP_ENABLED"
```

---

### Task 4: `/connect/whatsapp` confirm page

**Files:**
- Create: `apps/catalogues-web/src/app/connect/whatsapp/consent.ts`
- Create: `apps/catalogues-web/src/app/connect/whatsapp/page.tsx`

**Interfaces:**
- Consumes: `POST /v1/messaging/connect/chat/preview` and `/confirm` (Task 3); types from Task 1.
- Produces: the page at `/connect/whatsapp?t=<token>` that plan 3's bot links to via `chatConnectUrl(WEB_URL, token)`.

Not in `PUBLIC_PATHS`, so `src/middleware.ts` sends a logged-out visitor to `/login?next=/connect/whatsapp?t=…`. Login honours `next`; register stores it as `pending_next` across email verification in the same tab (`(auth)/register/page.tsx:142`). That is why the chat token lives 30 minutes.

- [ ] **Step 1: Write the consent copy**

`apps/catalogues-web/src/app/connect/whatsapp/consent.ts`:

```ts
// Approved 2026-10-13 (spec section 14, D21). Change only with sign-off: this is
// the consent the seller gives, and messaging_accounts.opted_in_at timestamps it.
export const CONSENT_POINTS = [
  'Aivastra will send messages to this WhatsApp number about the catalog images you create here, such as questions while you set up a catalog and the finished images.',
  'The photos you send in this chat are used to generate your catalog images and are stored in your Aivastra account, the same way as photos you upload on the website.',
  'Your WhatsApp number is stored so we can recognise you in the chat. We do not use it for marketing.',
  'Images created in the chat use credits from your Aivastra account.',
] as const;
```

- [ ] **Step 2: Write the page**

`apps/catalogues-web/src/app/connect/whatsapp/page.tsx`:

```tsx
'use client';

import type { ChatConnectConfirmResponse, ChatConnectPreviewResponse } from '@aivastra/types';
import { useMutation, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { C } from '@/components/tokens';
import { GradBtn } from '@/components/ui/grad-btn';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/errors';
import { CONSENT_POINTS } from './consent';

// Codes from apps/api/src/modules/messaging/identity.ts. Anything else falls
// back to the server's own message rather than a generic one.
function messageFor(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'CONNECT_TOKEN_EXPIRED') {
      return 'This link has expired or was already used. Send any message to the Aivastra WhatsApp number to get a new one.';
    }
    if (err.code === 'NUMBER_IN_USE') {
      return 'This WhatsApp number is already connected to another Aivastra account. Disconnect it from that account in Settings first.';
    }
  }
  return (err as Error)?.message || 'Something went wrong. Try again.';
}

// Same plain centred column as /connect/wordpress — no boxed card.
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: C.bg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <div style={{ width: '100%', maxWidth: 520, color: C.text }}>{children}</div>
    </div>
  );
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <Shell>
      <h1 style={{ fontWeight: 700, fontSize: 20, marginBottom: 8 }}>{title}</h1>
      <p style={{ fontSize: 14, color: C.mid, lineHeight: 1.6 }}>{body}</p>
    </Shell>
  );
}

function ConnectWhatsappInner() {
  const token = useSearchParams().get('t') ?? '';

  const preview = useQuery({
    queryKey: ['whatsapp-connect-preview', token],
    queryFn: () =>
      api.post<ChatConnectPreviewResponse>('/v1/messaging/connect/chat/preview', { token }),
    enabled: token.length > 0,
    retry: false,
  });

  const confirm = useMutation({
    mutationFn: () =>
      api.post<ChatConnectConfirmResponse>('/v1/messaging/connect/chat/confirm', { token }),
  });

  if (!token) {
    return (
      <Notice
        title="Invalid link"
        body="This link is missing information. Send any message to the Aivastra WhatsApp number to get a new one."
      />
    );
  }
  if (preview.isLoading) return <Notice title="Checking your link…" body="" />;
  if (preview.error) return <Notice title="Can't connect this number" body={messageFor(preview.error)} />;
  if (confirm.isSuccess || preview.data?.alreadyConnected) {
    return (
      <Notice
        title="WhatsApp connected"
        body="You can go back to WhatsApp and start creating catalog images. You can disconnect this number at any time in Settings."
      />
    );
  }

  const data = preview.data;
  if (!data) return null;
  return (
    <Shell>
      <h1 style={{ fontWeight: 700, fontSize: 20, marginBottom: 8 }}>
        Connect WhatsApp {data.phoneMasked} to your Aivastra account?
      </h1>
      {/* D29: a hint only. The seller can confirm either way. */}
      <p style={{ fontSize: 13, color: data.matchesProfile ? C.mint : C.amber, marginBottom: 20 }}>
        {data.matchesProfile
          ? 'This is the mobile number on your account.'
          : data.profilePhoneLast4
            ? `This is different from the mobile number on your account (ending ${data.profilePhoneLast4}).`
            : 'Your account has no mobile number saved.'}
      </p>

      <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>By connecting, you agree that:</p>
      <ul style={{ fontSize: 14, color: C.mid, lineHeight: 1.6, paddingLeft: 20, margin: 0 }}>
        {CONSENT_POINTS.map((point) => (
          <li key={point} style={{ marginBottom: 6 }}>
            {point}
          </li>
        ))}
      </ul>
      <p style={{ fontSize: 13, color: C.mid, lineHeight: 1.6, marginTop: 12 }}>
        Your data is handled under our{' '}
        <Link href="/privacy" style={{ color: C.pink }}>
          Privacy Policy
        </Link>{' '}
        and{' '}
        <Link href="/terms" style={{ color: C.pink }}>
          Terms
        </Link>
        . You can stop messages at any time by replying STOP in the chat, or disconnect this
        number in Settings.
      </p>

      {confirm.error && (
        <p style={{ fontSize: 13, color: C.pink, marginTop: 16 }}>{messageFor(confirm.error)}</p>
      )}
      <div style={{ marginTop: 24 }}>
        <GradBtn onClick={() => confirm.mutate()} disabled={confirm.isPending}>
          {confirm.isPending ? 'Connecting…' : 'Connect WhatsApp'}
        </GradBtn>
      </div>
    </Shell>
  );
}

export default function ConnectWhatsappPage() {
  return (
    <Suspense fallback={null}>
      <ConnectWhatsappInner />
    </Suspense>
  );
}
```

Before running: confirm `C.mint`, `C.amber`, `C.pink`, `C.mid`, `C.bg`, `C.text` exist in `src/components/tokens.ts` (the settings page uses all of them). If `Link` with a root-relative `href` does not account for `NEXT_PUBLIC_BASE_PATH` in this app, follow how `src/components/legal-page.tsx` or the sidebar links to `/privacy`.

- [ ] **Step 3: Typecheck and lint**

Run: `pnpm --filter @aivastra/web typecheck && pnpm --filter @aivastra/web lint`
Expected: exit 0.

- [ ] **Step 4: Manual check**

With the api running locally with `MESSAGING_WHATSAPP_ENABLED=true` and `WHATSAPP_DISPLAY_NUMBER=15556585373`, mint a token from a Node REPL in `apps/api`:
`npx tsx -e "import('./src/modules/messaging/identity.ts').then(async m => { const { Redis } = await import('ioredis'); const r = new Redis(process.env.REDIS_URL); console.log(await m.createChatConnectToken(r, '+919109516207')); r.disconnect(); })"`
(load `REDIS_URL` from your local `.env`). Open `http://localhost:3000/connect/whatsapp?t=<token>`:
1. Logged out → redirected to login, then back to the page.
2. The masked number and the match line show; the four consent points and the two links render.
3. Connect → "WhatsApp connected". Reload → "Can't connect this number" with the expired message.

- [ ] **Step 5: Commit**

```bash
git add apps/catalogues-web/src/app/connect/whatsapp
git commit -m "feat(web): WhatsApp connect confirmation page with approved consent wording"
```

---

### Task 5: Settings panel and studio status chip

**Files:**
- Create: `apps/catalogues-web/src/hooks/use-whatsapp-status.ts`
- Create: `apps/catalogues-web/src/app/(app)/settings/whatsapp-panel.tsx`
- Modify: `apps/catalogues-web/src/app/(app)/settings/page.tsx` (render the panel above the Google Drive block, around line 885)
- Create: `apps/catalogues-web/src/components/whatsapp-status-chip.tsx`
- Modify: `apps/catalogues-web/src/app/(app)/studio/page.tsx` (the `<TopBar title="Studio" …/>` at about line 2266)

**Interfaces:**
- Consumes: `GET /v1/messaging/accounts`, `POST /v1/messaging/connect/web-code`, `DELETE /v1/messaging/accounts/:id` (Task 3).
- Produces: `useWhatsappStatus()` (query key `['whatsapp-status']`).

- [ ] **Step 1: Write the status hook**

`apps/catalogues-web/src/hooks/use-whatsapp-status.ts`:

```ts
import type { MessagingAccountsResponse } from '@aivastra/types';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

// Shared by Settings and the studio chip. `enabled: false` from the api means the
// bot is switched off for this environment — callers render nothing.
export function useWhatsappStatus() {
  return useQuery({
    queryKey: ['whatsapp-status'],
    queryFn: () => api.get<MessagingAccountsResponse>('/v1/messaging/accounts'),
    staleTime: 60_000,
  });
}
```

- [ ] **Step 2: Write the Settings panel**

`apps/catalogues-web/src/app/(app)/settings/whatsapp-panel.tsx`:

```tsx
'use client';

import type { MessagingAccount, WebConnectCodeResponse } from '@aivastra/types';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { C, grad } from '@/components/tokens';
import { api } from '@/lib/api';

type Toast = { message: string; type: 'success' | 'error' };

function formatNumber(e164: string): string {
  // '+919109516207' → '+91 91095 16207'; other lengths shown as stored.
  const m = /^\+91(\d{5})(\d{5})$/.exec(e164);
  return m ? `+91 ${m[1]} ${m[2]}` : e164;
}

const buttonBase: React.CSSProperties = {
  padding: '8px 16px',
  borderRadius: 8,
  fontFamily: 'inherit',
  fontWeight: 600,
  fontSize: 13,
};

/**
 * Web-started connect (spec section 7): opens WhatsApp with "CONNECT <code>"
 * prefilled. The code is shown too, for when wa.me cannot prefill (desktop
 * without WhatsApp installed).
 */
export function WhatsappPanel({
  accounts,
  onToast,
}: {
  accounts: MessagingAccount[];
  onToast: (t: Toast) => void;
}) {
  const qc = useQueryClient();
  const [pending, setPending] = useState<WebConnectCodeResponse | null>(null);
  const [busy, setBusy] = useState(false);

  async function startConnect() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await api.post<WebConnectCodeResponse>('/v1/messaging/connect/web-code', {});
      setPending(res);
      window.open(res.waLink, '_blank', 'noopener,noreferrer');
    } catch (e) {
      onToast({ type: 'error', message: (e as Error).message || 'Could not start connecting' });
    } finally {
      setBusy(false);
    }
  }

  async function disconnect(id: string) {
    if (busy) return;
    setBusy(true);
    try {
      await api.del(`/v1/messaging/accounts/${id}`);
      await qc.invalidateQueries({ queryKey: ['whatsapp-status'] });
      onToast({ type: 'success', message: 'WhatsApp number disconnected' });
    } catch (e) {
      onToast({ type: 'error', message: (e as Error).message || 'Failed to disconnect' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ fontSize: 13, color: C.mid, margin: 0 }}>
        Create catalog images from WhatsApp. Images and credits are shared with this account.
      </p>

      {accounts.map((a) => (
        <div
          key={a.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ fontSize: 14, color: C.text, fontWeight: 600 }}>
            {formatNumber(a.externalId)}{' '}
            <span style={{ fontSize: 12, fontWeight: 500, color: a.optedOut ? C.amber : C.mint }}>
              {a.optedOut ? 'Messages stopped (reply START to resume)' : 'Connected'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => void disconnect(a.id)}
            disabled={busy}
            style={{
              ...buttonBase,
              border: `1px solid ${C.border2}`,
              background: C.white,
              color: C.pink,
              cursor: busy ? 'not-allowed' : 'pointer',
              opacity: busy ? 0.6 : 1,
            }}
          >
            Disconnect
          </button>
        </div>
      ))}

      <div>
        <button
          type="button"
          onClick={() => void startConnect()}
          disabled={busy}
          style={{
            ...buttonBase,
            border: 'none',
            background: grad,
            color: C.white,
            cursor: busy ? 'not-allowed' : 'pointer',
            opacity: busy ? 0.6 : 1,
          }}
        >
          {accounts.length > 0 ? 'Connect another number' : 'Connect WhatsApp'}
        </button>
      </div>

      {pending && (
        <p style={{ fontSize: 13, color: C.mid, margin: 0, lineHeight: 1.6 }}>
          WhatsApp should open with a message ready to send. If it didn&apos;t, send{' '}
          <strong style={{ color: C.text }}>CONNECT {pending.code}</strong> to +{pending.displayNumber}{' '}
          within {Math.round(pending.expiresInSeconds / 60)} minutes, then{' '}
          <button
            type="button"
            onClick={() => void qc.invalidateQueries({ queryKey: ['whatsapp-status'] })}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              color: C.pink,
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: 13,
            }}
          >
            refresh
          </button>
          .
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Render it in Settings**

In `apps/catalogues-web/src/app/(app)/settings/page.tsx`:

Add imports:

```ts
import { useWhatsappStatus } from '@/hooks/use-whatsapp-status';
import { WhatsappPanel } from './whatsapp-panel';
```

Next to `const driveStatus = useGoogleDriveStatus();` add:

```ts
  const whatsappStatus = useWhatsappStatus();
```

Immediately before the `{/* ── Part 3: Integrations (Google Drive) …` comment, add:

```tsx
            {/* WhatsApp catalog bot — rendered only when the api reports it
                enabled for this environment (MESSAGING_WHATSAPP_ENABLED). */}
            {whatsappStatus.data?.enabled && (
              <Section title="WhatsApp" noBorder={!GOOGLE_DRIVE_ENABLED}>
                <WhatsappPanel accounts={whatsappStatus.data.accounts} onToast={setToast} />
              </Section>
            )}
```

- [ ] **Step 4: Write the studio chip**

`apps/catalogues-web/src/components/whatsapp-status-chip.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { useWhatsappStatus } from '@/hooks/use-whatsapp-status';
import { C } from './tokens';

// D27: the studio shows whether WhatsApp is connected. Both states link to
// Settings, where connect / disconnect live — the chip itself changes nothing.
export function WhatsappStatusChip() {
  const { data } = useWhatsappStatus();
  if (!data?.enabled) return null;
  const connected = data.accounts.some((a) => !a.optedOut);
  return (
    <Link
      href="/settings"
      style={{
        padding: '4px 10px',
        borderRadius: 99,
        fontSize: 12,
        fontWeight: 600,
        textDecoration: 'none',
        border: `1px solid ${connected ? C.mint : C.border}`,
        color: connected ? C.mint : C.mid,
        whiteSpace: 'nowrap',
      }}
    >
      {connected ? 'WhatsApp connected' : 'Connect WhatsApp'}
    </Link>
  );
}
```

- [ ] **Step 5: Place it in the studio header**

In `apps/catalogues-web/src/app/(app)/studio/page.tsx`, add the import:

```ts
import { WhatsappStatusChip } from '@/components/whatsapp-status-chip';
```

and change the studio `TopBar` (about line 2266) to:

```tsx
      <TopBar
        title="Studio"
        subtitle="Create premium AI catalogue shoots from flat lay garments in minutes."
        right={<WhatsappStatusChip />}
      />
```

Check `src/components/topbar.tsx` first: it already accepts `right?: React.ReactNode` (line 19) and renders it (line 148). If another `TopBar` in the studio file already passes `right`, put the chip next to that content instead of replacing it.

- [ ] **Step 6: Typecheck and lint**

Run: `pnpm --filter @aivastra/web typecheck && pnpm --filter @aivastra/web lint`
Expected: exit 0.

- [ ] **Step 7: Manual check**

With the flag **off**: no WhatsApp section in Settings, no chip in the studio.
With the flag **on** and `WHATSAPP_DISPLAY_NUMBER=15556585373`:
1. Studio shows "Connect WhatsApp" → links to Settings.
2. Settings → Connect WhatsApp: a new tab opens `wa.me/15556585373?text=CONNECT%20…`; the code and number appear in the panel.
3. Connect a number through the Task 4 page, refresh Settings: the number shows as "+91 91095 16207 Connected"; the studio chip reads "WhatsApp connected".
4. Disconnect: the row disappears and a success toast shows.

(The `CONNECT` message itself is only redeemed once plan 3's inbound consumer exists.)

- [ ] **Step 8: Commit**

```bash
git add apps/catalogues-web/src/hooks/use-whatsapp-status.ts "apps/catalogues-web/src/app/(app)/settings/whatsapp-panel.tsx" "apps/catalogues-web/src/app/(app)/settings/page.tsx" apps/catalogues-web/src/components/whatsapp-status-chip.tsx "apps/catalogues-web/src/app/(app)/studio/page.tsx"
git commit -m "feat(web): WhatsApp connect panel in Settings and status chip in the studio"
```

---

### Task 6: Record the design change and progress

**Files:**
- Modify: `docs/superpowers/specs/2026-10-12-whatsapp-catalog-bot-design.md` (section 12 and the T4 line in section 18)
- Modify: `docs/progress.md` (new dated entry at the top)

- [ ] **Step 1: Update the spec's data model**

In section 12, replace the `messaging_connect_tokens` block with:

```
Connect tokens and codes are not a table. They live in Redis (plan 1, D32):
  msg:connect:chat:{sha256(token)}  → { channel, externalId }   TTL 30 min, redeemed with GETDEL
  msg:connect:web:{sha256(code)}    → { userId }                TTL 10 min, redeemed with GETDEL
Same pattern as the WordPress connect flow (modules/merchant/wordpress-shared.ts).
```

Change `messaging_accounts.last_inbound_at` in the same block to `timestamptz NULL` and `linked_via` to `('chat_link' | 'web_code')` if not already.

Add to the section 3 table:

```
| D32 | Connect tokens storage | Redis `SET EX` + `GETDEL`, not a Postgres table: atomic single use and expiry, no sweeper, matches the WordPress connect flow. The durable record is the `messaging_accounts` row. Chat tokens live 30 minutes so a seller can register and verify their email first. |
```

Replace T4 in section 18 with:

```
- **T4.** Closed. `/connect/whatsapp` sits outside `(app)` like `/connect/wordpress`; the middleware sends logged-out sellers to login with `next`, and registration carries it across email verification as `pending_next` (same tab only). WhatsApp settings live in Settings → Profile Details; the studio has a status chip (D27).
```

- [ ] **Step 2: Add the progress entry**

At the top of `docs/progress.md` (below the GPU note), add an entry dated the day you finish, recording: what shipped (table, routes, pages), the exact test commands and pass counts you saw in Task 3 Steps 6–7 and Task 5 Step 6, that both env vars must be set per environment (`MESSAGING_WHATSAPP_ENABLED`, `WHATSAPP_DISPLAY_NUMBER`) and are **off** everywhere until plan 3 ships, and that the migration is additive and reaches production only through CI/CD → `db:migrate:prod`.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-10-12-whatsapp-catalog-bot-design.md docs/progress.md
git commit -m "docs: WhatsApp bot plan 1 — Redis connect tokens (D32) and progress"
```

---

## Self-review notes

- **Spec coverage (plan 1's share):** D13 (bot never creates users) — nothing here inserts into `users`. D15 both directions — Task 3 (`web-code`, `chat/preview`, `chat/confirm`) + Task 4 + Task 5. D21 consent — Task 4 copy and `opted_in_at`. D27 studio status — Task 5. D29 profile hint — Task 2 `matchesProfilePhone`, Task 3 preview, Task 4 copy, test asserting `users.phone` is untouched. Section 7 "one number, one account" — unique index + `NUMBER_IN_USE` tests. Section 7 "Disconnect deletes the row" — Task 3 test. Section 14 erasure — cascade test.
- **Left to plan 3, by design:** redeeming `CONNECT <code>` from an inbound message (`parseConnectCommand` + `consumeWebConnectCode` + `connectAccount`), sending the chat-started link (`createChatConnectToken` + `chatConnectUrl`), the "Connected" chat message after confirm, STOP / START setting `opted_out_at`, and `last_inbound_at` updates.
