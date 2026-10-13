# WhatsApp bot — Plan 3: WhatsApp adapter, inbound consumer and delivery

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect plans 1 and 2 to WhatsApp: receive Meta's webhook, turn each message into an engine event (connecting unknown numbers, honouring STOP/START, downloading photos), send the engine's messages back as WhatsApp messages, and deliver finished catalog images to the chat — including when the 24-hour window has closed.

**Architecture:** `POST /v1/whatsapp/webhook` verifies `X-Hub-Signature-256`, drops duplicates with `SET NX`, appends each message to the Redis stream `messaging:inbound` and acknowledges at once. A consumer-group loop in the api process (same idiom as `shopify/sync-consumer.ts`) processes one message at a time under a per-sender lock. A delivery loop polls `messaging_runs` every few seconds and sends finished images. Everything Meta-specific is in `modules/messaging/channels/whatsapp/` (client, renderer, parser, signature).

**Tech Stack:** Fastify 5, Redis Streams (ioredis), Drizzle, Node 20 `fetch` / `FormData` / `Blob`, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-12-whatsapp-catalog-bot-design.md` — sections 4, 5, 6, 9, 11, 13, 14, 16; decisions D10, D15, D20, D21, D26, D29.

**This is plan 3 of 4.** Depends on plan 1 (`identity.ts`, connect routes) and plan 2 (`runConversation`, `storeGarmentPhoto`, `messaging_runs`, engine `COPY`). Plan 4 (Amazon white-background removal) is independent.

## What is confirmed, and what Task 1 must confirm first

Confirmed from Meta's official page ([interactive media carousel messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/interactive-media-carousel-messages/), read 2026-10-13): non-template carousel is `type: "interactive"`, `interactive.type: "carousel"`, 2–10 cards, body ≤ 1024 characters, card body ≤ 160 characters, image or video header by `link`, quick-reply buttons with title ≤ 20 and id ≤ 256 characters, and **button types and counts must match across all cards**.

**Provisional until Task 1 (the spike) runs on the test number:**
1. The page's example puts `"type": "cta_url"` on a card that has quick-reply buttons. That looks like a doc error. The renderer omits the card-level `type`; the spike tries both.
2. The webhook shape of a carousel quick-reply tap was not documented. The parser accepts `interactive.button_reply`, `interactive.list_reply` and `interactive.quick_reply`; the spike records which one arrives.
3. Whether Meta can fetch our presigned MinIO URLs (T3). Card thumbnails use links; **result images are uploaded to Meta's media endpoint and sent by id**, which works whatever the answer.
4. Whether carousels are allowed outside the 24-hour window. The design never sends one there (only the approved template), so this does not block anything.

If the spike contradicts the plan on any point, change the renderer or parser in Task 3 / Task 4 to match the spike — the spike is the source of truth — and record it in `docs/progress.md`.

## Decisions this plan makes (recorded in Task 9)

- **D37 — delivery by polling, not pub/sub.** The spec had a notifier on the dispatcher's `sse:events:admin` channel plus a sweeper to catch what pub/sub drops. One polling loop over unfinished `messaging_runs` (indexed, a handful of rows) does both jobs with one code path. Cost: up to one poll interval (5 s) of extra latency on a multi-minute generation.

  | | Developers | Users |
  |---|---|---|
  | Pub/sub notifier + sweeper (spec) | Two paths to keep consistent; a subscriber connection to manage | Image arrives ~5 s sooner |
  | **Polling loop only** | One path, testable by calling the tick | Image arrives within 5 s of finishing |

- **D38 — results are uploaded to Meta, not linked.** Uploading needs no public URL and no T3 answer.
- **D39 — the window margin is 10 minutes.** A free-form send is attempted only if the seller's last message is less than 23 h 50 min old, so a send in flight never crosses the 24-hour line.

## Global Constraints

- Everything from plans 1 and 2 still applies (literal-`'true'` flags, no production schema work, no `console.log`, comments explain *why*, English copy in one file).
- **Secrets:** `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` are never logged; add them to the logger's redact list. Report them only as set/unset and length.
- **Webhook always answers 200** — on a bad signature, a flag that is off, or a payload it cannot use — so Meta does not retry (same pattern as `/v1/payments/webhook`). Only a Redis failure while enqueuing may return 500, so Meta retries and no message is lost.
- **Feature flag off:** the webhook does nothing, and neither loop is started.
- **Unknown numbers never reach the engine** and never cause a download or upload.
- **STOP:** after the confirmation reply, nothing is sent to that number until it messages again (D21).
- **Only one paid message type:** the approved utility template "Your catalog images are ready", at most once per run (D26). No proactive or marketing messages.
- Graph API version comes from env, default `v25.0` (the version the developer console used on 2026-10-13).

## File structure

| File | Responsibility |
|---|---|
| `apps/api/src/env.ts` (modify) | WhatsApp env vars |
| `packages/logger/src/index.ts` (modify) | redact WhatsApp secrets |
| `apps/api/src/modules/messaging/channels/whatsapp/client.ts` (create) | Graph API: send, upload media, download media |
| `apps/api/src/modules/messaging/channels/whatsapp/render.ts` (create) | `OutboundMessage` → Cloud API payloads |
| `apps/api/src/modules/messaging/channels/whatsapp/parse.ts` (create) | webhook body → `ParsedInbound[]` |
| `apps/api/src/modules/messaging/channels/whatsapp/signature.ts` (create) | `X-Hub-Signature-256` check |
| `apps/api/src/modules/messaging/webhook.routes.ts` (create) | GET verify + POST receive |
| `apps/api/src/modules/messaging/inbound.ts` (create) | one inbound message, end to end |
| `apps/api/src/modules/messaging/inbound-consumer.ts` (create) | stream consumer loop |
| `apps/api/src/modules/messaging/delivery.ts` (create) | send finished runs |
| `apps/api/src/modules/messaging/send.ts` (create) | render + send + opt-out + window handling |
| `apps/api/src/modules/messaging/engine/copy.ts` (modify) | connect/STOP/template-reply copy |
| `packages/db/src/schema/messaging.ts` (modify) | delivery columns on `messaging_runs` |
| `apps/api/src/modules/messaging/connect.routes.ts` (modify) | "Connected" message after a chat-started confirm |
| `apps/api/src/modules/payments/routes.ts` (modify) | `creditsAdded` after a purchase |
| `apps/api/src/server.ts`, `apps/api/src/main.ts` (modify) | register routes, start loops |
| tests | `apps/api/test/whatsapp-*.test.ts`, `apps/api/test/helpers/fake-whatsapp.ts`, `apps/api/test/integration/whatsapp-*.test.ts` |

---

### Task 1: Spike on the test number (manual, before any code)

Answers T1–T3 with real sends. No code is committed except the notes.

**Files:**
- Modify: `docs/progress.md`

Prerequisites: the temporary access token from the developer console, the test number's Phone Number ID `1331723183359956`, and the verified recipient `919109516207`. Put the token in your shell only:

```bash
read -s WA_TOKEN   # paste the token, press Enter; nothing is echoed
export WA_TOKEN PHONE_ID=1331723183359956 TO=919109516207 GRAPH=https://graph.facebook.com/v25.0
```

The recipient must have messaged the test number within the last 24 hours, or free-form sends fail with error `131047`. Send "hi" from the phone first.

- [ ] **Step 1: Reply buttons and a list**

```bash
curl -s -X POST "$GRAPH/$PHONE_ID/messages" -H "Authorization: Bearer $WA_TOKEN" -H 'Content-Type: application/json' -d '{
  "messaging_product":"whatsapp","to":"'"$TO"'","type":"interactive",
  "interactive":{"type":"button","body":{"text":"Spike: buttons"},
    "action":{"buttons":[{"type":"reply","reply":{"id":"n1|menu|new","title":"New catalog"}},
                         {"type":"reply","reply":{"id":"n1|menu|credits","title":"Credits"}}]}}}'
curl -s -X POST "$GRAPH/$PHONE_ID/messages" -H "Authorization: Bearer $WA_TOKEN" -H 'Content-Type: application/json' -d '{
  "messaging_product":"whatsapp","to":"'"$TO"'","type":"interactive",
  "interactive":{"type":"list","body":{"text":"Spike: list"},
    "action":{"button":"Choose","sections":[{"title":"Options","rows":[
      {"id":"n1|gender|women","title":"Women"},{"id":"n1|gender|men","title":"Men"}]}]}}}'
```

Expected: `{"messages":[{"id":"wamid..."}]}` for each, and both render on the phone.

- [ ] **Step 2: Carousel, with and without the card `type`**

Use two real image URLs: one presigned URL from your local MinIO (from any `/v1/models/faces` response while running the api locally — expect this one to **fail** because Meta cannot reach localhost), and one from staging or production (`https://app.aivastra.com/minio/...` presigned). Send the payload twice: once as below, once with `"type":"cta_url"` added to each card.

```bash
curl -s -X POST "$GRAPH/$PHONE_ID/messages" -H "Authorization: Bearer $WA_TOKEN" -H 'Content-Type: application/json' -d '{
  "messaging_product":"whatsapp","to":"'"$TO"'","type":"interactive",
  "interactive":{"type":"carousel","body":{"text":"Spike: carousel"},
    "action":{"cards":[
      {"card_index":0,"header":{"type":"image","image":{"link":"<URL_1>"}},"body":{"text":"Face 1"},
       "action":{"buttons":[{"type":"quick_reply","quick_reply":{"id":"n1|face|a","title":"Select"}}]}},
      {"card_index":1,"header":{"type":"image","image":{"link":"<URL_2>"}},"body":{"text":"Face 2"},
       "action":{"buttons":[{"type":"quick_reply","quick_reply":{"id":"n1|face|b","title":"Select"}}]}}]}}}'
```

Record: which variant Meta accepts; whether the presigned staging/production URL renders (T3); any error text.

- [ ] **Step 3: See what a tap sends back**

Meta posts taps to the app's webhook, which does not exist yet. Use a temporary request bin: in the developer console → WhatsApp → Configuration, set the callback URL to a throwaway HTTPS inspector you control (for example a `webhook.site` URL) with any verify token — the inspector must echo `hub.challenge`; if it cannot, skip this step and confirm the shape in Task 8 instead. Subscribe the `messages` field. Tap a reply button, a list row and a carousel card. Record the `messages[0].interactive` object for each (`button_reply` / `list_reply` / other).

**Remove the temporary callback URL afterwards** — it would otherwise receive real messages.

- [ ] **Step 4: Upload media and send by id**

