# Shopify Admin Support Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give merchants a working live-chat support button inside the embedded Shopify admin (`apps/shopify`), backed by the existing `apps/chatbot` + `apps/api` ticket system, with zero changes to that system's schema or auth model.

**Architecture:** A new `apps/api` route (`POST /v1/shopify/support/session`), gated by the existing `requireShopifySession` plugin, lazily provisions one synthetic platform `users` row per store and mints it a normal platform access JWT. The Shopify SPA takes that JWT and drives the chatbot's *existing*, unmodified `/ws-ticket` + WS flow — the same one `apps/catalogues-web/src/components/chat-widget.tsx` already uses. A new `SupportChat` Modal component replaces the external link on the existing `SupportPage.tsx`'s "Live chat" card.

**Tech Stack:** Fastify 5 + Drizzle (apps/api), Vite + React + Polaris 13 (apps/shopify), native WebSocket (no client library, matching chat-widget.tsx).

**Spec:** `docs/superpowers/specs/2026-09-05-shopify-admin-support-chat-design.md`

## Global Constraints

- Text-only for v1 — no attachment upload/display code in the Shopify admin chat.
- Zero changes to `apps/chatbot` (WS auth, ticket schema, sweeper) or to `chatbot_conversations`'/`chatbot_messages`' shape.
- Zero changes to `shopify_stores.owner_user_id`'s meaning or any code that reads it.
- The new `support_user_id` column is nullable, independent of `owner_user_id`, populated lazily.
- Reuse `signAccess` (`apps/api/src/modules/auth/service.ts`) for the minted token — no new signing path.
- Tickets are identified as Shopify-originated via the synthetic support user's `email` (`shopify-support+{shopDomain}@internal.aivastra.com`), not via `source` — the shared WS gateway always creates tickets with `source: 'chat_widget'` regardless of caller, and changing that would mean touching `apps/chatbot`.

---

### Task 1: Add `support_user_id` to `shopify_stores`

**Files:**
- Modify: `packages/db/src/schema/shopify.ts:116`
- Create (generated): a new file under `packages/db/src/migrations/` (name assigned by drizzle-kit — note the actual filename when you commit)

**Interfaces:**
- Produces: `schema.shopifyStores.supportUserId` (nullable `uuid`, FK → `users.id`, `onDelete: 'set null'`) — consumed by Task 2.

- [ ] **Step 1: Add the column to the schema**

In `packages/db/src/schema/shopify.ts`, right after the `ownerUserId` line:

```ts
  ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
  // Owns this store's support tickets in the chatbot ticket system — a
  // platform user created purely to hold that identity, never a real login.
  // Distinct from ownerUserId (the real merchant account, when one exists,
  // used for admin reporting) — do not conflate the two. Lazily provisioned
  // by POST /v1/shopify/support/session on first use.
  supportUserId: uuid('support_user_id').references(() => users.id, { onDelete: 'set null' }),
  installedAt: timestamp('installed_at', { withTimezone: true }).notNull().defaultNow(),
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm db:generate`

This creates a new `packages/db/src/migrations/NNNN_<generated-name>.sql` (drizzle-kit assigns the name) containing a single `ALTER TABLE shopify_stores ADD COLUMN support_user_id uuid REFERENCES users(id) ON DELETE SET NULL;`, plus an updated `meta/_journal.json` and `meta/NNNN_snapshot.json`. Open the generated `.sql` file and confirm it contains exactly that one `ALTER TABLE` — nothing else.

- [ ] **Step 3: Apply it locally**

Run: `pnpm db:migrate`
Expected: migration applies cleanly against your local dev database (`pnpm docker:up` must already be running).

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/schema/shopify.ts packages/db/src/migrations/
git commit -m "feat(db): add shopify_stores.support_user_id for ticket ownership"
```

---

### Task 2: `POST /v1/shopify/support/session` route

**Files:**
- Create: `apps/api/src/modules/shopify/support.routes.ts`
- Modify: `apps/api/src/modules/shopify/routes.ts`
- Test: `apps/api/test/integration/shopify-support-session.test.ts`

**Interfaces:**
- Consumes: `schema.shopifyStores` (Task 1's `supportUserId` column), `schema.users`, `schema.userCredits`, `signAccess(secret, sub, claims, exp, audience?)` from `apps/api/src/modules/auth/service.ts`, `app.requireShopifySession` (decorated in `apps/api/src/plugins/shopify-auth.ts`, attaches `req.shopifyStore: typeof schema.shopifyStores.$inferSelect`).
- Produces: `shopifySupportRoutes(app: FastifyInstance)` — registered in `routes.ts`. Route response shape `{ token: string }`, consumed by Task 4's `useSupportChat` hook.

- [ ] **Step 1: Write the failing integration test**

Create `apps/api/test/integration/shopify-support-session.test.ts`:

```ts
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { jwtVerify } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { upsertShopifyStore } from '../../src/modules/shopify/auth.routes.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';
import { signSessionToken } from '../helpers/shopify-session.js';

