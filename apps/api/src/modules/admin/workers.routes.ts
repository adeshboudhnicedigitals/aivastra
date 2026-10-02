import { schema } from '@aivastra/db';
import {
  capabilitiesKey,
  capabilityMutationError,
  comfyVersionKey,
  WORKER_POOL,
  workerCapabilitiesSchema,
  workerPoolSchema,
} from '@aivastra/types';
import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { recordAudit } from './audit.js';
import { requirePermission } from './guard.js';
import { readWorkerCapabilities, requireCapabilityDrain } from './worker-capabilities.js';

const REGISTRY_KEY = 'worker:registry';

function healthKey(id: string) {
  return `worker:health:${id}`;
}

// Per-worker routing flags, written here and read by the dispatcher's selectWorker.
// Kept outside worker:registry (the dispatcher rebuilds those entries on boot). Missing
// = queue gating off. Keep in sync with routingConfigKey in apps/dispatcher/src/worker/registry.ts.
function routingConfigKey(id: string) {
  return `worker:routing-config:${id}`;
}

async function readQueueGate(redis: FastifyInstance['redis'], id: string): Promise<boolean> {
  const raw = await redis.get(routingConfigKey(id));
  if (!raw) return false;
  try {
    return (JSON.parse(raw) as { queueGateEnabled?: unknown }).queueGateEnabled === true;
  } catch {
    return false;
  }
}

// Display snapshot written by the dispatcher health monitor (worker/queue-sampler.ts).
interface QueueSnapshot {
  queueRemaining: number | null;
  running: number | null;
  pending: number | null;
  probedAt: number;
  error?: string;
}