```bash
curl -s -X POST "$GRAPH/$PHONE_ID/media" -H "Authorization: Bearer $WA_TOKEN" \
  -F messaging_product=whatsapp -F type=image/png -F file=@some-result.png
# → {"id":"<MEDIA_ID>"}
curl -s -X POST "$GRAPH/$PHONE_ID/messages" -H "Authorization: Bearer $WA_TOKEN" -H 'Content-Type: application/json' \
  -d '{"messaging_product":"whatsapp","to":"'"$TO"'","type":"image","image":{"id":"<MEDIA_ID>"}}'
```

Expected: the image arrives.

- [ ] **Step 5: Record the results**

Add a dated `docs/progress.md` entry "WhatsApp spike (T1–T3)" with: accepted carousel variant, tap webhook shape per message type, whether presigned staging/production URLs render, and any limits that differed from this plan. Then `unset WA_TOKEN`.

```bash
git add docs/progress.md
git commit -m "docs(progress): WhatsApp Cloud API spike results (T1-T3)"
```

- [ ] **Step 6: Submit the results template for approval (Meta dashboard, manual)**

WhatsApp Manager → Message templates → Create: category **Utility**, name `catalog_images_ready`, language English (`en`), body `Your Aivastra catalog images are ready.`, one **quick reply** button `Show images`. Submit. Approval is asynchronous; Task 7 works without it until the window-closed path is tested. Record the template name and status in `docs/progress.md` when approved.

---

### Task 2: Env vars and the Graph API client

**Files:**
- Modify: `apps/api/src/env.ts`, `.env.example`, `.env.production.example`, `packages/logger/src/index.ts`
- Create: `apps/api/src/modules/messaging/channels/whatsapp/client.ts`
- Test: `apps/api/test/whatsapp-client.test.ts`

**Interfaces:**
- Produces: `WhatsappClient` (`send`, `uploadMedia`, `downloadMedia`), `createWhatsappClient(cfg)`, `MetaApiError { status, code }`, `META_ERROR_OUTSIDE_WINDOW = 131047`.

- [ ] **Step 1: Env vars**

In `apps/api/src/env.ts`, next to `MESSAGING_WHATSAPP_ENABLED`:

```ts
  // WhatsApp Cloud API (spec section 16). The token and app secret are secrets:
  // never log them. Blank lines in .env must not crash startup.
  WHATSAPP_PHONE_NUMBER_ID: z.preprocess((v) => (v === '' ? undefined : v), z.string().regex(/^\d+$/).optional()),
  WHATSAPP_ACCESS_TOKEN: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(20).optional()),
  WHATSAPP_APP_SECRET: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(16).optional()),
  WHATSAPP_VERIFY_TOKEN: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(16).optional()),
  WHATSAPP_GRAPH_VERSION: z.string().regex(/^v\d+\.\d+$/).default('v25.0'),
  // Approved utility template sent when results finish after the 24-hour window
  // closed (D26). Unset = such results simply wait for the seller's next message.
  WHATSAPP_RESULTS_TEMPLATE: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
```

Add the same six names (empty) to `.env.example` and `.env.production.example` under the plan 1 block, with a comment that the token is a **system-user permanent token** in production.

In `packages/logger/src/index.ts`, add to `redact.paths`: `'WHATSAPP_ACCESS_TOKEN'`, `'WHATSAPP_APP_SECRET'`, `'WHATSAPP_VERIFY_TOKEN'`.

- [ ] **Step 2: Write the failing client tests**

`apps/api/test/whatsapp-client.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createWhatsappClient, MetaApiError } from '../src/modules/messaging/channels/whatsapp/client';

const cfg = { phoneNumberId: '111', accessToken: 'tok-0123456789abcdefghij', graphVersion: 'v25.0' };
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('whatsapp client', () => {
  it('sends with the bearer token and returns the message id', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(200, { messages: [{ id: 'wamid.1' }] }));
    const c = createWhatsappClient({ ...cfg, fetchImpl });
    await expect(c.send('919100000001', { type: 'text', text: { body: 'hi' } })).resolves.toEqual({
      messageId: 'wamid.1',
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v25.0/111/messages');
    expect(init.headers.Authorization).toBe('Bearer tok-0123456789abcdefghij');
    expect(JSON.parse(init.body)).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '919100000001',
      type: 'text',
      text: { body: 'hi' },
    });
  });

  it('surfaces Meta error codes', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(json(400, { error: { message: 'Re-engagement message', code: 131047 } }));
    const c = createWhatsappClient({ ...cfg, fetchImpl });
    const err = await c.send('9191', { type: 'text', text: { body: 'x' } }).catch((e) => e);
    expect(err).toBeInstanceOf(MetaApiError);
    expect(err).toMatchObject({ status: 400, code: 131047 });
  });

  it('downloads media in two steps and refuses oversize files', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json(200, { url: 'https://lookaside/x', mime_type: 'image/jpeg', file_size: 3 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    const c = createWhatsappClient({ ...cfg, fetchImpl });
    const media = await c.downloadMedia('m1', 10);
    expect(media.mimeType).toBe('image/jpeg');
    expect([...media.bytes]).toEqual([1, 2, 3]);
    expect(fetchImpl.mock.calls[1][1].headers.Authorization).toBe('Bearer tok-0123456789abcdefghij');

    const big = vi
      .fn()
      .mockResolvedValueOnce(json(200, { url: 'u', mime_type: 'image/jpeg', file_size: 11 }));
    await expect(createWhatsappClient({ ...cfg, fetchImpl: big }).downloadMedia('m2', 10)).rejects.toThrow(
      /too large/,
    );
  });

  it('uploads media and returns its id', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(200, { id: 'media-1' }));
    const c = createWhatsappClient({ ...cfg, fetchImpl });
    await expect(c.uploadMedia(Buffer.from('png'), 'image/png')).resolves.toBe('media-1');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v25.0/111/media');
    expect(init.body).toBeInstanceOf(FormData);
  });
});
```

Run (from `apps/api`): `npx vitest run test/whatsapp-client.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the client**

`apps/api/src/modules/messaging/channels/whatsapp/client.ts`:

```ts
// Thin Graph API client. Knows HTTP and Meta's error shape, nothing about the
// conversation. Never logs request headers: they carry the access token.
export const META_ERROR_OUTSIDE_WINDOW = 131047;

export class MetaApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: number | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'MetaApiError';
  }
}

export interface WhatsappClient {
  /** `to` is the wa_id: E.164 digits without '+'. */
  send(to: string, payload: Record<string, unknown>): Promise<{ messageId: string }>;
  uploadMedia(bytes: Buffer, mimeType: string): Promise<string>;
  downloadMedia(mediaId: string, maxBytes: number): Promise<{ bytes: Buffer; mimeType: string }>;
}

export interface WhatsappClientConfig {
  phoneNumberId: string;
  accessToken: string;
  graphVersion: string;
  fetchImpl?: typeof fetch;
}

async function failure(res: Response): Promise<MetaApiError> {
  let code: number | undefined;
  let message = `Graph API ${res.status}`;
  try {
    const body = (await res.json()) as { error?: { code?: number; message?: string } };
    code = body.error?.code;
    if (body.error?.message) message = body.error.message;
  } catch {
    // non-JSON error body: keep the status-only message
  }
  return new MetaApiError(res.status, code, message);
}

export function createWhatsappClient(cfg: WhatsappClientConfig): WhatsappClient {
  const doFetch = cfg.fetchImpl ?? fetch;
  const base = `https://graph.facebook.com/${cfg.graphVersion}`;
  const auth = { Authorization: `Bearer ${cfg.accessToken}` };

  return {
    async send(to, payload) {
      const res = await doFetch(`${base}/${cfg.phoneNumberId}/messages`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, ...payload }),
      });
      if (!res.ok) throw await failure(res);
      const body = (await res.json()) as { messages?: { id: string }[] };
      return { messageId: body.messages?.[0]?.id ?? '' };
    },

    async uploadMedia(bytes, mimeType) {
      const form = new FormData();
      form.append('messaging_product', 'whatsapp');
      form.append('type', mimeType);
      form.append('file', new Blob([bytes], { type: mimeType }), 'image');
      const res = await doFetch(`${base}/${cfg.phoneNumberId}/media`, { method: 'POST', headers: auth, body: form });
      if (!res.ok) throw await failure(res);
      return ((await res.json()) as { id: string }).id;
    },

    async downloadMedia(mediaId, maxBytes) {
      // Two steps: the media id resolves to a short-lived URL, which also needs the token.
      const meta = await doFetch(`${base}/${mediaId}`, { headers: auth });
      if (!meta.ok) throw await failure(meta);
      const info = (await meta.json()) as { url: string; mime_type: string; file_size?: number };
      if ((info.file_size ?? 0) > maxBytes) throw new MetaApiError(413, undefined, 'media too large');
      const file = await doFetch(info.url, { headers: auth });
      if (!file.ok) throw await failure(file);
      const bytes = Buffer.from(await file.arrayBuffer());
      if (bytes.length > maxBytes) throw new MetaApiError(413, undefined, 'media too large');
      return { bytes, mimeType: info.mime_type };
    },
  };
}
```

- [ ] **Step 4: Run, typecheck, commit**

Run: `npx vitest run test/whatsapp-client.test.ts` → PASS, 4 tests. `pnpm --filter @aivastra/api typecheck` → exit 0.

```bash
git add apps/api/src/env.ts .env.example .env.production.example packages/logger/src/index.ts apps/api/src/modules/messaging/channels/whatsapp/client.ts apps/api/test/whatsapp-client.test.ts
git commit -m "feat(api): WhatsApp Graph API client and env"
```

---

### Task 3: Renderer

**Files:**
- Create: `apps/api/src/modules/messaging/channels/whatsapp/render.ts`
- Modify: `apps/api/src/modules/messaging/engine/copy.ts` (add `btnSelect: 'Select'`)
- Test: `apps/api/test/whatsapp-render.test.ts`

**Interfaces:**
- Consumes: `OutboundMessage` (plan 2).
- Produces: `renderMessage(m: OutboundMessage): Record<string, unknown>[]` — one or more payloads for `client.send`, in order.

- [ ] **Step 1: Add the copy**

In `engine/copy.ts`, add `btnSelect: 'Select',` next to `btnDone`.

- [ ] **Step 2: Write the failing tests**

`apps/api/test/whatsapp-render.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { renderMessage } from '../src/modules/messaging/channels/whatsapp/render';

