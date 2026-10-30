# WhatsApp Conversation Trace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An admin "Conversations" tab on the WhatsApp page that shows, per seller number, what the bot received and sent (with the buttons and list rows) and any send failures, kept in Redis for 4 days.

**Architecture:** A small recorder (`messaging/trace.ts`) writes JSON entries to a capped Redis list per seller plus a sorted-set index. It is called from the two choke points of the WhatsApp path: `processInbound` (inbound) and `sendMessages` (outbound, with sent/failed/skipped status). Two read-only admin routes serve the list and timeline; a React tab renders them as a chat.

**Tech Stack:** Fastify 5, ioredis (`app.redis`), Zod (`@aivastra/types`), Vitest integration harness (docker Redis/Postgres), React + Vite (`apps/admin-web`).

Spec: `docs/superpowers/specs/2026-10-27-whatsapp-conversation-trace-design.md`. Where this plan differs, the plan wins:
- Outbound options are one `options` array (buttons, list rows and cards alike) instead of separate `buttons`/`list` fields — same information, one shape to render.
- An inbound `image` entry carries no garment key (the key only exists after the download, which happens later in `processInbound`).

## Global Constraints

- Trace key is the **wa_id digits** exactly as Meta sends them (`ParsedInbound.from`, and the `to` argument of `sendMessages`). Never the E.164 `+` form — the two hooks must agree. The UI displays `+{digits}`.
- TTL **4 days** (`4 * 24 * 60 * 60` s), refreshed on every write. List capped at the **last 300** entries.
- Recording is best effort: it must never throw into, delay materially, or change the result of a send or an inbound.
- Admin routes use `requirePermission('jobs.read')` (same as the Requests tab).
- ESM, `.js` import suffixes in `apps/api/src`; no `console.log`; use `app.log`. Admin UI uses CSS vars (`var(--border)`, `var(--muted)`, `var(--surface)`), no raw hex, no raw `<select>`.
- Do not commit unless the user asks (repo CLAUDE.md). The commit steps below are for when they do; otherwise skip them.
- `pnpm --filter @aivastra/api test` does NOT run integration tests; run them from `apps/api` with `npx vitest run --config vitest.integration.config.ts <pattern>` (needs `pnpm docker:up`).

## File Structure

| File | Responsibility |
|---|---|
| `packages/types/src/whatsapp-trace.ts` (new) | Zod schemas + types for `TraceEntry`, list/timeline responses |
| `packages/types/src/index.ts` (modify) | export the new module |
| `apps/api/src/modules/messaging/trace.ts` (new) | key names, TTL/cap, `traceInbound`, `traceOutbound`, `listSenders`, `readTimeline` |
| `apps/api/src/modules/messaging/send.ts` (modify) | record each outbound message with its status |
| `apps/api/src/modules/messaging/inbound.ts` (modify) | record each inbound event |
| `apps/api/src/modules/admin/whatsapp-conversations.routes.ts` (new) | the two admin GET routes |
| `apps/api/src/server.ts` (modify) | register the routes |
| `apps/admin-web/src/pages/whatsapp/ConversationsTab.tsx` (new) | sender list + chat thread UI |
| `apps/admin-web/src/pages/WhatsAppPage.tsx` (modify) | add the tab |
| `apps/api/test/integration/whatsapp-trace.test.ts` (new) | recorder, send hook, inbound hook |
| `apps/api/test/integration/admin-whatsapp-conversations.test.ts` (new) | routes + permission |

---

### Task 1: Types and the recorder

**Files:**
- Create: `packages/types/src/whatsapp-trace.ts`
- Modify: `packages/types/src/index.ts` (add one export line next to `whatsapp-baskets.js`)
- Create: `apps/api/src/modules/messaging/trace.ts`
- Test: `apps/api/test/integration/whatsapp-trace.test.ts`

**Interfaces:**
- Produces (types package):
  - `TraceEntry` — union on `dir`: `{ dir:'in'; t:number; kind:'text'|'reply'|'image'|'unsupported'; text?:string; action?:string; value?:string }` | `{ dir:'out'; t:number; kind:'text'|'buttons'|'list'|'cards'|'link'; text:string; buttonLabel?:string; options?:{id:string;title:string;description?:string}[]; url?:string; status:'sent'|'failed'|'skipped'; error?:string }`
  - `TraceSender` — `{ waId:string; lastAt:number; count:number; preview:string }`
- Produces (`trace.ts`):
  - `TRACE_TTL_SECONDS: number`, `TRACE_MAX_ENTRIES: number`
  - `traceInbound(app: FastifyInstance, waId: string, content: InboundContent): Promise<void>`
  - `traceOutbound(app: FastifyInstance, waId: string, message: OutboundMessage, status: 'sent'|'failed'|'skipped', error?: string): Promise<void>`
  - `listSenders(app: FastifyInstance): Promise<TraceSender[]>` — most recent first
  - `readTimeline(app: FastifyInstance, waId: string): Promise<TraceEntry[]>` — oldest first

