import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from './guard.js';

const REGISTRY_KEY = 'worker:registry';

function healthKey(id: string) {
  return `worker:health:${id}`;
}

function maskApiKey(key: string): string {
  return key.length > 6 ? `...${key.slice(-6)}` : '******';
}

async function syncToRedis(
  redis: FastifyInstance['redis'],
  id: string,
  entry: {
    url?: string;
    apiKey?: string;
    status?: string;
    lastSeen?: number;
    allowedJobTypes?: string[];
  },
) {
  const existing = await redis.hget(REGISTRY_KEY, id);
  const prev = existing
    ? (JSON.parse(existing) as {
        url?: string;
        apiKey?: string;
        status?: string;
        lastSeen?: number;
        allowedJobTypes?: string[];
      })
    : {};
  await redis.hset(
    REGISTRY_KEY,
    id,
    JSON.stringify({
      url: entry.url ?? prev.url,
      apiKey: entry.apiKey ?? prev.apiKey,
      status: entry.status ?? prev.status ?? 'IDLE',
      lastSeen: entry.lastSeen ?? prev.lastSeen ?? Date.now(),
      allowedJobTypes: entry.allowedJobTypes ?? prev.allowedJobTypes ?? [],
    }),
  );
}

export async function adminWorkersRoutes(app: FastifyInstance) {
  app.get(
    '/admin/workers',
    { preHandler: requireAdmin(['SUPER_ADMIN', 'MODERATOR', 'SUPPORT', 'ADMIN']) },
    async () => {
      const dbWorkers = await app.db.select().from(schema.workers);
      const results = await Promise.all(
        dbWorkers.map(async (w) => {
          const raw = await app.redis.hget(REGISTRY_KEY, w.id);
          const registry = raw ? (JSON.parse(raw) as { status?: string; lastSeen?: number }) : {};
          const healthy = (await app.redis.get(healthKey(w.id))) === '1';
          return {
            id: w.id,
            label: w.label,
            url: w.url,
            apiKeyHint: maskApiKey(w.apiKey),
            isActive: w.isActive,
            allowedJobTypes: w.allowedJobTypes ?? [],
            status: registry.status ?? (w.isActive ? 'IDLE' : 'DRAINING'),
            healthy,
            lastSeen: registry.lastSeen ?? null,
            createdAt: w.createdAt,
            updatedAt: w.updatedAt,
          };
        }),
      );
      return results;
    },
  );

  app.post(
    '/admin/workers',
    {
      preHandler: requireAdmin(['SUPER_ADMIN']),
      schema: {
        body: z.object({
          id: z
            .string()
            .min(1)
            .regex(/^[\w-]+$/, 'id must be alphanumeric with dashes'),
          label: z.string().default(''),
          url: z.string().url(),
          apiKey: z.string().min(1),
          allowedJobTypes: z.array(z.enum(['catalogue', 'tryon', 'saree'])).default([]),
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

      const existing = await app.db
        .select({ id: schema.workers.id })
        .from(schema.workers)
        .where(eq(schema.workers.id, id));
      if (existing.length > 0) {
        return reply
          .code(409)
          .send({ error: { code: 'WORKER_EXISTS', message: 'Worker ID already exists' } });
      }

      const [created] = await app.db
        .insert(schema.workers)
        .values({ id, label, url, apiKey, isActive: true, allowedJobTypes })
        .returning();
      if (!created) {
        return reply
          .code(500)
          .send({ error: { code: 'INSERT_FAILED', message: 'Failed to create worker' } });
      }

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
      preHandler: requireAdmin(['SUPER_ADMIN']),
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
          allowedJobTypes: z.array(z.enum(['catalogue', 'tryon', 'saree'])).optional(),
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

      const [existing] = await app.db
        .select()
        .from(schema.workers)
        .where(eq(schema.workers.id, id));
      if (!existing)
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Worker not found' } });

      const nextId = body.id ?? id;
      if (nextId !== id) {
        const [conflict] = await app.db
          .select({ id: schema.workers.id })
          .from(schema.workers)
          .where(eq(schema.workers.id, nextId));
        if (conflict) {
          return reply
            .code(409)
            .send({ error: { code: 'WORKER_EXISTS', message: 'Worker ID already exists' } });
        }
      }

      const [updated] = await app.db
        .update(schema.workers)
        .set({ ...body, id: nextId, updatedAt: new Date() })
        .where(eq(schema.workers.id, id))
        .returning();
      if (!updated) {
        return reply
          .code(500)
          .send({ error: { code: 'UPDATE_FAILED', message: 'Failed to update worker' } });
      }

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
      preHandler: requireAdmin(['SUPER_ADMIN']),
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

      await app.db.delete(schema.workers).where(eq(schema.workers.id, id));
      await app.redis.hdel(REGISTRY_KEY, id);
      await app.redis.del(healthKey(id));

      return reply.code(204).send();
    },
  );

  app.post(
    '/admin/workers/:id/drain',
    {
      preHandler: requireAdmin(['SUPER_ADMIN', 'MODERATOR', 'ADMIN']),
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
}
