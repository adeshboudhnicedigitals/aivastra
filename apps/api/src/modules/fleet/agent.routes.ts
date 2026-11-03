import { schema } from '@aivastra/db';
import {
  type AgentTelemetry,
  FLEET_AGENT_MAX_ACTIVE_KEYS_PER_WORKER,
  FLEET_SYSTEM_STALE_MS,
  fleetAgentHeartbeatKey,
  fleetAgentKeyCreatedSchema,
  fleetAgentLatestKey,
  fleetAgentRejectsKey,
  fleetAgentStatusSchema,
  fleetAgentTelemetryViewSchema,
} from '@aivastra/types';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { recordAudit } from '../admin/audit.js';
import { requirePermission } from '../admin/guard.js';
import { generateAgentKey } from './agent-keys.js';
import { deriveGpuSignals } from './signals.js';

const workerParams = z.object({ id: z.string().min(1).max(100) });
const keyParams = z.object({ keyId: z.string().uuid() });
const createKeyBody = z.object({ label: z.string().trim().max(60).optional() }).nullish();

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/**
 * Admin side of the fleet agent: who may push for a worker, whether it is pushing, and what it
 * last said. Reads need `fleet.view`; creating or revoking a key needs `fleet.operate`
 * (SUPER_ADMIN only), because a key is a credential that speaks for a GPU box.
 */