- [ ] **Step 1: Write the types**

`packages/types/src/whatsapp-trace.ts`:

```ts
import { z } from 'zod';

// WhatsApp conversation trace (admin debug view): what the bot received and sent,
// per seller number, kept in Redis for a few days. See
// apps/api/src/modules/messaging/trace.ts.

export const TraceOption = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
});
export type TraceOption = z.infer<typeof TraceOption>;

const TraceIn = z.object({
  dir: z.literal('in'),
  t: z.number(),
  kind: z.enum(['text', 'reply', 'image', 'unsupported']),
  text: z.string().optional(),
  // A tap, decoded from the reply id (the prompt nonce is not kept).
  action: z.string().optional(),
  value: z.string().optional(),
});

const TraceOut = z.object({
  dir: z.literal('out'),
  t: z.number(),
  kind: z.enum(['text', 'buttons', 'list', 'cards', 'link']),
  text: z.string(),
  buttonLabel: z.string().optional(),
  // Buttons, list rows or cards, whichever the message carried.
  options: z.array(TraceOption).optional(),
  url: z.string().optional(),
  status: z.enum(['sent', 'failed', 'skipped']),
  error: z.string().optional(),
});

export const TraceEntry = z.discriminatedUnion('dir', [TraceIn, TraceOut]);
export type TraceEntry = z.infer<typeof TraceEntry>;

export const TraceSender = z.object({
  // wa_id digits, as Meta sends them (no '+').
  waId: z.string(),
  lastAt: z.number(),
  count: z.number().int(),
  preview: z.string(),
});
export type TraceSender = z.infer<typeof TraceSender>;

export const TraceSendersResponse = z.object({ items: z.array(TraceSender) });
export const TraceTimelineResponse = z.object({ entries: z.array(TraceEntry) });
```

In `packages/types/src/index.ts`, add after the `whatsapp-baskets.js` line:

```ts
export * from './whatsapp-trace.js';
```

- [ ] **Step 2: Write the failing recorder test**

