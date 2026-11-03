import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { FLEET_ALERT_RULES } from '@aivastra/types';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminAuthHeader } from '../helpers/admin';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

const RUN = randomUUID().slice(0, 8);

describe('fleet incidents and alert rules', () => {
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

  const worker = (name: string) => `inc-${RUN}-${name}`;
  async function open(
    workerId: string,
    over: Partial<typeof schema.fleetIncidents.$inferInsert> = {},
  ) {
    const [row] = await app.db
      .insert(schema.fleetIncidents)
      .values({
        ruleKey: 'thermal_collapse',
        workerId,
        severity: 'warning',
        summary: 'GPU 0 at 87 C with SM clock at 37% of maximum',
        evidence: { gpuIndex: 0, tempC: 87, clockRatio: 0.37 },
        ...over,
      })
      .returning();
    if (!row) throw new Error('insert failed');
    await app.db
      .insert(schema.fleetIncidentEvents)
      .values({ incidentId: row.id, kind: 'OPENED', at: row.openedAt });
    return row;
  }
  const get = (url: string, headers: Record<string, string> = superAuth) =>
    app.inject({ method: 'GET', url, headers });
  const post = (url: string, payload?: unknown, headers: Record<string, string> = superAuth) =>
    app.inject({ method: 'POST', url, headers, payload: payload as Record<string, unknown> });
  const audits = async (resourceId: string, action: string) =>
    (
      await app.db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.resourceId, resourceId))
    ).filter((a) => a.action === action);
  const events = async (incidentId: string) =>
    app.db
      .select()
      .from(schema.fleetIncidentEvents)
      .where(eq(schema.fleetIncidentEvents.incidentId, incidentId));

  describe('permissions', () => {
    it('reads need fleet.view: ADMIN and SUPER_ADMIN yes, MODERATOR and anonymous no', async () => {
      const inc = await open(worker('perm'));
      for (const url of [
        '/admin/fleet/incidents',
        '/admin/fleet/incidents/summary',
        `/admin/fleet/incidents/${inc.id}`,
        '/admin/fleet/alert-rules',
      ]) {
        expect((await get(url, superAuth)).statusCode, url).toBe(200);
        expect((await get(url, adminAuth)).statusCode, url).toBe(200);
        expect((await get(url, modAuth)).statusCode, url).toBe(403);
        expect((await get(url, {})).statusCode, url).toBe(401);
      }
    });

    it('acknowledging and noting need fleet.ack (ADMIN and SUPER_ADMIN), not MODERATOR', async () => {
      const inc = await open(worker('perm-ack'));
      expect((await post(`/admin/fleet/incidents/${inc.id}/ack`, {}, modAuth)).statusCode).toBe(
        403,
      );
      expect(
        (await post(`/admin/fleet/incidents/${inc.id}/notes`, { text: 'hello there' }, modAuth))
          .statusCode,
      ).toBe(403);
      expect((await post(`/admin/fleet/incidents/${inc.id}/ack`, {}, adminAuth)).statusCode).toBe(
        200,
      );
    });

    it('tuning a rule is SUPER_ADMIN only', async () => {
      const patch = (headers: Record<string, string>) =>
        app.inject({
          method: 'PATCH',
          url: '/admin/fleet/alert-rules/swap_active',
          headers,
          payload: { enabled: false },
        });
      expect((await patch(adminAuth)).statusCode).toBe(403);
      expect((await patch(modAuth)).statusCode).toBe(403);
    });
  });

  describe('listing', () => {
    it('puts live incidents before recovered ones, newest first, with a total', async () => {
      const w = worker('list');
      const t = Date.now();
      const old = await open(w, {
        ruleKey: 'swap_active',
        severity: 'info',
        state: 'RECOVERED',
        openedAt: new Date(t - 3 * 3600_000),
        recoveredAt: new Date(t - 2 * 3600_000),
      });
      const a = await open(w, { ruleKey: 'disk_high', openedAt: new Date(t - 2 * 3600_000) });
      const b = await open(w, { ruleKey: 'ram_low', openedAt: new Date(t - 1 * 3600_000) });
      const res = await get(`/admin/fleet/incidents?workerId=${w}`);
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.total).toBe(3);
      expect(body.items.map((i: { id: string }) => i.id)).toEqual([b.id, a.id, old.id]);
      expect(body.items[0].evidence).toEqual({ gpuIndex: 0, tempC: 87, clockRatio: 0.37 });
    });

    it('filters by state (comma separated), severity and rule, and paginates', async () => {
      const w = worker('filter');
      const t = Date.now();
      await open(w, { ruleKey: 'disk_high', severity: 'warning', openedAt: new Date(t - 5000) });
      await open(w, {
        ruleKey: 'box_unreachable',
        severity: 'critical',
        state: 'ACK',
        openedAt: new Date(t - 4000),
      });
      await open(w, {
        ruleKey: 'swap_active',
        severity: 'info',
        state: 'RECOVERED',
        openedAt: new Date(t - 3000),
      });
      const q = (s: string) =>
        get(`/admin/fleet/incidents?workerId=${w}&${s}`).then((r) => r.json());
      expect((await q('state=OPEN')).total).toBe(1);
      expect((await q('state=OPEN,ACK')).total).toBe(2);
      expect(
        (await q('severity=critical')).items.map((i: { ruleKey: string }) => i.ruleKey),
      ).toEqual(['box_unreachable']);
      expect((await q('ruleKey=swap_active')).total).toBe(1);
      const page = await q('limit=1&offset=1');
      expect(page.total).toBe(3);
      expect(page.items).toHaveLength(1);
    });

    it.each([
      ['state=BOGUS'],
      ['severity=urgent'],
      ['ruleKey=not_a_rule'],
      ['limit=0'],
      ['limit=500'],
      ['offset=-1'],
    ])('rejects a bad filter (%s)', async (qs) => {
      expect((await get(`/admin/fleet/incidents?${qs}`)).statusCode).toBe(400);
    });

    it('counts only live incidents in the summary, by state and severity', async () => {
      const before = (await get('/admin/fleet/incidents/summary')).json();
      const w = worker('summary');
      await open(w, { ruleKey: 'box_unreachable', severity: 'critical' });
      await open(w, { ruleKey: 'disk_high', severity: 'warning', state: 'ACK' });
      await open(w, { ruleKey: 'swap_active', severity: 'info', state: 'RECOVERED' });
      const after = (await get('/admin/fleet/incidents/summary')).json();
      expect(after.open - before.open).toBe(1);
      expect(after.acknowledged - before.acknowledged).toBe(1);
      expect(after.bySeverity.critical - before.bySeverity.critical).toBe(1);
      expect(after.bySeverity.warning - before.bySeverity.warning).toBe(1);
      expect(after.bySeverity.info - before.bySeverity.info).toBe(0); // the recovered one is not counted
    });
  });

  describe('detail, acknowledge and notes', () => {
    it('returns the incident with its timeline, oldest first, and 404 / 400 for bad ids', async () => {
      const inc = await open(worker('detail'));
      await post(`/admin/fleet/incidents/${inc.id}/notes`, { text: 'looking at it' });
      const body = (await get(`/admin/fleet/incidents/${inc.id}`)).json();
      expect(body.incident.id).toBe(inc.id);
      expect(body.events.map((e: { kind: string }) => e.kind)).toEqual(['OPENED', 'NOTE']);
      expect(body.events[0].actor).toBeNull(); // opened by the system
      expect(body.events[1].actor).toMatchObject({ id: expect.any(String) });
      expect((await get(`/admin/fleet/incidents/${randomUUID()}`)).statusCode).toBe(404);
      expect((await get('/admin/fleet/incidents/not-a-uuid')).statusCode).toBe(400);
    });

    it('acknowledges an OPEN incident once, recording who, with an event and an audit row', async () => {
      const inc = await open(worker('ack'));
      const res = await post(`/admin/fleet/incidents/${inc.id}/ack`, { note: 'taking this one' });
      expect(res.json()).toEqual({ ok: true, changed: true, state: 'ACK' });

      const detail = (await get(`/admin/fleet/incidents/${inc.id}`)).json();
      expect(detail.incident.state).toBe('ACK');
      expect(detail.incident.ackedAt).not.toBeNull();
      expect(detail.incident.ackedBy).toMatchObject({ id: expect.any(String) });
      expect(detail.events.map((e: { kind: string }) => e.kind)).toEqual(['OPENED', 'ACK']);
      expect(detail.events[1].text).toBe('taking this one');

      const [audit] = await audits(inc.id, 'fleet.incident.ack');
      expect(audit).toMatchObject({
        actorRole: 'SUPER_ADMIN',
        before: { state: 'OPEN' },
        after: { state: 'ACK', ruleKey: 'thermal_collapse', note: 'taking this one' },
      });
    });

    it('does nothing the second time, or on a recovered incident, and writes no extra rows', async () => {
      const inc = await open(worker('ack-twice'));
      await post(`/admin/fleet/incidents/${inc.id}/ack`, {});
      const again = await post(`/admin/fleet/incidents/${inc.id}/ack`, {});
      expect(again.json()).toEqual({ ok: true, changed: false, state: 'ACK' });
      expect(await audits(inc.id, 'fleet.incident.ack')).toHaveLength(1);
      expect((await events(inc.id)).filter((e) => e.kind === 'ACK')).toHaveLength(1);

      const done = await open(worker('ack-recovered'), {
        state: 'RECOVERED',
        recoveredAt: new Date(),
      });
      const res = await post(`/admin/fleet/incidents/${done.id}/ack`);
      expect(res.json()).toMatchObject({ changed: false, state: 'RECOVERED' });
      expect(await audits(done.id, 'fleet.incident.ack')).toHaveLength(0);
    });

    it('accepts a bodyless ack (the button sends no note) and rejects a bad note', async () => {
      const inc = await open(worker('ack-nobody'));
      expect((await post(`/admin/fleet/incidents/${inc.id}/ack`)).statusCode).toBe(200);
      const other = await open(worker('ack-badnote'));
      expect(
        (await post(`/admin/fleet/incidents/${other.id}/ack`, { note: 'ab' })).statusCode,
      ).toBe(400);
      expect(
        (await post(`/admin/fleet/incidents/${other.id}/ack`, { note: 'x'.repeat(1001) }))
          .statusCode,
      ).toBe(400);
      expect((await get(`/admin/fleet/incidents/${other.id}`)).json().incident.state).toBe('OPEN');
    });

    it('adds notes in any state, including after recovery, with an audit row', async () => {
      const done = await open(worker('note-recovered'), {
        state: 'RECOVERED',
        recoveredAt: new Date(),
      });
      const res = await post(`/admin/fleet/incidents/${done.id}/notes`, {
        text: '  provider rebooted the host  ',
      });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ ok: true, eventId: expect.any(Number) });
      const note = (await events(done.id)).find((e) => e.kind === 'NOTE');
      expect(note?.text).toBe('provider rebooted the host'); // trimmed
      expect(await audits(done.id, 'fleet.incident.note')).toHaveLength(1);
    });

    it('rejects an empty, too short, too long or missing note, and an unknown incident', async () => {
      const inc = await open(worker('note-bad'));
      for (const body of [{}, { text: '' }, { text: 'ab' }, { text: 'x'.repeat(1001) }]) {
        expect((await post(`/admin/fleet/incidents/${inc.id}/notes`, body)).statusCode).toBe(400);
      }
      expect(
        (await post(`/admin/fleet/incidents/${randomUUID()}/notes`, { text: 'valid note' }))
          .statusCode,
      ).toBe(404);
      expect((await events(inc.id)).filter((e) => e.kind === 'NOTE')).toHaveLength(0);
    });
  });

  describe('one live incident per rule and worker', () => {
    it('is enforced by the database, and a recurrence after recovery is a new incident', async () => {
      const w = worker('dedupe');
      const first = await open(w, { ruleKey: 'disk_high' });
      await expect(open(w, { ruleKey: 'disk_high' })).rejects.toThrow();
      // A different rule or worker is independent.
      await open(w, { ruleKey: 'ram_low' });
      await open(worker('dedupe-other'), { ruleKey: 'disk_high' });

      await app.db
        .update(schema.fleetIncidents)
        .set({ state: 'RECOVERED', recoveredAt: new Date() })
        .where(eq(schema.fleetIncidents.id, first.id));
      const second = await open(w, { ruleKey: 'disk_high' });
      expect(second.id).not.toBe(first.id);
    });
  });

  describe('alert rules', () => {
    const rules = async () =>
      (await get('/admin/fleet/alert-rules')).json().rules as {
        key: string;
        severity: string;
        enabled: boolean;
        forSeconds: number;
        clearSeconds: number;
        params: Record<string, { value: number; default: number }>;
        updatedAt: string | null;
      }[];
    const patch = (key: string, payload: unknown, headers: Record<string, string> = superAuth) =>
      app.inject({
        method: 'PATCH',
        url: `/admin/fleet/alert-rules/${key}`,
        headers,
        payload: payload as Record<string, unknown>,
      });

    it('seeds exactly the catalog, with the catalog defaults (so the migration cannot drift)', async () => {
      const list = await rules();
      expect(list.map((r) => r.key).sort()).toEqual(Object.keys(FLEET_ALERT_RULES).sort());
      for (const r of list) {
        const def = FLEET_ALERT_RULES[r.key as keyof typeof FLEET_ALERT_RULES];
        expect(r, r.key).toMatchObject({
          severity: def.severity,
          enabled: true,
          forSeconds: def.forSeconds,
          clearSeconds: def.clearSeconds,
          updatedAt: null,
        });
        for (const [name, p] of Object.entries(r.params)) {
          expect(p.value, `${r.key}.${name}`).toBe(p.default);
        }
      }
    });

    it('changes a rule, audits before and after, and later patches merge into it', async () => {
      const res = await patch('gpu_temp_high', { params: { tempAtLeastC: 85 }, forSeconds: 120 });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        key: 'gpu_temp_high',
        forSeconds: 120,
        params: { tempAtLeastC: { value: 85, default: 88 } },
      });
      expect(res.json().updatedAt).not.toBeNull();

      await patch('gpu_temp_high', { severity: 'critical' });
      const now = (await rules()).find((r) => r.key === 'gpu_temp_high');
      expect(now).toMatchObject({ severity: 'critical', forSeconds: 120 });
      expect(now?.params.tempAtLeastC?.value).toBe(85); // the earlier change survived

      const logged = await audits('gpu_temp_high', 'fleet.alert_rule.update');
      expect(logged).toHaveLength(2);
      expect(logged[0]).toMatchObject({
        before: { severity: 'warning', forSeconds: 300, params: { tempAtLeastC: 88 } },
        after: { severity: 'warning', forSeconds: 120, params: { tempAtLeastC: 85 } },
      });
    });

    it('can disable a rule', async () => {
      await patch('foreign_vram', { enabled: false });
      expect((await rules()).find((r) => r.key === 'foreign_vram')?.enabled).toBe(false);
    });

    it.each([
      ['an unknown parameter', 'swap_active', { params: { nope: 1 } }, 400],
      ['a value below the minimum', 'swap_active', { params: { swapUsedMibAbove: 1 } }, 400],
      ['a value above the maximum', 'ram_low', { params: { availablePctBelow: 99 } }, 400],
      ['a parameter on a rule that has none', 'box_unreachable', { params: { x: 1 } }, 400],
      ['an empty change', 'swap_active', {}, 400],
      ['an unknown field', 'swap_active', { threshold: 1 }, 400],
      ['a bad severity', 'swap_active', { severity: 'urgent' }, 400],
      ['a negative duration', 'swap_active', { forSeconds: -1 }, 400],
      ['an unknown rule', 'not_a_rule', { enabled: false }, 404],
    ])('refuses %s', async (_label, key, body, status) => {
      expect((await patch(key, body)).statusCode).toBe(status);
    });

    it('leaves the rule untouched when a patch is refused', async () => {
      const before = (await rules()).find((r) => r.key === 'clock_skew');
      await patch('clock_skew', { enabled: false, params: { skewSecondsAbove: 99999 } });
      expect((await rules()).find((r) => r.key === 'clock_skew')).toEqual(before);
    });
  });
});
