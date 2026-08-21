import { schema } from '@aivastra/db';
import { CreatePosePresetRequest, ListPosePresetsResponse } from '@aivastra/types';
import { and, desc, eq, inArray, isNull, not } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';

const MAX_NAMED_PRESETS = 10;

async function activePoseIds(app: FastifyInstance, poseIds: string[]): Promise<string[]> {
  if (poseIds.length === 0) return [];
  const rows = await app.db
    .select({ id: schema.modelPoseAssets.id })
    .from(schema.modelPoseAssets)
    .where(
      and(
        inArray(schema.modelPoseAssets.id, poseIds),
        eq(schema.modelPoseAssets.isActive, true),
        isNull(schema.modelPoseAssets.deletedAt),
      ),
    );
  return rows.map((r) => r.id);
}

export async function posePresetsRoutes(app: FastifyInstance) {
  app.get('/v1/pose-presets', { preHandler: app.requireUser }, async (req) => {
    const rows = await app.db
      .select()
      .from(schema.userPosePresets)
      .where(eq(schema.userPosePresets.userId, req.userId))
      .orderBy(desc(schema.userPosePresets.updatedAt));

    const filtered = await Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        name: r.name,
        poseIds: await activePoseIds(app, r.poseIds),
        isLastUsed: r.isLastUsed,
        updatedAt: r.updatedAt.toISOString(),
      })),
    );

    return ListPosePresetsResponse.parse({
      lastUsed: filtered.find((p) => p.isLastUsed) ?? null,
      named: filtered.filter((p) => !p.isLastUsed),
    });
  });

  app.post(
    '/v1/pose-presets',
    { preHandler: app.requireUser, schema: { body: CreatePosePresetRequest } },
    async (req, reply) => {
      const { name, poseIds } = req.body as z.infer<typeof CreatePosePresetRequest>;

      const valid = await activePoseIds(app, poseIds);
      if (valid.length !== poseIds.length) {
        throw new AppError('INVALID_POSE_IDS', 400, 'one or more poses are not active');
      }

      const named = await app.db
        .select({ id: schema.userPosePresets.id, name: schema.userPosePresets.name })
        .from(schema.userPosePresets)
        .where(
          and(
            eq(schema.userPosePresets.userId, req.userId),
            not(schema.userPosePresets.isLastUsed),
          ),
        );
      if (named.length >= MAX_NAMED_PRESETS) {
        throw new AppError('PRESET_LIMIT_REACHED', 409, `max ${MAX_NAMED_PRESETS} presets`);
      }
      if (named.some((r) => r.name?.toLowerCase() === name.toLowerCase())) {
        throw new AppError('PRESET_NAME_TAKEN', 409, 'a preset with this name already exists');
      }

      const [created] = await app.db
        .insert(schema.userPosePresets)
        .values({ userId: req.userId, name, poseIds })
        .returning();

      reply.code(201);
      return {
        id: created.id,
        name: created.name,
        poseIds: created.poseIds,
        isLastUsed: created.isLastUsed,
        updatedAt: created.updatedAt.toISOString(),
      };
    },
  );

  app.delete(
    '/v1/pose-presets/:id',
    { preHandler: app.requireUser, schema: { params: z.object({ id: z.string().uuid() }) } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const [row] = await app.db
        .select()
        .from(schema.userPosePresets)
        .where(
          and(eq(schema.userPosePresets.id, id), eq(schema.userPosePresets.userId, req.userId)),
        );
      if (!row) throw new AppError('NOT_FOUND', 404, 'preset not found');
      if (row.isLastUsed) {
        throw new AppError('VALIDATION', 400, 'the last-used preset cannot be deleted directly');
      }
      await app.db.delete(schema.userPosePresets).where(eq(schema.userPosePresets.id, id));
      reply.code(204);
    },
  );
}
