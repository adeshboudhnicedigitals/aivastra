import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { traceInbound, traceOutbound } from '../../src/modules/messaging/trace.js';
import { adminAuthHeader } from '../helpers/admin.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

// Admin Conversations tab: the Redis trace written by messaging/trace.ts is
// surfaced read-only under /admin/whatsapp/conversations with the same
// jobs.read permission as the Requests tab.
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