describe('renderMessage', () => {
  it('text → text with link previews', () => {
    expect(renderMessage({ kind: 'text', text: 'hi https://x' })).toEqual([
      { type: 'text', text: { body: 'hi https://x', preview_url: true } },
    ]);
  });

  it('buttons → reply buttons, max 3, titles clipped to 20', () => {
    const [p] = renderMessage({
      kind: 'buttons',
      text: 'Pick',
      buttons: [
        { id: 'a', title: 'A very long button title indeed' },
        { id: 'b', title: 'B' },
        { id: 'c', title: 'C' },
        { id: 'd', title: 'D' },
      ],
    });
    expect(p).toEqual({
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: 'Pick' },
        action: {
          buttons: [
            { type: 'reply', reply: { id: 'a', title: 'A very long button t' } },
            { type: 'reply', reply: { id: 'b', title: 'B' } },
            { type: 'reply', reply: { id: 'c', title: 'C' } },
          ],
        },
      },
    });
  });

  it('list → one section, max 10 rows, titles clipped to 24', () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ id: `r${i}`, title: `Row number ${i} with a long tail` }));
    const [p] = renderMessage({ kind: 'list', text: 'Choose one', buttonLabel: 'Choose', rows });
    const action = (p as { interactive: { action: { button: string; sections: { rows: unknown[] }[] } } })
      .interactive.action;
    expect(action.button).toBe('Choose');
    expect(action.sections[0].rows).toHaveLength(10);
    expect(action.sections[0].rows[0]).toEqual({ id: 'r0', title: 'Row number 0 with a long' });
  });

  it('2+ cards → one carousel with a Select quick reply per card', () => {
    const [p] = renderMessage({
      kind: 'cards',
      text: 'Choose a model.',
      cards: [
        { id: 'n|face|1', imageUrl: 'https://i/1.jpg', title: 'Asha' },
        { id: 'n|face|2', imageUrl: 'https://i/2.jpg', title: 'Meera' },
      ],
    });
    expect(p).toEqual({
      type: 'interactive',
      interactive: {
        type: 'carousel',
        body: { text: 'Choose a model.' },
        action: {
          cards: [
            {
              card_index: 0,
              header: { type: 'image', image: { link: 'https://i/1.jpg' } },
              body: { text: 'Asha' },
              action: { buttons: [{ type: 'quick_reply', quick_reply: { id: 'n|face|1', title: 'Select' } }] },
            },
            {
              card_index: 1,
              header: { type: 'image', image: { link: 'https://i/2.jpg' } },
              body: { text: 'Meera' },
              action: { buttons: [{ type: 'quick_reply', quick_reply: { id: 'n|face|2', title: 'Select' } }] },
            },
          ],
        },
      },
    });
  });

  it('1 card → an image then a Select button (carousels need at least 2)', () => {
    const out = renderMessage({
      kind: 'cards',
      text: 'Choose a model.',
      cards: [{ id: 'n|face|1', imageUrl: 'https://i/1.jpg', title: 'Asha' }],
    });
    expect(out).toEqual([
      { type: 'image', image: { link: 'https://i/1.jpg', caption: 'Asha' } },
      {
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: 'Choose a model.' },
          action: { buttons: [{ type: 'reply', reply: { id: 'n|face|1', title: 'Select' } }] },
        },
      },
    ]);
  });

  it('0 cards renders nothing', () => {
    expect(renderMessage({ kind: 'cards', text: 'x', cards: [] })).toEqual([]);
  });
});
```

Run: `npx vitest run test/whatsapp-render.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement the renderer**

`apps/api/src/modules/messaging/channels/whatsapp/render.ts`:

```ts
import { COPY } from '../../engine/copy.js';
import type { OutboundMessage } from '../../engine/types.js';

// Limits from Meta's docs (spec section 9; carousel confirmed 2026-10-13, the
// rest re-checked by the plan 3 spike). Clipping here keeps a long admin label
// from turning a whole message into a 400.
const BODY_MAX = 1024;
const BUTTON_TITLE_MAX = 20;
const ROW_TITLE_MAX = 24;
const ROW_DESC_MAX = 72;
const CARD_BODY_MAX = 160;
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

function replyButtons(text: string, buttons: { id: string; title: string }[]) {
  return {
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: clip(text, BODY_MAX) },
      action: {
        buttons: buttons.slice(0, 3).map((b) => ({
          type: 'reply',
          reply: { id: b.id, title: clip(b.title, BUTTON_TITLE_MAX) },
        })),
      },
    },
  };
}

export function renderMessage(m: OutboundMessage): Record<string, unknown>[] {
  switch (m.kind) {
    case 'text':
      return [{ type: 'text', text: { body: m.text, preview_url: true } }];

    case 'buttons':
      return [replyButtons(m.text, m.buttons)];

    case 'list':
      return [
        {
          type: 'interactive',
          interactive: {
            type: 'list',
            body: { text: clip(m.text, BODY_MAX) },
            action: {
              button: clip(m.buttonLabel, BUTTON_TITLE_MAX),
              sections: [
                {
                  title: 'Options',
                  rows: m.rows.slice(0, 10).map((r) => ({
                    id: r.id,
                    title: clip(r.title, ROW_TITLE_MAX),
                    ...(r.description ? { description: clip(r.description, ROW_DESC_MAX) } : {}),
                  })),
                },
              ],
            },
          },
        },
      ];

    case 'cards': {
      if (m.cards.length === 0) return [];
      // A carousel needs 2–10 cards; one option becomes an image plus a button.
      if (m.cards.length === 1) {
        const [c] = m.cards;
        return [
          { type: 'image', image: { link: c.imageUrl, caption: clip(c.title, BODY_MAX) } },
          replyButtons(m.text, [{ id: c.id, title: COPY.btnSelect }]),
        ];
      }
      return [
        {
          type: 'interactive',
          interactive: {
            type: 'carousel',
            body: { text: clip(m.text, BODY_MAX) },
            action: {
              // Every card has exactly one quick reply: Meta requires the same
              // button types and counts on all cards.
              cards: m.cards.slice(0, 10).map((c, i) => ({
                card_index: i,
                header: { type: 'image', image: { link: c.imageUrl } },
                body: { text: clip(c.title, CARD_BODY_MAX) },
                action: {
                  buttons: [{ type: 'quick_reply', quick_reply: { id: c.id, title: COPY.btnSelect } }],
                },
              })),
            },
          },
        },
      ];
    }
  }
}
```

If the Task 1 spike found that Meta requires a card-level `type`, add it to each card here and to the test's expected payload.

- [ ] **Step 4: Run and commit**

Run: `npx vitest run test/whatsapp-render.test.ts` → PASS, 6 tests.

```bash
git add apps/api/src/modules/messaging/channels/whatsapp/render.ts apps/api/src/modules/messaging/engine/copy.ts apps/api/test/whatsapp-render.test.ts
git commit -m "feat(api): render engine messages as WhatsApp Cloud API payloads"
```

---

### Task 4: Webhook parser and signature check

**Files:**
- Create: `apps/api/src/modules/messaging/channels/whatsapp/parse.ts`
- Create: `apps/api/src/modules/messaging/channels/whatsapp/signature.ts`
- Test: `apps/api/test/whatsapp-parse.test.ts`

**Interfaces:**
- Produces:
  - `ParsedInbound = { messageId: string; from: string; profileName: string | null; content: InboundContent }`
  - `InboundContent = { kind: 'text'; text: string } | { kind: 'reply'; id: string } | { kind: 'image'; mediaId: string; mimeType: string } | { kind: 'templateButton'; payload: string } | { kind: 'unsupported' }`
  - `parseWebhook(body: unknown): ParsedInbound[]`
  - `verifySignature(rawBody: Buffer, header: string | undefined, appSecret: string): boolean`

- [ ] **Step 1: Write the failing tests**

`apps/api/test/whatsapp-parse.test.ts`:

```ts
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseWebhook } from '../src/modules/messaging/channels/whatsapp/parse';
import { verifySignature } from '../src/modules/messaging/channels/whatsapp/signature';

const wrap = (messages: unknown[], contacts: unknown[] = []) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: 'waba', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', contacts, messages } }] }],
});

describe('parseWebhook', () => {
  it('parses text with the sender profile name', () => {
    const out = parseWebhook(
      wrap([{ from: '919100000001', id: 'wamid.1', type: 'text', text: { body: 'hi' } }], [
        { wa_id: '919100000001', profile: { name: 'Asha' } },
      ]),
    );
    expect(out).toEqual([
      { messageId: 'wamid.1', from: '919100000001', profileName: 'Asha', content: { kind: 'text', text: 'hi' } },
    ]);
  });

  it('parses button, list and carousel quick-reply taps as replies', () => {
    const out = parseWebhook(
      wrap([
        { from: '91', id: 'a', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'n|x|1', title: 'X' } } },
        { from: '91', id: 'b', type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'n|y|2', title: 'Y' } } },
        { from: '91', id: 'c', type: 'interactive', interactive: { type: 'quick_reply', quick_reply: { id: 'n|z|3' } } },
      ]),
    );
    expect(out.map((m) => m.content)).toEqual([
      { kind: 'reply', id: 'n|x|1' },
      { kind: 'reply', id: 'n|y|2' },
      { kind: 'reply', id: 'n|z|3' },
    ]);
  });

  it('parses images, template buttons and flags everything else as unsupported', () => {
    const out = parseWebhook(
      wrap([
        { from: '91', id: 'i', type: 'image', image: { id: 'media-1', mime_type: 'image/jpeg' } },
        { from: '91', id: 't', type: 'button', button: { payload: 'SHOW_IMAGES', text: 'Show images' } },
        { from: '91', id: 'v', type: 'video', video: { id: 'm2' } },
      ]),
    );
    expect(out.map((m) => m.content)).toEqual([
      { kind: 'image', mediaId: 'media-1', mimeType: 'image/jpeg' },
      { kind: 'templateButton', payload: 'SHOW_IMAGES' },
      { kind: 'unsupported' },
    ]);
  });

  it('ignores status updates and junk', () => {
    expect(parseWebhook({ entry: [{ changes: [{ field: 'messages', value: { statuses: [{}] } }] }] })).toEqual([]);
    expect(parseWebhook(null)).toEqual([]);
    expect(parseWebhook({ entry: 'nope' })).toEqual([]);
  });
});

describe('verifySignature', () => {
  const body = Buffer.from('{"a":1}');
  const good = `sha256=${createHmac('sha256', 'app-secret-0123456789').update(body).digest('hex')}`;
  it('accepts the right signature', () => {
    expect(verifySignature(body, good, 'app-secret-0123456789')).toBe(true);
  });
  it('rejects a wrong, missing or malformed one', () => {
    expect(verifySignature(body, good, 'other-secret-0123456789')).toBe(false);
    expect(verifySignature(body, undefined, 'app-secret-0123456789')).toBe(false);
    expect(verifySignature(body, 'sha256=zz', 'app-secret-0123456789')).toBe(false);
  });
});
```