const ENC_KEY = Buffer.alloc(32, 12).toString('base64');
const API_SECRET = 'test-secret';
const API_KEY = 'test-key';

describe('POST /v1/shopify/support/session', () => {
  let c: Containers;
  let app: TestApp;
  let auth: { authorization: string };
  let shopDomain: string;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c, {
      SHOPIFY_TOKEN_ENC_KEY: ENC_KEY,
      SHOPIFY_API_SECRET: API_SECRET,
      SHOPIFY_API_KEY: API_KEY,
    });

    const tag = Date.now();
    shopDomain = `support-session-${tag}.myshopify.com`;
    await upsertShopifyStore(
      app,
      {
        shopifyShopId: tag,
        shopDomain,
        myshopifyDomain: shopDomain,
        name: 'Support Session Store',
        email: 'owner@support-session-test.com',
      },
      'tok',
      'read_products',
    );
    auth = { authorization: `Bearer ${signSessionToken(shopDomain, API_SECRET, API_KEY)}` };
  }, 60_000);

  afterAll(async () => {
    await app.stop();
    await c.stop();
  });

  it('creates a support user on first call and mints a valid platform access token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/shopify/support/session',
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    const { token } = res.json() as { token: string };
    expect(typeof token).toBe('string');

    const secret = new TextEncoder().encode(app.env.JWT_SECRET);
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
    expect(payload.kind).toBe('access');
    expect(typeof payload.sub).toBe('string');

    const [store] = await app.db
      .select()
      .from(schema.shopifyStores)
      .where(eq(schema.shopifyStores.shopDomain, shopDomain));
    expect(store.supportUserId).toBe(payload.sub);

    const [user] = await app.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, store.supportUserId as string));
    expect(user.passwordHash).toBeNull();
    expect(user.emailVerified).toBe(true);
    // Shop domain, not the opaque store id — this is the only signal that
    // distinguishes a Shopify ticket in ChatInboxPage's userEmail column.
    expect(user.email).toBe(`shopify-support+${shopDomain}@internal.aivastra.com`);
  });

  it('is idempotent — a second call returns the same support user', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/v1/shopify/support/session',
      headers: auth,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/v1/shopify/support/session',
      headers: auth,
    });
    const secret = new TextEncoder().encode(app.env.JWT_SECRET);
    const firstSub = (await jwtVerify((first.json() as { token: string }).token, secret)).payload
      .sub;
    const secondSub = (await jwtVerify((second.json() as { token: string }).token, secret))
      .payload.sub;
    expect(secondSub).toBe(firstSub);
  });

  it('rejects a request with no session token', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/shopify/support/session' });
    expect(res.statusCode).toBe(401);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run --config vitest.integration.config.ts shopify-support-session` (from `apps/api`)
Expected: FAIL — `404` (route doesn't exist yet) or a module-not-found error, since `support.routes.ts` doesn't exist yet.

- [ ] **Step 3: Write the route**

Create `apps/api/src/modules/shopify/support.routes.ts`:

```ts
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { signAccess } from '../auth/service.js';

type Store = typeof schema.shopifyStores.$inferSelect;

/**
 * Every Shopify store gets exactly one synthetic platform user, created on
 * first use, that exists purely to own that store's support tickets in the
 * chatbot ticket system. Distinct from `owner_user_id` (the real merchant
 * account, when one exists) — this row is never a real login and holds no
 * credits, uploads, or catalog data of its own.
 */
async function getOrCreateSupportUser(app: FastifyInstance, store: Store): Promise<string> {
  if (store.supportUserId) return store.supportUserId;

  return app.db.transaction(async (tx) => {
    // Re-check inside the transaction: a concurrent first-open (two tabs) can
    // race this function. A duplicate synthetic user in that rare case is
    // harmless and cleanup-able — not worth a locking scheme.
    const [existing] = await tx
      .select({ supportUserId: schema.shopifyStores.supportUserId })
      .from(schema.shopifyStores)
      .where(eq(schema.shopifyStores.id, store.id));
    if (existing?.supportUserId) return existing.supportUserId;

    const [user] = await tx
      .insert(schema.users)
      .values({
        // The shop domain, not the store's opaque id, so an agent recognizes
        // the merchant at a glance from ChatInboxPage's existing userEmail
        // column — this is the only signal that distinguishes a
        // Shopify-admin ticket, since the shared WS gateway
        // (apps/chatbot/src/ws/gateway.ts) always creates tickets with
        // source: 'chat_widget' regardless of caller and cannot be told
        // otherwise without changing apps/chatbot.
        email: `shopify-support+${store.shopDomain}@internal.aivastra.com`,
        passwordHash: null,
        displayName: `Shopify support (${store.shopDomain})`,
        companyName: null,
        emailVerified: true,
        tier: 'free',
      })
      .returning();
    await tx.insert(schema.userCredits).values({ userId: user.id, balance: 0 });
    await tx
      .update(schema.shopifyStores)
      .set({ supportUserId: user.id })
      .where(eq(schema.shopifyStores.id, store.id));
    return user.id;
  });
}

export async function shopifySupportRoutes(app: FastifyInstance) {
  app.post('/v1/shopify/support/session', { preHandler: app.requireShopifySession }, async (req) => {
    const store = req.shopifyStore as Store;
    const supportUserId = await getOrCreateSupportUser(app, store);
    const secret = new TextEncoder().encode(app.env.JWT_SECRET);
    const token = await signAccess(secret, supportUserId, { kind: 'access' }, app.env.JWT_EXPIRY);
    return { token };
  });
}
```

- [ ] **Step 4: Register the route**

In `apps/api/src/modules/shopify/routes.ts`, add the import alongside the other `shopify*Routes` imports:

```ts
import { shopifyShoppersRoutes } from './shoppers.routes.js';
import { shopifySupportRoutes } from './support.routes.js';
import { registerWebhooksDecorator, shopifyWebhookRoutes } from './webhook.routes.js';
```

And register it alongside the other `await app.register(shopify...)` calls:

```ts
  await app.register(shopifyShoppersRoutes);
  await app.register(shopifySupportRoutes);
  await app.register(shopifyActivationRoutes);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run --config vitest.integration.config.ts shopify-support-session` (from `apps/api`)
Expected: PASS — all 3 cases.

- [ ] **Step 6: Run the full api test suites to check for regressions**

Run: `pnpm --filter @aivastra/api test` and `pnpm --filter @aivastra/api test:integration`
Expected: all passing, same counts as before plus these 3 new cases.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/shopify/support.routes.ts apps/api/src/modules/shopify/routes.ts apps/api/test/integration/shopify-support-session.test.ts
git commit -m "feat(api): add POST /v1/shopify/support/session for the embedded-admin chat"
```

---

### Task 3: Wire `VITE_CHATBOT_URL` into the `apps/shopify` build

`apps/admin-web`'s Dockerfile/compose build args already pass `VITE_CHATBOT_URL` through (that app's `ChatInboxPage` is the agent side of the same chatbot). `apps/shopify`'s do not yet — Task 4's hook needs `import.meta.env.VITE_CHATBOT_URL` available at build time in every environment, not just local dev (where it's already picked up from the repo-root `.env` via `envDir: '../../'` in `apps/shopify/vite.config.ts`).

**Files:**
- Modify: `apps/shopify/Dockerfile`
- Modify: `infra/docker-compose.prod.yml`
- Modify: `infra/docker-compose.staging.yml`

**Interfaces:**
- Produces: `import.meta.env.VITE_CHATBOT_URL` available inside the built `apps/shopify` bundle in every environment — consumed by Task 4.

- [ ] **Step 1: Add the build arg to the Dockerfile**

In `apps/shopify/Dockerfile`, alongside the other `ARG`/`ENV` pairs:

```dockerfile
ARG VITE_SHOPIFY_APP_HANDLE
ENV VITE_SHOPIFY_APP_HANDLE=$VITE_SHOPIFY_APP_HANDLE
ARG VITE_CHATBOT_URL
ENV VITE_CHATBOT_URL=$VITE_CHATBOT_URL
RUN pnpm --filter @aivastra/types build
```

- [ ] **Step 2: Pass it through in production compose**

In `infra/docker-compose.prod.yml`'s `shopify-admin` service:

```yaml
  shopify-admin:
    build:
      context: ..
      dockerfile: apps/shopify/Dockerfile
      args:
        VITE_SHOPIFY_API_KEY: ${VITE_SHOPIFY_API_KEY}
        VITE_AIVASTRA_APP_URL: ${VITE_AIVASTRA_APP_URL:-https://app.aivastra.com}
        VITE_API_BASE_URL: ${VITE_API_BASE_URL:-https://app.aivastra.com}
        VITE_CHATBOT_URL: ${VITE_CHATBOT_URL}
```

- [ ] **Step 3: Pass it through in staging compose**

In `infra/docker-compose.staging.yml`'s `shopify-admin` service, add the same `VITE_CHATBOT_URL: ${VITE_CHATBOT_URL}` line to its `args:` block (staging's `.env.staging.example` already defines `VITE_CHATBOT_URL=https://staging-admin.aivastra.com/chatbot` for this exact app — this step just wires it through).

