import { schema } from '@aivastra/db';
import {
  type AgentTelemetry,
  FLEET_ALERT_RULES,
  type FleetAlertRuleKey,
  fleetAgentHeartbeatKey,
  fleetAgentLatestKey,
  fleetAgentRejectsKey,
  fleetAlertRuleKeys,
} from '@aivastra/types';
import { and, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  type DispatcherView,
  decide,
  EMPTY_HYSTERESIS,
  type Hysteresis,
  type Observation,
  observe,
  THERMAL_SLOWDOWN_WINDOW_MS,
  type WorkerContext,
} from './evaluator-core.js';
import { notifyFleetIncident } from './notify.js';
import { silencedWorkers } from './operations-core.js';

// Opens, escalates and recovers incidents (docs/fleet-agent-design.md section 7).
//
// Safe to run from more than one api process: an incident is opened with INSERT ... ON CONFLICT DO
// NOTHING against the one-live-incident-per-(rule, worker) unique index, and recovered with an
// UPDATE guarded by `state <> 'RECOVERED'`, so only the process whose write actually changed a
// row records the timeline event. Hysteresis windows live in Redis so a second process (or a
// restart) continues the same window instead of restarting it.

const TICK_INTERVAL_MS = 15_000;
const HYSTERESIS_TTL_SEC = 24 * 60 * 60;
// The dispatcher samples /queue every 15 s; a snapshot older than this is not a current probe.
const DISPATCHER_PROBE_FRESH_MS = 45_000;

const hysteresisKey = (rule: string, workerId: string) => `fleet:eval:${rule}:${workerId}`;

function dispatcherView(
  healthRaw: string | null,
  queueRaw: string | null,
  now: number,
): DispatcherView {
  // The dispatcher health monitor renews this while ComfyUI answers /system_stats.
  if (healthRaw === '1') return 'reachable';
  if (!queueRaw) return 'unknown';
  try {
    const snap = JSON.parse(queueRaw) as { probedAt?: unknown; error?: unknown };
    if (typeof snap.probedAt !== 'number' || now - snap.probedAt > DISPATCHER_PROBE_FRESH_MS) {
      return 'unknown';
    }
    // A fresh probe that failed, with no healthy key: the dispatcher is running and ComfyUI is
    // not answering. A missing/stale snapshot above means the dispatcher itself may be down, which
    // says nothing about the box, so it stays unknown rather than alerting.
    return typeof snap.error === 'string' ? 'unreachable' : 'reachable';
  } catch {
    return 'unknown';
  }
}

function parseLatest(raw: string | null): { telemetry: AgentTelemetry; skewMs: number } | null {
  if (!raw) return null;
  try {
    const {
      receivedAt: _r,
      clockSkewMs,
      ...rest
    } = JSON.parse(raw) as AgentTelemetry & {
      receivedAt: number;
      clockSkewMs: number;
    };
    return { telemetry: rest, skewMs: clockSkewMs };
  } catch {
    return null;
  }
}

type RuleConfig = typeof schema.fleetAlertRules.$inferSelect;
type LiveIncident = typeof schema.fleetIncidents.$inferSelect;

async function readHysteresis(
  app: FastifyInstance,
  pairs: { rule: string; workerId: string }[],
): Promise<Map<string, Hysteresis>> {
  const out = new Map<string, Hysteresis>();
  if (pairs.length === 0) return out;
  const raws = await app.redis.mget(pairs.map((p) => hysteresisKey(p.rule, p.workerId)));
  pairs.forEach((p, i) => {
    let h = EMPTY_HYSTERESIS;
    const raw = raws[i];
    if (raw) {
      try {
        const v = JSON.parse(raw) as Partial<Hysteresis>;
        h = {
          pendingSince: typeof v.pendingSince === 'number' ? v.pendingSince : null,
          clearSince: typeof v.clearSince === 'number' ? v.clearSince : null,
        };
      } catch {
        h = EMPTY_HYSTERESIS;
      }
    }
    out.set(`${p.rule}|${p.workerId}`, h);
  });
  return out;
}