Run: `npx vitest run test/whatsapp-parse.test.ts` → FAIL.

- [ ] **Step 2: Implement both**

`apps/api/src/modules/messaging/channels/whatsapp/signature.ts`:

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Meta signs the raw body: `X-Hub-Signature-256: sha256=<hex HMAC with the app secret>`. */
export function verifySignature(rawBody: Buffer, header: string | undefined, appSecret: string): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const given = Buffer.from(header.slice('sha256='.length), 'hex');
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  // Constant-time, and length-checked first: timingSafeEqual throws on unequal lengths.
  return given.length === expected.length && timingSafeEqual(given, expected);
}
```

`apps/api/src/modules/messaging/channels/whatsapp/parse.ts`:

```ts
export type InboundContent =
  | { kind: 'text'; text: string }
  | { kind: 'reply'; id: string }
  | { kind: 'image'; mediaId: string; mimeType: string }
  // A tap on the results template's quick-reply button (D26).
  | { kind: 'templateButton'; payload: string }
  | { kind: 'unsupported' };

export interface ParsedInbound {
  messageId: string;
  // wa_id: E.164 digits without '+'.
  from: string;
  profileName: string | null;
  content: InboundContent;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | undefined => (v && typeof v === 'object' ? (v as Obj) : undefined);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

function content(m: Obj): InboundContent {
  switch (m.type) {
    case 'text': {
      const body = str(obj(m.text)?.body);
      return body !== undefined ? { kind: 'text', text: body } : { kind: 'unsupported' };
    }
    case 'image': {
      const img = obj(m.image);
      const id = str(img?.id);
      return id ? { kind: 'image', mediaId: id, mimeType: str(img?.mime_type) ?? '' } : { kind: 'unsupported' };
    }
    case 'interactive': {
      const i = obj(m.interactive);
      // button_reply / list_reply are documented; quick_reply is the carousel
      // tap's shape if it differs — the plan 3 spike confirms which arrives.
      const id = str(obj(i?.button_reply)?.id) ?? str(obj(i?.list_reply)?.id) ?? str(obj(i?.quick_reply)?.id);
      return id ? { kind: 'reply', id } : { kind: 'unsupported' };
    }
    case 'button': {
      const payload = str(obj(m.button)?.payload);
      return payload ? { kind: 'templateButton', payload } : { kind: 'unsupported' };
    }
    default:
      return { kind: 'unsupported' };
  }
}

/** Defensive by design: the body is untrusted input even after the signature check. */
export function parseWebhook(body: unknown): ParsedInbound[] {
  const out: ParsedInbound[] = [];
  for (const entry of arr(obj(body)?.entry)) {
    for (const change of arr(obj(entry)?.changes)) {
      const c = obj(change);
      if (c?.field !== 'messages') continue;
      const value = obj(c.value);
      const names = new Map<string, string>();
      for (const contact of arr(value?.contacts)) {
        const k = obj(contact);
        const waId = str(k?.wa_id);
        const name = str(obj(k?.profile)?.name);
        if (waId && name) names.set(waId, name);
      }
      for (const raw of arr(value?.messages)) {
        const m = obj(raw);
        const id = str(m?.id);
        const from = str(m?.from);
        if (!m || !id || !from) continue;
        out.push({ messageId: id, from, profileName: names.get(from) ?? null, content: content(m) });
      }
    }
  }
  return out;
}
```

- [ ] **Step 3: Run and commit**

Run: `npx vitest run test/whatsapp-parse.test.ts` → PASS, 6 tests.

```bash
git add apps/api/src/modules/messaging/channels/whatsapp/parse.ts apps/api/src/modules/messaging/channels/whatsapp/signature.ts apps/api/test/whatsapp-parse.test.ts
git commit -m "feat(api): WhatsApp webhook parser and signature verification"
```

---

### Task 5: Webhook routes

**Files:**
- Create: `apps/api/src/modules/messaging/webhook.routes.ts`
- Modify: `apps/api/src/server.ts` (register after `messagingConnectRoutes`)
- Test: `apps/api/test/integration/whatsapp-webhook.test.ts`

**Interfaces:**
- Produces: `GET /v1/whatsapp/webhook` (verification handshake), `POST /v1/whatsapp/webhook`; stream `messaging:inbound` with field `msg` = JSON `ParsedInbound`; dedupe key `msg:seen:whatsapp:<messageId>` (3 days, T6).

- [ ] **Step 1: Write the failing integration test**

`apps/api/test/integration/whatsapp-webhook.test.ts`:

```ts
import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

const SECRET = 'app-secret-0123456789abcdef';
const VERIFY = 'verify-token-0123456789';
const sign = (raw: string) => `sha256=${createHmac('sha256', SECRET).update(raw).digest('hex')}`;
const payload = (id: string) =>
  JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ field: 'messages', value: { messages: [{ from: '919100000001', id, type: 'text', text: { body: 'hi' } }] } }] }],
  });

describe('whatsapp webhook', () => {
  let c: Containers;
  let app: TestApp;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c, {
      MESSAGING_WHATSAPP_ENABLED: true,
      WHATSAPP_APP_SECRET: SECRET,
      WHATSAPP_VERIFY_TOKEN: VERIFY,
    });
  }, 60_000);
  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  const streamLength = () => app.redis.xlen('messaging:inbound');

  it('answers the verification handshake only with the right token', async () => {
    const ok = await app.inject({
      method: 'GET',
      url: `/v1/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=12345`,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toBe('12345');
    const bad = await app.inject({
      method: 'GET',
      url: '/v1/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1',
    });
    expect(bad.statusCode).toBe(403);
  });

  it('enqueues a signed message once, even when Meta redelivers it', async () => {
    const before = await streamLength();
    const raw = payload('wamid.dup-1');
    for (let i = 0; i < 2; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/whatsapp/webhook',
        headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(raw) },
        payload: raw,
      });
      expect(res.statusCode).toBe(200);
    }
    expect(await streamLength()).toBe(before + 1);
  });

  it('acks but drops a badly signed request', async () => {
    const before = await streamLength();
    const raw = payload('wamid.bad-1');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/whatsapp/webhook',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=00' },
      payload: raw,
    });
    expect(res.statusCode).toBe(200);
    expect(await streamLength()).toBe(before);
  });
});

describe('whatsapp webhook (flag off)', () => {
  let c: Containers;
  let app: TestApp;
  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c, { WHATSAPP_APP_SECRET: SECRET, WHATSAPP_VERIFY_TOKEN: VERIFY });
  }, 60_000);
  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  it('acks and does nothing', async () => {
    const raw = payload('wamid.off-1');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/whatsapp/webhook',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(raw) },
      payload: raw,
    });
    expect(res.statusCode).toBe(200);
    expect(await app.redis.xlen('messaging:inbound')).toBe(0);
  });
});
```

Run: `npx vitest run --config vitest.integration.config.ts whatsapp-webhook` → FAIL (404s).

- [ ] **Step 2: Implement the routes**

`apps/api/src/modules/messaging/webhook.routes.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { parseWebhook } from './channels/whatsapp/parse.js';
import { verifySignature } from './channels/whatsapp/signature.js';

export const INBOUND_STREAM = 'messaging:inbound';
// Meta retries for up to a few days; a redelivery older than this is processed again.
const SEEN_TTL_SECONDS = 3 * 24 * 60 * 60;

/**
 * Meta → us. Verify, de-duplicate, enqueue, ack — nothing slow happens here, so
 * Meta never times out and retries, and a crash mid-processing never loses a
 * seller's photo: the consumer picks it up from the stream (spec section 5).
 */
export async function whatsappWebhookRoutes(app: FastifyInstance) {
  app.get('/v1/whatsapp/webhook', async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const expected = app.env.WHATSAPP_VERIFY_TOKEN;
    if (q['hub.mode'] === 'subscribe' && expected && q['hub.verify_token'] === expected) {
      return reply.type('text/plain').send(q['hub.challenge'] ?? '');
    }
    return reply.code(403).send();
  });

  // Scoped so the raw-buffer JSON parser (needed for the HMAC) affects only this route.
  await app.register(async (sub) => {
    sub.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

    sub.post(
      '/v1/whatsapp/webhook',
      // Meta's own delivery volume, not abuse: keep the limiter well out of its way.
      { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } },
      async (req, reply) => {
        if (app.env.MESSAGING_WHATSAPP_ENABLED !== true) return reply.code(200).send();
        const secret = app.env.WHATSAPP_APP_SECRET;
        const raw = req.body as Buffer;
        if (!secret || !verifySignature(raw, req.headers['x-hub-signature-256'] as string | undefined, secret)) {
          app.log.warn('whatsapp webhook: missing or invalid signature — dropped');
          return reply.code(200).send();
        }

        let body: unknown;
        try {
          body = JSON.parse(raw.toString('utf-8'));
        } catch {
          return reply.code(200).send();
        }

        for (const msg of parseWebhook(body)) {
          // SET NX first: a redelivered message never enters the stream twice.
          const fresh = await app.redis.set(`msg:seen:whatsapp:${msg.messageId}`, '1', 'EX', SEEN_TTL_SECONDS, 'NX');
          if (fresh !== 'OK') continue;
          await app.redis.xadd(INBOUND_STREAM, '*', 'msg', JSON.stringify(msg));
        }
        return reply.code(200).send();
      },
    );
  });
}
```

Register in `apps/api/src/server.ts` after `messagingConnectRoutes`:

```ts
import { whatsappWebhookRoutes } from './modules/messaging/webhook.routes.js';
// …
  await app.register(whatsappWebhookRoutes);
```

If Redis throws inside the loop, Fastify returns 500 and Meta retries — intended: the `SET NX` for a message that never reached the stream must then not block the retry. Guard that: if `xadd` throws, `del` the seen key before rethrowing:

```ts
          try {
            await app.redis.xadd(INBOUND_STREAM, '*', 'msg', JSON.stringify(msg));
          } catch (err) {
            await app.redis.del(`msg:seen:whatsapp:${msg.messageId}`).catch(() => {});
            throw err;
          }
