import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deriveTokenSecret, signShopperToken } from '../src/modules/dev/shopper-policy.js';
import { buildTestApp, type TestApp } from './helpers/api.js';
import { type Containers, startContainers } from './helpers/containers.js';
import {
  createTestApiKey,
  createTestDevTryonCategory,
  createTestMerchant,
} from './helpers/merchant.js';

let c: Containers;
let app: TestApp;
let base: string;

const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
const now = () => Math.floor(Date.now() / 1000);

beforeAll(async () => {
  c = await startContainers();
  app = await buildTestApp(c);
  await app.ready();
  const addr = app.server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  await createTestDevTryonCategory(app, { slug: 'general' });
}, 60000);

afterAll(async () => {
  await app?.close();
  await c?.stop();
});

async function setup() {
  const m = await createTestMerchant(app, { balance: 100 });
  const full = await createTestApiKey(app, m.merchantId, {
    scope: 'full',
    integration: 'wordpress',
  });
  const widget = await createTestApiKey(app, m.merchantId, {
    scope: 'widget',
    integration: 'wordpress',
  });
  return { ...m, full: full.key, widget: widget.key };
}

const putPolicy = (key: string, body: unknown) =>
  fetch(`${base}/v1/dev/shopper-policy`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

function tryon(key: string, token?: string) {
  const fd = new FormData();
  fd.set('category', 'general');
  fd.set('person', new Blob([jpeg()], { type: 'image/jpeg' }), 'p.jpg');
  fd.set('garment', new Blob([jpeg()], { type: 'image/jpeg' }), 'g.jpg');
  return fetch(`${base}/v1/dev/tryon`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${key}`,
      ...(token ? { 'x-aivastra-shopper': token } : {}),
    },
    body: fd,
  });
}

describe('PUT/GET /v1/dev/shopper-policy', () => {
  it('stores the policy and returns a token secret to a full key only', async () => {
    const m = await setup();
    const res = await putPolicy(m.full, { loginRequired: true, perShopperCap: 3 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ loginRequired: true, perShopperCap: 3, windowHours: 24 });
    expect(body.tokenSecret).toBe(deriveTokenSecret(app.env.JWT_SECRET, m.merchantId, 1));

    const get = await fetch(`${base}/v1/dev/shopper-policy`, {
      headers: { authorization: `Bearer ${m.full}` },
    });
    expect((await get.json()).tokenSecret).toBe(body.tokenSecret);

    // The public widget key must never be able to read or write it.
    expect((await putPolicy(m.widget, { loginRequired: false, perShopperCap: null })).status).toBe(
      403,
    );
    const widgetGet = await fetch(`${base}/v1/dev/shopper-policy`, {
      headers: { authorization: `Bearer ${m.widget}` },
    });
    expect(widgetGet.status).toBe(403);
  });

  it('keeps the same secret across edits', async () => {
    const m = await setup();
    const a = await (await putPolicy(m.full, { loginRequired: false, perShopperCap: 1 })).json();
    const b = await (await putPolicy(m.full, { loginRequired: true, perShopperCap: 5 })).json();
    expect(b.tokenSecret).toBe(a.tokenSecret);
  });

  it('rejects an out-of-range cap', async () => {
    const m = await setup();
    expect((await putPolicy(m.full, { loginRequired: false, perShopperCap: 0 })).status).toBe(400);
  });
});

describe('POST /v1/dev/tryon with a shopper policy', () => {
  it('behaves exactly as before when the merchant has no policy', async () => {
    const m = await setup();
    expect((await tryon(m.widget)).status).toBe(202);
  });

  it('refuses a direct call with no token, even with the right widget key', async () => {
    const m = await setup();
    await putPolicy(m.full, { loginRequired: false, perShopperCap: 5 });
    const res = await tryon(m.widget);
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('SHOPPER_TOKEN_INVALID');
  });

  it('requires a logged-in token when login is required', async () => {
    const m = await setup();
    await putPolicy(m.full, { loginRequired: true, perShopperCap: null });
    const secret = deriveTokenSecret(app.env.JWT_SECRET, m.merchantId, 1);
    const guest = signShopperToken(secret, { sid: 'g:abc', lg: false, exp: now() + 600 });
    const member = signShopperToken(secret, { sid: 'u:7', lg: true, exp: now() + 600 });

    const refused = await tryon(m.widget, guest);
    expect(refused.status).toBe(403);
    expect((await refused.json()).error.code).toBe('LOGIN_REQUIRED');
    expect((await tryon(m.widget, member)).status).toBe(202);
  });

  it('enforces the per-shopper cap and charges nothing for refused attempts', async () => {
    const m = await setup();
    await putPolicy(m.full, { loginRequired: false, perShopperCap: 2 });
    const secret = deriveTokenSecret(app.env.JWT_SECRET, m.merchantId, 1);
    const member = signShopperToken(secret, { sid: 'u:9', lg: true, exp: now() + 600 });

    expect((await tryon(m.widget, member)).status).toBe(202);
    expect((await tryon(m.widget, member)).status).toBe(202);
    const third = await tryon(m.widget, member);
    expect(third.status).toBe(429);
    expect((await third.json()).error.code).toBe('SHOPPER_LIMIT');

    const [bal] = await app.db
      .select({ balance: schema.userCredits.balance })
      .from(schema.userCredits)
      .where(eq(schema.userCredits.userId, m.userId));
    expect(bal?.balance).toBeLessThan(100);

    // Another shopper still gets through.
    const other = signShopperToken(secret, { sid: 'u:10', lg: true, exp: now() + 600 });
    expect((await tryon(m.widget, other)).status).toBe(202);
  });

  it('a token minted for another merchant is not accepted', async () => {
    const a = await setup();
    const b = await setup();
    await putPolicy(a.full, { loginRequired: true, perShopperCap: null });
    const foreign = signShopperToken(deriveTokenSecret(app.env.JWT_SECRET, b.merchantId, 1), {
      sid: 'u:1',
      lg: true,
      exp: now() + 600,
    });
    expect((await tryon(a.widget, foreign)).status).toBe(403);
  });

  it("does not throttle the merchant's own full-scope key", async () => {
    const m = await setup();
    await putPolicy(m.full, { loginRequired: true, perShopperCap: 1 });
    expect((await tryon(m.full)).status).toBe(202);
  });

  it('returns the quota slot when the job cannot be created', async () => {
    const m = await setup();
    await putPolicy(m.full, { loginRequired: false, perShopperCap: 1 });
    const secret = deriveTokenSecret(app.env.JWT_SECRET, m.merchantId, 1);
    const member = signShopperToken(secret, { sid: 'u:11', lg: true, exp: now() + 600 });

    await m.credits(0);
    expect((await tryon(m.widget, member)).status).toBe(402);
    await m.credits(100);
    expect((await tryon(m.widget, member)).status).toBe(202);
  });
});

describe('POST /v1/dev/tryon with personKey (reuse a previous photo)', () => {
  const tryonWith = (key: string, fields: Record<string, string>, withPerson = false) => {
    const fd = new FormData();
    fd.set('category', 'general');
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    if (withPerson) fd.set('person', new Blob([jpeg()], { type: 'image/jpeg' }), 'p.jpg');
    fd.set('garment', new Blob([jpeg()], { type: 'image/jpeg' }), 'g.jpg');
    return fetch(`${base}/v1/dev/tryon`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}` },
      body: fd,
    });
  };

  it('reuses the photo a previous try-on uploaded, without re-sending it', async () => {
    const m = await setup();
    const first = await tryon(m.widget);
    expect(first.status).toBe(202);
    const { personKey } = await first.json();

    const again = await tryonWith(m.widget, { personKey });
    expect(again.status).toBe(202);
    const body = await again.json();
    expect(body.personKey).toBe(personKey);

    const [input] = await app.db
      .select({ params: schema.jobInputs.params })
      .from(schema.jobInputs)
      .where(eq(schema.jobInputs.jobId, body.jobId));
    expect((input?.params as { personKey?: string }).personKey).toBe(personKey);
  });

  it("refuses another merchant's photo key, an unknown key, and both inputs at once", async () => {
    const a = await setup();
    const b = await setup();
    const { personKey: bKey } = await (await tryon(b.widget)).json();

    const foreign = await tryonWith(a.widget, { personKey: bKey });
    expect(foreign.status).toBe(404);
    expect((await foreign.json()).error.code).toBe('PHOTO_NOT_AVAILABLE');

    const unknown = await tryonWith(a.widget, {
      personKey: `dev/${a.merchantId}/00000000-0000-0000-0000-000000000000.jpg`,
    });
    expect(unknown.status).toBe(404);

    const { personKey: aKey } = await (await tryon(a.widget)).json();
    const both = await tryonWith(a.widget, { personKey: aKey }, true);
    expect(both.status).toBe(400);
  });

  it('charges nothing when the reused photo is refused', async () => {
    const m = await setup();
    const [before] = await app.db
      .select({ balance: schema.userCredits.balance })
      .from(schema.userCredits)
      .where(eq(schema.userCredits.userId, m.userId));
    await tryonWith(m.widget, { personKey: `dev/${m.merchantId}/nope.jpg` });
    const [after] = await app.db
      .select({ balance: schema.userCredits.balance })
      .from(schema.userCredits)
      .where(eq(schema.userCredits.userId, m.userId));
    expect(after?.balance).toBe(before?.balance);
  });
});

describe('POST /v1/dev/widget-event productId', () => {
  it('accepts the numeric string WordPress sends as well as a number', async () => {
    const m = await setup();
    for (const productId of ['873', 873]) {
      const res = await fetch(`${base}/v1/dev/widget-event`, {
        method: 'POST',
        headers: { authorization: `Bearer ${m.widget}`, 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'button_click', productId }),
      });
      expect(res.status).toBe(202);
    }
    const rows = await app.db
      .select({ productId: schema.merchantWidgetEvents.productId })
      .from(schema.merchantWidgetEvents)
      .where(eq(schema.merchantWidgetEvents.merchantId, m.merchantId));
    expect(rows.map((r) => r.productId)).toEqual([873, 873]);
  });

  it('still rejects a non-numeric productId', async () => {
    const m = await setup();
    const res = await fetch(`${base}/v1/dev/widget-event`, {
      method: 'POST',
      headers: { authorization: `Bearer ${m.widget}`, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'button_click', productId: 'abc' }),
    });
    expect(res.status).toBe(400);
  });
});