`apps/api/test/integration/whatsapp-trace.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  TRACE_MAX_ENTRIES,
  TRACE_TTL_SECONDS,
  listSenders,
  readTimeline,
  traceInbound,
  traceOutbound,
} from '../../src/modules/messaging/trace';
import { encodeReplyId } from '../../src/modules/messaging/engine/reply-id';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

let seq = 0;
const waId = () => `9188${Date.now().toString().slice(-6)}${(++seq).toString().padStart(2, '0')}`;

describe('whatsapp trace recorder', () => {
  let c: Containers;
  let app: TestApp;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c, { MESSAGING_WHATSAPP_ENABLED: true });
  }, 60_000);
  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  it('keeps entries in order, decodes taps, and keeps list options', async () => {
    const id = waId();
    await traceInbound(app, id, { kind: 'text', text: 'hello' });
    await traceOutbound(
      app,
      id,
      {
        kind: 'list',
        text: 'Which garment is it?',
        buttonLabel: 'Choose',
        rows: [
          { id: 'n1|basket|b:tops', title: 'Tops' },
          { id: 'n1|basket|b:lowers', title: 'Lowers', description: 'pants' },
        ],
      },
      'sent',
    );
    await traceInbound(app, id, { kind: 'reply', id: encodeReplyId('n1', 'basket', 'b:tops') });

    const t = await readTimeline(app, id);
    expect(t.map((e) => e.dir)).toEqual(['in', 'out', 'in']);
    expect(t[0]).toMatchObject({ kind: 'text', text: 'hello' });
    expect(t[1]).toMatchObject({
      kind: 'list',
      status: 'sent',
      buttonLabel: 'Choose',
      options: [
        { id: 'n1|basket|b:tops', title: 'Tops' },
        { id: 'n1|basket|b:lowers', title: 'Lowers', description: 'pants' },
      ],
    });
    expect(t[2]).toMatchObject({ kind: 'reply', action: 'basket', value: 'b:tops' });
  });

  it('records failed and skipped sends with the error', async () => {
    const id = waId();
    await traceOutbound(app, id, { kind: 'text', text: 'x' }, 'failed', 'Meta 131000: boom');
    await traceOutbound(app, id, { kind: 'text', text: 'y' }, 'skipped');
    const t = await readTimeline(app, id);
    expect(t[0]).toMatchObject({ status: 'failed', error: 'Meta 131000: boom' });
    expect(t[1]).toMatchObject({ status: 'skipped' });
  });

  it('caps the list and sets a 4-day TTL', async () => {
    const id = waId();
    for (let i = 0; i < TRACE_MAX_ENTRIES + 5; i++) {
      await traceInbound(app, id, { kind: 'text', text: `m${i}` });
    }
    const t = await readTimeline(app, id);
    expect(t).toHaveLength(TRACE_MAX_ENTRIES);
    expect(t[0]).toMatchObject({ text: 'm5' });
    const ttl = await app.redis.ttl(`wa:trace:${id}`);
    expect(ttl).toBeGreaterThan(TRACE_TTL_SECONDS - 60);
    expect(ttl).toBeLessThanOrEqual(TRACE_TTL_SECONDS);
  });

  it('lists senders most recent first with count and preview', async () => {
    const a = waId();
    const b = waId();
    await traceInbound(app, a, { kind: 'text', text: 'first sender' });
    await new Promise((r) => setTimeout(r, 5));
    await traceOutbound(app, b, { kind: 'text', text: 'second sender last msg' }, 'sent');
    const senders = await listSenders(app);
    const ia = senders.findIndex((s) => s.waId === a);
    const ib = senders.findIndex((s) => s.waId === b);
    expect(ib).toBeGreaterThanOrEqual(0);
    expect(ib).toBeLessThan(ia);
    expect(senders[ib]).toMatchObject({ count: 1, preview: 'second sender last msg' });
  });

  it('drops senders whose last activity is older than the TTL', async () => {
    const id = waId();
    await traceInbound(app, id, { kind: 'text', text: 'old' });
    await app.redis.zadd('wa:trace:index', Date.now() - (TRACE_TTL_SECONDS + 10) * 1000, id);
    const senders = await listSenders(app);
    expect(senders.find((s) => s.waId === id)).toBeUndefined();
  });

  it('never throws when Redis fails', async () => {
    const id = waId();
    const real = app.redis.multi.bind(app.redis);
    app.redis.multi = (() => {
      throw new Error('redis down');
    }) as typeof app.redis.multi;
    try {
      await expect(traceInbound(app, id, { kind: 'text', text: 'x' })).resolves.toBeUndefined();
      await expect(
        traceOutbound(app, id, { kind: 'text', text: 'x' }, 'sent'),
      ).resolves.toBeUndefined();
    } finally {
      app.redis.multi = real;
    }
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run (from `apps/api`): `npx vitest run --config vitest.integration.config.ts whatsapp-trace`
Expected: FAIL — cannot resolve `../../src/modules/messaging/trace`.

- [ ] **Step 4: Write the recorder**

`apps/api/src/modules/messaging/trace.ts`:

```ts
import type { TraceEntry, TraceSender } from '@aivastra/types';
import type { FastifyInstance } from 'fastify';
import type { InboundContent } from './channels/whatsapp/parse.js';
import { decodeReplyId } from './engine/reply-id.js';
import type { OutboundMessage } from './engine/types.js';

// Admin debug view of the WhatsApp conversation (admin Conversations tab): what
// the bot received and sent, per seller, for a few days. Keyed by wa_id digits
// as Meta sends them, so inbound (ParsedInbound.from) and outbound (the `to` of
// sendMessages) land in the same list. Best effort throughout: a Redis problem
// is logged and never reaches the conversation.

export const TRACE_TTL_SECONDS = 4 * 24 * 60 * 60;
export const TRACE_MAX_ENTRIES = 300;
const INDEX_KEY = 'wa:trace:index';
const ERROR_MAX = 200;

const listKey = (waId: string) => `wa:trace:${waId}`;

async function push(app: FastifyInstance, waId: string, entry: TraceEntry): Promise<void> {
  try {
    const key = listKey(waId);
    await app.redis
      .multi()
      .rpush(key, JSON.stringify(entry))
      .ltrim(key, -TRACE_MAX_ENTRIES, -1)
      .expire(key, TRACE_TTL_SECONDS)
      .zadd(INDEX_KEY, entry.t, waId)
      .expire(INDEX_KEY, TRACE_TTL_SECONDS)
      .exec();
  } catch (err) {
    app.log.warn({ err }, 'whatsapp trace write failed');
  }
}

export async function traceInbound(
  app: FastifyInstance,
  waId: string,
  content: InboundContent,
): Promise<void> {
  const t = Date.now();
  switch (content.kind) {
    case 'text':
      return push(app, waId, { dir: 'in', t, kind: 'text', text: content.text });
    case 'reply': {
      const d = decodeReplyId(content.id);
      return push(app, waId, {
        dir: 'in',
        t,
        kind: 'reply',
        action: d?.action ?? 'unknown',
        value: d?.value ?? content.id,
      });
    }
    case 'templateButton':
      return push(app, waId, {
        dir: 'in',
        t,
        kind: 'reply',
        action: 'template',
        value: content.payload,
      });
    case 'image':
      return push(app, waId, { dir: 'in', t, kind: 'image' });
    default:
      return push(app, waId, { dir: 'in', t, kind: 'unsupported' });
  }
}

