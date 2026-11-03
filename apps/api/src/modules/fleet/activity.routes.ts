import { schema } from '@aivastra/db';
import { fleetActivityListSchema, fleetActivityQuerySchema } from '@aivastra/types';
import { and, desc, eq, inArray, like, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import { requirePermission } from '../admin/guard.js';
import { auditItem, commandItem, incidentEventItem, mergeActivity } from './activity-core.js';

/** Read-only: audit rows for fleet actions, the incident timeline, and finished commands. */
export async function fleetActivityRoutes(app: FastifyInstance) {
  app.get(
    '/admin/fleet/activity',
    {
      preHandler: requirePermission('fleet.view'),
      schema: { querystring: fleetActivityQuerySchema },
    },
    async (req) => {
      const q = req.query as z.infer<typeof fleetActivityQuerySchema>;
      const want = (s: 'AUDIT' | 'INCIDENT' | 'COMMAND') =>
        q.source.length === 0 || q.source.includes(s);
      const take = q.offset + q.limit + 1;
      const actor = schema.users;

      const audit = want('AUDIT')
        ? (
            await app.db
              .select({
                id: schema.auditLogs.id,
                action: schema.auditLogs.action,
                resourceType: schema.auditLogs.resourceType,
                resourceId: schema.auditLogs.resourceId,
                actorEmail: actor.email,
                createdAt: schema.auditLogs.createdAt,
              })
              .from(schema.auditLogs)
              .leftJoin(actor, eq(actor.id, schema.auditLogs.actorUserId))
              .where(
                and(
                  like(schema.auditLogs.action, 'fleet.%'),
                  q.workerId
                    ? and(
                        inArray(schema.auditLogs.resourceType, ['worker', 'fleet_host']),
                        eq(schema.auditLogs.resourceId, q.workerId),
                      )
                    : undefined,
                ),
              )
              .orderBy(desc(schema.auditLogs.createdAt))
              .limit(take)
          ).map(auditItem)
        : [];

      const incidents = want('INCIDENT')
        ? (
            await app.db
              .select({
                id: schema.fleetIncidentEvents.id,
                kind: schema.fleetIncidentEvents.kind,
                at: schema.fleetIncidentEvents.at,
                text: schema.fleetIncidentEvents.text,
                actorEmail: actor.email,
                ruleKey: schema.fleetIncidents.ruleKey,
                workerId: schema.fleetIncidents.workerId,
                incidentSummary: schema.fleetIncidents.summary,
              })
              .from(schema.fleetIncidentEvents)
              .innerJoin(
                schema.fleetIncidents,
                eq(schema.fleetIncidents.id, schema.fleetIncidentEvents.incidentId),
              )
              .leftJoin(actor, eq(actor.id, schema.fleetIncidentEvents.actorUserId))
              .where(q.workerId ? eq(schema.fleetIncidents.workerId, q.workerId) : undefined)
              .orderBy(desc(schema.fleetIncidentEvents.at))
              .limit(take)
          ).map(incidentEventItem)
        : [];

      const commands = want('COMMAND')
        ? (
            await app.db
              .select({
                id: schema.fleetCommands.id,
                workerId: schema.fleetCommands.workerId,
                kind: schema.fleetCommands.kind,
                state: schema.fleetCommands.state,
                finishedAt: schema.fleetCommands.finishedAt,
                result: schema.fleetCommands.result,
              })
              .from(schema.fleetCommands)
              .where(
                and(
                  sql`${schema.fleetCommands.finishedAt} is not null`,
                  q.workerId ? eq(schema.fleetCommands.workerId, q.workerId) : undefined,
                ),
              )
              .orderBy(desc(schema.fleetCommands.finishedAt))
              .limit(take)
          )
            .map(commandItem)
            .filter((i): i is NonNullable<typeof i> => i !== null)
        : [];

      const { items, hasMore } = mergeActivity([audit, incidents, commands], q.limit, q.offset);
      return fleetActivityListSchema.parse({
        generatedAt: new Date().toISOString(),
        items,
        hasMore,
      });
    },
  );
}
