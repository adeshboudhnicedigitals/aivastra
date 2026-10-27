import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

const SECRET = 'app-secret-0123456789abcdef';
const VERIFY = 'verify-token-0123456789';
// Unique per run: pooled Redis indices are reused across runs without a flush,
// and the seen-keys carry a 3-day TTL — a fixed message id would be treated as
// a redelivery of an earlier run and never enqueued.
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const sign = (raw: string) => `sha256=${createHmac('sha256', SECRET).update(raw).digest('hex')}`;
const payload = (id: string) =>
  JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        changes: [
          {
            field: 'messages',
            value: { messages: [{ from: '919100000001', id, type: 'text', text: { body: 'hi' } }] },
          },
        ],
      },
    ],
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
    const raw = payload(`wamid.dup-1-${runId}`);
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

  it('remembers delivered and read receipts, not sent or failed, and enqueues nothing', async () => {
    const before = await streamLength();
    const id = (n: string) => `wamid.out-${n}-${runId}`;
    const raw = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                statuses: [
                  { id: id('sent'), status: 'sent' },
                  { id: id('delivered'), status: 'delivered' },
                  { id: id('read'), status: 'read' },
                  { id: id('failed'), status: 'failed' },
                ],
              },
            },
          ],
        },
      ],
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/whatsapp/webhook',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(raw) },
      payload: raw,
    });
    expect(res.statusCode).toBe(200);
    const stored = (n: string) => app.redis.get(`msg:status:whatsapp:${id(n)}`);
    expect(await stored('delivered')).toBe('delivered');
    expect(await stored('read')).toBe('read');
    expect(await stored('sent')).toBeNull();
    expect(await stored('failed')).toBeNull();
    expect(await streamLength()).toBe(before);
  });

  it('rejects a badly signed request with 401 and enqueues nothing', async () => {
    const before = await streamLength();
    const raw = payload(`wamid.bad-1-${runId}`);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/whatsapp/webhook',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=00' },
      payload: raw,
    });
    expect(res.statusCode).toBe(401);
    expect(await streamLength()).toBe(before);
  });

  it('checks the signature before parsing: bad signature on a garbage body is still 401', async () => {
    const before = await streamLength();
    const raw = 'not-json{{{';
    const res = await app.inject({
      method: 'POST',
      url: '/v1/whatsapp/webhook',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=00' },
      payload: raw,
    });
    // Had the body been parsed first, JSON.parse would have thrown a 500.
    expect(res.statusCode).toBe(401);
    expect(await streamLength()).toBe(before);
  });

  it('acks a signed-but-unusable payload with 200 and enqueues nothing', async () => {
    const before = await streamLength();
    const raw = 'not-json{{{';
    const res = await app.inject({
      method: 'POST',
      url: '/v1/whatsapp/webhook',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(raw) },
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
    // Delta, not absolute 0: startContainers re-claims a pooled Redis index
    // whose streams keep data from earlier describes (no flush on stop).
    const before = await app.redis.xlen('messaging:inbound');
    const raw = payload(`wamid.off-1-${runId}`);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/whatsapp/webhook',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(raw) },
      payload: raw,
    });
    expect(res.statusCode).toBe(200);
    expect(await app.redis.xlen('messaging:inbound')).toBe(before);
  });
});