export async function traceOutbound(
  app: FastifyInstance,
  waId: string,
  message: OutboundMessage,
  status: 'sent' | 'failed' | 'skipped',
  error?: string,
): Promise<void> {
  const base = {
    dir: 'out' as const,
    t: Date.now(),
    status,
    ...(error ? { error: error.slice(0, ERROR_MAX) } : {}),
  };
  switch (message.kind) {
    case 'text':
      return push(app, waId, { ...base, kind: 'text', text: message.text });
    case 'buttons':
      return push(app, waId, {
        ...base,
        kind: 'buttons',
        text: message.text,
        options: message.buttons.map((b) => ({ id: b.id, title: b.title })),
      });
    case 'list':
      return push(app, waId, {
        ...base,
        kind: 'list',
        text: message.text,
        buttonLabel: message.buttonLabel,
        options: message.rows,
      });
    case 'cards':
      return push(app, waId, {
        ...base,
        kind: 'cards',
        text: message.text,
        options: message.cards.map((c) => ({ id: c.id, title: 'card' })),
      });
    case 'link':
      return push(app, waId, {
        ...base,
        kind: 'link',
        text: message.text,
        buttonLabel: message.label,
        url: message.url,
      });
  }
}

const previewOf = (e: TraceEntry | undefined): string => {
  if (!e) return '';
  if (e.dir === 'out') return e.text;
  if (e.kind === 'text') return e.text ?? '';
  if (e.kind === 'reply') return `tapped ${e.action}${e.value ? `: ${e.value}` : ''}`;
  return e.kind === 'image' ? '[photo]' : '[unsupported]';
};

/** Senders with a live trace, most recent activity first. */
export async function listSenders(app: FastifyInstance): Promise<TraceSender[]> {
  const cutoff = Date.now() - TRACE_TTL_SECONDS * 1000;
  await app.redis.zremrangebyscore(INDEX_KEY, '-inf', cutoff);
  const ranked = await app.redis.zrevrange(INDEX_KEY, 0, -1, 'WITHSCORES');
  const out: TraceSender[] = [];
  for (let i = 0; i < ranked.length; i += 2) {
    const waId = ranked[i];
    const lastRaw = await app.redis.lindex(listKey(waId), -1);
    if (!lastRaw) continue; // the list expired before the index entry
    out.push({
      waId,
      lastAt: Number(ranked[i + 1]),
      count: await app.redis.llen(listKey(waId)),
      preview: previewOf(JSON.parse(lastRaw) as TraceEntry).slice(0, 120),
    });
  }
  return out;
}

