import { schema } from '@aivastra/db';
import { SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { buildTestApp } from './helpers/app.js';
import { type Containers, startContainers } from './helpers/containers.js';

const SECRET = new TextEncoder().encode('test-jwt-secret-test-jwt-secret');

async function userToken(sub: string) {
  return new SignJWT({ kind: 'access' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(SECRET);
}

function nextFrame(ws: WebSocket, type: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${type}`)), 10_000);
    ws.on('message', (buf) => {
      const f = JSON.parse(buf.toString());
      if (f.type === type) {
        clearTimeout(timer);
        resolve(f);
      }
    });
  });
}

describe('ws gateway', () => {
  let c: Containers;
  let t: Awaited<ReturnType<typeof buildTestApp>>;
  let userId: string;

  beforeAll(async () => {
    c = await startContainers();
    t = await buildTestApp(c);
    const [u] = await t.deps.db
      .insert(schema.users)
      .values({ email: 'ws@test.dev', passwordHash: 'x', emailVerified: true })
      .returning();
    userId = u.id;
  }, 60_000);

  afterAll(async () => {
    await t.stop();
    await c.stop();
  });

  it('ticket is required and one-time', async () => {
    const noTicket = await fetch(`${t.baseUrl.replace('http', 'ws')}/ws`).catch(() => null);
    const token = await userToken(userId);
    const res = await fetch(`${t.baseUrl}/ws-ticket`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const { ticket } = (await res.json()) as { ticket: string };
    expect(ticket.length).toBeGreaterThan(16);
    expect(noTicket).toBeNull();
  });

  it('user connects, ready frame reports OPEN, sent message echoes back with no bot reply', async () => {
    const token = await userToken(userId);
    const { ticket } = (await (
      await fetch(`${t.baseUrl}/ws-ticket`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      })
    ).json()) as { ticket: string };

    const wsUrl = `${t.baseUrl.replace('http', 'ws')}/ws?ticket=${ticket}`;
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('close', (code) => reject(new Error(`closed ${code}`)));
    });
    const ready = await nextFrame(ws, 'ready');
    expect(ready.status).toBe('OPEN');

    const userMsg = nextFrame(ws, 'message');
    ws.send(JSON.stringify({ type: 'message', content: 'hi there' }));
    const got = await userMsg;
    expect((got.message as { role: string; content: string }).role).toBe('user');
    expect((got.message as { content: string }).content).toBe('hi there');
    ws.close();
  });

  it('sent message carries an attachmentKey through to the persisted message', async () => {
    const token = await userToken(userId);
    const { ticket } = (await (
      await fetch(`${t.baseUrl}/ws-ticket`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      })
    ).json()) as { ticket: string };
    const ws = new WebSocket(`${t.baseUrl.replace('http', 'ws')}/ws?ticket=${ticket}`);
    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('close', (code) => reject(new Error(`closed ${code}`)));
    });
    await nextFrame(ws, 'ready');
    const userMsg = nextFrame(ws, 'message');
    ws.send(
      JSON.stringify({ type: 'message', content: 'see this', attachmentKey: 'support/a.jpg' }),
    );
    const got = await userMsg;
    expect((got.message as { attachmentKey: string | null }).attachmentKey).toBe('support/a.jpg');
    ws.close();
  });

  it('rejects ws without ticket', async () => {
    const wsUrl = `${t.baseUrl.replace('http', 'ws')}/ws`;
    const ws = new WebSocket(wsUrl);
    const code = await new Promise<number>((resolve) => {
      ws.on('close', (c) => resolve(c));
      setTimeout(() => resolve(-1), 5000);
    });
    expect(code).toBe(4401);
  });
});