async function openIncident(
  app: FastifyInstance,
  rule: FleetAlertRuleKey,
  cfg: RuleConfig,
  workerId: string,
  obs: Extract<Observation, { status: 'breach' }>,
  now: number,
): Promise<boolean> {
  return app.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.fleetIncidents)
      .values({
        ruleKey: rule,
        workerId,
        state: 'OPEN',
        severity: cfg.severity,
        summary: obs.summary,
        evidence: obs.evidence,
        openedAt: new Date(now),
      })
      .onConflictDoNothing()
      .returning({ id: schema.fleetIncidents.id });
    if (!row) return false; // another process opened it first
    await tx
      .insert(schema.fleetIncidentEvents)
      .values({ incidentId: row.id, kind: 'OPENED', at: new Date(now), text: obs.summary });
    return true;
  });
}

async function recoverIncident(
  app: FastifyInstance,
  incident: LiveIncident,
  now: number,
  text: string,
): Promise<boolean> {
  return app.db.transaction(async (tx) => {
    const [row] = await tx
      .update(schema.fleetIncidents)
      .set({ state: 'RECOVERED', recoveredAt: new Date(now) })
      .where(
        and(
          eq(schema.fleetIncidents.id, incident.id),
          ne(schema.fleetIncidents.state, 'RECOVERED'),
        ),
      )
      .returning({ id: schema.fleetIncidents.id });
    if (!row) return false;
    await tx
      .insert(schema.fleetIncidentEvents)
      .values({ incidentId: incident.id, kind: 'RECOVERED', at: new Date(now), text });
    return true;
  });
}

async function escalateIncident(
  app: FastifyInstance,
  incident: LiveIncident,
  now: number,
  text: string,
): Promise<boolean> {
  return app.db.transaction(async (tx) => {
    const [row] = await tx
      .update(schema.fleetIncidents)
      .set({ severity: 'critical' })
      .where(
        and(
          eq(schema.fleetIncidents.id, incident.id),
          ne(schema.fleetIncidents.state, 'RECOVERED'),
          ne(schema.fleetIncidents.severity, 'critical'),
        ),
      )
      .returning({ id: schema.fleetIncidents.id });
    if (!row) return false;
    await tx
      .insert(schema.fleetIncidentEvents)
      .values({ incidentId: incident.id, kind: 'ESCALATED', at: new Date(now), text });
    return true;
  });
}

export type EvaluatorTickResult = {
  opened: number;
  recovered: number;
  escalated: number;
  workers: number;
};

/**
 * Per worker, the longest time any GPU spent thermally slowed in the window: the rise of the
 * driver's cumulative counter between the first and the last reading. A GPU with fewer than two
 * readings, or whose counter fell (the driver reloaded), contributes nothing, so the worker reads
 * "unknown" rather than "fine".
 */
export async function thermalSlowedByWorker(
  app: FastifyInstance,
  workerIds: string[],
  now: number,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!workerIds.length) return out;
  const since = new Date(now - THERMAL_SLOWDOWN_WINDOW_MS).toISOString();
  const rows = await app.db.execute<{ worker_id: string; delta_us: string | number }>(sql`
    SELECT worker_id,
           max((last_us - first_us)) AS delta_us
    FROM (
      SELECT worker_id, gpu_index,
             (array_agg(hw_thermal_slowdown_us ORDER BY observed_at DESC))[1] AS last_us,
             (array_agg(hw_thermal_slowdown_us ORDER BY observed_at ASC))[1] AS first_us
      FROM fleet_gpu_samples
      WHERE worker_id IN (${sql.join(
        workerIds.map((id) => sql`${id}`),
        sql`, `,
      )})
        AND observed_at >= ${since}::timestamptz AND hw_thermal_slowdown_us IS NOT NULL
      GROUP BY worker_id, gpu_index
      HAVING count(*) >= 2
    ) per_gpu
    WHERE last_us >= first_us
    GROUP BY worker_id
  `);
  for (const r of rows) out.set(r.worker_id, Number(r.delta_us) / 1000);
  return out;
}

/**
 * One evaluation pass. Exported so a test can drive it with a chosen clock.
 *
 * A worker is monitored when it is active and holds at least one unrevoked agent key. Without an
 * agent there is no box-side evidence, so no incident is opened for it; incidents already live for
 * a worker that stopped being monitored (key revoked, worker deactivated) or for a rule that was
 * disabled are recovered with that reason rather than left open forever.
 */
