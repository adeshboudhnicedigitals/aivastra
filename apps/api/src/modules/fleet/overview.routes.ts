import { schema } from '@aivastra/db';
import {
  type AgentTelemetry,
  FLEET_SYSTEM_STALE_MS,
  type FleetAgentSummary,
  type FleetBox,
  type FleetBoxDispatcherState,
  fleetAgentHeartbeatKey,
  fleetAgentLatestKey,
  fleetAgentSummariesSchema,
  fleetBoxesSchema,
  fleetBoxHardwareSchema,
} from '@aivastra/types';
import { asc, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { requirePermission } from '../admin/guard.js';
import { deriveGpuSignals } from './signals.js';

const MAX = (xs: (number | null)[]) =>
  xs.length === 0 || xs.some((x) => x === null) ? null : Math.max(...(xs as number[]));
const MIN = (xs: (number | null)[]) =>
  xs.length === 0 || xs.some((x) => x === null) ? null : Math.min(...(xs as number[]));
const SUM = (xs: (number | null)[]) =>
  xs.length === 0 || xs.some((x) => x === null)
    ? null
    : (xs as number[]).reduce((a, b) => a + b, 0);

function summarize(t: AgentTelemetry, now: number): NonNullable<FleetAgentSummary['telemetry']> {
  const signals = deriveGpuSignals(t);
  const disks = t.host.disks.map((d) =>
    d.totalGb !== null && d.usedGb !== null && d.totalGb > 0 ? (d.usedGb / d.totalGb) * 100 : null,
  );
  const c = t.comfy[0];
  return {
    observedAt: new Date(t.observedAt).toISOString(),
    stale: now - t.observedAt > FLEET_SYSTEM_STALE_MS,
    gpuCount: t.gpus.length,
    tempMaxC: MAX(t.gpus.map((g) => g.tempC)),
    clockRatioMin: MIN(signals.map((s) => s.clockRatio)),
    utilGpuPctMax: MAX(t.gpus.map((g) => g.utilGpuPct)),
    powerWTotal: SUM(t.gpus.map((g) => g.powerW)),
    vramUsedMib: SUM(t.gpus.map((g) => g.vramUsedMib)),
    vramTotalMib: SUM(t.gpus.map((g) => g.vramTotalMib)),
    ramAvailMib: t.host.ramAvailMib,
    ramTotalMib: t.host.ramTotalMib,
    swapUsedMib: t.host.swapUsedMib,
    diskUsedPctMax: (() => {
      const m = MAX(disks);
      return m === null ? null : Math.round(m * 10) / 10;
    })(),
    comfy: c ? { reachable: c.reachable, running: c.running, pending: c.pending } : null,
  };
}

// Jobs per worker over 24 h. jobs has no (worker_id, created_at) index and the page polls, so the
// counts are cached briefly per process instead of scanning the table on every refresh.
const JOBS_CACHE_MS = 60_000;
let jobsCache: { at: number; byWorker: Map<string, { completed: number; failed: number }> } | null =
  null;

function parseJson<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null; // unreadable is reported as nothing, never half-parsed
  }
}

/**
 * One call for the overview grid: what each agent-monitored worker last reported, plus its live
 * incident counts. Additive to GET /admin/fleet, which only carries what the dispatcher knows.
 */