async function readQueueSnapshot(
  redis: FastifyInstance['redis'],
  id: string,
): Promise<QueueSnapshot | null> {
  const raw = await redis.get(`worker:queue:${id}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as QueueSnapshot;
  } catch {
    return null;
  }
}

/**
 * Whether the dispatcher can actually route to this worker right now, so "healthy but never
 * gets traffic" is explainable. Advisory: routing probes live, this reads the 15s snapshot.
 */
function routingState(args: {
  healthy: boolean;
  status: string;
  gateOn: boolean;
  queue: QueueSnapshot | null;
}): 'unavailable' | 'ungated' | 'externally_busy' | 'ok' {
  if (!args.healthy || args.status === 'DRAINING') return 'unavailable';
  if (!args.gateOn) return 'ungated';
  if (!args.queue || args.queue.queueRemaining === null) return 'unavailable';
  return args.status === 'IDLE' && args.queue.queueRemaining > 0 ? 'externally_busy' : 'ok';
}

function maskApiKey(key: string): string {
  return key.length > 6 ? `...${key.slice(-6)}` : '******';
}

async function syncToRedis(
  redis: FastifyInstance['redis'],
  id: string,
  fields: {
    url?: string;
    apiKey?: string;
    status?: string;
    lastSeen?: number;
    allowedJobTypes?: string[];
  },
) {
  const raw = await redis.hget(REGISTRY_KEY, id);
  const cur = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  await redis.hset(
    REGISTRY_KEY,
    id,
    JSON.stringify({
      ...cur,
      ...fields,
      allowedJobTypes: fields.allowedJobTypes ?? cur.allowedJobTypes ?? [],
    }),
  );
}

export async function adminWorkersRoutes(app: FastifyInstance) {
  app.get('/admin/workers', { preHandler: requirePermission('workers.read') }, async () => {
    const dbWorkers = await app.db
      .select()
      .from(schema.workers)
      .orderBy(asc(schema.workers.createdAt));
    const results = await Promise.all(
      dbWorkers.map(async (w) => {
        const raw = await app.redis.hget(REGISTRY_KEY, w.id);
        const registry = raw ? (JSON.parse(raw) as { status?: string; lastSeen?: number }) : {};
        const healthy = (await app.redis.get(healthKey(w.id))) === '1';
        const queueGateEnabled = await readQueueGate(app.redis, w.id);
        const queue = await readQueueSnapshot(app.redis, w.id);
        const capabilities = await readWorkerCapabilities(app, w.id);
        const capabilityGateDrift =
          capabilities.status === 'configured' && queueGateEnabled !== true;
        return {
          id: w.id,
          label: w.label,
          url: w.url,
          apiKeyHint: maskApiKey(w.apiKey),
          isActive: w.isActive,
          allowedJobTypes: w.allowedJobTypes ?? [],
          status: registry.status ?? (w.isActive ? 'IDLE' : 'DRAINING'),
          healthy,
          queueGateEnabled,
          capabilities,
          comfyVersion: await app.redis.get(comfyVersionKey(w.id)),
          capabilityWarning:
            capabilities.status === 'unreadable'
              ? 'Capabilities unreadable — drain before repair'
              : capabilityGateDrift
                ? 'Validated worker has no queue gate protection'
                : null,
          queue,
          routing: routingState({
            healthy,
            status: registry.status ?? (w.isActive ? 'IDLE' : 'DRAINING'),
            gateOn: queueGateEnabled,
            queue,
          }),
          lastSeen: registry.lastSeen ?? null,
          createdAt: w.createdAt,
          updatedAt: w.updatedAt,
        };
      }),
    );
    return results;
  });

  app.get('/admin/workers/job-types', { preHandler: requirePermission('workers.read') }, async () =>
    Object.values(WORKER_POOL),
  );

  /** Probe a worker URL + API key without saving anything.
   *  Uses the same GET /system_stats check the dispatcher's health monitor uses.
   *  No DB write, no audit log — safe to call repeatedly from the Add/Edit form. */
  app.post(
    '/admin/workers/test-connection',
    {
      preHandler: requirePermission('workers.read'),
      schema: {
        body: z.object({
          url: z.string().url(),
          apiKey: z.string().min(1),
        }),
      },
    },
    async (req, reply) => {
      const { url, apiKey } = req.body as { url: string; apiKey: string };
      const probeUrl = `${url.replace(/\/$/, '')}/system_stats`;
      const start = Date.now();
      try {
        const res = await fetch(probeUrl, {
          headers: { 'X-Api-Key': apiKey },
          signal: AbortSignal.timeout(8_000),
        });
        const latencyMs = Date.now() - start;
        if (res.ok) {
          return reply.send({ ok: true, latencyMs });
        }
        return reply.send({ ok: false, error: `HTTP ${res.status}`, latencyMs });
      } catch (err: unknown) {
        const latencyMs = Date.now() - start;
        const message =
          err instanceof Error
            ? err.name === 'TimeoutError'
              ? 'Connection timed out'
              : err.message
            : 'Connection failed';
        return reply.send({ ok: false, error: message, latencyMs });
      }
    },
  );

  app.post(
    '/admin/workers',
    {
      preHandler: requirePermission('workers.write'),
      schema: {
        body: z.object({
          id: z
            .string()
            .min(1)
            .regex(/^[\w-]+$/, 'id must be alphanumeric with dashes'),
          label: z.string().default(''),
          url: z.string().url(),
          apiKey: z.string().min(1),
          allowedJobTypes: z.array(workerPoolSchema).default([]),
        }),
      },
    },
    async (req, reply) => {
      const { id, label, url, apiKey, allowedJobTypes } = req.body as {
        id: string;
        label: string;
        url: string;
        apiKey: string;
        allowedJobTypes: string[];
      };

      const created = await app.db.transaction(async (tx) => {
        const existing = await tx
          .select({ id: schema.workers.id })
          .from(schema.workers)
          .where(eq(schema.workers.id, id));
        if (existing.length > 0) {
          throw new AppError('WORKER_EXISTS', 409, 'Worker ID already exists');
        }

        const [row] = await tx
          .insert(schema.workers)
          .values({ id, label, url, apiKey, isActive: true, allowedJobTypes })
          .returning();
        if (!row) {
          throw new AppError('INSERT_FAILED', 500, 'Failed to create worker');
        }

        await recordAudit(tx, {
          actor: { userId: req.userId, role: req.adminRole! },
          action: 'worker.create',
          resourceType: 'worker',
          resourceId: row.id,
          after: {
            id: row.id,
            label: row.label,
            url: row.url,
            isActive: row.isActive,
            allowedJobTypes,
          },
          request: req,
        });

        return row;
      });

      await syncToRedis(app.redis, id, {
        url,
        apiKey,
        status: 'IDLE',
        lastSeen: Date.now(),
        allowedJobTypes,
      });

      return reply.code(201).send({
        id: created.id,
        label: created.label,
        url: created.url,
        apiKeyHint: maskApiKey(apiKey),
        isActive: created.isActive,
        allowedJobTypes: created.allowedJobTypes ?? [],
        status: 'IDLE',
        healthy: false,
        createdAt: created.createdAt,
        updatedAt: created.updatedAt,
      });
    },
  );

  app.patch(
    '/admin/workers/:id',
    {
      preHandler: requirePermission('workers.write'),
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({
          id: z
            .string()
            .min(1)
            .regex(/^[\w-]+$/, 'id must be alphanumeric with dashes')
            .optional(),
          label: z.string().optional(),
          url: z.string().url().optional(),
          apiKey: z.string().min(1).optional(),
          isActive: z.boolean().optional(),
          allowedJobTypes: z.array(workerPoolSchema).optional(),
        }),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as {
        id?: string;
        label?: string;
        url?: string;
        apiKey?: string;
        isActive?: boolean;
        allowedJobTypes?: string[];
      };

      const nextId = body.id ?? id;
      if (nextId !== id) await requireCapabilityDrain(app, id);

      const { updated, existing } = await app.db.transaction(async (tx) => {
        const [existingRow] = await tx
          .select()
          .from(schema.workers)
          .where(eq(schema.workers.id, id))
          .for('update');
        if (!existingRow) throw new AppError('NOT_FOUND', 404, 'Worker not found');

        if (nextId !== id) {
          const [conflict] = await tx
            .select({ id: schema.workers.id })
            .from(schema.workers)
            .where(eq(schema.workers.id, nextId));
          if (conflict) {
            throw new AppError('WORKER_EXISTS', 409, 'Worker ID already exists');
          }
        }

        const [row] = await tx
          .update(schema.workers)
          .set({ ...body, id: nextId, updatedAt: new Date() })
          .where(eq(schema.workers.id, id))
          .returning();
        if (!row) {
          throw new AppError('UPDATE_FAILED', 500, 'Failed to update worker');
        }

        await recordAudit(tx, {
          actor: { userId: req.userId, role: req.adminRole! },
          action: 'worker.update',
          resourceType: 'worker',
          resourceId: row.id,
          before: {
            id: existingRow.id,
            label: existingRow.label,
            url: existingRow.url,
            isActive: existingRow.isActive,
            allowedJobTypes: existingRow.allowedJobTypes,
          },
          after: {
            id: row.id,
            label: row.label,
            url: row.url,
            isActive: row.isActive,
            allowedJobTypes: row.allowedJobTypes,
          },
          request: req,
        });

        return { updated: row, existing: existingRow };
      });

      if (nextId !== id) {
        const raw = await app.redis.hget(REGISTRY_KEY, id);
        if (raw) {
          await app.redis.hset(REGISTRY_KEY, nextId, raw);
          await app.redis.hdel(REGISTRY_KEY, id);
        }

        const healthy = await app.redis.get(healthKey(id));
        if (healthy !== null) {
          await app.redis.set(healthKey(nextId), healthy);
          await app.redis.del(healthKey(id));
        }

        const capabilities = await app.redis.get(capabilitiesKey(id));
        if (capabilities !== null) {
          await app.redis.set(capabilitiesKey(nextId), capabilities);
          await app.redis.del(capabilitiesKey(id));
        }
        // Version belongs to the probed identity; the monitor rebuilds it after rename.
        await app.redis.del(comfyVersionKey(id));
        const gate = await app.redis.get(routingConfigKey(id));
        if (gate !== null) {
          await app.redis.set(routingConfigKey(nextId), gate);
          await app.redis.del(routingConfigKey(id));
        }
      }

      const newUrl = body.url ?? existing.url;
      const newApiKey = body.apiKey ?? existing.apiKey;
      if (
        nextId !== id ||
        body.url !== undefined ||
        body.apiKey !== undefined ||
        body.allowedJobTypes !== undefined
      ) {
        await syncToRedis(app.redis, nextId, {
          url: newUrl,
          apiKey: newApiKey,
          allowedJobTypes: body.allowedJobTypes,
        });
      }

      if (body.isActive === false) {
        const raw = await app.redis.hget(REGISTRY_KEY, nextId);
        if (raw) {
          const entry = JSON.parse(raw) as Record<string, unknown>;
          entry.status = 'DRAINING';
          await app.redis.hset(REGISTRY_KEY, nextId, JSON.stringify(entry));
        }
      } else if (body.isActive === true) {
        const raw = await app.redis.hget(REGISTRY_KEY, nextId);
        if (raw) {
          const entry = JSON.parse(raw) as Record<string, unknown>;
          if (entry.status === 'DRAINING') {
            entry.status = 'IDLE';
            await app.redis.hset(REGISTRY_KEY, nextId, JSON.stringify(entry));
          }
        }
      }

      const healthy = (await app.redis.get(healthKey(nextId))) === '1';
      const raw = await app.redis.hget(REGISTRY_KEY, nextId);
      const registry = raw ? (JSON.parse(raw) as { status?: string; lastSeen?: number }) : {};

      return {
        id: updated.id,
        label: updated.label,
        url: updated.url,
        apiKeyHint: maskApiKey(updated.apiKey),
        isActive: updated.isActive,
        allowedJobTypes: updated.allowedJobTypes ?? [],
        status: registry.status ?? 'IDLE',
        healthy,
        lastSeen: registry.lastSeen ?? null,
        updatedAt: updated.updatedAt,
      };
    },
  );

  app.delete(
    '/admin/workers/:id',
    {
      preHandler: requirePermission('workers.write'),
      schema: { params: z.object({ id: z.string() }) },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };

      const raw = await app.redis.hget(REGISTRY_KEY, id);
      if (raw) {
        const entry = JSON.parse(raw) as { status?: string };
        if (entry.status === 'BUSY') {
          return reply.code(409).send({
            error: { code: 'WORKER_BUSY', message: 'Cannot delete a BUSY worker - drain it first' },
          });
        }
      }

      await app.db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(schema.workers)
          .where(eq(schema.workers.id, id))
          .for('update');
        if (!existing) return;

        await tx.delete(schema.workers).where(eq(schema.workers.id, id));

        await recordAudit(tx, {
          actor: { userId: req.userId, role: req.adminRole! },
          action: 'worker.delete',
          resourceType: 'worker',
          resourceId: id,
          before: {
            id: existing.id,
            label: existing.label,
            url: existing.url,
            isActive: existing.isActive,
            allowedJobTypes: existing.allowedJobTypes,
          },
          request: req,
        });
      });

      await app.redis.hdel(REGISTRY_KEY, id);
      await app.redis.del(healthKey(id));
      await app.redis.del(routingConfigKey(id));
      await app.redis.del(capabilitiesKey(id));
      await app.redis.del(comfyVersionKey(id));

      return reply.code(204).send();
    },
  );

  app.get(
    '/admin/workers/:id/capabilities',
    {
      preHandler: requirePermission('workers.read'),
      schema: { params: z.object({ id: z.string() }) },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const [worker] = await app.db
        .select({ id: schema.workers.id })
        .from(schema.workers)
        .where(eq(schema.workers.id, id));
      if (!worker) throw new AppError('NOT_FOUND', 404, 'Worker not found');
      return {
        ...(await readWorkerCapabilities(app, id)),
        comfyVersion: await app.redis.get(comfyVersionKey(id)),
      };
    },
  );

  // Full replacement makes partial revocation explicit. Audit precedes the Redis write,
  // as for queue-gate; the cross-store commit window remains the existing limitation.
  for (const method of ['PUT', 'DELETE'] as const) {
    app.route({
      method,
      url: '/admin/workers/:id/capabilities',
      preHandler: requirePermission('workers.write'),
      schema: {
        params: z.object({ id: z.string() }),
        ...(method === 'PUT' ? { body: workerCapabilitiesSchema } : {}),
      },
      handler: async (req, reply) => {
        const { id } = req.params as { id: string };
        const [worker] = await app.db
          .select({ id: schema.workers.id })
          .from(schema.workers)
          .where(eq(schema.workers.id, id));
        if (!worker) throw new AppError('NOT_FOUND', 404, 'Worker not found');
        const before = await readWorkerCapabilities(app, id, true);
        const next = method === 'PUT' ? workerCapabilitiesSchema.parse(req.body) : null;
        const raw = await app.redis.hget(REGISTRY_KEY, id);
        const draining =
          raw !== null && (JSON.parse(raw) as { status?: unknown }).status === 'DRAINING';
        const error = capabilityMutationError(
          before,
          next,
          draining,
          await readQueueGate(app.redis, id),
        );
        if (error) throw new AppError('WORKER_CAPABILITIES_PROTECTED', 409, error);
        await app.db.transaction(async (tx) => {
          await recordAudit(tx, {
            actor: { userId: req.userId, role: req.adminRole! },
            action: 'worker.capabilities',
            resourceType: 'worker',
            resourceId: id,
            before: { state: before },
            after: { capabilities: next },
            request: req,
          });
          if (next === null) await app.redis.del(capabilitiesKey(id));
          else await app.redis.set(capabilitiesKey(id), JSON.stringify(next));
        });
        return method === 'DELETE' ? reply.code(204).send() : { ok: true, capabilities: next };
      },
    });
  }

  // Toggles the dispatcher's ComfyUI queue gate for one worker. Live: the dispatcher
  // reads the flag on every claim, so no restart. Audit first, Redis write last, so a
  // failed write rolls the audit back (same fail-closed shape as the other mutations).
  app.put(
    '/admin/workers/:id/queue-gate',
    {
      preHandler: requirePermission('workers.write'),
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({ enabled: z.boolean() }),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { enabled } = req.body as { enabled: boolean };
      const [row] = await app.db.select().from(schema.workers).where(eq(schema.workers.id, id));
      if (!row) return reply.code(404).send({ ok: false });

      if (enabled === false) await requireCapabilityDrain(app, id);
      const before = await readQueueGate(app.redis, id);
      await app.db.transaction(async (tx) => {
        await recordAudit(tx, {
          actor: { userId: req.userId, role: req.adminRole! },
          action: 'worker.queue_gate',
          resourceType: 'worker',
          resourceId: id,
          before: { queueGateEnabled: before },
          after: { queueGateEnabled: enabled },
          request: req,
        });
        await app.redis.set(routingConfigKey(id), JSON.stringify({ queueGateEnabled: enabled }));
      });
      return { ok: true, queueGateEnabled: enabled };
    },
  );

  app.post(
    '/admin/workers/:id/drain',
    {
      preHandler: requirePermission('workers.drain'),
      schema: { params: z.object({ id: z.string() }) },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const raw = await app.redis.hget(REGISTRY_KEY, id);
      if (!raw) return reply.code(404).send({ ok: false });
      const w = JSON.parse(raw) as Record<string, unknown>;
      await app.redis.hset(REGISTRY_KEY, id, JSON.stringify({ ...w, status: 'DRAINING' }));
      return { ok: true };
    },
  );

  app.post(
    '/admin/workers/:id/undrain',
    {
      preHandler: requirePermission('workers.drain'),
      schema: { params: z.object({ id: z.string() }) },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const raw = await app.redis.hget(REGISTRY_KEY, id);
      if (!raw) return reply.code(404).send({ ok: false });
      const w = JSON.parse(raw) as Record<string, unknown>;
      if (w.status === 'DRAINING') {
        await app.redis.hset(REGISTRY_KEY, id, JSON.stringify({ ...w, status: 'IDLE' }));
      }
      return { ok: true };
    },
  );
}
