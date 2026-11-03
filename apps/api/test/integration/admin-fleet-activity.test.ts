import { schema } from '@aivastra/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminAuthHeader } from '../helpers/admin';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

describe('GET /admin/fleet/activity', () => {
  let c: Containers;
  let app: TestApp;
  let superAuth: Record<string, string>;
  let modAuth: Record<string, string>;

  const get = (qs = '', headers?: Record<string, string>) =>
    app.inject({ method: 'GET', url: `/admin/fleet/activity${qs}`, headers });

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
    superAuth = await adminAuthHeader(app, 'SUPER_ADMIN');
    modAuth = await adminAuthHeader(app, 'MODERATOR');

    for (const id of ['act-w1', 'act-w2']) {
      const res = await app.inject({
        method: 'POST',
        url: '/admin/workers',
        headers: superAuth,
        payload: {
          id,
          label: id,
          url: 'https://act.invalid/',
          apiKey: 'act-secret-key-0123456789',
        },
      });
      expect(res.statusCode).toBe(201);
      // Agent keys belong to a box; register one linked to this worker, as enrolment would.
      await app.db
        .insert(schema.fleetHosts)
        .values({ id, label: id, workerId: id })
        .onConflictDoNothing();
    }
    // A real audited action: creating an agent key writes fleet.agent_key.create against the worker.
    const key = await app.inject({
      method: 'POST',
      url: '/admin/fleet/workers/act-w1/agent-keys',
      headers: superAuth,
      payload: {},
    });
    expect(key.statusCode).toBeLessThan(300);

    const [incident] = await app.db
      .insert(schema.fleetIncidents)
      .values({
        ruleKey: 'disk_high',
        workerId: 'act-w2',
        severity: 'warning',
        summary: 'disk 93%',
      })
      .returning();
    await app.db.insert(schema.fleetIncidentEvents).values([
      { incidentId: incident!.id, kind: 'OPENED', at: new Date('2026-11-03T09:00:00Z') },
      {
        incidentId: incident!.id,
        kind: 'NOTE',
        at: new Date('2026-11-03T09:05:00Z'),
        text: 'looking',
      },
    ]);
    await app.db.insert(schema.fleetCommands).values([
      {
        workerId: 'act-w2',
        kind: 'clear_queue',
        reason: 'test run',
        state: 'SUCCEEDED',
        finishedAt: new Date('2026-11-03T09:10:00Z'),
        result: 'cleared 0',
      },
      { workerId: 'act-w2', kind: 'restart_comfyui', reason: 'still waiting', state: 'PENDING' },
    ]);
  }, 60000);
  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  it('needs fleet.view and a login', async () => {
    expect((await get('', superAuth)).statusCode).toBe(200);
    expect((await get('', modAuth)).statusCode).toBe(403);
    expect((await get()).statusCode).toBe(401);
  });

  it('merges audit, incident and command rows, newest first', async () => {
    const body = (await get('', superAuth)).json();
    const sources = new Set(body.items.map((i: { source: string }) => i.source));
    expect(sources).toEqual(new Set(['AUDIT', 'INCIDENT', 'COMMAND']));
    const ats = body.items.map((i: { at: string }) => i.at);
    expect([...ats].sort().reverse()).toEqual(ats);
  });

  it('shows who did a real audited action', async () => {
    const body = (await get('?source=AUDIT', superAuth)).json();
    const k = body.items.find((i: { action: string }) => i.action === 'fleet.agent_key.create');
    expect(k).toBeDefined();
    expect(k.workerId).toBe('act-w1');
    expect(k.actor).toContain('@');
  });

  it('lists a finished command once and leaves the pending one out', async () => {
    const body = (await get('?source=COMMAND', superAuth)).json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ action: 'command.succeeded', workerId: 'act-w2' });
  });

  it('filters by worker across all sources', async () => {
    const body = (await get('?workerId=act-w1', superAuth)).json();
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.every((i: { workerId: string }) => i.workerId === 'act-w1')).toBe(true);
  });

  it('pages with hasMore and no repeats', async () => {
    const p1 = (await get('?limit=2&offset=0', superAuth)).json();
    const p2 = (await get('?limit=2&offset=2', superAuth)).json();
    expect(p1.items).toHaveLength(2);
    expect(p1.hasMore).toBe(true);
    const ids = [...p1.items, ...p2.items].map((i: { id: string }) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('rejects out-of-range paging and unknown sources', async () => {
    expect((await get('?limit=500', superAuth)).statusCode).toBe(400);
    expect((await get('?offset=5000', superAuth)).statusCode).toBe(400);
    expect((await get('?source=BOGUS', superAuth)).statusCode).toBe(400);
  });

  it('does not leak secrets or payloads', async () => {
    const res = await get('', superAuth);
    expect(res.body).not.toContain('act-secret-key');
    expect(res.body).not.toContain('keyHash');
    expect(res.body).not.toContain('"before"');
  });
});