export async function fleetOverviewRoutes(app: FastifyInstance) {
  app.get('/admin/fleet/agents', { preHandler: requirePermission('fleet.view') }, async () => {
    const now = Date.now();
    const keyed = await app.db
      .selectDistinct({ workerId: schema.fleetAgents.workerId })
      .from(schema.fleetAgents)
      .where(isNull(schema.fleetAgents.revokedAt));
    const ids = keyed.map((k) => k.workerId).sort();
    if (ids.length === 0) {
      return fleetAgentSummariesSchema.parse({
        generatedAt: new Date(now).toISOString(),
        workers: [],
      });
    }
    const [beats, latests, counts] = await Promise.all([
      app.redis.mget(ids.map(fleetAgentHeartbeatKey)),
      app.redis.mget(ids.map(fleetAgentLatestKey)),
      app.db.execute<{ worker_id: string; severity: string; n: number }>(sql`
          SELECT worker_id, severity, count(*)::int AS n FROM fleet_incidents
          WHERE state <> 'RECOVERED' GROUP BY worker_id, severity`),
    ]);
    const incidents = new Map<string, FleetAgentSummary['incidents']>();
    for (const r of counts) {
      const cur = incidents.get(r.worker_id) ?? { critical: 0, warning: 0, info: 0 };
      if (r.severity === 'critical' || r.severity === 'warning' || r.severity === 'info') {
        cur[r.severity] += Number(r.n);
      }
      incidents.set(r.worker_id, cur);
    }
    const workers = ids.map((workerId, i): FleetAgentSummary => {
      let heartbeatAt: string | null = null;
      try {
        const b = beats[i] ? (JSON.parse(beats[i] as string) as { receivedAt?: number }) : null;
        if (b && typeof b.receivedAt === 'number')
          heartbeatAt = new Date(b.receivedAt).toISOString();
      } catch {
        heartbeatAt = null;
      }
      let telemetry: FleetAgentSummary['telemetry'] = null;
      try {
        if (latests[i]) {
          const { receivedAt: _r, clockSkewMs: _c, ...rest } = JSON.parse(latests[i] as string);
          telemetry = summarize(rest as AgentTelemetry, now);
        }
      } catch {
        telemetry = null; // unreadable is reported as nothing, never half-parsed
      }
      return {
        workerId,
        heartbeatAt,
        telemetry,
        incidents: incidents.get(workerId) ?? { critical: 0, warning: 0, info: 0 },
      };
    });
    return fleetAgentSummariesSchema.parse({ generatedAt: new Date(now).toISOString(), workers });
  });

  /**
   * The Boxes page: one row per rented machine (fleet_hosts), whatever the dispatcher thinks of it.
   * Health comes from the agent on the box; the dispatcher only contributes a label.
   */
  app.get('/admin/fleet/boxes', { preHandler: requirePermission('fleet.view') }, async () => {
    const now = Date.now();
    const [hosts, keys, counts] = await Promise.all([
      app.db
        .select({
          id: schema.fleetHosts.id,
          label: schema.fleetHosts.label,
          workerId: schema.fleetHosts.workerId,
          workerActive: schema.workers.isActive,
          hardware: schema.fleetHosts.hardware,
          hardwareAt: schema.fleetHosts.hardwareAt,
        })
        .from(schema.fleetHosts)
        .leftJoin(schema.workers, eq(schema.workers.id, schema.fleetHosts.workerId))
        .orderBy(asc(schema.fleetHosts.id)),
      app.db
        .select({
          boxId: schema.fleetAgents.workerId,
          revokedAt: schema.fleetAgents.revokedAt,
          lastSeenAt: schema.fleetAgents.lastSeenAt,
          agentVersion: schema.fleetAgents.agentVersion,
        })
        .from(schema.fleetAgents),
      app.db.execute<{ worker_id: string; severity: string; n: number }>(sql`
          SELECT worker_id, severity, count(*)::int AS n FROM fleet_incidents
          WHERE state <> 'RECOVERED' GROUP BY worker_id, severity`),
    ]);
    if (hosts.length === 0) {
      return fleetBoxesSchema.parse({ generatedAt: new Date(now).toISOString(), boxes: [] });
    }

    const ids = hosts.map((h) => h.id);
    const linked = hosts.map((h) => h.workerId ?? '__none__');
    const [beats, latests, health] = await Promise.all([
      app.redis.mget(ids.map(fleetAgentHeartbeatKey)),
      app.redis.mget(ids.map(fleetAgentLatestKey)),
      app.redis.mget(linked.map((w) => `worker:health:${w}`)),
    ]);

    const workerIds = hosts.flatMap((h) => (h.workerId ? [h.workerId] : []));
    if (!jobsCache || now - jobsCache.at > JOBS_CACHE_MS) {
      const byWorker = new Map<string, { completed: number; failed: number }>();
      if (workerIds.length > 0) {
        const rows = await app.db.execute<{ worker_id: string; status: string; n: number }>(sql`
            SELECT worker_id, status, count(*)::int AS n FROM jobs
            WHERE created_at > now() - interval '24 hours'
              AND status IN ('COMPLETED', 'FAILED') AND worker_id IS NOT NULL
            GROUP BY worker_id, status`);
        for (const r of rows) {
          const cur = byWorker.get(r.worker_id) ?? { completed: 0, failed: 0 };
          if (r.status === 'COMPLETED') cur.completed += Number(r.n);
          else cur.failed += Number(r.n);
          byWorker.set(r.worker_id, cur);
        }
      }
      jobsCache = { at: now, byWorker };
    }

    const incidents = new Map<string, FleetBox['incidents']>();
    for (const r of counts) {
      const cur = incidents.get(r.worker_id) ?? { critical: 0, warning: 0, info: 0 };
      if (r.severity === 'critical' || r.severity === 'warning' || r.severity === 'info') {
        cur[r.severity] += Number(r.n);
      }
      incidents.set(r.worker_id, cur);
    }

    const boxes = hosts.map((h, i): FleetBox => {
      const mine = keys.filter((k) => k.boxId === h.id);
      const seen = mine
        .filter((k) => k.lastSeenAt)
        .sort((a, b) => (b.lastSeenAt as Date).getTime() - (a.lastSeenAt as Date).getTime())[0];
      const beat = parseJson<{ receivedAt?: number }>(beats[i]);
      const latest = parseJson<AgentTelemetry & { receivedAt: number; clockSkewMs: number }>(
        latests[i],
      );
      let telemetry: FleetBox['telemetry'] = null;
      if (latest) {
        const { receivedAt: _r, clockSkewMs: _c, ...rest } = latest;
        try {
          telemetry = summarize(rest as AgentTelemetry, now);
        } catch {
          telemetry = null;
        }
      }
      const dispatcher: FleetBoxDispatcherState = !h.workerId
        ? 'not_a_worker'
        : h.workerActive === false
          ? 'disabled'
          : health[i] === '1'
            ? 'in_rotation'
            : 'not_reachable';
      const hw = fleetBoxHardwareSchema.safeParse(h.hardware);
      return {
        id: h.id,
        label: h.label,
        workerId: h.workerId,
        dispatcher,
        agentEnrolled: mine.some((k) => k.revokedAt === null),
        heartbeatAt:
          beat && typeof beat.receivedAt === 'number'
            ? new Date(beat.receivedAt).toISOString()
            : null,
        lastSeenAt: seen?.lastSeenAt ? seen.lastSeenAt.toISOString() : null,
        agentVersion: seen?.agentVersion ?? null,
        hardware: hw.success ? hw.data : null,
        hardwareAt: h.hardwareAt ? h.hardwareAt.toISOString() : null,
        telemetry,
        jobs24h: h.workerId
          ? (jobsCache?.byWorker.get(h.workerId) ?? { completed: 0, failed: 0 })
          : null,
        incidents: incidents.get(h.id) ?? { critical: 0, warning: 0, info: 0 },
      };
    });
    return fleetBoxesSchema.parse({ generatedAt: new Date(now).toISOString(), boxes });
  });
}
