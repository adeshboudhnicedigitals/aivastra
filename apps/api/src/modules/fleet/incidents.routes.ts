import { schema } from '@aivastra/db';
import {
  FLEET_ALERT_RULES,
  type FleetAlertParamDef,
  type FleetAlertRuleKey,
  fleetAlertRulePatchSchema,
  fleetAlertRulesSchema,
  fleetAlertRuleViewSchema,
  fleetIncidentAckBodySchema,
  fleetIncidentDetailSchema,
  fleetIncidentListQuerySchema,
  fleetIncidentListSchema,
  fleetIncidentNoteBodySchema,
  fleetIncidentSummarySchema,
} from '@aivastra/types';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { recordAudit } from '../admin/audit.js';
import { requirePermission } from '../admin/guard.js';

const idParams = z.object({ id: z.string().uuid() });
const keyParams = z.object({ key: z.string().min(1).max(64) });

const iso = (d: Date | null) => (d ? d.toISOString() : null);

type IncidentRow = typeof schema.fleetIncidents.$inferSelect;
type Person = { id: string; email: string | null } | null;

function toIncident(row: IncidentRow, ackedBy: Person) {
  return {
    id: row.id,
    ruleKey: row.ruleKey,
    workerId: row.workerId,
    state: row.state,
    severity: row.severity,
    summary: row.summary,
    evidence: row.evidence,
    openedAt: row.openedAt.toISOString(),
    ackedAt: iso(row.ackedAt),
    ackedBy,
    recoveredAt: iso(row.recoveredAt),
  };
}

function toRuleView(
  key: FleetAlertRuleKey,
  row: typeof schema.fleetAlertRules.$inferSelect | undefined,
) {
  const def = FLEET_ALERT_RULES[key];
  const defs: Record<string, FleetAlertParamDef> = def.params;
  const stored = row?.params ?? {};
  return {
    key,
    description: def.description,
    severity: row?.severity ?? def.severity,
    enabled: row?.enabled ?? true,
    forSeconds: row?.forSeconds ?? def.forSeconds,
    clearSeconds: row?.clearSeconds ?? def.clearSeconds,
    params: Object.fromEntries(
      Object.entries(defs).map(([name, p]) => [
        name,
        {
          // A stored value outside the catalog bounds (a bound tightened later) is shown as the
          // default rather than trusted, and the evaluator applies the same rule.
          value:
            typeof stored[name] === 'number' && stored[name] >= p.min && stored[name] <= p.max
              ? stored[name]
              : p.default,
          default: p.default,
          min: p.min,
          max: p.max,
          unit: p.unit,
          label: p.label,
        },
      ]),
    ),
    // When a person last tuned it. A row that still has its seeded values has no updated_by, and
    // showing the migration time would claim a change nobody made.
    updatedAt: row?.updatedBy ? iso(row.updatedAt) : null,
  };
}

/**
 * Incidents and alert rules. Reads need `fleet.view`. Acknowledging and noting need `fleet.ack`
 * (ADMIN and SUPER_ADMIN); neither changes any worker. Tuning a rule needs `fleet.operate`
 * (SUPER_ADMIN), because it changes what the on-call is told about. Incidents are opened and
 * recovered by the evaluator, never through this API.
 */
