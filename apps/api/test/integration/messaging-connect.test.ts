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
const uniq = () =>
  Math.floor(Math.random() * 1e9)
    .toString()
    .padStart(9, '0');
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