```

(Replace the plain `xadd` line above with this block.)

- [ ] **Step 3: Run and commit**

Run: `npx vitest run --config vitest.integration.config.ts whatsapp-webhook` → PASS, 4 tests.

```bash
git add apps/api/src/modules/messaging/webhook.routes.ts apps/api/src/server.ts apps/api/test/integration/whatsapp-webhook.test.ts
git commit -m "feat(api): WhatsApp webhook — verify, de-duplicate, enqueue"
```

---

### Task 6: Sending, and processing one inbound message

**Files:**
- Modify: `apps/api/src/modules/messaging/engine/copy.ts` (connect / STOP copy)
- Create: `apps/api/src/modules/messaging/send.ts`
- Create: `apps/api/src/modules/messaging/inbound.ts`
- Create: `apps/api/test/helpers/fake-whatsapp.ts`
- Test: `apps/api/test/integration/whatsapp-inbound.test.ts`

**Interfaces:**
- Consumes: plan 1 (`toE164FromWaId`, `findAccountByExternalId`, `createChatConnectToken`, `chatConnectUrl`, `parseConnectCommand`, `consumeWebConnectCode`, `connectAccount`, `matchesProfilePhone`, `numberInUse`), plan 2 (`runConversation`, `storeGarmentPhoto`), Tasks 2–4.
- Produces:
  - `sendMessages(app, wa, to: string, messages: OutboundMessage[]): Promise<void>`
  - `windowOpen(lastInboundAt: Date | null, now?: Date): boolean`
  - `processInbound(app, wa, m: ParsedInbound): Promise<void>`
  - `deliverPendingForAccount` is consumed from Task 7 — Task 6 calls it through an injected function so the two tasks can be built in order (see Step 4).

- [ ] **Step 1: Add the copy**

Append to `COPY` in `engine/copy.ts`:

```ts
  connectPrompt: (url: string) =>
    `Welcome to Aivastra! To create catalog images here, connect your Aivastra account (or create one): ${url}\nThis link works for 30 minutes.`,
  connected: 'Connected. You can now create catalog images here. Reply STOP at any time to stop messages from Aivastra, or MENU to see your options.',
  connectedDifferentNumber: (last4: string) =>
    `Note: this WhatsApp number is different from the mobile number on your account (ending ${last4}).`,
  alreadyConnected: 'This number is already connected to your Aivastra account.',
  connectCodeInvalid: 'That code has expired or was already used. Open Settings on the Aivastra website and tap Connect WhatsApp again.',
  numberInUse: 'This number is connected to another Aivastra account. Disconnect it there first.',
  stopped: "You won't receive any more messages from Aivastra on WhatsApp. Your account and images are unchanged. Send START if you want to use the bot again.",
  photoFailed: "Couldn't receive that photo. Please send it again.",
```

`connected` and `stopped` are the approved wording from spec section 14.

- [ ] **Step 2: Write `send.ts`**

`apps/api/src/modules/messaging/send.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { META_ERROR_OUTSIDE_WINDOW, MetaApiError, type WhatsappClient } from './channels/whatsapp/client.js';
import { renderMessage } from './channels/whatsapp/render.js';
import type { OutboundMessage } from './engine/types.js';

// D39: free-form sends stop 10 minutes before Meta's 24-hour line, so a send in
// flight never crosses it.
const WINDOW_MS = 24 * 60 * 60 * 1000 - 10 * 60 * 1000;

export function windowOpen(lastInboundAt: Date | null, now = new Date()): boolean {
  return lastInboundAt !== null && now.getTime() - lastInboundAt.getTime() < WINDOW_MS;
}

/**
 * Renders and sends in order. Stops at the first failure: later messages
 * usually depend on earlier ones (a "More" button after a carousel). A send
 * outside the window is logged, not thrown — the conversation is still saved,
 * and the seller's next message reopens the window.
 */
export async function sendMessages(
  app: FastifyInstance,
  wa: WhatsappClient,
  to: string,
  messages: OutboundMessage[],
): Promise<void> {
  for (const m of messages) {
    for (const payload of renderMessage(m)) {
      try {
        await wa.send(to, payload);
      } catch (err) {
        if (err instanceof MetaApiError && err.code === META_ERROR_OUTSIDE_WINDOW) {
          app.log.warn({ code: err.code }, 'whatsapp send outside the 24h window — skipped');
          return;
        }
        throw err;
      }
    }
  }
}
```

- [ ] **Step 3: Write the fake client**

`apps/api/test/helpers/fake-whatsapp.ts`:

```ts
import type { WhatsappClient } from '../../src/modules/messaging/channels/whatsapp/client';

export function fakeWhatsapp(media: Record<string, { bytes: Buffer; mimeType: string }> = {}) {
  const sent: { to: string; payload: Record<string, unknown> }[] = [];
  const uploads: { bytes: Buffer; mimeType: string }[] = [];
  const client: WhatsappClient = {
    async send(to, payload) {
      sent.push({ to, payload });
      return { messageId: `out.${sent.length}` };
    },
    async uploadMedia(bytes, mimeType) {
      uploads.push({ bytes, mimeType });
      return `media.${uploads.length}`;
    },
    async downloadMedia(id) {
      const m = media[id];
      if (!m) throw new Error(`no fake media ${id}`);
      return m;
    },
  };
  // Every text body sent, in order — the easiest thing to assert on.
  const texts = () =>
    sent.map((s) => {
      const p = s.payload as { text?: { body: string }; interactive?: { body?: { text: string } } };
      return p.text?.body ?? p.interactive?.body?.text ?? '';
    });
  return { client, sent, uploads, texts };
}
```

- [ ] **Step 4: Write `inbound.ts`**

`apps/api/src/modules/messaging/inbound.ts`:

```ts
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../../lib/errors.js';
import type { WhatsappClient } from './channels/whatsapp/client.js';
import type { ParsedInbound } from './channels/whatsapp/parse.js';
import { runConversation } from './conversation.js';
import { COPY } from './engine/copy.js';
import type { InboundEvent, OutboundMessage } from './engine/types.js';
import {
  CHANNEL_WHATSAPP,
  chatConnectUrl,
  connectAccount,
  consumeWebConnectCode,
  createChatConnectToken,
  findAccountByExternalId,
  matchesProfilePhone,
  type MessagingAccountRow,
  parseConnectCommand,
  toE164FromWaId,
} from './identity.js';
import { storeGarmentPhoto } from './photos.js';
import { sendMessages } from './send.js';

const M = schema.messagingAccounts;
// T6: generous for a person tapping through a wizard, low enough that one number
// cannot flood job creation or Meta sends.
const RATE_LIMIT_PER_MINUTE = 30;
// Same ceiling as Meta's own image limit; createJob applies the admin-set web limit.
const MAX_PHOTO_BYTES = 16 * 1024 * 1024;
const PHOTO_TYPES = new Set(['image/jpeg', 'image/png']);
const text = (t: string): OutboundMessage => ({ kind: 'text', text: t });

export type DeliverPending = (app: FastifyInstance, wa: WhatsappClient, accountId: string) => Promise<void>;

async function overRateLimit(app: FastifyInstance, externalId: string): Promise<boolean> {
  const key = `msg:rate:whatsapp:${externalId}`;
  const n = await app.redis.incr(key);
  if (n === 1) await app.redis.expire(key, 60);
  return n > RATE_LIMIT_PER_MINUTE;
}

async function downloadPhoto(
  app: FastifyInstance,
  wa: WhatsappClient,
  userId: string,
  mediaId: string,
  mimeType: string,
): Promise<InboundEvent | 'failed'> {
  if (!PHOTO_TYPES.has(mimeType)) return { type: 'unsupportedMedia' };
  // Spec section 13: two retries, then ask the seller to send it again.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const media = await wa.downloadMedia(mediaId, MAX_PHOTO_BYTES);
      if (!PHOTO_TYPES.has(media.mimeType)) return { type: 'unsupportedMedia' };
      return { type: 'image', garmentKey: await storeGarmentPhoto(app, userId, media.bytes, media.mimeType) };
    } catch (err) {
      app.log.warn({ err, attempt }, 'whatsapp photo download failed');
    }
  }
  return 'failed';
}

/** An unknown number: redeem a CONNECT code, or send a connect link. Never reaches the engine. */
async function handleUnknown(app: FastifyInstance, wa: WhatsappClient, m: ParsedInbound, externalId: string) {
  const code = m.content.kind === 'text' ? parseConnectCommand(m.content.text) : null;
  if (!code) {
    const token = await createChatConnectToken(app.redis, externalId);
    return sendMessages(app, wa, m.from, [text(COPY.connectPrompt(chatConnectUrl(app.env.WEB_URL, token)))]);
  }
  const hit = await consumeWebConnectCode(app.redis, code);
  if (!hit) return sendMessages(app, wa, m.from, [text(COPY.connectCodeInvalid)]);
  let account: MessagingAccountRow;
  try {
    ({ account } = await connectAccount(app.db, {
      channel: CHANNEL_WHATSAPP,
      externalId,
      userId: hit.userId,
      linkedVia: 'web_code',
    }));
  } catch (err) {
    if (err instanceof AppError && err.code === 'NUMBER_IN_USE') {
      return sendMessages(app, wa, m.from, [text(COPY.numberInUse)]);
    }
    throw err;
  }
  await touchInbound(app, account.id);
  const [user] = await app.db.select({ phone: schema.users.phone }).from(schema.users).where(eq(schema.users.id, hit.userId));
  const intro: OutboundMessage[] = [text(COPY.connected)];
  // D29: a hint, never a block.
  if (user?.phone && !matchesProfilePhone(externalId, user.phone)) {
    intro.push(text(COPY.connectedDifferentNumber(user.phone.slice(-4))));
  }
  const menu = await runConversation(app, convAccount(account), { type: 'text', text: 'menu' }, m.messageId);
  return sendMessages(app, wa, m.from, [...intro, ...menu]);
}

function convAccount(a: MessagingAccountRow) {
  return { id: a.id, userId: a.userId, channel: a.channel, externalId: a.externalId };
}

async function touchInbound(app: FastifyInstance, accountId: string) {
  const now = new Date();
  await app.db.update(M).set({ lastInboundAt: now, updatedAt: now }).where(eq(M.id, accountId));
}

/**
 * One message from Meta, end to end. The caller holds the per-sender lock, so
 * a sender's messages are handled strictly in order.
 */