export async function runFleetEvaluatorTick(
  app: FastifyInstance,
  opts: { now?: number } = {},
): Promise<EvaluatorTickResult> {
  const now = opts.now ?? Date.now();
  const result: EvaluatorTickResult = { opened: 0, recovered: 0, escalated: 0, workers: 0 };

  const [ruleRows, monitoredRows, liveRows, windowRows] = await Promise.all([
    app.db.select().from(schema.fleetAlertRules),
    // Every box with a working agent key is watched, whether or not the dispatcher uses it: a
    // disabled worker's box can still overheat or fill its disk. `workerId` is the box id; the
    // linked dispatcher worker (if active) only feeds the dispatcher-side view below.
    app.db
      .select({
        workerId: schema.fleetAgents.workerId,
        lastSeenAt: schema.fleetAgents.lastSeenAt,
        dispatcherWorkerId: schema.fleetHosts.workerId,
        dispatcherWorkerActive: schema.workers.isActive,
      })
      .from(schema.fleetAgents)
      .innerJoin(schema.fleetHosts, eq(schema.fleetHosts.id, schema.fleetAgents.workerId))
      .leftJoin(schema.workers, eq(schema.workers.id, schema.fleetHosts.workerId))
      .where(isNull(schema.fleetAgents.revokedAt)),
    app.db.select().from(schema.fleetIncidents).where(ne(schema.fleetIncidents.state, 'RECOVERED')),
    app.db
      .select({
        workerId: schema.fleetMaintenanceWindows.workerId,
        startsAt: schema.fleetMaintenanceWindows.startsAt,
        endsAt: schema.fleetMaintenanceWindows.endsAt,
        state: schema.fleetMaintenanceWindows.state,
      })
      .from(schema.fleetMaintenanceWindows)
      .where(
        and(
          eq(schema.fleetMaintenanceWindows.state, 'SCHEDULED'),
          gt(schema.fleetMaintenanceWindows.endsAt, new Date(now)),
        ),
      ),
  ]);
  // A worker inside a maintenance window gets no new incidents, escalations or emails. Evidence is
  // still collected, and an incident already open keeps recovering normally (without an email).
  // Box -> its active dispatcher worker. A box without one has no dispatcher view ('unknown').
  const dispatcherOf = new Map<string, string>();
  for (const m of monitoredRows) {
    if (m.dispatcherWorkerId && m.dispatcherWorkerActive === true) {
      dispatcherOf.set(m.workerId, m.dispatcherWorkerId);
    }
  }
  // Maintenance windows are set per dispatcher worker; they silence the box that worker runs on.
  const silencedDispatcher = silencedWorkers(windowRows, now);
  const silenced = new Set<string>(
    monitoredRows
      .filter((m) => m.dispatcherWorkerId && silencedDispatcher.has(m.dispatcherWorkerId))
      .map((m) => m.workerId),
  );

  const rules = new Map<string, RuleConfig>(ruleRows.map((r) => [r.key, r]));
  // Most recent contact across the worker's keys; a rotation briefly holds two.
  const lastSeen = new Map<string, number | null>();
  for (const m of monitoredRows) {
    const t = m.lastSeenAt ? m.lastSeenAt.getTime() : null;
    const prev = lastSeen.get(m.workerId);
    lastSeen.set(m.workerId, prev === undefined ? t : t === null ? prev : Math.max(prev ?? 0, t));
  }
  const live = new Map<string, LiveIncident>(
    liveRows.map((i) => [`${i.ruleKey}|${i.workerId}`, i]),
  );
  result.workers = lastSeen.size;

  // Recover what is no longer evaluable.
  for (const inc of liveRows) {
    const cfg = rules.get(inc.ruleKey);
    const known = (fleetAlertRuleKeys as readonly string[]).includes(inc.ruleKey);
    const reason = !lastSeen.has(inc.workerId)
      ? 'Closed because this box is no longer monitored (no active agent key).'
      : !known || !cfg?.enabled
        ? 'Closed because this alert rule was disabled.'
        : null;
    if (reason && (await recoverIncident(app, inc, now, reason))) {
      result.recovered++;
      live.delete(`${inc.ruleKey}|${inc.workerId}`);
    }
  }

  const workerIds = [...lastSeen.keys()];
  const activeRules = fleetAlertRuleKeys.filter((k) => rules.get(k)?.enabled);
  const pairs = workerIds.flatMap((workerId) => activeRules.map((rule) => ({ rule, workerId })));
  const hysteresis = await readHysteresis(app, pairs);
  const thermalSlowed = activeRules.includes('thermal_slowdown')
    ? await thermalSlowedByWorker(app, workerIds, now)
    : new Map<string, number>();

  for (const workerId of workerIds) {
    const [beat, latestRaw, rejects, health, queue] = await app.redis.mget([
      fleetAgentHeartbeatKey(workerId),
      fleetAgentLatestKey(workerId),
      fleetAgentRejectsKey(workerId),
      `worker:health:${dispatcherOf.get(workerId) ?? '__none__'}`,
      `worker:queue:${dispatcherOf.get(workerId) ?? '__none__'}`,
    ]);
    const latest = parseLatest(latestRaw);
    const ctx: WorkerContext = {
      now,
      agentAlive: beat !== null,
      agentLastSeenAt: lastSeen.get(workerId) ?? null,
      dispatcher: dispatcherView(health, queue, now),
      telemetry: latest?.telemetry ?? null,
      clockSkewMs: latest?.skewMs ?? null,
      rejectsLastHour: Number(rejects ?? 0) || 0,
      thermalSlowedMs: thermalSlowed.get(workerId) ?? null,
    };

    for (const rule of activeRules) {
      const cfg = rules.get(rule);
      if (!cfg) continue;
      const key = `${rule}|${workerId}`;
      const incident = live.get(key);
      const obs = observe(rule, ctx, cfg.params);
      const prev = hysteresis.get(key) ?? EMPTY_HYSTERESIS;
      const d = decide({
        obs,
        live: incident !== undefined,
        state: prev,
        now,
        forMs: cfg.forSeconds * 1000,
        clearMs: cfg.clearSeconds * 1000,
      });

      const quiet = silenced.has(workerId);
      if (d.action === 'open' && obs.status === 'breach') {
        // Inside a window nothing opens. If the condition outlasts the window it is evaluated
        // afresh and opens after its normal "for" period.
        if (!quiet && (await openIncident(app, rule, cfg, workerId, obs, now))) {
          result.opened++;
          void notifyFleetIncident(app, {
            kind: 'opened',
            severity: cfg.severity,
            workerId,
            ruleKey: rule,
            summary: obs.summary,
          });
        }
      } else if (d.action === 'recover' && incident) {
        if (await recoverIncident(app, incident, now, 'The condition has cleared.')) {
          result.recovered++;
          if (!quiet) {
            void notifyFleetIncident(app, {
              kind: 'recovered',
              severity: incident.severity,
              workerId,
              ruleKey: rule,
              summary: incident.summary,
            });
          }
        }
      } else if (
        rule === 'agent_silent' &&
        !quiet &&
        incident &&
        obs.status === 'breach' &&
        incident.severity !== 'critical'
      ) {
        // Escalate on how long the agent has actually been silent, not on how long the incident
        // has existed, so a raised "for" window does not delay it.
        const limit = (cfg.params.criticalAfterSeconds ??
          FLEET_ALERT_RULES.agent_silent.params.criticalAfterSeconds.default) as number;
        const silentFor = (now - (ctx.agentLastSeenAt ?? now)) / 1000;
        if (silentFor >= limit) {
          const text = `Still silent after ${Math.round(silentFor)} s; escalated to critical.`;
          if (await escalateIncident(app, incident, now, text)) {
            result.escalated++;
            void notifyFleetIncident(app, {
              kind: 'escalated',
              severity: 'critical',
              workerId,
              ruleKey: rule,
              summary: text,
            });
          }
        }
      }

      const changed =
        prev.pendingSince !== d.next.pendingSince || prev.clearSince !== d.next.clearSince;
      if (changed) {
        const rk = hysteresisKey(rule, workerId);
        if (d.next.pendingSince === null && d.next.clearSince === null) {
          await app.redis.del(rk);
        } else {
          await app.redis.set(rk, JSON.stringify(d.next), 'EX', HYSTERESIS_TTL_SEC);
        }
      }
    }
  }
  return result;
}

/** Call once after `app.listen(...)`. Returns a stop function so tests can tear the timer down. */
export function startFleetEvaluator(
  app: FastifyInstance,
  intervalMs: number = TICK_INTERVAL_MS,
): () => void {
  let running = false;
  const tick = () => {
    if (running) {
      app.log.warn('fleet evaluator tick still running — skipping this interval');
      return;
    }
    running = true;
    void runFleetEvaluatorTick(app)
      .then((r) => {
        if (r.opened || r.recovered || r.escalated) app.log.info(r, 'fleet evaluator tick');
      })
      .catch((err) => app.log.error({ err }, 'fleet evaluator tick failed'))
      .finally(() => {
        running = false;
      });
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