/** One sender's entries, oldest first. */
export async function readTimeline(app: FastifyInstance, waId: string): Promise<TraceEntry[]> {
  const raw = await app.redis.lrange(listKey(waId), 0, -1);
  return raw.map((r) => JSON.parse(r) as TraceEntry);
}
```

- [ ] **Step 5: Run it to verify it passes**

Run (from `apps/api`): `npx vitest run --config vitest.integration.config.ts whatsapp-trace`
Expected: PASS, 6 tests. Then `npx tsc --noEmit -p .` (from `apps/api`) — no errors.

- [ ] **Step 6: Commit (only if the user asked)**

```bash
git add packages/types/src/whatsapp-trace.ts packages/types/src/index.ts apps/api/src/modules/messaging/trace.ts apps/api/test/integration/whatsapp-trace.test.ts
git commit -m "feat(whatsapp): conversation trace recorder"
```

---

### Task 2: Record outbound sends

**Files:**
- Modify: `apps/api/src/modules/messaging/send.ts` (the `sendMessages` function, lines 24-43)
- Test: `apps/api/test/integration/whatsapp-trace.test.ts` (append a `describe`)

**Interfaces:**
- Consumes: `traceOutbound(app, waId, message, status, error?)` from Task 1.
- Produces: `sendMessages` now records every message; its signature and its throw/return behaviour are unchanged.

- [ ] **Step 1: Write the failing test**

Check `apps/api/test/helpers/fake-whatsapp.ts` for the `fakeWhatsapp()` shape (`client`, `sent`, `texts()`). Append to `whatsapp-trace.test.ts` (add imports `sendMessages` from `../../src/modules/messaging/send`, `META_ERROR_OUTSIDE_WINDOW`, `MetaApiError` from `../../src/modules/messaging/channels/whatsapp/client`, and `fakeWhatsapp` from `../helpers/fake-whatsapp`; read `MetaApiError`'s constructor in `client.ts` and use it as defined there):

```ts
describe('sendMessages trace', () => {
  let c: Containers;
  let app: TestApp;
  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c, { MESSAGING_WHATSAPP_ENABLED: true });
  }, 60_000);
  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  it('records each message as sent', async () => {
    const id = waId();
    const wa = fakeWhatsapp();
    await sendMessages(app, wa.client, id, [
      { kind: 'text', text: 'one' },
      { kind: 'buttons', text: 'two', buttons: [{ id: 'n|a|', title: 'A' }] },
    ]);
    const t = await readTimeline(app, id);
    expect(t.map((e) => (e.dir === 'out' ? e.status : null))).toEqual(['sent', 'sent']);
    expect(t[1]).toMatchObject({ kind: 'buttons', options: [{ id: 'n|a|', title: 'A' }] });
  });

  it('records a failure and still throws', async () => {
    const id = waId();
    const wa = fakeWhatsapp();
    wa.client.send = async () => {
      throw new Error('network down');
    };
    await expect(
      sendMessages(app, wa.client, id, [{ kind: 'text', text: 'one' }]),
    ).rejects.toThrow('network down');
    const t = await readTimeline(app, id);
    expect(t[0]).toMatchObject({ status: 'failed', error: 'network down' });
  });

  it('records the rest as skipped outside the 24h window and does not throw', async () => {
    const id = waId();
    const wa = fakeWhatsapp();
    wa.client.send = async () => {
      throw new MetaApiError(META_ERROR_OUTSIDE_WINDOW, 'outside window');
    };
    await sendMessages(app, wa.client, id, [
      { kind: 'text', text: 'one' },
      { kind: 'text', text: 'two' },
    ]);
    const t = await readTimeline(app, id);
    expect(t.map((e) => (e.dir === 'out' ? e.status : null))).toEqual(['skipped', 'skipped']);
  });
});
```

If `MetaApiError`'s constructor differs from `(code, message)`, adapt the test to the real signature (read `channels/whatsapp/client.ts`).

- [ ] **Step 2: Run to verify it fails**

Run (from `apps/api`): `npx vitest run --config vitest.integration.config.ts whatsapp-trace`
Expected: the three new tests FAIL (timeline empty / undefined entries).

- [ ] **Step 3: Implement**

Replace the body of `sendMessages` in `send.ts` (add `import { traceOutbound } from './trace.js';`):

```ts
export async function sendMessages(
  app: FastifyInstance,
  wa: WhatsappClient,
  to: string,
  messages: OutboundMessage[],
): Promise<void> {
  for (const [i, m] of messages.entries()) {
    try {
      for (const payload of renderMessage(m)) await wa.send(to, payload);
    } catch (err) {
      if (err instanceof MetaApiError && err.code === META_ERROR_OUTSIDE_WINDOW) {
        app.log.warn({ code: err.code }, 'whatsapp send outside the 24h window — skipped');
        for (const rest of messages.slice(i)) await traceOutbound(app, to, rest, 'skipped');
        return;
      }
      await traceOutbound(app, to, m, 'failed', err instanceof Error ? err.message : String(err));
      throw err;
    }
    await traceOutbound(app, to, m, 'sent');
  }
}
```

Keep the existing doc comment above the function.

- [ ] **Step 4: Run to verify it passes**

Run (from `apps/api`): `npx vitest run --config vitest.integration.config.ts whatsapp-trace whatsapp-delivery whatsapp-inbound`
Expected: PASS (the existing delivery and inbound suites still pass — behaviour unchanged).

- [ ] **Step 5: Commit (only if the user asked)**

```bash
git add apps/api/src/modules/messaging/send.ts apps/api/test/integration/whatsapp-trace.test.ts
git commit -m "feat(whatsapp): trace every outbound message with its send status"
```

---

### Task 3: Record inbound events

**Files:**
- Modify: `apps/api/src/modules/messaging/inbound.ts` (top of `processInbound`, line ~145)
- Test: `apps/api/test/integration/whatsapp-inbound.test.ts` (add a test in the existing `describe`)

**Interfaces:**
- Consumes: `traceInbound(app, waId, content)` from Task 1.
- Produces: every `processInbound` call records its inbound event first, including unknown numbers and rate-limited senders.

- [ ] **Step 1: Write the failing test**

Add to `whatsapp-inbound.test.ts` (import `readTimeline` from `../../src/modules/messaging/trace`):

```ts
  it('records the inbound event and the replies in the conversation trace', async () => {
    const wa = fakeWhatsapp();
    const from = waId();
    await processInbound(
      app,
      wa.client,
      msg(from, { kind: 'text', text: 'hello there' }),
      noPending,
    );
    const t = await readTimeline(app, from);
    expect(t[0]).toMatchObject({ dir: 'in', kind: 'text', text: 'hello there' });
    // An unknown number is sent the connect link; that reply is traced too.
    expect(t.some((e) => e.dir === 'out' && e.status === 'sent')).toBe(true);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run (from `apps/api`): `npx vitest run --config vitest.integration.config.ts whatsapp-inbound`
Expected: the new test FAILs (`t[0]` is the outbound entry, not the inbound).

- [ ] **Step 3: Implement**

In `inbound.ts` add `import { traceInbound } from './trace.js';` and make the first statement of `processInbound`:

```ts
  await traceInbound(app, m.from, m.content);
```

(before `const externalId = toE164FromWaId(m.from);`, so a rate-limited or invalid-number message is still recorded).

- [ ] **Step 4: Run to verify it passes**

Run (from `apps/api`): `npx vitest run --config vitest.integration.config.ts whatsapp-inbound whatsapp-trace`
Expected: PASS. Then `npx tsc --noEmit -p .` — clean.

- [ ] **Step 5: Commit (only if the user asked)**

```bash
git add apps/api/src/modules/messaging/inbound.ts apps/api/test/integration/whatsapp-inbound.test.ts
git commit -m "feat(whatsapp): trace every inbound event"
```

---

### Task 4: Admin routes

**Files:**
- Create: `apps/api/src/modules/admin/whatsapp-conversations.routes.ts`
- Modify: `apps/api/src/server.ts` (import near line 43; register near line 466)
- Test: `apps/api/test/integration/admin-whatsapp-conversations.test.ts`

**Interfaces:**
- Consumes: `listSenders`, `readTimeline` (Task 1); `TraceSendersResponse`, `TraceTimelineResponse` (types).
- Produces:
  - `GET /admin/whatsapp/conversations` → `{ items: TraceSender[] }`
  - `GET /admin/whatsapp/conversations/:waId` → `{ entries: TraceEntry[] }`; `:waId` must match `^\d{6,16}$` (400 otherwise)

- [ ] **Step 1: Write the failing test**

`apps/api/test/integration/admin-whatsapp-conversations.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { traceInbound, traceOutbound } from '../../src/modules/messaging/trace';
import { adminAuthHeader } from '../helpers/admin';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

describe('admin whatsapp conversations', () => {
  let c: Containers;
  let app: TestApp;
  let headers: Record<string, string>;
  const wa = `9177${Date.now().toString().slice(-8)}`;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
    headers = await adminAuthHeader(app, 'SUPER_ADMIN');
    await traceInbound(app, wa, { kind: 'text', text: 'hi' });
    await traceOutbound(
      app,
      wa,
      { kind: 'buttons', text: 'Menu?', buttons: [{ id: 'n|menu|', title: 'Menu' }] },
      'sent',
    );
  }, 60_000);
  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  it('lists senders', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/whatsapp/conversations', headers });
    expect(res.statusCode).toBe(200);
    const item = res.json().items.find((s: { waId: string }) => s.waId === wa);
    expect(item).toMatchObject({ count: 2, preview: 'Menu?' });
  });

  it('returns one timeline, oldest first', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/admin/whatsapp/conversations/${wa}`,
      headers,
    });
    expect(res.statusCode).toBe(200);
    const { entries } = res.json();
    expect(entries.map((e: { dir: string }) => e.dir)).toEqual(['in', 'out']);
    expect(entries[1].options).toEqual([{ id: 'n|menu|', title: 'Menu' }]);
  });

  it('rejects a malformed number', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/whatsapp/conversations/not-a-number',
      headers,
    });
    expect(res.statusCode).toBe(400);
  });

  it('requires an admin', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/whatsapp/conversations' });
    expect([401, 403]).toContain(res.statusCode);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run (from `apps/api`): `npx vitest run --config vitest.integration.config.ts admin-whatsapp-conversations`
Expected: FAIL — 404 on the routes.

- [ ] **Step 3: Implement**

`apps/api/src/modules/admin/whatsapp-conversations.routes.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { listSenders, readTimeline } from '../messaging/trace.js';
import { requirePermission } from './guard.js';

// WhatsApp → Conversations tab: a read-only view of the Redis conversation trace
// (messaging/trace.ts). Same permission as the Requests tab — it is inspection of
// the bot's traffic, not a billing action. Full numbers are returned on purpose:
// admins look up a specific seller, and the data expires after 4 days.

const Params = z.object({ waId: z.string().regex(/^\d{6,16}$/) });

export async function adminWhatsappConversationsRoutes(app: FastifyInstance) {
  const R = requirePermission('jobs.read');

  app.get('/admin/whatsapp/conversations', { preHandler: R }, async () => ({
    items: await listSenders(app),
  }));

  app.get(
    '/admin/whatsapp/conversations/:waId',
    { preHandler: R, schema: { params: Params } },
    async (req) => {
      const { waId } = req.params as z.infer<typeof Params>;
      return { entries: await readTimeline(app, waId) };
    },
  );
}
```

In `server.ts`, next to the `adminGarmentRecognitionsRoutes` import add:

```ts
import { adminWhatsappConversationsRoutes } from './modules/admin/whatsapp-conversations.routes.js';
```

and next to `await app.register(adminGarmentRecognitionsRoutes);` add:

```ts
  await app.register(adminWhatsappConversationsRoutes);
```

- [ ] **Step 4: Run to verify it passes**

Run (from `apps/api`): `npx vitest run --config vitest.integration.config.ts admin-whatsapp-conversations`
Expected: PASS, 4 tests. Then `npx tsc --noEmit -p .` — clean.

- [ ] **Step 5: Commit (only if the user asked)**

```bash
git add apps/api/src/modules/admin/whatsapp-conversations.routes.ts apps/api/src/server.ts apps/api/test/integration/admin-whatsapp-conversations.test.ts
git commit -m "feat(admin): whatsapp conversation trace routes"
```

---

### Task 5: Admin UI tab

**Files:**
- Create: `apps/admin-web/src/pages/whatsapp/ConversationsTab.tsx`
- Modify: `apps/admin-web/src/pages/WhatsAppPage.tsx` (TABS at line ~41, render block at line ~766, import near line 10)

**Interfaces:**
- Consumes: `GET /admin/whatsapp/conversations`, `GET /admin/whatsapp/conversations/:waId` (Task 4); `TraceEntry`, `TraceSender` types from `@aivastra/types`; `apiFetch`, `apiErrorMessage` from `../../lib/data`; `useUrlState` from `../../hooks/use-url-state`.
- Produces: `ConversationsTab({ toast })` with the same `Props` shape as `BasketsTab`.

- [ ] **Step 1: Write the component**

`apps/admin-web/src/pages/whatsapp/ConversationsTab.tsx`:

```tsx
import type { TraceEntry, TraceSender } from '@aivastra/types';
import { useCallback, useEffect, useState } from 'react';
import { useUrlState } from '../../hooks/use-url-state';
import { apiErrorMessage, apiFetch } from '../../lib/data';

// WhatsApp → Conversations. A debug view of what the bot received and sent per
// seller number (Redis, 4-day retention): inbound texts and taps, outbound
// messages with the buttons / list rows they carried, and send failures.

interface Props {
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
}

const POLL_MS = 5000;

const card = {
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'var(--surface)',
} as const;

const chip = {
  display: 'inline-block',
  padding: '2px 8px',
  margin: '2px 4px 2px 0',
  border: '1px solid var(--border)',
  borderRadius: 999,
  fontSize: 12,
} as const;

const time = (t: number) => new Date(t).toLocaleTimeString();
const ago = (t: number) => {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

function Bubble({ e }: { e: TraceEntry }) {
  const out = e.dir === 'out';
  const failed = out && e.status === 'failed';
  const skipped = out && e.status === 'skipped';
  const body =
    e.dir === 'in'
      ? e.kind === 'text'
        ? (e.text ?? '')
        : e.kind === 'reply'
          ? `Tapped: ${e.action}${e.value ? ` · ${e.value}` : ''}`
          : e.kind === 'image'
            ? '[photo]'
            : '[unsupported message]'
      : e.text;
  return (
    <div style={{ display: 'flex', justifyContent: out ? 'flex-end' : 'flex-start' }}>
      <div
        style={{
          maxWidth: '75%',
          padding: '8px 12px',
          borderRadius: 10,
          border: `1px solid ${failed ? 'var(--danger, #c0392b)' : 'var(--border)'}`,
          background: out ? 'var(--surface-2, var(--surface))' : 'var(--surface)',
          opacity: skipped ? 0.6 : 1,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        <div style={{ fontSize: 13.5 }}>{body}</div>
        {out && e.buttonLabel && (
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
            button: {e.buttonLabel}
            {e.url ? ` → ${e.url}` : ''}
          </div>
        )}
        {out && e.options && e.options.length > 0 && (
          <div style={{ marginTop: 6 }}>
            {e.options.map((o) => (
              <span key={o.id} style={chip} title={o.id}>
                {o.title}
                <span style={{ color: 'var(--muted)', marginLeft: 6, fontSize: 11 }}>{o.id}</span>
              </span>
            ))}
          </div>
        )}
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
          {time(e.t)}
          {out && e.status !== 'sent' && ` · ${e.status}`}
          {failed && e.error ? ` · ${e.error}` : ''}
          {skipped ? ' · outside the 24h window' : ''}
        </div>
      </div>
    </div>
  );
}

export function ConversationsTab({ toast }: Props) {
  const [selected, setSelected] = useUrlState('sender');
  const [senders, setSenders] = useState<TraceSender[] | null>(null);
  const [entries, setEntries] = useState<TraceEntry[] | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await apiFetch<{ items: TraceSender[] }>('/admin/whatsapp/conversations');
      setSenders(list.items);
      if (selected) {
        const t = await apiFetch<{ entries: TraceEntry[] }>(
          `/admin/whatsapp/conversations/${encodeURIComponent(selected)}`,
        );
        setEntries(t.entries);
      } else {
        setEntries(null);
      }
    } catch (err) {
      toast({ kind: 'error', title: apiErrorMessage(err, 'Could not load conversations') });
    }
  }, [selected, toast]);

  useEffect(() => {
    load();
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 16, minHeight: 480 }}>
      <div style={{ ...card, overflowY: 'auto', maxHeight: '70vh' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            padding: '10px 12px',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <strong style={{ fontSize: 13 }}>Senders (last 4 days)</strong>
          <button type="button" onClick={load} style={{ fontSize: 12 }}>
            Refresh
          </button>
        </div>
        {senders === null && <p style={{ padding: 12, color: 'var(--muted)' }}>Loading…</p>}
        {senders?.length === 0 && (
          <p style={{ padding: 12, color: 'var(--muted)' }}>No conversations yet.</p>
        )}
        {senders?.map((s) => (
          <button
            key={s.waId}
            type="button"
            onClick={() => setSelected(s.waId)}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '10px 12px',
              border: 'none',
              borderBottom: '1px solid var(--border)',
              background: selected === s.waId ? 'var(--surface-2, var(--border))' : 'none',
              color: 'inherit',
              cursor: 'pointer',
            }}
          >
            <div style={{ fontWeight: 600, fontSize: 13 }}>+{s.waId}</div>
            <div
              style={{
                fontSize: 12,
                color: 'var(--muted)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {s.preview || '—'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>
              {ago(s.lastAt)} · {s.count} msgs
            </div>
          </button>
        ))}
      </div>

      <div style={{ ...card, padding: 14, overflowY: 'auto', maxHeight: '70vh' }}>
        {!selected && <p style={{ color: 'var(--muted)' }}>Pick a sender to see the conversation.</p>}
        {selected && entries === null && <p style={{ color: 'var(--muted)' }}>Loading…</p>}
        {selected && entries?.length === 0 && (
          <p style={{ color: 'var(--muted)' }}>
            Nothing recorded for +{selected} (it may have expired).
          </p>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {entries?.map((e, i) => (
            <Bubble key={`${e.t}-${i}`} e={e} />
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire the tab**

In `WhatsAppPage.tsx`:
- add `import { ConversationsTab } from './whatsapp/ConversationsTab';` next to the `BasketsTab` import;
- in `TABS`, add `{ id: 'conversations', label: 'Conversations' },` after the `requests` entry;
- in the render block, add `{tab === 'conversations' && <ConversationsTab toast={toast} />}` after the `requests` line;
- change the page `lede` text only if it lists tabs (it currently says "its requests and logs"; add "conversations" there).

- [ ] **Step 3: Verify**

Run (from repo root): `pnpm --filter @aivastra/admin build` (runs `tsc -b`) and `pnpm --filter @aivastra/admin lint`.
Expected: both succeed; fix any biome formatting with `pnpm --filter @aivastra/admin exec biome check --write src/pages/whatsapp/ConversationsTab.tsx src/pages/WhatsAppPage.tsx`.

If `--danger`/`--surface-2` aren't defined CSS vars in `apps/admin-web/src/styles/tokens.css`, replace those two with the tokens that file does define (read it first); do not leave a raw hex fallback.

- [ ] **Step 4: Run it and look at it**

Start the stack (`pnpm docker:up`, then `pnpm --filter @aivastra/api dev` and `pnpm --filter @aivastra/admin dev`), send a message through the bot (or seed one with a node REPL calling `traceInbound`/`traceOutbound`), open Admin → WhatsApp → Conversations. Confirm: sender appears, selecting it shows the thread, list rows show as chips with ids, a failed send is red, the view updates within ~5 s. Report what you saw; if you could not run it, say so.

- [ ] **Step 5: Commit (only if the user asked)**

```bash
git add apps/admin-web/src/pages/whatsapp/ConversationsTab.tsx apps/admin-web/src/pages/WhatsAppPage.tsx
git commit -m "feat(admin): whatsapp conversations tab"
```

---

## Wrap-up

- [ ] Append a dated entry to `docs/progress.md` (Done / Open): the Conversations tab, the Redis keys (`wa:trace:{waId}`, `wa:trace:index`, 4-day TTL, 300 cap), and that it stores seller numbers and message text for 4 days.
- [ ] Run the three touched suites together once more: from `apps/api`, `npx vitest run --config vitest.integration.config.ts whatsapp-trace admin-whatsapp-conversations whatsapp-inbound whatsapp-delivery`, plus `pnpm --filter @aivastra/api test` for unit tests.