export async function fleetAgentAdminRoutes(app: FastifyInstance) {
  // The `:id` in these routes is a BOX id (fleet_hosts, e.g. "w6"): the agent reports per machine,
  // whether or not the dispatcher uses it. The path keeps its old "workers" segment.
  async function requireWorker(id: string): Promise<void> {
    const [box] = await app.db
      .select({ id: schema.fleetHosts.id })
      .from(schema.fleetHosts)
      .where(eq(schema.fleetHosts.id, id));
    if (!box) throw new AppError('NOT_FOUND', 404, 'Box not found');
  }

  app.get(
    '/admin/fleet/workers/:id/agent',
    { preHandler: requirePermission('fleet.view'), schema: { params: workerParams } },
    async (req) => {
      const { id } = req.params as z.infer<typeof workerParams>;
      await requireWorker(id);
      const [keys, rawBeat, rejects] = await Promise.all([
        app.db
          .select()
          .from(schema.fleetAgents)
          .where(eq(schema.fleetAgents.workerId, id))
          .orderBy(asc(schema.fleetAgents.createdAt)),
        app.redis.get(fleetAgentHeartbeatKey(id)),
        app.redis.get(fleetAgentRejectsKey(id)),
      ]);
      let heartbeat: unknown = null;
      if (rawBeat) {
        try {
          const b = JSON.parse(rawBeat) as {
            observedAt: number;
            receivedAt: number;
            agentVersion: string;
            bootId: string;
          };
          heartbeat = {
            receivedAt: new Date(b.receivedAt).toISOString(),
            observedAt: new Date(b.observedAt).toISOString(),
            agentVersion: b.agentVersion,
            bootId: b.bootId,
          };
        } catch {
          heartbeat = null;
        }
      }
      return fleetAgentStatusSchema.parse({
        workerId: id,
        generatedAt: new Date().toISOString(),
        keys: keys.map((k) => ({
          id: k.id,
          label: k.label,
          keyPrefix: k.keyPrefix,
          createdAt: k.createdAt.toISOString(),
          revokedAt: iso(k.revokedAt),
          lastSeenAt: iso(k.lastSeenAt),
          agentVersion: k.agentVersion,
        })),
        heartbeat,
        rejectsLastHour: Number(rejects ?? 0) || 0,
      });
    },
  );

  app.get(
    '/admin/fleet/workers/:id/telemetry',
    { preHandler: requirePermission('fleet.view'), schema: { params: workerParams } },
    async (req) => {
      const { id } = req.params as z.infer<typeof workerParams>;
      await requireWorker(id);
      const now = Date.now();
      const raw = await app.redis.get(fleetAgentLatestKey(id));
      let telemetry: AgentTelemetry | null = null;
      let receivedAt: number | null = null;
      let clockSkewMs: number | null = null;
      if (raw) {
        try {
          const {
            receivedAt: r,
            clockSkewMs: c,
            ...rest
          } = JSON.parse(raw) as AgentTelemetry & {
            receivedAt: number;
            clockSkewMs: number;
          };
          telemetry = rest;
          receivedAt = r;
          clockSkewMs = c;
        } catch {
          // An unreadable value is reported as "nothing", never as a half-parsed sample.
          telemetry = null;
        }
      }
      return fleetAgentTelemetryViewSchema.parse({
        workerId: id,
        generatedAt: new Date(now).toISOString(),
        telemetry,
        receivedAt: receivedAt === null ? null : new Date(receivedAt).toISOString(),
        stale: telemetry === null ? true : now - telemetry.observedAt > FLEET_SYSTEM_STALE_MS,
        clockSkewMs,
        signals: telemetry ? deriveGpuSignals(telemetry) : [],
      });
    },
  );

  app.post(
    '/admin/fleet/workers/:id/agent-keys',
    {
      preHandler: requirePermission('fleet.operate'),
      schema: { params: workerParams, body: createKeyBody },
    },
    async (req, reply) => {
      const { id } = req.params as z.infer<typeof workerParams>;
      const label = (req.body as z.infer<typeof createKeyBody>)?.label ?? '';
      await requireWorker(id);
      const generated = generateAgentKey();

      const created = await app.db.transaction(async (tx) => {
        const active = await tx
          .select({ id: schema.fleetAgents.id })
          .from(schema.fleetAgents)
          .where(and(eq(schema.fleetAgents.workerId, id), isNull(schema.fleetAgents.revokedAt)));
        // Two active keys covers a rotation; more means old ones were never revoked.
        if (active.length >= FLEET_AGENT_MAX_ACTIVE_KEYS_PER_WORKER) {
          throw new AppError(
            'TOO_MANY_KEYS',
            409,
            `this worker already has ${active.length} active keys; revoke one first`,
          );
        }
        const [row] = await tx
          .insert(schema.fleetAgents)
          .values({
            workerId: id,
            label,
            keyHash: generated.keyHash,
            keyPrefix: generated.keyPrefix,
            createdBy: req.userId,
          })
          .returning();
        if (!row) throw new AppError('INSERT_FAILED', 500, 'Failed to create key');
        // Never the key or its hash: the audit log is readable by more people than the key is.
        await recordAudit(tx, {
          actor: { userId: req.userId, role: req.adminRole as string },
          action: 'fleet.agent_key.create',
          resourceType: 'fleet_host',
          resourceId: id,
          after: { keyId: row.id, keyPrefix: row.keyPrefix, label },
          request: req,
        });
        return row;
      });

      // The only response that will ever contain the plaintext key.
      reply.header('cache-control', 'no-store');
      return reply.code(201).send(
        fleetAgentKeyCreatedSchema.parse({
          id: created.id,
          label: created.label,
          keyPrefix: created.keyPrefix,
          createdAt: created.createdAt.toISOString(),
          revokedAt: null,
          lastSeenAt: null,
          agentVersion: null,
          key: generated.key,
        }),
      );
    },
  );

  app.delete(
    '/admin/fleet/agent-keys/:keyId',
    { preHandler: requirePermission('fleet.operate'), schema: { params: keyParams } },
    async (req) => {
      const { keyId } = req.params as z.infer<typeof keyParams>;
      return app.db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(schema.fleetAgents)
          .where(eq(schema.fleetAgents.id, keyId))
          .for('update');
        if (!row) throw new AppError('NOT_FOUND', 404, 'Key not found');
        // Revoking twice is a no-op and writes no second audit row.
        if (row.revokedAt) return { ok: true, changed: false };
        await tx
          .update(schema.fleetAgents)
          .set({ revokedAt: new Date(), revokedBy: req.userId })
          .where(eq(schema.fleetAgents.id, keyId));
        await recordAudit(tx, {
          actor: { userId: req.userId, role: req.adminRole as string },
          action: 'fleet.agent_key.revoke',
          resourceType: 'fleet_host',
          resourceId: row.workerId,
          before: { keyId: row.id, keyPrefix: row.keyPrefix, label: row.label },
          request: req,
        });
        return { ok: true, changed: true };
      });
    },
  );
}