export async function processInbound(
  app: FastifyInstance,
  wa: WhatsappClient,
  m: ParsedInbound,
  deliverPending: DeliverPending,
): Promise<void> {
  const externalId = toE164FromWaId(m.from);
  if (await overRateLimit(app, externalId)) {
    app.log.warn({ messageId: m.messageId }, 'whatsapp sender over rate limit — dropped');
    return;
  }

  const account = await findAccountByExternalId(app.db, CHANNEL_WHATSAPP, externalId);
  if (!account) return handleUnknown(app, wa, m, externalId);

  await touchInbound(app, account.id);
  const words = m.content.kind === 'text' ? m.content.text.trim().toLowerCase() : '';

  if (words === 'stop') {
    await app.db.update(M).set({ optedOutAt: new Date(), updatedAt: new Date() }).where(eq(M.id, account.id));
    return sendMessages(app, wa, m.from, [text(COPY.stopped)]);
  }
  // D21: START, or any new message after a STOP, turns the bot back on — the
  // seller messaging us is what makes replying acceptable.
  if (account.optedOutAt) {
    await app.db.update(M).set({ optedOutAt: null, updatedAt: new Date() }).where(eq(M.id, account.id));
  }
  if (m.content.kind === 'text' && parseConnectCommand(m.content.text)) {
    return sendMessages(app, wa, m.from, [text(COPY.alreadyConnected)]);
  }

  // Results that finished while the window was closed go out first (D26).
  await deliverPending(app, wa, account.id);
  if (m.content.kind === 'templateButton') return;

  let event: InboundEvent;
  switch (m.content.kind) {
    case 'text':
      event = words === 'start' ? { type: 'text', text: 'menu' } : { type: 'text', text: m.content.text };
      break;
    case 'reply':
      event = { type: 'reply', id: m.content.id };
      break;
    case 'image': {
      const got = await downloadPhoto(app, wa, account.userId, m.content.mediaId, m.content.mimeType);
      if (got === 'failed') return sendMessages(app, wa, m.from, [text(COPY.photoFailed)]);
      event = got;
      break;
    }
    default:
      event = { type: 'unsupportedMedia' };
  }

  const out = await runConversation(app, convAccount(account), event, m.messageId);
  await sendMessages(app, wa, m.from, out);
}
```

- [ ] **Step 5: Write the integration test**

`apps/api/test/integration/whatsapp-inbound.test.ts` (no catalog seeding needed: these paths stop before option lists, except the menu, which needs none):

```ts
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ParsedInbound } from '../../src/modules/messaging/channels/whatsapp/parse';
import { CHANNEL_WHATSAPP, connectAccount, createWebConnectCode } from '../../src/modules/messaging/identity';
import { processInbound } from '../../src/modules/messaging/inbound';
import { buildTestApp, type TestApp } from '../helpers/api';
import { createVerifiedUserToken } from '../helpers/auth';
import { type Containers, startContainers } from '../helpers/containers';
import { fakeWhatsapp } from '../helpers/fake-whatsapp';

let seq = 0;
const waId = () => `9199${Date.now().toString().slice(-6)}${(++seq).toString().padStart(2, '0')}`;
const msg = (from: string, content: ParsedInbound['content']): ParsedInbound => ({
  messageId: `wamid.t${++seq}`,
  from,
  profileName: null,
  content,
});
const noPending = vi.fn().mockResolvedValue(undefined);

