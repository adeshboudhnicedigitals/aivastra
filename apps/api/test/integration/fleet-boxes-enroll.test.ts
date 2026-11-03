import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import {
  FLEET_AGENT_KEY_RE,
  FLEET_ENROLL_TOKEN_RE,
  fleetBoxesSchema,
  fleetEnrollResponseSchema,
} from '@aivastra/types';
import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminAuthHeader } from '../helpers/admin';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

// Box ids must match FLEET_BOX_ID_RE (lower-case), and integration files share one Postgres.
const RUN = randomUUID().slice(0, 6).toLowerCase();

describe('box enrolment and the Boxes view', () => {
  let c: Containers;
  let app: TestApp;
  let superAuth: Record<string, string>;
  let modAuth: Record<string, string>;
  let token: string;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
    superAuth = await adminAuthHeader(app, 'SUPER_ADMIN');
    modAuth = await adminAuthHeader(app, 'MODERATOR');
  }, 60000);
  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  async function worker(id: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/workers',
      headers: superAuth,
      payload: { id, label: id, url: 'https://box.invalid/', apiKey: 'k'.repeat(12) },
    });
    expect(res.statusCode).toBe(201);
  }
  const enroll = (body: unknown, tok = token) =>
    app.inject({
      method: 'POST',
      url: '/v1/fleet/enroll',
      headers: { authorization: `Bearer ${tok}` },
      payload: body as Record<string, unknown>,
    });
  function sample(boxId: string, key: string, seq = 1) {
    const now = Date.now();
    return app.inject({
      method: 'POST',
      url: '/v1/fleet/agent/ingest',
      headers: { authorization: `Bearer ${key}` },
      payload: {
        v: 1,
        workerId: boxId,
        agentVersion: '0.2.0',
        bootId: 'b00710aa',
        seq,
        observedAt: now - 500,
        gpus: [
          {
            index: 0,
            name: 'NVIDIA RTX A6000',
            tempC: 61,
            memTempC: null,
            fanPct: 30,
            pstate: 'P2',
            smClockMhz: 1800,
            smClockMaxMhz: 2100,
            memClockMhz: 8000,
            powerW: 200,
            powerLimitW: 300,
            utilGpuPct: 55,
            utilMemPct: 20,
            vramUsedMib: 10000,
            vramTotalMib: 49140,
            throttleReasons: null,
            eccUncorrected: 0,
          },
        ],
        computeApps: [],
        host: {
          cpuCount: 16,
          load1: 1,
          load5: 1,
          load15: 1,
          ramTotalMib: 128000,
          ramAvailMib: 64000,
          swapTotalMib: 0,
          swapUsedMib: 0,
          memPsiSome10: 0,
          uptimeSec: 1000,
          ntpSynced: true,
          driverVersion: '550.127.05',
          disks: [{ mount: '/', totalGb: 999.6, usedGb: 930, inodeUsedPct: 3 }],
        },
        services: [{ name: 'comfyui', active: 'active', sub: 'running', restarts: 0 }],
        comfy: [{ instance: 'main', reachable: true, running: 1, pending: 0 }],
      },
    });
  }

  describe('enrolment tokens', () => {
    it('are created once by SUPER_ADMIN, shown once, and listed without the secret', async () => {
      const denied = await app.inject({
        method: 'POST',
        url: '/admin/fleet/enroll-tokens',
        headers: modAuth,
        payload: { label: 'laptop' },
      });
      expect(denied.statusCode).toBe(403);

      const res = await app.inject({
        method: 'POST',
        url: '/admin/fleet/enroll-tokens',
        headers: superAuth,
        payload: { label: 'laptop' },
      });
      expect(res.statusCode).toBe(201);
      expect(res.headers['cache-control']).toBe('no-store');
      token = (res.json() as { token: string }).token;
      expect(token).toMatch(FLEET_ENROLL_TOKEN_RE);

      const list = await app.inject({
        method: 'GET',
        url: '/admin/fleet/enroll-tokens',
        headers: superAuth,
      });
      expect(list.statusCode).toBe(200);
      expect(list.body).not.toContain(token);
      expect(list.body).toContain(token.slice(0, 11));
    });

    it('refuses a missing, malformed or unknown token, before looking at the body', async () => {
      expect((await enroll({ boxId: 'x' }, '')).statusCode).toBe(401);
      expect((await enroll({ boxId: 'x' }, 'fe_short')).statusCode).toBe(401);
      expect((await enroll({ boxId: 'x' }, `fe_${'A'.repeat(43)}`)).statusCode).toBe(401);
      // An agent key is not an enrolment token.
      expect((await enroll({ boxId: 'x' }, `fa_${'A'.repeat(43)}`)).statusCode).toBe(401);
    });
  });

  describe('POST /v1/fleet/enroll', () => {
    it('registers the box, links its worker, and returns a working agent key', async () => {
      const box = `w${RUN}a`;
      await worker(`tw-${RUN}-a`);
      const res = await enroll({ boxId: box, workerId: `tw-${RUN}-a` });
      expect(res.statusCode).toBe(201);
      expect(res.headers['cache-control']).toBe('no-store');
      const body = fleetEnrollResponseSchema.parse(res.json());
      expect(body).toMatchObject({ boxId: box, revokedPrevious: 0, workerLinked: true });
      expect(body.key).toMatch(FLEET_AGENT_KEY_RE);

      const [host] = await app.db
        .select()
        .from(schema.fleetHosts)
        .where(eq(schema.fleetHosts.id, box));
      expect(host?.workerId).toBe(`tw-${RUN}-a`);

      // The key works for its box, and the box's hardware is recorded from the first sample.
      expect((await sample(box, body.key)).statusCode).toBe(200);
      const [after] = await app.db
        .select()
        .from(schema.fleetHosts)
        .where(eq(schema.fleetHosts.id, box));
      expect(after?.hardware).toMatchObject({
        gpus: [{ index: 0, name: 'NVIDIA RTX A6000', vramTotalMib: 49140 }],
        driverVersion: '550.127.05',
        ramTotalMib: 128000,
        diskTotalGb: 1000,
      });

      // The audit row names the box and never holds the key.
      const audits = await app.db
        .select()
        .from(schema.auditLogs)
        .where(
          and(
            eq(schema.auditLogs.action, 'fleet.box.enroll'),
            eq(schema.auditLogs.resourceId, box),
          ),
        );
      expect(audits).toHaveLength(1);
      expect(JSON.stringify(audits)).not.toContain(body.key);
    });

    it('re-enrolling a box revokes its old key: one working key per box', async () => {
      const box = `w${RUN}b`;
      const first = fleetEnrollResponseSchema.parse(
        (await enroll({ boxId: box, workerId: null })).json(),
      );
      const second = await enroll({ boxId: box, workerId: null });
      expect(second.statusCode).toBe(201);
      const body = fleetEnrollResponseSchema.parse(second.json());
      expect(body.revokedPrevious).toBe(1);
      expect((await sample(box, first.key)).statusCode).toBe(401);
      expect((await sample(box, body.key)).statusCode).toBe(200);
      const live = await app.db
        .select()
        .from(schema.fleetAgents)
        .where(and(eq(schema.fleetAgents.workerId, box), isNull(schema.fleetAgents.revokedAt)));
      expect(live).toHaveLength(1);
    });

    it('enrols a box whose worker does not exist, unlinked rather than refused', async () => {
      const box = `w${RUN}c`;
      const res = await enroll({ boxId: box, workerId: 'no-such-worker' });
      expect(res.statusCode).toBe(201);
      expect((res.json() as { workerLinked: boolean }).workerLinked).toBe(false);
      const [host] = await app.db
        .select()
        .from(schema.fleetHosts)
        .where(eq(schema.fleetHosts.id, box));
      expect(host?.workerId).toBeNull();
    });

    it('rejects a box id that is not a plain lower-case name', async () => {
      for (const boxId of ['W6', 'w6!', '', '-w6', 'w'.repeat(40)]) {
        expect((await enroll({ boxId, workerId: null })).statusCode, boxId).toBe(400);
      }
    });

    it('stops working the moment its token is revoked', async () => {
      const made = await app.inject({
        method: 'POST',
        url: '/admin/fleet/enroll-tokens',
        headers: superAuth,
        payload: { label: 'temp' },
      });
      const { id, token: t } = made.json() as { id: string; token: string };
      expect((await enroll({ boxId: `w${RUN}d`, workerId: null }, t)).statusCode).toBe(201);
      const del = await app.inject({
        method: 'DELETE',
        url: `/admin/fleet/enroll-tokens/${id}`,
        headers: superAuth,
      });
      expect(del.statusCode).toBe(200);
      expect((await enroll({ boxId: `w${RUN}d`, workerId: null }, t)).statusCode).toBe(401);
    });
  });

  describe('GET /admin/fleet/boxes', () => {
    it('labels the dispatcher state without letting it decide the box health', async () => {
      const inRot = `w${RUN}e`;
      const down = `w${RUN}f`;
      const disabled = `w${RUN}g`;
      const solo = `w${RUN}h`;
      for (const w of ['e', 'f', 'g']) await worker(`tw-${RUN}-${w}`);
      const keyOf: Record<string, string> = {};
      for (const [box, w] of [
        [inRot, `tw-${RUN}-e`],
        [down, `tw-${RUN}-f`],
        [disabled, `tw-${RUN}-g`],
        [solo, null],
      ] as const) {
        keyOf[box] = (await enroll({ boxId: box, workerId: w })).json().key;
      }
      await app.redis.set(`worker:health:tw-${RUN}-e`, '1', 'EX', 60);
      await app.db
        .update(schema.workers)
        .set({ isActive: false })
        .where(eq(schema.workers.id, `tw-${RUN}-g`));
      // The disabled worker's box is reporting normally.
      expect((await sample(disabled, keyOf[disabled] as string)).statusCode).toBe(200);

      const res = await app.inject({
        method: 'GET',
        url: '/admin/fleet/boxes',
        headers: superAuth,
      });
      expect(res.statusCode).toBe(200);
      const { boxes } = fleetBoxesSchema.parse(res.json());
      const by = new Map(boxes.map((b) => [b.id, b]));
      expect(by.get(inRot)?.dispatcher).toBe('in_rotation');
      expect(by.get(down)?.dispatcher).toBe('not_reachable');
      expect(by.get(disabled)?.dispatcher).toBe('disabled');
      expect(by.get(solo)?.dispatcher).toBe('not_a_worker');
      expect(by.get(solo)?.jobs24h).toBeNull();
      expect(by.get(inRot)?.jobs24h).toEqual({ completed: 0, failed: 0 });

      const d = by.get(disabled);
      expect(d?.agentEnrolled).toBe(true);
      expect(d?.heartbeatAt).not.toBeNull();
      expect(d?.telemetry?.utilGpuPctMax).toBe(55);
      expect(d?.telemetry?.diskUsedPctMax).toBe(93);
      expect(d?.hardware?.gpus[0]?.name).toBe('NVIDIA RTX A6000');
      // Enrolled but never reported: no numbers, not zeros.
      expect(by.get(down)?.telemetry).toBeNull();
      expect(by.get(down)?.hardware).toBeNull();
    });

    it('needs fleet.view', async () => {
      expect((await app.inject({ method: 'GET', url: '/admin/fleet/boxes' })).statusCode).toBe(401);
    });
  });
});
