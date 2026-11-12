import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { handleCrmEntry } from '../../src/modules/crm/consumer';
import { decryptPhone, phoneHash, sealSecret } from '../../src/modules/crm/crypto';
import { CRM_INBOUND_STREAM } from '../../src/modules/crm/inbound';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';
import { createTestBranch, createTestDevice, createTestMerchant } from '../helpers/merchant';

// CRM phase 2, plan Tasks 4–5: tablet code → shopper's LOOKS message on the brand's number →
// consent → looks. Graph is stubbed through app.crmFetch; the webhook, stream entry, consumer
// handler and database are real.

const CRM_DATA_KEY = randomBytes(32).toString('base64');
const SHOPPER = '919812345678';
let c: Containers;
let app: TestApp;

// Every message the API sent from a merchant number: [phoneNumberId, payload].
let sent: Array<{ pnid: string; to: string; body: Record<string, unknown> }> = [];

beforeAll(async () => {
  c = await startContainers();
  app = await buildTestApp(c, { CRM_DATA_KEY, CRM_IDENTIFY_ENABLED: true });
  app.crmFetch = (async (url: string, init?: RequestInit) => {
    const m = /\/(\d+)\/messages$/.exec(String(url));
    if (m && init?.body) {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      sent.push({ pnid: m[1]!, to: String(body.to), body });
      return new Response(JSON.stringify({ messages: [{ id: `wamid.${sent.length}` }] }));
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
}, 60_000);

afterAll(async () => {
  await app?.close();
  await c?.stop();
});

beforeEach(() => {
  sent = [];
});

let pnidSeq = 700_000_000;
async function connectedMerchant(opts: { retention?: boolean; channel?: boolean } = {}) {
  const m = await createTestMerchant(app);
  const branch = await createTestBranch(app, m.merchantId);
  const device = await createTestDevice(app, m.merchantId, branch.id);
  const phoneNumberId = String(++pnidSeq);
  const appSecret = `secret-${randomUUID()}`;
  if (opts.channel !== false) {
    await app.db.insert(schema.merchantWhatsappChannels).values({
      merchantId: m.merchantId,
      wabaId: '1020304050',
      phoneNumberId,
      displayNumber: '919900011122',
      accessTokenEnc: sealSecret(CRM_DATA_KEY, 'EAAG-merchant-token'),
      appSecretEnc: sealSecret(CRM_DATA_KEY, appSecret),
    });
  }
  if (opts.retention !== false) {
    await app.db.insert(schema.merchantCrmSettings).values({
      merchantId: m.merchantId,
      photoRetentionDays: 90,
      profileRetentionDays: 365,
    });
  }
  const s = await app.inject({
    method: 'POST',
    url: '/v1/device/sessions',
    headers: device.auth,
    payload: { mode: 'kiosk' },
  });
  return { m, branch, device, phoneNumberId, appSecret, sessionId: s.json().id as string };
}
type Ctx = Awaited<ReturnType<typeof connectedMerchant>>;

const identify = (ctx: Ctx) =>
  app.inject({
    method: 'POST',
    url: `/v1/device/sessions/${ctx.sessionId}/identify`,
    headers: ctx.device.auth,
  });
const status = async (ctx: Ctx) =>
  (
    await app.inject({
      method: 'GET',
      url: `/v1/device/sessions/${ctx.sessionId}/identify`,
      headers: ctx.device.auth,
    })
  ).json().status;

let msgSeq = 0;
function webhookBody(phoneNumberId: string, message: Record<string, unknown>, from = SHOPPER) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '919900011122', phone_number_id: phoneNumberId },
              contacts: [{ wa_id: from, profile: { name: 'Priya' } }],
              messages: [{ id: `wamid.in.${++msgSeq}`, from, timestamp: '1', ...message }],
            },
          },
        ],
      },
    ],
  };
}
const textMsg = (body: string) => ({ type: 'text', text: { body } });
const buttonMsg = (id: string) => ({
  type: 'interactive',
  interactive: { type: 'button_reply', button_reply: { id, title: 'x' } },
});

async function postWebhook(body: unknown, secret: string) {
  const raw = Buffer.from(JSON.stringify(body));
  const sig = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
  return app.inject({
    method: 'POST',
    url: '/v1/whatsapp/webhook',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig },
    payload: raw,
  });
}

/** Delivers a shopper message end to end: webhook → stream → consumer handler. */
async function shopperSays(ctx: Ctx, message: Record<string, unknown>, from = SHOPPER) {
  const before = await app.redis.xlen(CRM_INBOUND_STREAM);
  const res = await postWebhook(webhookBody(ctx.phoneNumberId, message, from), ctx.appSecret);
  expect(res.statusCode).toBe(200);
  const entries = await app.redis.xrange(CRM_INBOUND_STREAM, '-', '+');
  expect(entries.length).toBe(before + 1);
  await handleCrmEntry(app, entries[entries.length - 1]![1]);
}