describe('whatsapp inbound', () => {
  let c: Containers;
  let app: TestApp;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c, { MESSAGING_WHATSAPP_ENABLED: true, WEB_URL: 'https://app.test' });
  }, 60_000);
  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  it('an unknown number gets a connect link and nothing else happens', async () => {
    const wa = fakeWhatsapp();
    const from = waId();
    await processInbound(app, wa.client, msg(from, { kind: 'image', mediaId: 'm', mimeType: 'image/jpeg' }), noPending);
    expect(wa.texts()).toHaveLength(1);
    expect(wa.texts()[0]).toMatch(/^Welcome to Aivastra!.*https:\/\/app\.test\/connect\/whatsapp\?t=/s);
    expect(wa.uploads).toHaveLength(0);
  });

  it('CONNECT <code> from an unknown number connects it and shows the menu', async () => {
    const wa = fakeWhatsapp();
    const { userId } = await createVerifiedUserToken(app, `wa-in-${seq}-${Date.now()}@example.com`);
    await app.db.update(schema.users).set({ phone: '9000001234' }).where(eq(schema.users.id, userId));
    const code = await createWebConnectCode(app.redis, userId);
    const from = waId();
    await processInbound(app, wa.client, msg(from, { kind: 'text', text: `CONNECT ${code}` }), noPending);

    const [row] = await app.db.select().from(schema.messagingAccounts).where(eq(schema.messagingAccounts.externalId, `+${from}`));
    expect(row).toMatchObject({ userId, linkedVia: 'web_code' });
    expect(row.lastInboundAt).not.toBeNull();
    const t = wa.texts();
    expect(t[0]).toMatch(/^Connected\./);
    expect(t[1]).toMatch(/ending 1234/);
    expect(t.at(-1)).toBe('What would you like to do?');
  });

  it('an expired code is refused', async () => {
    const wa = fakeWhatsapp();
    await processInbound(app, wa.client, msg(waId(), { kind: 'text', text: 'CONNECT ZZZZ2222' }), noPending);
    expect(wa.texts()).toEqual([expect.stringMatching(/expired or was already used/)]);
  });

  it('STOP silences the number; the next message turns it back on', async () => {
    const { userId } = await createVerifiedUserToken(app, `wa-stop-${seq}-${Date.now()}@example.com`);
    const from = waId();
    const { account } = await connectAccount(app.db, {
      channel: CHANNEL_WHATSAPP,
      externalId: `+${from}`,
      userId,
      linkedVia: 'chat_link',
    });
    const wa = fakeWhatsapp();
    await processInbound(app, wa.client, msg(from, { kind: 'text', text: 'STOP' }), noPending);
    expect(wa.texts()).toEqual([expect.stringMatching(/^You won't receive any more messages/)]);
    let [row] = await app.db.select().from(schema.messagingAccounts).where(eq(schema.messagingAccounts.id, account.id));
    expect(row.optedOutAt).not.toBeNull();

    await processInbound(app, wa.client, msg(from, { kind: 'text', text: 'START' }), noPending);
    [row] = await app.db.select().from(schema.messagingAccounts).where(eq(schema.messagingAccounts.id, account.id));
    expect(row.optedOutAt).toBeNull();
    expect(wa.texts().at(-1)).toBe('What would you like to do?');
  });

  it('a connected number reaches the engine and pending deliveries run first', async () => {
    const { userId } = await createVerifiedUserToken(app, `wa-eng-${seq}-${Date.now()}@example.com`);
    const from = waId();
    const { account } = await connectAccount(app.db, {
      channel: CHANNEL_WHATSAPP,
      externalId: `+${from}`,
      userId,
      linkedVia: 'chat_link',
    });
    const wa = fakeWhatsapp();
    const pending = vi.fn().mockResolvedValue(undefined);
    await processInbound(app, wa.client, msg(from, { kind: 'text', text: 'hi' }), pending);
    expect(pending).toHaveBeenCalledWith(app, wa.client, account.id);
    expect(wa.texts().at(-1)).toBe('What would you like to do?');
  });

  it('a photo is downloaded, stored as an owned upload and handed to the engine', async () => {
    const { userId } = await createVerifiedUserToken(app, `wa-img-${seq}-${Date.now()}@example.com`);
    const from = waId();
    await connectAccount(app.db, { channel: CHANNEL_WHATSAPP, externalId: `+${from}`, userId, linkedVia: 'chat_link' });
    const wa = fakeWhatsapp({ m1: { bytes: Buffer.from('jpeg'), mimeType: 'image/jpeg' } });
    await processInbound(app, wa.client, msg(from, { kind: 'image', mediaId: 'm1', mimeType: 'image/jpeg' }), noPending);
    // Photo from the main menu → the engine asks for gender next.
    expect(wa.texts().at(-1)).toBe('Who is the garment for?');
    const owned = await app.redis.keys('upload:owner:inputs/*');
    expect(owned.length).toBeGreaterThan(0);
  });

  it('a sender over the rate limit is dropped', async () => {
    const from = waId();
    await app.redis.set(`msg:rate:whatsapp:+${from}`, '30', 'EX', 60);
    const wa = fakeWhatsapp();
    await processInbound(app, wa.client, msg(from, { kind: 'text', text: 'hi' }), noPending);
    expect(wa.sent).toHaveLength(0);
  });
});
```

Run: `npx vitest run --config vitest.integration.config.ts whatsapp-inbound` → PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/messaging/send.ts apps/api/src/modules/messaging/inbound.ts apps/api/src/modules/messaging/engine/copy.ts apps/api/test/helpers/fake-whatsapp.ts apps/api/test/integration/whatsapp-inbound.test.ts
git commit -m "feat(api): process WhatsApp messages — connect, STOP/START, photos, engine"
```

---

### Task 7: Delivery

**Files:**
- Modify: `packages/db/src/schema/messaging.ts` (two columns on `messaging_runs`)
- Generated: `packages/db/src/migrations/0226_*.sql` + `meta/`
- Create: `apps/api/src/modules/messaging/delivery.ts`
- Test: `apps/api/test/integration/whatsapp-delivery.test.ts`

**Interfaces:**
- Produces: `deliverRun(app, wa, runId)`, `deliverPendingForAccount(app, wa, accountId)`, `deliveryTick(app, wa)`.

- [ ] **Step 1: Add the columns and migrate**

In `messagingRuns` (plan 2), add after `jobIds`:

```ts
    // Jobs whose outcome reached the chat (image sent, or failure accounted for).
    deliveredJobIds: uuid('delivered_job_ids').array().notNull().default(sql`'{}'::uuid[]`),
    // D26: the paid "images are ready" template goes out at most once per run.
    readyNoticeSentAt: timestamp('ready_notice_sent_at', { withTimezone: true }),
```

Add `sql` to the file's `drizzle-orm` imports (`import { sql } from 'drizzle-orm';`). Run `pnpm --filter @aivastra/db generate` and `pnpm db:migrate`; expect `0226_*.sql` with two `ALTER TABLE "messaging_runs" ADD COLUMN` statements only.

- [ ] **Step 2: Implement delivery**

`apps/api/src/modules/messaging/delivery.ts`:

```ts
import { schema } from '@aivastra/db';
import { keys } from '@aivastra/storage';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { WhatsappClient } from './channels/whatsapp/client.js';
import { runConversation } from './conversation.js';
import { sendMessages, windowOpen } from './send.js';

const R = schema.messagingRuns;
const TERMINAL = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);
const LOCK_TTL_SECONDS = 120;

/**
 * Sends whatever finished for one run. Safe to call from the poll loop and from
 * the inbound path at the same time: a per-run Redis lock serialises them, and
 * delivered_job_ids makes every send happen once.
 */
export async function deliverRun(app: FastifyInstance, wa: WhatsappClient, runId: string): Promise<void> {
  const lock = `msg:deliver:${runId}`;
  if ((await app.redis.set(lock, '1', 'EX', LOCK_TTL_SECONDS, 'NX')) !== 'OK') return;
  try {
    const [run] = await app.db.select().from(R).where(eq(R.catalogueId, runId));
    if (!run || run.finishedAt) return;
    const [account] = await app.db
      .select()
      .from(schema.messagingAccounts)
      .where(eq(schema.messagingAccounts.id, run.messagingAccountId));
    if (!account) return; // cascade deletes the run with the account; nothing to do

    const jobs = await app.db
      .select({ id: schema.jobs.id, status: schema.jobs.status, poseId: schema.jobInputs.poseId, resultKey: schema.jobOutputs.resultKey })
      .from(schema.jobs)
      .leftJoin(schema.jobInputs, eq(schema.jobInputs.jobId, schema.jobs.id))
      .leftJoin(schema.jobOutputs, eq(schema.jobOutputs.jobId, schema.jobs.id))
      .where(inArray(schema.jobs.id, run.jobIds));

    const delivered = new Set(run.deliveredJobIds);
    const pending = jobs.filter((j) => TERMINAL.has(j.status) && !delivered.has(j.id));
    const to = account.externalId.slice(1);
    const optedOut = account.optedOutAt !== null;
    const open = windowOpen(account.lastInboundAt);

    for (const j of pending) {
      if (j.status === 'COMPLETED' && !optedOut) {
        if (!open) {
          // Window closed: one paid template per run, then the images wait for
          // the seller's next message (processInbound → deliverPendingForAccount).
          const template = app.env.WHATSAPP_RESULTS_TEMPLATE;
          if (template && !run.readyNoticeSentAt) {
            await wa.send(to, { type: 'template', template: { name: template, language: { code: 'en' } } });
            await app.db.update(R).set({ readyNoticeSentAt: new Date() }).where(eq(R.catalogueId, runId));
          }
          return;
        }
        // D38: uploaded, not linked — needs no public URL.
        const bytes = await app.storage.getObject(j.resultKey ?? keys.output(j.id));
        const mediaId = await wa.uploadMedia(bytes, 'image/png');
        await wa.send(to, { type: 'image', image: { id: mediaId } });
      }
      // STOP: results stay on the web (/catalogs); the job counts as accounted for.
      await app.db
        .update(R)
        .set({ deliveredJobIds: sql`array_append(${R.deliveredJobIds}, ${j.id}::uuid)` })
        .where(eq(R.catalogueId, runId));
      delivered.add(j.id);
    }

    if (delivered.size < run.jobIds.length) return;
    // Every job is accounted for. The closing buttons need an open window; when
    // closed, the run stays unfinished and closes on the seller's next message.
    if (!optedOut && !open) return;
    await app.db.update(R).set({ finishedAt: new Date() }).where(eq(R.catalogueId, runId));
    if (optedOut) return;
    const failedPoseIds = jobs
      .filter((j) => j.status !== 'COMPLETED' && j.poseId)
      .map((j) => j.poseId as string);
    const out = await runConversation(
      app,
      { id: account.id, userId: account.userId, channel: account.channel, externalId: account.externalId },
      { type: 'runFinished', runId, images: run.jobIds.length, failedPoseIds },
      `run:${runId}`,
    );
    await sendMessages(app, wa, to, out);
  } finally {
    await app.redis.del(lock);
  }
}

export async function deliverPendingForAccount(app: FastifyInstance, wa: WhatsappClient, accountId: string) {
  const runs = await app.db
    .select({ id: R.catalogueId })
    .from(R)
    .where(and(eq(R.messagingAccountId, accountId), isNull(R.finishedAt)))
    .orderBy(asc(R.createdAt));
  for (const r of runs) await deliverRun(app, wa, r.id);
}

export async function deliveryTick(app: FastifyInstance, wa: WhatsappClient): Promise<void> {
  const runs = await app.db
    .select({ id: R.catalogueId })
    .from(R)
    .where(isNull(R.finishedAt))
    .orderBy(asc(R.createdAt))
    .limit(50);
  for (const r of runs) {
    // One bad run (a missing result object) must not stall everyone else's.
    await deliverRun(app, wa, r.id).catch((err) => app.log.error({ err, runId: r.id }, 'whatsapp delivery failed'));
  }
}
```

Check before running: the result object's real content type. If `job_outputs` stores webp results (`keys.output` defaults to png but accepts webp), read `headObject(key).contentType` and pass it to `uploadMedia` instead of the literal `'image/png'`.

- [ ] **Step 3: Write the integration test**

`apps/api/test/integration/whatsapp-delivery.test.ts`. Seed directly in the tables — no `createJob`: a user, a connected account, two `jobs` rows (one `COMPLETED` with a `job_outputs.resultKey` whose object you `putObject`, one `FAILED`), `job_inputs.poseId` for both, and a `messaging_runs` row with both job ids. Read the `jobs` / `job_inputs` / `job_outputs` columns in `packages/db/src/schema/jobs.ts` for the required (`notNull`) fields before writing the inserts; the sibling test `admin-jobs-delete-assets.test.ts` inserts the same three tables.

Cover these cases, each with a fresh account and run:

1. **Window open:** `lastInboundAt = now`. `deliverRun` → one `uploadMedia`, one image send, then the `runFinished` messages (the session must be in GENERATING with `runId` = the run for the engine to answer — seed the session with `saveSession` from plan 2 using a GENERATING session whose `runId` is the catalogue id). Assert `deliveredJobIds` has both ids, `finishedAt` is set, and the last text contains `1 of 2 images failed`.
2. **Twice is once:** call `deliverRun` again → no new sends.
3. **Window closed, template configured:** `lastInboundAt = 25 h ago`, env `WHATSAPP_RESULTS_TEMPLATE: 'catalog_images_ready'` (build a separate app with that override). Two `deliverRun` calls → exactly one `type: 'template'` send, no image sends, `readyNoticeSentAt` set, `finishedAt` null. Then set `lastInboundAt = now` and call `deliverPendingForAccount` → the image and the closing messages go out.
4. **Opted out:** `optedOutAt = now` → no sends at all, both jobs marked delivered, `finishedAt` set.
5. **Still running:** one job `PROCESSING` → only the finished one is delivered, `finishedAt` stays null.

Run: `npx vitest run --config vitest.integration.config.ts whatsapp-delivery` → PASS, 5 tests.

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/schema/messaging.ts packages/db/src/migrations apps/api/src/modules/messaging/delivery.ts apps/api/test/integration/whatsapp-delivery.test.ts
git commit -m "feat(api): deliver finished WhatsApp runs, with the 24-hour window handled"
```

---

### Task 8: Loops, hooks and an end-to-end check on staging

**Files:**
- Create: `apps/api/src/modules/messaging/inbound-consumer.ts`
- Modify: `apps/api/src/main.ts`
- Modify: `apps/api/src/modules/messaging/connect.routes.ts` (chat confirm → "Connected" + menu)
- Modify: `apps/api/src/modules/payments/routes.ts` (credits added)
- Create: `apps/api/src/modules/messaging/notify.ts`
- Test: `apps/api/test/integration/whatsapp-hooks.test.ts`

**Interfaces:**
- Produces: `startWhatsappInboundConsumer(app, wa)`, `startWhatsappDelivery(app, wa)`, `createAppWhatsappClient(app): WhatsappClient | null`, `notifyConnected(app, accountId)`, `notifyCreditsAdded(app, userId, credits)`.

- [ ] **Step 1: The consumer loop**

`apps/api/src/modules/messaging/inbound-consumer.ts`:

```ts
import { hostname } from 'node:os';
import type { FastifyInstance } from 'fastify';
import { createWhatsappClient, type WhatsappClient } from './channels/whatsapp/client.js';
import type { ParsedInbound } from './channels/whatsapp/parse.js';
import { deliverPendingForAccount, deliveryTick } from './delivery.js';
import { processInbound } from './inbound.js';
import { INBOUND_STREAM } from './webhook.routes.js';

const GROUP = 'messaging-inbound-cg';
const DELIVERY_INTERVAL_MS = 5_000;
type XReadGroupResult = Array<[string, Array<[string, string[]]>]> | null;

export function createAppWhatsappClient(app: FastifyInstance): WhatsappClient | null {
  const { WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN, WHATSAPP_GRAPH_VERSION } = app.env;
  if (!WHATSAPP_PHONE_NUMBER_ID || !WHATSAPP_ACCESS_TOKEN) return null;
  return createWhatsappClient({
    phoneNumberId: WHATSAPP_PHONE_NUMBER_ID,
    accessToken: WHATSAPP_ACCESS_TOKEN,
    graphVersion: WHATSAPP_GRAPH_VERSION,
  });
}

/**
 * One sender at a time across replicas: a per-sender lock, waited on briefly.
 * Two of one seller's messages handled at once would overwrite each other's
 * session (plan 2, conversation.ts).
 */
async function withSenderLock(app: FastifyInstance, from: string, fn: () => Promise<void>) {
  const key = `msg:lock:whatsapp:${from}`;
  for (let i = 0; i < 50; i++) {
    if ((await app.redis.set(key, '1', 'EX', 60, 'NX')) === 'OK') {
      try {
        return await fn();
      } finally {
        await app.redis.del(key);
      }
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('sender lock timeout');
}

/** Same consumer-group idiom as shopify/sync-consumer.ts. */
export function startWhatsappInboundConsumer(app: FastifyInstance, wa: WhatsappClient): () => void {
  const consumer = `${hostname()}-${process.pid}`;
  let running = true;

  async function loop() {
    try {
      await app.redisBlocking.xgroup('CREATE', INBOUND_STREAM, GROUP, '$', 'MKSTREAM');
    } catch (err) {
      if (!(err instanceof Error) || !err.message.includes('BUSYGROUP')) throw err;
    }
    while (running) {
      try {
        const result = (await app.redisBlocking.xreadgroup(
          'GROUP', GROUP, consumer, 'COUNT', '1', 'BLOCK', '5000', 'STREAMS', INBOUND_STREAM, '>',
        )) as XReadGroupResult;
        const entry = result?.[0]?.[1]?.[0];
        if (!entry) continue;
        const [id, fields] = entry;
        const raw = fields[fields.indexOf('msg') + 1];
        try {
          const m = JSON.parse(raw) as ParsedInbound;
          await withSenderLock(app, m.from, () => processInbound(app, wa, m, deliverPendingForAccount));
        } catch (err) {
          // Acked anyway: retrying a message that throws would loop forever.
          // The seller can simply send it again.
          app.log.error({ err, streamId: id }, 'whatsapp inbound message failed');
        }
        await app.redisBlocking.xack(INBOUND_STREAM, GROUP, id);
      } catch (err) {
        app.log.error({ err }, 'whatsapp inbound loop error — resuming');
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  loop().catch((err) => app.log.error({ err }, 'whatsapp inbound loop crashed'));
  return () => {
    running = false;
  };
}

/** setInterval + re-entrancy guard, like every other api background loop. */
export function startWhatsappDelivery(app: FastifyInstance, wa: WhatsappClient): () => void {
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await deliveryTick(app, wa);
    } catch (err) {
      app.log.error({ err }, 'whatsapp delivery tick failed');
    } finally {
      busy = false;
    }
  }, DELIVERY_INTERVAL_MS);
  return () => clearInterval(timer);
}
```

(Biome will reformat the long `xreadgroup` call; that is fine.)

- [ ] **Step 2: Start them in `main.ts`**

In `apps/api/src/main.ts`, after `startUnlimitedPlanReminderScheduler(app);`:

```ts
// WhatsApp catalog bot (plan 3). Started only when enabled AND fully configured,
// so a half-configured environment logs once instead of failing on every message.
if (app.env.MESSAGING_WHATSAPP_ENABLED === true) {
  const wa = createAppWhatsappClient(app);
  if (wa) {
    startWhatsappInboundConsumer(app, wa);
    startWhatsappDelivery(app, wa);
  } else {
    app.log.warn('MESSAGING_WHATSAPP_ENABLED is on but WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN are missing — bot not started');
  }
}
```

with the matching import from `./modules/messaging/inbound-consumer.js`.

Update `CLAUDE.md`'s "Background loops in the api process" table with two rows: `startWhatsappInboundConsumer` (continuous, `messaging:inbound` → `processInbound`) and `startWhatsappDelivery` (5 s, sends finished runs; template once when the window closed).

- [ ] **Step 3: The two hooks**

`apps/api/src/modules/messaging/notify.ts`:

```ts
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { runConversation } from './conversation.js';
import { COPY } from './engine/copy.js';
import type { InboundEvent, OutboundMessage } from './engine/types.js';
import { createAppWhatsappClient } from './inbound-consumer.js';
import { sendMessages, windowOpen } from './send.js';

const M = schema.messagingAccounts;

/** Best-effort pushes into a chat. A failure here must never fail the caller's request. */
async function push(app: FastifyInstance, accountId: string, build: (a: typeof M.$inferSelect) => Promise<OutboundMessage[]>) {
  try {
    if (app.env.MESSAGING_WHATSAPP_ENABLED !== true) return;
    const wa = createAppWhatsappClient(app);
    const [a] = await app.db.select().from(M).where(eq(M.id, accountId));
    // Only inside the window and never after STOP: these are free-form messages.
    if (!wa || !a || a.optedOutAt || !windowOpen(a.lastInboundAt)) return;
    await sendMessages(app, wa, a.externalId.slice(1), await build(a));
  } catch (err) {
    app.log.error({ err, accountId }, 'whatsapp push failed');
  }
}

const conv = (a: typeof M.$inferSelect) => ({ id: a.id, userId: a.userId, channel: a.channel, externalId: a.externalId });

/** Chat-started connect confirmed on the web: "Connected" + the menu. */
export function notifyConnected(app: FastifyInstance, accountId: string) {
  return push(app, accountId, async (a) => [
    { kind: 'text', text: COPY.connected },
    ...(await runConversation(app, conv(a), { type: 'text', text: 'menu' }, `connected:${a.id}`)),
  ]);
}

/** A purchase completed on the web: tell every connected chat, and resume a NO_CREDITS wizard. */
export async function notifyCreditsAdded(app: FastifyInstance, userId: string, credits: number) {
  if (app.env.MESSAGING_WHATSAPP_ENABLED !== true) return;
  const accounts = await app.db.select({ id: M.id }).from(M).where(eq(M.userId, userId));
  const event: InboundEvent = { type: 'creditsAdded', credits };
  for (const { id } of accounts) {
    await push(app, id, (a) => runConversation(app, conv(a), event, `credits:${Date.now()}`));
  }
}
```

In `connect.routes.ts`'s `/v1/messaging/connect/chat/confirm` handler, after `connectAccount`:

```ts
      // Fire-and-forget: the web response must not wait on Meta.
      void notifyConnected(app, account.id);
```

In `apps/api/src/modules/payments/routes.ts`, after each successful grant **commits** — in `/verify` after the `if (!credited) return …` line, and in the webhook after `if (webhookCredited) {` — add:

```ts
      void notifyCreditsAdded(app, req.userId, creditsGranted);
```

(webhook: `void notifyCreditsAdded(app, payment.userId, payment.credits);`). Read both call sites first: use the credit amount actually granted at each one (`grantPurchaseCredits`'s return value where it is captured, `payment.credits` otherwise). These are the only edits to payment code in the whole bot, and they are post-commit and best-effort.

- [ ] **Step 4: Hook tests**

`apps/api/test/integration/whatsapp-hooks.test.ts`: with `vi.mock('../../src/modules/messaging/inbound-consumer.js', …)` returning a `fakeWhatsapp().client` from `createAppWhatsappClient`, assert:
1. `notifyConnected` sends "Connected…" then the menu when `lastInboundAt` is recent, and sends nothing when it is 25 h old or `optedOutAt` is set.
2. `notifyCreditsAdded` on a session in `NO_CREDITS` (seed with `saveSession`) sends "N credits added." and a confirm prompt; with the flag off it sends nothing.

Run: `npx vitest run --config vitest.integration.config.ts whatsapp-hooks` → PASS.

Then the full api suites: `pnpm --filter @aivastra/api test`, `pnpm --filter @aivastra/api test:integration` (or at least every `messaging-*` and `whatsapp-*` file plus `payments`), `typecheck`, `lint`. Record counts.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/messaging apps/api/src/main.ts apps/api/src/modules/payments/routes.ts apps/api/test/integration/whatsapp-hooks.test.ts CLAUDE.md
git commit -m "feat(api): start the WhatsApp loops; connect and credit hooks"
```

- [ ] **Step 6: Staging end to end (manual)**

On staging, set in `.env.staging` (values via the VPS, never pasted into chat or the repo): `MESSAGING_WHATSAPP_ENABLED=true`, `WHATSAPP_DISPLAY_NUMBER=15556585373`, `WHATSAPP_PHONE_NUMBER_ID=1331723183359956`, `WHATSAPP_ACCESS_TOKEN` (temporary token is fine for this test; a system-user token before anything lasting), `WHATSAPP_APP_SECRET` (App settings → Basic), `WHATSAPP_VERIFY_TOKEN` (any random 32+ characters), `WHATSAPP_RESULTS_TEMPLATE=catalog_images_ready` once approved. Add the new names to `scripts/staging/check-staging-env.sh` if it lists required vars. Deploy through the normal pipeline (migrations `0224`–`0226` via CI/CD).

In the developer console → WhatsApp → Configuration: callback URL `https://<staging-admin-host>/v1/whatsapp/webhook`, the same verify token, subscribe `messages`. Then from the registered phone:

1. "hi" → connect link → log in on staging → confirm → "Connected" + menu arrive.
2. Send a garment photo → gender → type → shape → face carousel renders → template → confirm shows cost → Generate.
3. The image arrives; the follow-up buttons arrive; the run is in `/catalogs` on staging web; credits dropped by the quoted amount.
4. STOP → confirmation; send "hi" → menu again.
5. Settings → Connect WhatsApp from a second test phone → prefilled `CONNECT` code → "Connected".

Record the results, and the webhook configuration (URL, subscribed fields — not the verify token), in `docs/progress.md`.

---

### Task 9: Record decisions and progress

**Files:**
- Modify: `docs/superpowers/specs/2026-10-12-whatsapp-catalog-bot-design.md`
- Modify: `docs/progress.md`

- [ ] **Step 1: Spec**

Add D37 (polling delivery), D38 (upload results to Meta), D39 (10-minute window margin) to section 3, using the tables at the top of this plan. Replace the section 5 diagram's notifier/pub-sub branch with "delivery loop (5 s) over `messaging_runs`". Mark T1, T2 (if the spike answered it), T3, T6 and T8 closed in section 18 with the spike's findings and these values: dedupe 3 days, 30 messages per sender per minute, delivery in the api process.

- [ ] **Step 2: Progress and commit**

Dated `docs/progress.md` entry: what shipped, test counts, migration `0226`, the staging check results, the Meta dashboard state (callback URL, template name and approval status), and what remains before production: production number and display-name approval, system-user permanent token, business verification of Nice Interactive (Ram Kumar), production env values.

```bash
git add docs/superpowers/specs/2026-10-12-whatsapp-catalog-bot-design.md docs/progress.md
git commit -m "docs: WhatsApp bot plan 3 decisions (D37-D39) and progress"
```

---

## Self-review notes

- **Spec coverage:** webhook verification and signature (§4.5, §14) — Tasks 4–5; dedupe and durable stream (§5) — Task 5; per-sender rate limit (§14) — Task 6; unknown number → connect link, CONNECT code, profile hint (§7, D15, D29) — Task 6; STOP/START (D21) — Task 6; photo download, type check, two retries (§13) — Task 6; rendering incl. carousel and the 1-card fallback (§6, §9) — Task 3; delivery, 24-hour window, one template per run (§11, D26) — Task 7; failed jobs reported with Retry (§11) — Task 7 via plan 2's `runFinished`; credits added (§8) — Task 8; "Connected" after web confirm (§7) — Task 8; flag off (§13) — Tasks 5 and 8; secrets redaction (§14) — Task 2.
- **Written as instructions rather than full code, deliberately:** the delivery and hook integration tests (Task 7 Step 3, Task 8 Step 4) list exact cases and assertions but leave the `jobs` / `job_inputs` / `job_outputs` inserts to the implementer, because their required columns were not read while writing this plan. Everything else is complete code.
- **Depends on the spike:** the carousel card shape (Task 3) and the tap webhook shape (Task 4) — both coded to the documented/most likely form and flagged.
