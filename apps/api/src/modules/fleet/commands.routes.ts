import { schema } from '@aivastra/db';
import {
  fleetCommandCreateSchema,
  fleetCommandsSchema,
  fleetCommandViewSchema,
} from '@aivastra/types';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { recordAudit } from '../admin/audit.js';
import { requirePermission } from '../admin/guard.js';
import { readCommandContext } from './commands-context.js';
import { checkCommand } from './commands-core.js';

const workerParams = z.object({ id: z.string().min(1).max(100) });
const commandParams = z.object({ id: z.string().uuid() });

const iso = (d: Date | null) => (d ? d.toISOString() : null);

const toView = (r: typeof schema.fleetCommands.$inferSelect) =>
  fleetCommandViewSchema.parse({
    id: r.id,
    workerId: r.workerId,
    kind: r.kind,
    reason: r.reason,
    state: r.state,
    requestedAt: r.requestedAt.toISOString(),
    claimedAt: iso(r.claimedAt),
    finishedAt: iso(r.finishedAt),
    result: r.result,
  });

/**
 * Control commands: request, list and cancel. Requesting needs `fleet.operate` (SUPER_ADMIN), the
 * same bar as creating an agent key, and is refused unless commands-core says the action cannot
 * destroy work the dispatcher is tracking. The audit row is written in the same transaction as the
 * request, so no command exists without a record of who asked and why.
 */
export async function fleetCommandRoutes(app: FastifyInstance) {
  app.get(
    '/admin/fleet/workers/:id/commands',
    { preHandler: requirePermission('fleet.view'), schema: { params: workerParams } },
    async (req) => {
      const { id } = req.params as z.infer<typeof workerParams>;
      const rows = await app.db
        .select()
        .from(schema.fleetCommands)
        .where(eq(schema.fleetCommands.workerId, id))
        .orderBy(desc(schema.fleetCommands.requestedAt))
        .limit(20);
      return fleetCommandsSchema.parse({
        workerId: id,
        generatedAt: new Date().toISOString(),
        commands: rows.map(toView),
      });
    },
  );

  app.post(
    '/admin/fleet/workers/:id/commands',
    {
      preHandler: requirePermission('fleet.operate'),
      schema: { params: workerParams, body: fleetCommandCreateSchema },
    },
    async (req, reply) => {
      const { id } = req.params as z.infer<typeof workerParams>;
      const body = req.body as z.infer<typeof fleetCommandCreateSchema>;

      const [worker] = await app.db
        .select({ id: schema.workers.id })
        .from(schema.workers)
        .where(eq(schema.workers.id, id));
      if (!worker) throw new AppError('NOT_FOUND', 404, 'Worker not found');

      const verdict = checkCommand(body.kind, await readCommandContext(app.redis, id, Date.now()));
      if (!verdict.ok) throw new AppError('COMMAND_NOT_ALLOWED', 409, verdict.reason);

      try {
        const row = await app.db.transaction(async (tx) => {
          const [created] = await tx
            .insert(schema.fleetCommands)
            .values({
              workerId: id,
              kind: body.kind,
              reason: body.reason,
              requestedBy: req.userId,
            })
            .returning();
          if (!created) throw new Error('fleet command insert returned no row');
          await recordAudit(tx, {
            actor: { userId: req.userId, role: req.adminRole as string },
            action: 'fleet.command.request',
            resourceType: 'worker',
            resourceId: id,
            after: { commandId: created.id, kind: body.kind, reason: body.reason },
            request: req,
          });
          return created;
        });
        return reply.code(201).send(toView(row));
      } catch (err) {
        // The partial unique index: one live command per worker.
        if ((err as { code?: string }).code === '23505') {
          throw new AppError(
            'COMMAND_IN_PROGRESS',
            409,
            'This worker already has a command waiting or running.',
          );
        }
        throw err;
      }
    },
  );

  app.post(
    '/admin/fleet/commands/:id/cancel',
    { preHandler: requirePermission('fleet.operate'), schema: { params: commandParams } },
    async (req) => {
      const { id } = req.params as z.infer<typeof commandParams>;
      return app.db.transaction(async (tx) => {
        // Only a request nobody has claimed can be cancelled; a running one cannot be recalled.
        const [row] = await tx
          .update(schema.fleetCommands)
          .set({ state: 'CANCELLED', finishedAt: new Date(), result: 'Cancelled by an operator.' })
          .where(and(eq(schema.fleetCommands.id, id), eq(schema.fleetCommands.state, 'PENDING')))
          .returning();
        if (!row) {
          throw new AppError('NOT_FOUND', 404, 'No waiting command with that id');
        }
        await recordAudit(tx, {
          actor: { userId: req.userId, role: req.adminRole as string },
          action: 'fleet.command.cancel',
          resourceType: 'worker',
          resourceId: row.workerId,
          after: { commandId: row.id, kind: row.kind },
          request: req,
        });
        return toView(row);
      });
    },
  );
}
