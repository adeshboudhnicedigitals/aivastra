import { randomBytes } from 'node:crypto';
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openSecret } from '../../src/modules/crm/crypto';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';
import {
  createTestBranch,
  createTestMerchant,
  createTestStaff,
  memberAuthHeader,
} from '../helpers/merchant';

// CRM phase 2, plan Task 3: connecting the brand's WhatsApp number and choosing retention.

const CRM_DATA_KEY = randomBytes(32).toString('base64');
let c: Containers;
let app: TestApp;

// Graph stub: a phone number id is valid for exactly one token.
const GOOD_TOKEN = 'EAAG-good-token-0123456789';
let graphCalls: string[] = [];
function stubGraph(url: string, init?: RequestInit): Response {
  graphCalls.push(url);
  const auth = new Headers(init?.headers).get('authorization');
  if (auth !== `Bearer ${GOOD_TOKEN}`) {
    return new Response(
      JSON.stringify({ error: { message: 'Invalid OAuth access token - app Foo' } }),
      {
        status: 401,
      },
    );
  }
  return new Response(JSON.stringify({ display_phone_number: '+91 98765 43210', id: 'x' }));
}

beforeAll(async () => {
  c = await startContainers();
  app = await buildTestApp(c, { CRM_DATA_KEY, CRM_IDENTIFY_ENABLED: true });
  app.crmFetch = (async (url: string, init?: RequestInit) =>
    stubGraph(String(url), init)) as typeof fetch;
}, 60_000);

afterAll(async () => {
  await app?.close();
  await c?.stop();
});

const body = (phoneNumberId: string, accessToken = GOOD_TOKEN) => ({
  wabaId: '102030405060',
  phoneNumberId,
  accessToken,
  appSecret: 'app-secret-0123456789abcdef',
});
const req = (method: string, url: string, headers: Record<string, string>, payload?: unknown) =>
  app.inject({ method: method as 'GET', url, headers, ...(payload ? { payload } : {}) });

async function admin() {
  const m = await createTestMerchant(app);
  return { m, auth: await memberAuthHeader(app, m.userId) };
}
const pnid = () => String(100_000_000 + Math.floor(Math.random() * 899_999_999));

describe('WhatsApp channel connect', () => {
  it('verifies with Meta, stores sealed secrets, and never returns them', async () => {
    const { m, auth } = await admin();
    const id = pnid();
    const put = await req('PUT', '/v1/merchant/whatsapp-channel', auth, body(id));
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({
      connected: true,
      phoneNumberId: id,
      displayNumber: '919876543210',
    });
    expect(put.body).not.toContain(GOOD_TOKEN);
    expect(put.body).not.toContain('app-secret');

    const [row] = await app.db
      .select()
      .from(schema.merchantWhatsappChannels)
      .where(eq(schema.merchantWhatsappChannels.merchantId, m.merchantId));
    expect(row!.accessTokenEnc).not.toContain(GOOD_TOKEN);
    expect(openSecret(CRM_DATA_KEY, row!.accessTokenEnc)).toBe(GOOD_TOKEN);

    const got = await req('GET', '/v1/merchant/whatsapp-channel', auth);
    expect(got.json()).toMatchObject({ connected: true, displayNumber: '919876543210' });
    expect(got.body).not.toContain(GOOD_TOKEN);

    const [audit] = await app.db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.action, 'merchant_whatsapp_channel.connect'));
    expect(JSON.stringify(audit)).not.toContain(GOOD_TOKEN);
  });

  it('a token Meta rejects is a 422, stores nothing and does not echo Meta', async () => {
    const { m, auth } = await admin();
    const res = await req(
      'PUT',
      '/v1/merchant/whatsapp-channel',
      auth,
      body(pnid(), 'EAAG-bad-token-0123456789'),
    );
    expect(res.statusCode).toBe(422);
    expect(res.body).not.toContain('app Foo');
    const rows = await app.db
      .select()
      .from(schema.merchantWhatsappChannels)
      .where(eq(schema.merchantWhatsappChannels.merchantId, m.merchantId));
    expect(rows).toHaveLength(0);
  });

  it('a number connected to another merchant is a 409, checked before calling Meta', async () => {
    const a = await admin();
    const b = await admin();
    const id = pnid();
    expect((await req('PUT', '/v1/merchant/whatsapp-channel', a.auth, body(id))).statusCode).toBe(
      200,
    );
    graphCalls = [];
    expect((await req('PUT', '/v1/merchant/whatsapp-channel', b.auth, body(id))).statusCode).toBe(
      409,
    );
    expect(graphCalls).toHaveLength(0);
  });

  it('staff cannot read or change the channel', async () => {
    const { m } = await admin();
    const branch = await createTestBranch(app, m.merchantId);
    const staff = await createTestStaff(app, m.merchantId, branch.id);
    expect((await req('GET', '/v1/merchant/whatsapp-channel', staff.auth)).statusCode).toBe(403);
    expect(
      (await req('PUT', '/v1/merchant/whatsapp-channel', staff.auth, body(pnid()))).statusCode,
    ).toBe(403);
    expect(
      (
        await req('PUT', '/v1/merchant/crm-settings', staff.auth, {
          identifyAt: 'end',
          photoRetentionDays: 30,
          profileRetentionDays: 365,
        })
      ).statusCode,
    ).toBe(403);
  });

  it('disconnect removes the channel', async () => {
    const { auth } = await admin();
    await req('PUT', '/v1/merchant/whatsapp-channel', auth, body(pnid()));
    expect((await req('DELETE', '/v1/merchant/whatsapp-channel', auth)).statusCode).toBe(204);
    expect((await req('GET', '/v1/merchant/whatsapp-channel', auth)).json().connected).toBe(false);
  });
});

describe('CRM settings', () => {
  it('identification is blocked until a channel AND both retention periods exist', async () => {
    const { auth } = await admin();
    const blockers = async () =>
      (await req('GET', '/v1/merchant/crm-settings', auth)).json().identification;
    expect(await blockers()).toEqual({ enabled: false, blockers: ['no_channel', 'no_retention'] });

    await req('PUT', '/v1/merchant/whatsapp-channel', auth, body(pnid()));
    expect(await blockers()).toEqual({ enabled: false, blockers: ['no_retention'] });

    const put = await req('PUT', '/v1/merchant/crm-settings', auth, {
      identifyAt: 'end',
      photoRetentionDays: 90,
      profileRetentionDays: 730,
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({
      photoRetentionDays: 90,
      profileRetentionDays: 730,
      identification: { enabled: true, blockers: [] },
    });
  });

  it('rejects retention outside the bounds', async () => {
    const { auth } = await admin();
    for (const bad of [
      { photoRetentionDays: 0, profileRetentionDays: 365 },
      { photoRetentionDays: 400, profileRetentionDays: 365 },
      { photoRetentionDays: 30, profileRetentionDays: 10 },
    ]) {
      expect(
        (await req('PUT', '/v1/merchant/crm-settings', auth, { identifyAt: 'end', ...bad }))
          .statusCode,
      ).toBe(400);
    }
  });

  it('with the feature flag off, identification stays off whatever the merchant set', async () => {
    const off = await buildTestApp(c, { CRM_DATA_KEY });
    try {
      const m = await createTestMerchant(off);
      const auth = await memberAuthHeader(off, m.userId);
      const res = await off.inject({
        method: 'GET',
        url: '/v1/merchant/crm-settings',
        headers: auth,
      });
      expect(res.json().identification.blockers).toContain('feature_off');
    } finally {
      await off.close();
    }
  });
});