async function completedJob(ctx: Ctx) {
  const [job] = await app.db
    .insert(schema.jobs)
    .values({
      merchantId: ctx.m.merchantId,
      userId: ctx.m.userId,
      status: 'COMPLETED',
      creditsCharged: 5,
      source: 'merchant_tryon',
      sessionId: ctx.sessionId,
      branchId: ctx.branch.id,
      deviceId: ctx.device.deviceId,
      completedAt: new Date(),
    })
    .returning();
  await app.db
    .insert(schema.jobOutputs)
    .values({ jobId: job!.id, resultKey: `results/${job!.id}.png` });
}

const eventsOf = async (sessionId: string) =>
  (
    await app.db
      .select({ event: schema.analyticsEvents.event, shopperId: schema.analyticsEvents.shopperId })
      .from(schema.analyticsEvents)
      .where(eq(schema.analyticsEvents.sessionId, sessionId))
      .orderBy(asc(schema.analyticsEvents.receivedAt))
  ).map((e) => e.event);

describe('identify start', () => {
  it('without a channel or retention the tablet gets 409 with the QR fallback', async () => {
    for (const opts of [{ channel: false }, { retention: false }]) {
      const ctx = await connectedMerchant(opts);
      const res = await identify(ctx);
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ error: { code: 'IDENTIFY_UNAVAILABLE' }, fallback: 'qr' });
    }
  });

  it("returns a code and a wa.me link to the brand's number; another device gets 404", async () => {
    const ctx = await connectedMerchant();
    const res = await identify(ctx);
    expect(res.statusCode).toBe(200);
    const { code, waLink } = res.json() as { code: string; waLink: string };
    expect(code).toMatch(/^[A-Z2-9]{8}$/);
    expect(waLink).toBe(`https://wa.me/919900011122?text=LOOKS%20${code}`);
    expect(await status(ctx)).toBe('pending');
    const other = await createTestDevice(app, ctx.m.merchantId, ctx.branch.id);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/v1/device/sessions/${ctx.sessionId}/identify`,
          headers: other.auth,
        })
      ).statusCode,
    ).toBe(404);
  });
});

describe('webhook routing', () => {
  it("a merchant number's webhook signed with the wrong secret is 401 and queues nothing", async () => {
    const ctx = await connectedMerchant();
    const before = await app.redis.xlen(CRM_INBOUND_STREAM);
    const res = await postWebhook(webhookBody(ctx.phoneNumberId, textMsg('hi')), 'not-the-secret');
    expect(res.statusCode).toBe(401);
    expect(await app.redis.xlen(CRM_INBOUND_STREAM)).toBe(before);
  });

  it('a body for any other number is not routed to the CRM stream', async () => {
    const before = await app.redis.xlen(CRM_INBOUND_STREAM);
    const res = await postWebhook(webhookBody('111111111', textMsg('hi')), 'whatever');
    // Seller lane is off in this test app: acknowledged, nothing queued anywhere CRM.
    expect(res.statusCode).toBe(200);
    expect(await app.redis.xlen(CRM_INBOUND_STREAM)).toBe(before);
  });

  it('a redelivered message is queued once', async () => {
    const ctx = await connectedMerchant();
    const body = webhookBody(ctx.phoneNumberId, textMsg('hi'));
    const before = await app.redis.xlen(CRM_INBOUND_STREAM);
    await postWebhook(body, ctx.appSecret);
    await postWebhook(body, ctx.appSecret);
    expect(await app.redis.xlen(CRM_INBOUND_STREAM)).toBe(before + 1);
  });
});

describe('shopper conversation', () => {
  it('LOOKS <code> identifies the shopper, links the session and asks for consent', async () => {
    const ctx = await connectedMerchant();
    const { code } = (await identify(ctx)).json() as { code: string };
    await shopperSays(ctx, textMsg(`LOOKS ${code}`));

    const [shopper] = await app.db
      .select()
      .from(schema.shoppers)
      .where(eq(schema.shoppers.merchantId, ctx.m.merchantId));
    expect(shopper!.phoneHash).toBe(phoneHash(CRM_DATA_KEY, SHOPPER));
    expect(shopper!.phoneEnc).not.toContain(SHOPPER);
    expect(decryptPhone(CRM_DATA_KEY, shopper!.phoneEnc!)).toBe(SHOPPER);
    const [s] = await app.db
      .select()
      .from(schema.instoreSessions)
      .where(eq(schema.instoreSessions.id, ctx.sessionId));
    expect(s!.shopperId).toBe(shopper!.id);
    expect(await status(ctx)).toBe('verified');

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ pnid: ctx.phoneNumberId, to: SHOPPER });
    const buttons = (
      sent[0]!.body.interactive as { action: { buttons: { reply: { id: string } }[] } }
    ).action.buttons.map((b) => b.reply.id);
    expect(buttons).toEqual(['crm_consent:looks', 'crm_consent:both']);
    expect(await eventsOf(ctx.sessionId)).toContain('shopper_identified');
  });

  it('a code works once; a second use and a garbage code get "expired"', async () => {
    const ctx = await connectedMerchant();
    const { code } = (await identify(ctx)).json() as { code: string };
    await shopperSays(ctx, textMsg(`LOOKS ${code}`));
    sent = [];
    await shopperSays(ctx, textMsg(`LOOKS ${code}`), '919800000001');
    await shopperSays(ctx, textMsg('LOOKS ZZZZZZZZ'), '919800000002');
    expect(sent.map((x) => (x.body.text as { body: string }).body)).toEqual([
      'This code has expired. Ask the store to show the QR again.',
      'This code has expired. Ask the store to show the QR again.',
    ]);
    const shoppers = await app.db
      .select()
      .from(schema.shoppers)
      .where(eq(schema.shoppers.merchantId, ctx.m.merchantId));
    expect(shoppers).toHaveLength(1);
  });

  it("a code minted for one brand cannot be redeemed through another brand's number", async () => {
    const a = await connectedMerchant();
    const b = await connectedMerchant();
    const { code } = (await identify(a)).json() as { code: string };
    await shopperSays(b, textMsg(`LOOKS ${code}`));
    expect((sent[0]!.body.text as { body: string }).body).toMatch(/expired/);
    const [s] = await app.db
      .select()
      .from(schema.instoreSessions)
      .where(eq(schema.instoreSessions.id, a.sessionId));
    expect(s!.shopperId).toBeNull();
  });

  it("consent 'Looks + offers' records both consents and sends this session's finished looks", async () => {
    const ctx = await connectedMerchant();
    await completedJob(ctx);
    const elsewhere = await connectedMerchant();
    await completedJob(elsewhere);
    const { code } = (await identify(ctx)).json() as { code: string };
    await shopperSays(ctx, textMsg(`LOOKS ${code}`));
    sent = [];
    await shopperSays(ctx, buttonMsg('crm_consent:both'));

    const consents = await app.db
      .select()
      .from(schema.shopperConsents)
      .where(eq(schema.shopperConsents.merchantId, ctx.m.merchantId));
    expect(consents.map((x) => [x.kind, x.granted, x.version]).sort()).toEqual([
      ['looks', true, 'v0-draft'],
      ['marketing', true, 'v0-draft'],
    ]);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body.type).toBe('image');
    expect(await eventsOf(ctx.sessionId)).toEqual(
      expect.arrayContaining(['shopper_identified', 'consent_recorded', 'looks_sent']),
    );
  });

  it("'Just my looks' records marketing as NOT granted; STOP appends a withdrawal", async () => {
    const ctx = await connectedMerchant();
    const { code } = (await identify(ctx)).json() as { code: string };
    await shopperSays(ctx, textMsg(`LOOKS ${code}`));
    await shopperSays(ctx, buttonMsg('crm_consent:looks'));
    await shopperSays(ctx, textMsg('STOP'));
    const marketing = await app.db
      .select({ granted: schema.shopperConsents.granted, source: schema.shopperConsents.source })
      .from(schema.shopperConsents)
      .where(
        and(
          eq(schema.shopperConsents.merchantId, ctx.m.merchantId),
          eq(schema.shopperConsents.kind, 'marketing'),
        ),
      )
      .orderBy(asc(schema.shopperConsents.createdAt));
    expect(marketing).toEqual([
      { granted: false, source: 'whatsapp_button' },
      { granted: false, source: 'whatsapp_stop' },
    ]);
  });

  it('no finished looks yet: says so, and SEND delivers them once ready', async () => {
    const ctx = await connectedMerchant();
    const { code } = (await identify(ctx)).json() as { code: string };
    await shopperSays(ctx, textMsg(`LOOKS ${code}`));
    sent = [];
    await shopperSays(ctx, buttonMsg('crm_consent:looks'));
    expect((sent[0]!.body.text as { body: string }).body).toMatch(/Reply SEND/);
    await completedJob(ctx);
    sent = [];
    await shopperSays(ctx, textMsg('send'));
    expect(sent.map((x) => x.body.type)).toEqual(['image']);
  });

  it('a returning shopper at the same brand is the same record', async () => {
    const ctx = await connectedMerchant();
    const first = (await identify(ctx)).json().code as string;
    await shopperSays(ctx, textMsg(`LOOKS ${first}`));
    const again = await app.inject({
      method: 'POST',
      url: '/v1/device/sessions',
      headers: ctx.device.auth,
      payload: { mode: 'kiosk' },
    });
    const ctx2 = { ...ctx, sessionId: again.json().id as string };
    const second = (await identify(ctx2)).json().code as string;
    await shopperSays(ctx2, textMsg(`LOOKS ${second}`));
    const shoppers = await app.db
      .select()
      .from(schema.shoppers)
      .where(eq(schema.shoppers.merchantId, ctx.m.merchantId));
    expect(shoppers).toHaveLength(1);
  });
});
