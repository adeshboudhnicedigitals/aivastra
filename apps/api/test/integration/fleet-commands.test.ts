import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { fleetAgentLatestKey } from '@aivastra/types';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminAuthHeader } from '../helpers/admin';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

// Redis outlives the per-run database, so ids are unique per run.
const RUN = randomUUID().slice(0, 8);

describe('fleet control commands and alert recipients', () => {
  let c: Containers;
  let app: TestApp;
  let superAuth: Record<string, string>;
  let adminAuth: Record<string, string>;
  let modAuth: Record<string, string>;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
    superAuth = await adminAuthHeader(app, 'SUPER_ADMIN');
    adminAuth = await adminAuthHeader(app, 'ADMIN');
    modAuth = await adminAuthHeader(app, 'MODERATOR');
  }, 60000);
  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  async function worker(name: string) {
    const id = `cm-${RUN}-${name}`;
    const res = await app.inject({
      method: 'POST',
      url: '/admin/workers',
      headers: superAuth,
      payload: {
        id,
        label: 'commands',
        url: 'https://fleet-worker.invalid/',
        apiKey: 'k'.repeat(12),
      },
    });
    expect(res.statusCode).toBe(201);
    return id;
  }

  /** What the dispatcher and the agent say about a worker, written the way they write it. */
  async function observe(
    id: string,
    o: {
      status?: string | null;
      reserved?: boolean;
      dispatcher?: { running: number; pending: number } | null;
      agent?: { running: number; pending: number } | null;
    },
  ) {
    const now = Date.now();
    if (o.status)
      await app.redis.hset('worker:registry', id, JSON.stringify({ id, status: o.status }));
    if (o.reserved) await app.redis.hset('worker:reservations', id, 'token');
    if (o.dispatcher) {
      await app.redis.set(
        `worker:queue:${id}`,
        JSON.stringify({ probedAt: now, ...o.dispatcher }),
        'EX',
        60,
      );
    }
    if (o.agent) {
      await app.redis.set(
        fleetAgentLatestKey(id),
        JSON.stringify({
          observedAt: now - 2000,
          comfy: [{ instance: 'main', reachable: true, ...o.agent }],
        }),
        'EX',
        60,
      );
    }
  }

  const request = (
    id: string,
    kind: string,
    reason = 'queue stuck after a restart',
    headers = superAuth,
  ) =>
    app.inject({
      method: 'POST',
      url: `/admin/fleet/workers/${id}/commands`,
      headers,
      payload: { kind, reason },
    });
  const rows = (id: string) =>
    app.db.select().from(schema.fleetCommands).where(eq(schema.fleetCommands.workerId, id));
  const audits = async (id: string, action: string) =>
    (
      await app.db.select().from(schema.auditLogs).where(eq(schema.auditLogs.resourceId, id))
    ).filter((a) => a.action === action);

  it('refuses commands on a worker that is not drained and creates nothing', async () => {
    const id = await worker('notdrained');
    await observe(id, {
      status: 'IDLE',
      dispatcher: { running: 0, pending: 2 },
      agent: { running: 0, pending: 2 },
    });
    const res = await request(id, 'clear_queue');
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: 'COMMAND_NOT_ALLOWED' } });
    expect(await rows(id)).toHaveLength(0);
  });

  it('accepts a guarded command, audits who asked and why, and allows only one live command', async () => {
    const id = await worker('clear');
    await observe(id, {
      status: 'DRAINING',
      dispatcher: { running: 0, pending: 2 },
      agent: { running: 0, pending: 2 },
    });
    const res = await request(id, 'clear_queue', 'stuck prompts after tunnel flap');
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      workerId: id,
      kind: 'clear_queue',
      state: 'PENDING',
      claimedAt: null,
    });

    const [audit] = await audits(id, 'fleet.command.request');
    expect(audit?.after).toMatchObject({
      kind: 'clear_queue',
      reason: 'stuck prompts after tunnel flap',
    });

    const again = await request(id, 'clear_queue');
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ error: { code: 'COMMAND_IN_PROGRESS' } });
    expect(await rows(id)).toHaveLength(1);
  });

  it('refuses a restart unless dispatcher and agent both show an idle queue, and while reserved', async () => {
    const id = await worker('restart');
    await observe(id, { status: 'DRAINING', dispatcher: { running: 0, pending: 0 } });
    expect((await request(id, 'restart_comfyui')).statusCode).toBe(409); // no agent reading

    await observe(id, { agent: { running: 1, pending: 0 } });
    const busy = await request(id, 'restart_comfyui');
    expect(busy.statusCode).toBe(409);
    expect(busy.json().error.message).toMatch(/running/);

    await observe(id, { agent: { running: 0, pending: 0 }, reserved: true });
    expect((await request(id, 'restart_comfyui')).statusCode).toBe(409);
    await app.redis.hdel('worker:reservations', id);

    const ok = await request(id, 'restart_comfyui', 'ComfyUI wedged, VRAM not released');
    expect(ok.statusCode).toBe(201);
    expect(await rows(id)).toHaveLength(1);
  });

  it('needs fleet.operate to request or cancel and fleet.view to list', async () => {
    const id = await worker('perm');
    await observe(id, {
      status: 'DRAINING',
      dispatcher: { running: 0, pending: 1 },
      agent: { running: 0, pending: 1 },
    });
    expect((await request(id, 'clear_queue', 'valid reason here', adminAuth)).statusCode).toBe(403);
    expect((await request(id, 'clear_queue', 'valid reason here', modAuth)).statusCode).toBe(403);
    const anon = await app.inject({
      method: 'POST',
      url: `/admin/fleet/workers/${id}/commands`,
      payload: { kind: 'clear_queue', reason: 'valid reason here' },
    });
    expect(anon.statusCode).toBe(401);
    expect((await request(id, 'wipe_disk')).statusCode).toBe(400);
    expect((await request(id, 'clear_queue', 'x')).statusCode).toBe(400);
    expect((await request(`nope-${RUN}`, 'clear_queue')).statusCode).toBe(404);
    expect(await rows(id)).toHaveLength(0);

    const created = await request(id, 'clear_queue');
    const cmdId = created.json().id as string;
    const cancelAsMod = await app.inject({
      method: 'POST',
      url: `/admin/fleet/commands/${cmdId}/cancel`,
      headers: adminAuth,
    });
    expect(cancelAsMod.statusCode).toBe(403);

    const list = await app.inject({
      method: 'GET',
      url: `/admin/fleet/workers/${id}/commands`,
      headers: adminAuth,
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().commands).toHaveLength(1);
    const noView = await app.inject({
      method: 'GET',
      url: `/admin/fleet/workers/${id}/commands`,
      headers: modAuth,
    });
    expect(noView.statusCode).toBe(403);
  });

  it('cancels a waiting command once, audited, and frees the worker for the next one', async () => {
    const id = await worker('cancel');
    await observe(id, {
      status: 'DRAINING',
      dispatcher: { running: 0, pending: 3 },
      agent: { running: 0, pending: 3 },
    });
    const cmdId = (await request(id, 'clear_queue')).json().id as string;
    const cancel = await app.inject({
      method: 'POST',
      url: `/admin/fleet/commands/${cmdId}/cancel`,
      headers: superAuth,
    });
    expect(cancel.statusCode).toBe(200);
    expect(cancel.json()).toMatchObject({ state: 'CANCELLED' });
    expect((await audits(id, 'fleet.command.cancel')).length).toBe(1);

    const again = await app.inject({
      method: 'POST',
      url: `/admin/fleet/commands/${cmdId}/cancel`,
      headers: superAuth,
    });
    expect(again.statusCode).toBe(404);

    // A claimed command cannot be recalled.
    await app.db
      .update(schema.fleetCommands)
      .set({ state: 'RUNNING' })
      .where(eq(schema.fleetCommands.id, cmdId));
    const running = await app.inject({
      method: 'POST',
      url: `/admin/fleet/commands/${cmdId}/cancel`,
      headers: superAuth,
    });
    expect(running.statusCode).toBe(404);
  });

  it('manages alert recipients: normalised, audited, empty means off, validated, permissioned', async () => {
    const get = (headers = superAuth) =>
      app.inject({ method: 'GET', url: '/admin/fleet/notification-settings', headers });
    const put = (emails: unknown, headers = superAuth) =>
      app.inject({
        method: 'PUT',
        url: '/admin/fleet/notification-settings',
        headers,
        payload: { emails },
      });

    const initial = (await get()).json();
    expect(initial).toMatchObject({ emails: [], source: 'none', updatedAt: null });

    const saved = await put([' Ops@Example.com ', 'ops@example.com', 'lead@example.org']);
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({
      emails: ['ops@example.com', 'lead@example.org'],
      source: 'dashboard',
    });
    expect((await get(adminAuth)).json().emails).toEqual(['ops@example.com', 'lead@example.org']);
    expect((await get(modAuth)).statusCode).toBe(403);

    const [audit] = (
      await app.db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.resourceId, 'alertEmails'))
    ).filter((a) => a.action === 'fleet.notification_settings.update');
    expect(audit?.after).toMatchObject({ emails: ['ops@example.com', 'lead@example.org'] });

    // A saved empty list is "off on purpose", distinct from "never configured".
    const off = await put([]);
    expect(off.json()).toMatchObject({ emails: [], source: 'dashboard' });

    expect((await put(['not-an-email'])).statusCode).toBe(400);
    expect((await put(Array.from({ length: 21 }, (_, i) => `a${i}@example.com`))).statusCode).toBe(
      400,
    );
    expect((await put(['a@example.com'], adminAuth)).statusCode).toBe(403);
    expect((await get()).json().emails).toEqual([]);
  });
});