export async function fleetIncidentRoutes(app: FastifyInstance) {
  async function loadPerson(userId: string | null): Promise<Person> {
    if (!userId) return null;
    const [u] = await app.db
      .select({ id: schema.users.id, email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, userId));
    return u ?? null;
  }

  app.get(
    '/admin/fleet/incidents',
    {
      preHandler: requirePermission('fleet.view'),
      schema: { querystring: fleetIncidentListQuerySchema },
    },
    async (req) => {
      const q = req.query as z.infer<typeof fleetIncidentListQuerySchema>;
      const where = and(
        q.state ? inArray(schema.fleetIncidents.state, q.state) : undefined,
        q.workerId ? eq(schema.fleetIncidents.workerId, q.workerId) : undefined,
        q.severity ? eq(schema.fleetIncidents.severity, q.severity) : undefined,
        q.ruleKey ? eq(schema.fleetIncidents.ruleKey, q.ruleKey) : undefined,
      );
      const [rows, [count]] = await Promise.all([
        app.db
          .select({
            incident: schema.fleetIncidents,
            ackedById: schema.users.id,
            ackedByEmail: schema.users.email,
          })
          .from(schema.fleetIncidents)
          .leftJoin(schema.users, eq(schema.users.id, schema.fleetIncidents.ackedBy))
          .where(where)
          // Live incidents first, then recovered ones, newest first within each group.
          .orderBy(
            sql`(${schema.fleetIncidents.state} = 'RECOVERED')`,
            desc(schema.fleetIncidents.openedAt),
          )
          .limit(q.limit)
          .offset(q.offset),
        app.db.select({ n: sql<number>`count(*)::int` }).from(schema.fleetIncidents).where(where),
      ]);
      return fleetIncidentListSchema.parse({
        generatedAt: new Date().toISOString(),
        total: count?.n ?? 0,
        items: rows.map((r) =>
          toIncident(r.incident, r.ackedById ? { id: r.ackedById, email: r.ackedByEmail } : null),
        ),
      });
    },
  );

  app.get(
    '/admin/fleet/incidents/summary',
    { preHandler: requirePermission('fleet.view') },
    async () => {
      const rows = await app.db
        .select({
          state: schema.fleetIncidents.state,
          severity: schema.fleetIncidents.severity,
          n: sql<number>`count(*)::int`,
        })
        .from(schema.fleetIncidents)
        .where(inArray(schema.fleetIncidents.state, ['OPEN', 'ACK']))
        .groupBy(schema.fleetIncidents.state, schema.fleetIncidents.severity);
      const out = {
        open: 0,
        acknowledged: 0,
        bySeverity: { critical: 0, warning: 0, info: 0 },
      };
      for (const r of rows) {
        if (r.state === 'OPEN') out.open += r.n;
        else out.acknowledged += r.n;
        if (r.severity in out.bySeverity) {
          out.bySeverity[r.severity as keyof typeof out.bySeverity] += r.n;
        }
      }
      return fleetIncidentSummarySchema.parse({ generatedAt: new Date().toISOString(), ...out });
    },
  );

  app.get(
    '/admin/fleet/incidents/:id',
    { preHandler: requirePermission('fleet.view'), schema: { params: idParams } },
    async (req) => {
      const { id } = req.params as z.infer<typeof idParams>;
      const [row] = await app.db
        .select()
        .from(schema.fleetIncidents)
        .where(eq(schema.fleetIncidents.id, id));
      if (!row) throw new AppError('NOT_FOUND', 404, 'Incident not found');
      const events = await app.db
        .select({
          id: schema.fleetIncidentEvents.id,
          kind: schema.fleetIncidentEvents.kind,
          at: schema.fleetIncidentEvents.at,
          text: schema.fleetIncidentEvents.text,
          actorId: schema.users.id,
          actorEmail: schema.users.email,
        })
        .from(schema.fleetIncidentEvents)
        .leftJoin(schema.users, eq(schema.users.id, schema.fleetIncidentEvents.actorUserId))
        .where(eq(schema.fleetIncidentEvents.incidentId, id))
        .orderBy(asc(schema.fleetIncidentEvents.at), asc(schema.fleetIncidentEvents.id));
      return fleetIncidentDetailSchema.parse({
        generatedAt: new Date().toISOString(),
        incident: toIncident(row, await loadPerson(row.ackedBy)),
        events: events.map((e) => ({
          id: e.id,
          kind: e.kind,
          at: e.at.toISOString(),
          actor: e.actorId ? { id: e.actorId, email: e.actorEmail } : null,
          text: e.text,
        })),
      });
    },
  );

  app.post(
    '/admin/fleet/incidents/:id/ack',
    {
      preHandler: requirePermission('fleet.ack'),
      schema: { params: idParams, body: fleetIncidentAckBodySchema },
    },
    async (req) => {
      const { id } = req.params as z.infer<typeof idParams>;
      const note = (req.body as z.infer<typeof fleetIncidentAckBodySchema>)?.note;
      return app.db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(schema.fleetIncidents)
          .where(eq(schema.fleetIncidents.id, id))
          .for('update');
        if (!row) throw new AppError('NOT_FOUND', 404, 'Incident not found');
        // Only an OPEN incident can be acknowledged. A repeat, or an ack of one that already
        // recovered, changes nothing and writes no second audit row.
        if (row.state !== 'OPEN') return { ok: true, changed: false, state: row.state };
        await tx
          .update(schema.fleetIncidents)
          .set({ state: 'ACK', ackedAt: new Date(), ackedBy: req.userId })
          .where(eq(schema.fleetIncidents.id, id));
        await tx.insert(schema.fleetIncidentEvents).values({
          incidentId: id,
          kind: 'ACK',
          actorUserId: req.userId,
          text: note ?? null,
        });
        await recordAudit(tx, {
          actor: { userId: req.userId, role: req.adminRole as string },
          action: 'fleet.incident.ack',
          resourceType: 'fleet_incident',
          resourceId: id,
          before: { state: 'OPEN' },
          after: { state: 'ACK', ruleKey: row.ruleKey, workerId: row.workerId, note: note ?? null },
          request: req,
        });
        return { ok: true, changed: true, state: 'ACK' };
      });
    },
  );

  app.post(
    '/admin/fleet/incidents/:id/notes',
    {
      preHandler: requirePermission('fleet.ack'),
      schema: { params: idParams, body: fleetIncidentNoteBodySchema },
    },
    async (req, reply) => {
      const { id } = req.params as z.infer<typeof idParams>;
      const { text } = req.body as z.infer<typeof fleetIncidentNoteBodySchema>;
      const eventId = await app.db.transaction(async (tx) => {
        const [row] = await tx
          .select({ id: schema.fleetIncidents.id, ruleKey: schema.fleetIncidents.ruleKey })
          .from(schema.fleetIncidents)
          .where(eq(schema.fleetIncidents.id, id))
          .for('update');
        if (!row) throw new AppError('NOT_FOUND', 404, 'Incident not found');
        // Notes are allowed in any state: the usual one is written after recovery ("it was the
        // provider, ticket 123").
        const [ev] = await tx
          .insert(schema.fleetIncidentEvents)
          .values({ incidentId: id, kind: 'NOTE', actorUserId: req.userId, text })
          .returning({ id: schema.fleetIncidentEvents.id });
        await recordAudit(tx, {
          actor: { userId: req.userId, role: req.adminRole as string },
          action: 'fleet.incident.note',
          resourceType: 'fleet_incident',
          resourceId: id,
          after: { ruleKey: row.ruleKey, text },
          request: req,
        });
        return ev?.id;
      });
      return reply.code(201).send({ ok: true, eventId });
    },
  );

  app.get('/admin/fleet/alert-rules', { preHandler: requirePermission('fleet.view') }, async () => {
    const rows = await app.db.select().from(schema.fleetAlertRules);
    const byKey = new Map(rows.map((r) => [r.key, r]));
    const keys = Object.keys(FLEET_ALERT_RULES) as FleetAlertRuleKey[];
    return fleetAlertRulesSchema.parse({
      generatedAt: new Date().toISOString(),
      rules: keys.map((k) => toRuleView(k, byKey.get(k))),
    });
  });

  app.patch(
    '/admin/fleet/alert-rules/:key',
    {
      preHandler: requirePermission('fleet.operate'),
      schema: { params: keyParams, body: fleetAlertRulePatchSchema },
    },
    async (req) => {
      const { key } = req.params as z.infer<typeof keyParams>;
      if (!(key in FLEET_ALERT_RULES)) throw new AppError('NOT_FOUND', 404, 'Unknown alert rule');
      const ruleKey = key as FleetAlertRuleKey;
      const def = FLEET_ALERT_RULES[ruleKey];
      const patch = req.body as z.infer<typeof fleetAlertRulePatchSchema>;
      const defs: Record<string, FleetAlertParamDef> = def.params;

      if (patch.params) {
        for (const [name, value] of Object.entries(patch.params)) {
          const p = defs[name];
          if (!p) throw new AppError('VALIDATION', 400, `${key} has no parameter "${name}"`);
          if (value < p.min || value > p.max) {
            throw new AppError('VALIDATION', 400, `${name} must be between ${p.min} and ${p.max}`);
          }
        }
      }

      return app.db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(schema.fleetAlertRules)
          .where(eq(schema.fleetAlertRules.key, ruleKey))
          .for('update');
        const before = toRuleView(ruleKey, current);
        const beforeParams = Object.fromEntries(
          Object.entries(before.params).map(([n, p]) => [n, p.value]),
        );
        const merged = {
          severity: patch.severity ?? before.severity,
          enabled: patch.enabled ?? before.enabled,
          forSeconds: patch.forSeconds ?? before.forSeconds,
          clearSeconds: patch.clearSeconds ?? before.clearSeconds,
          params: { ...beforeParams, ...(patch.params ?? {}) },
        };
        const [row] = await tx
          .insert(schema.fleetAlertRules)
          .values({ key: ruleKey, ...merged, updatedBy: req.userId, updatedAt: new Date() })
          .onConflictDoUpdate({
            target: schema.fleetAlertRules.key,
            set: { ...merged, updatedBy: req.userId, updatedAt: new Date() },
          })
          .returning();
        const after = toRuleView(ruleKey, row);
        await recordAudit(tx, {
          actor: { userId: req.userId, role: req.adminRole as string },
          action: 'fleet.alert_rule.update',
          resourceType: 'fleet_alert_rule',
          resourceId: ruleKey,
          before: {
            severity: before.severity,
            enabled: before.enabled,
            forSeconds: before.forSeconds,
            clearSeconds: before.clearSeconds,
            params: beforeParams,
          },
          after: merged,
          request: req,
        });
        return fleetAlertRuleViewSchema.parse(after);
      });
    },
  );
}