- [ ] **Step 4: Verify locally**

Run: `pnpm --filter @aivastra/shopify-admin build` (from repo root — confirms the var is at least readable from the root `.env` during a local build; Docker-arg plumbing itself is only exercised by an actual `docker compose build`, which is out of scope to run here).
Expected: build succeeds (this only proves the build doesn't break — it does not prove the Docker args are correctly wired, since that path only runs in CI/deploy).

- [ ] **Step 5: Commit**

```bash
git add apps/shopify/Dockerfile infra/docker-compose.prod.yml infra/docker-compose.staging.yml
git commit -m "chore(shopify): wire VITE_CHATBOT_URL into the embedded-admin build"
```

---

### Task 4: `useSupportChat` hook

**Files:**
- Create: `apps/shopify/src/hooks/useSupportChat.ts`

**Interfaces:**
- Consumes: `apiFetch<T>(path, init)` from `apps/shopify/src/lib/api.ts`, `ChatMessageT` / `ConversationStatusT` / `WsServerFrameT` from `@aivastra/types`.
- Produces: `useSupportChat(active: boolean): UseSupportChatResult` where
  ```ts
  interface UseSupportChatResult {
    status: ConversationStatusT;
    messages: ChatMessageT[];
    typing: 'agent' | 'bot' | null;
    error: string | null;
    connecting: boolean;
    send: (content: string) => void;
    reset: () => void;
  }
  ```
  consumed by Task 5's `SupportChat.tsx`.

- [ ] **Step 1: Write the hook**

Create `apps/shopify/src/hooks/useSupportChat.ts`:

```ts
import type { ChatMessageT, ConversationStatusT, WsServerFrameT } from '@aivastra/types';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../lib/api';

const CHATBOT_URL = import.meta.env.VITE_CHATBOT_URL || 'http://localhost:4200';

interface SupportSessionResponse {
  token: string;
}

export interface UseSupportChatResult {
  status: ConversationStatusT;
  messages: ChatMessageT[];
  typing: 'agent' | 'bot' | null;
  error: string | null;
  connecting: boolean;
  send: (content: string) => void;
  reset: () => void;
}

/**
 * Drives the same chatbot WS protocol apps/catalogues-web's chat-widget.tsx
 * uses, but authenticated via a per-store synthetic platform user
 * (POST /v1/shopify/support/session) instead of a real logged-in user's
 * token — see docs/superpowers/specs/2026-09-05-shopify-admin-support-chat-design.md.
 */
export function useSupportChat(active: boolean): UseSupportChatResult {
  const [status, setStatus] = useState<ConversationStatusT>('OPEN');
  const [messages, setMessages] = useState<ChatMessageT[]>([]);
  const [typing, setTyping] = useState<'agent' | 'bot' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const tokenRef = useRef<string | null>(null);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      let ticket: string | null = null;
      // Up to 2 attempts: the first uses a cached platform token if we have
      // one; a 401 from /ws-ticket means it expired, so we clear it and mint
      // a fresh one via /v1/shopify/support/session (a cheap no-op after the
      // support user already exists) and try once more.
      for (let attempt = 0; attempt < 2 && !ticket; attempt++) {
        if (!tokenRef.current) {
          const session = await apiFetch<SupportSessionResponse>(
            '/v1/shopify/support/session',
            { method: 'POST' },
          );
          tokenRef.current = session.token;
        }
        const tRes = await fetch(`${CHATBOT_URL}/ws-ticket`, {
          method: 'POST',
          headers: { authorization: `Bearer ${tokenRef.current}` },
        });
        if (tRes.ok) {
          const body = (await tRes.json()) as { ticket: string };
          ticket = body.ticket;
        } else if (tRes.status === 401) {
          tokenRef.current = null;
        } else {
          throw new Error(`ws-ticket failed (${tRes.status})`);
        }
      }
      if (!ticket) throw new Error('ws-ticket failed after retry');

      const ws = new WebSocket(`${CHATBOT_URL.replace(/^http/, 'ws')}/ws?ticket=${ticket}`);
      ws.onmessage = async (ev) => {
        const f = JSON.parse(ev.data) as WsServerFrameT;
        if (f.type === 'ready') {
          setStatus(f.status);
          const h = await fetch(
            `${CHATBOT_URL}/conversations/${f.conversationId}/messages?limit=50`,
            { headers: { authorization: `Bearer ${tokenRef.current}` } },
          );
          if (h.ok) setMessages(((await h.json()) as { messages: ChatMessageT[] }).messages);
        } else if (f.type === 'message') {
          setTyping(null);
          setMessages((m) => [...m, f.message]);
        } else if (f.type === 'state_change') {
          setStatus(f.status);
        } else if (f.type === 'typing' && f.role !== 'user') {
          setTyping(f.role);
          setTimeout(() => setTyping(null), 4000);
        }
      };
      ws.onclose = () => {
        wsRef.current = null;
      };
      wsRef.current = ws;
    } catch {
      setError("Couldn't connect to support. Please try again.");
    } finally {
      setConnecting(false);
    }
  }, []);

  useEffect(() => {
    if (active && !wsRef.current) void connect();
    if (!active && wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, [active, connect]);

  const send = useCallback(
    (content: string) => {
      const trimmed = content.trim();
      if (!trimmed || !wsRef.current || status === 'CLOSED') return;
      wsRef.current.send(JSON.stringify({ type: 'message', content: trimmed }));
    },
    [status],
  );

  const reset = useCallback(() => {
    setStatus('OPEN');
    setMessages([]);
    setError(null);
    wsRef.current?.close();
    wsRef.current = null;
    void connect();
  }, [connect]);

  return { status, messages, typing, error, connecting, send, reset };
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @aivastra/shopify-admin typecheck`
Expected: clean (no test framework exercises this hook directly — matching this repo's existing convention of not unit-testing `chat-widget.tsx`'s equivalent WS logic; Task 5's manual verification step exercises it end-to-end).

- [ ] **Step 3: Commit**

```bash
git add apps/shopify/src/hooks/useSupportChat.ts
git commit -m "feat(shopify): add useSupportChat hook for the embedded-admin chat"
```

---

### Task 5: `SupportChat` component, wired into `SupportPage.tsx`

**Files:**
- Create: `apps/shopify/src/components/SupportChat.tsx`
- Modify: `apps/shopify/src/pages/SupportPage.tsx`

**Interfaces:**
- Consumes: `useSupportChat` (Task 4).
- Produces: `SupportChat({ open, onClose }: { open: boolean; onClose: () => void })`, rendered from `SupportPage.tsx`.

- [ ] **Step 1: Write the component**

Create `apps/shopify/src/components/SupportChat.tsx`:

```tsx
import type { ChatMessageT, ConversationStatusT } from '@aivastra/types';
import { Banner, BlockStack, Button, InlineStack, Modal, Text, TextField } from '@shopify/polaris';
import { useEffect, useRef, useState } from 'react';
import { useSupportChat } from '../hooks/useSupportChat';

const STATUS_COPY: Record<ConversationStatusT, string> = {
  OPEN: 'Waiting for an agent…',
  IN_PROGRESS: 'Live agent',
  RESOLVED: 'Marked resolved — send a message to reopen',
  CLOSED: 'Conversation ended',
  BOT: '',
  PENDING_HUMAN: '',
  HUMAN: '',
};

function MessageRow({ message }: { message: ChatMessageT }) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
      }}
    >
      <div
        style={{
          maxWidth: '80%',
          padding: '8px 12px',
          borderRadius: '12px',
          background: isUser ? '#008060' : isSystem ? 'transparent' : '#f1f1f1',
          color: isUser ? '#fff' : '#202223',
          fontStyle: isSystem ? 'italic' : 'normal',
          textAlign: isSystem ? 'center' : 'left',
          fontSize: '14px',
        }}
      >
        {message.content}
      </div>
    </div>
  );
}

export function SupportChat({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { status, messages, typing, error, connecting, send, reset } = useSupportChat(open);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length]);

  function handleSend() {
    if (!input.trim()) return;
    send(input);
    setInput('');
  }

  return (
    <Modal open={open} title="Aivastra Support" onClose={onClose}>
      <Modal.Section>
        <BlockStack gap="300">
          {error && <Banner tone="critical">{error}</Banner>}
          <Text as="p" tone="subdued">
            {connecting ? 'Connecting…' : STATUS_COPY[status]}
          </Text>
          <div
            ref={scrollRef}
            style={{
              height: '320px',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              padding: '4px',
            }}
          >
            {messages.map((m) => (
              <MessageRow key={m.id} message={m} />
            ))}
            {typing && (
              <Text as="p" tone="subdued">
                {typing === 'bot' ? 'Assistant is typing…' : 'Agent is typing…'}
              </Text>
            )}
          </div>
          {status === 'CLOSED' ? (
            <Button onClick={reset}>Start new chat</Button>
          ) : (
            <InlineStack gap="200" blockAlign="end">
              <div style={{ flex: 1 }}>
                <TextField
                  label="Message"
                  labelHidden
                  autoComplete="off"
                  value={input}
                  onChange={setInput}
                  placeholder="Type a message…"
                />
              </div>
              <Button onClick={handleSend} variant="primary">
                Send
              </Button>
            </InlineStack>
          )}
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
```

- [ ] **Step 2: Wire it into `SupportPage.tsx`**

Replace the full contents of `apps/shopify/src/pages/SupportPage.tsx`:

```tsx
import { Banner, BlockStack, Button, Card, InlineGrid, Page, Text } from '@shopify/polaris';
import { useState } from 'react';
import { SupportChat } from '../components/SupportChat';

export default function SupportPage() {
  const [chatOpen, setChatOpen] = useState(false);

  return (
    <Page title="Support" subtitle="Two ways to reach the team.">
      <BlockStack gap="400">
        <Banner tone="info">
          Live chat is the fastest option during business hours. Email is answered within 24 hours
          the rest of the time.
        </Banner>
        <InlineGrid columns={{ xs: 1, sm: 2 }} gap="400">
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">
                Email support
              </Text>
              <Text as="p" tone="subdued">
                Send us the details and we usually reply within 24 hours.
              </Text>
              <Button url="mailto:support@aivastra.com">Email us</Button>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">
                Live chat
              </Text>
              <Text as="p" tone="subdued">
                Talk to the team in real time during business hours.
              </Text>
              <Button onClick={() => setChatOpen(true)}>Start a chat</Button>
            </BlockStack>
          </Card>
        </InlineGrid>
      </BlockStack>
      <SupportChat open={chatOpen} onClose={() => setChatOpen(false)} />
    </Page>
  );
}
```

- [ ] **Step 3: Typecheck and build**

Run: `pnpm --filter @aivastra/shopify-admin typecheck` and `pnpm --filter @aivastra/shopify-admin build`
Expected: both clean.

- [ ] **Step 4: Manual end-to-end verification**

1. Ensure `pnpm docker:up`, the api (`pnpm --filter @aivastra/api dev`), and chatbot (`pnpm --filter @aivastra/chatbot dev`) are running locally, and that your root `.env` has `VITE_CHATBOT_URL` set (it should already, from the earlier chatbot ticket-system work — confirm with `grep VITE_CHATBOT_URL .env`).
2. Run `pnpm --filter @aivastra/shopify-admin dev` and open the app through your usual local Shopify embedded-admin setup (ngrok tunnel / dev store), navigate to Support.
3. Click "Start a chat", type a message, send it.
4. In `apps/admin-web`'s ChatInboxPage (`pnpm --filter @aivastra/admin dev`), confirm the new ticket appears in the queue with the synthetic `shopify-support+<your-dev-store-domain>@internal.aivastra.com` email.
5. Claim it and reply as an agent; confirm the reply appears back in the Shopify admin's `SupportChat` modal.
6. Close the modal and reopen it; confirm the same conversation and its history reload (status still `IN_PROGRESS`, not a fresh ticket).

Report the actual outcome of each step — do not mark this task done without having run it.

- [ ] **Step 5: Commit**

```bash
git add apps/shopify/src/components/SupportChat.tsx apps/shopify/src/pages/SupportPage.tsx
git commit -m "feat(shopify): add live support chat to the embedded admin's Support page"
```
