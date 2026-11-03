import { schema } from '@aivastra/db';
import {
  type AgentTelemetry,
  FLEET_SYSTEM_STALE_MS,
  type FleetAgentSummary,
  fleetAgentHeartbeatKey,
  fleetAgentLatestKey,
  fleetAgentSummariesSchema,
} from '@aivastra/types';
import { isNull, sql } from 'drizzle-orm';
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
}
