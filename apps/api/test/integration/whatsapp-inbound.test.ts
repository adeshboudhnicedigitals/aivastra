import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ParsedInbound } from '../../src/modules/messaging/channels/whatsapp/parse';
import { COPY } from '../../src/modules/messaging/engine/copy';
import {
  CHANNEL_WHATSAPP,
  connectAccount,
  createWebConnectCode,
} from '../../src/modules/messaging/identity';
import { processInbound } from '../../src/modules/messaging/inbound';
import { readTimeline } from '../../src/modules/messaging/trace';
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
    await processInbound(
      app,
      wa.client,
      msg(from, { kind: 'image', mediaId: 'm', mimeType: 'image/jpeg' }),
      noPending,
    );
    expect(wa.sent).toHaveLength(1);
    // A CTA URL button, not a pasted link: the token stays out of the chat text.
    expect(wa.texts()[0]).toMatch(/^Welcome to Ai Vastra/);
    expect(wa.sent[0].payload).toMatchObject({
      interactive: {
        type: 'cta_url',
        action: {
          parameters: { url: expect.stringMatching(/^https:\/\/app\.test\/connect\/whatsapp\?t=/) },
        },
      },
    });
    expect(wa.uploads).toHaveLength(0);
  });

  it('CONNECT <code> from an unknown number connects it and shows the menu', async () => {
    const wa = fakeWhatsapp();
    const { userId } = await createVerifiedUserToken(app, `wa-in-${seq}-${Date.now()}@example.com`);
    await app.db
      .update(schema.users)
      .set({ phone: '9000001234' })
      .where(eq(schema.users.id, userId));
    const code = await createWebConnectCode(app.redis, userId);
    const from = waId();
    await processInbound(
      app,
      wa.client,
      msg(from, { kind: 'text', text: `CONNECT ${code}` }),
      noPending,
    );

    const [row] = await app.db
      .select()
      .from(schema.messagingAccounts)
      .where(eq(schema.messagingAccounts.externalId, `+${from}`));
    expect(row).toMatchObject({ userId, linkedVia: 'web_code' });
    expect(row.lastInboundAt).not.toBeNull();
    const t = wa.texts();
    expect(t[0]).toMatch(/^You're connected!/);
    expect(t[1]).toMatch(/ending 1234/);
    expect(t.at(-1)).toBe(COPY.menu);
  });

  it('an expired code is refused', async () => {
    const wa = fakeWhatsapp();
    await processInbound(
      app,
      wa.client,
      msg(waId(), { kind: 'text', text: 'CONNECT ZZZZ2222' }),
      noPending,
    );
    expect(wa.texts()).toEqual([expect.stringMatching(/expired or was already used/)]);
  });

  it('STOP silences the number; the next message turns it back on', async () => {
    const { userId } = await createVerifiedUserToken(
      app,
      `wa-stop-${seq}-${Date.now()}@example.com`,
    );
    const from = waId();
    const { account } = await connectAccount(app.db, {
      channel: CHANNEL_WHATSAPP,
      externalId: `+${from}`,
      userId,
      linkedVia: 'chat_link',
    });
    const wa = fakeWhatsapp();
    await processInbound(app, wa.client, msg(from, { kind: 'text', text: 'STOP' }), noPending);
    expect(wa.texts()).toEqual([expect.stringMatching(/^Paused\./)]);
    let [row] = await app.db
      .select()
      .from(schema.messagingAccounts)
      .where(eq(schema.messagingAccounts.id, account.id));
    expect(row.optedOutAt).not.toBeNull();

    await processInbound(app, wa.client, msg(from, { kind: 'text', text: 'START' }), noPending);
    [row] = await app.db
      .select()
      .from(schema.messagingAccounts)
      .where(eq(schema.messagingAccounts.id, account.id));
    expect(row.optedOutAt).toBeNull();
    expect(wa.texts().at(-1)).toBe(COPY.menu);
  });

  it('a connected number reaches the engine and pending deliveries run first', async () => {
    const { userId } = await createVerifiedUserToken(
      app,
      `wa-eng-${seq}-${Date.now()}@example.com`,
    );
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
    expect(wa.texts().at(-1)).toBe(COPY.menu);
  });

  it('a photo is downloaded, stored as an owned upload and handed to the engine', async () => {
    const { userId } = await createVerifiedUserToken(
      app,
      `wa-img-${seq}-${Date.now()}@example.com`,
    );
    const from = waId();
    await connectAccount(app.db, {
      channel: CHANNEL_WHATSAPP,
      externalId: `+${from}`,
      userId,
      linkedVia: 'chat_link',
    });
    const wa = fakeWhatsapp({ m1: { bytes: Buffer.from('jpeg'), mimeType: 'image/jpeg' } });
    await processInbound(
      app,
      wa.client,
      msg(from, { kind: 'image', mediaId: 'm1', mimeType: 'image/jpeg' }),
      noPending,
    );
    // Photo from the main menu → the engine asks for gender next.
    expect(wa.texts().at(-1)).toBe('Who is this catalogue for?');
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
});
