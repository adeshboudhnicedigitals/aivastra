import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { keys } from '@aivastra/storage';
import {
  CreateGarmentTypeBody,
  PatchGarmentTypeBody,
  PresignGarmentTypeBody,
} from '@aivastra/types';
import { and, count, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { requireAdmin } from './guard.js';

export async function adminGarmentTypesRoutes(app: FastifyInstance) {
  const W = requireAdmin(['SUPER_ADMIN', 'MODERATOR']);
  const uuidParam = z.object({ id: z.string().uuid() });

  app.get('/admin/assets/garment-types', { preHandler: W }, async () => {
    const rows = await app.db.select().from(schema.garmentSubcategories);
    const poseCounts = await app.db
      .select({ subcategoryId: schema.modelPoses.subcategoryId, cnt: count() })
      .from(schema.modelPoses)
      .groupBy(schema.modelPoses.subcategoryId);
    const tmplCounts = await app.db
      .select({ subcategoryId: schema.modelPoses.subcategoryId, cnt: count() })
      .from(schema.modelPoses)
      .where(eq(schema.modelPoses.isTemplate, true))
      .groupBy(schema.modelPoses.subcategoryId);
    const poseMap = Object.fromEntries(poseCounts.map((r) => [r.subcategoryId, Number(r.cnt)]));
    const tmplMap = Object.fromEntries(tmplCounts.map((r) => [r.subcategoryId, Number(r.cnt)]));
    return {
      items: rows.map((r) => ({
        ...r,
        poseCount: poseMap[r.id] ?? 0,
        templateCount: tmplMap[r.id] ?? 0,
      })),
    };
  });

  app.post(
    '/admin/assets/garment-types/presign',
    {
      preHandler: W,
      schema: { body: PresignGarmentTypeBody },
    },
    async (req) => {
      const { contentType } = req.body as { contentType: string };
      const newId = randomUUID();
      const thumbKey = keys.subcategoryThumb(newId);
      const { url } = await app.storage.presignPut(thumbKey, contentType, 5_000_000, 300);
      return { uploadUrl: url, thumbnailKey: thumbKey };
    },
  );

  app.post(
    '/admin/assets/garment-types',
    {
      preHandler: W,
      schema: { body: CreateGarmentTypeBody },
    },
    async (req) => {
      const { genderSlug, slug, label, sortOrder, thumbnailKey } = req.body as {
        genderSlug: string;
        slug: string;
        label: string;
        sortOrder: number;
        thumbnailKey?: string;
      };
      const [row] = await app.db
        .insert(schema.garmentSubcategories)
        .values({ genderSlug, slug, label, sortOrder, thumbnailKey })
        .returning();
      return row;
    },
  );

  app.patch(
    '/admin/assets/garment-types/:id',
    {
      preHandler: W,
      schema: { params: uuidParam, body: PatchGarmentTypeBody },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const body = req.body as { isActive?: boolean; [key: string]: unknown };

      if (body.isActive === true) {
        // Require at least one pose exists and every face×bg cell has a template
        const allPoses = await app.db
          .select({
            faceId: schema.modelPoses.faceId,
            backgroundId: schema.modelPoses.backgroundId,
            isTemplate: schema.modelPoses.isTemplate,
          })
          .from(schema.modelPoses)
          .where(eq(schema.modelPoses.subcategoryId, id));

        if (allPoses.length === 0) {
          throw new AppError(
            'CONFLICT',
            409,
            'garment type has no poses — upload poses and mark one as template per face×background cell before activating',
          );
        }

        // Build a set of all unique cells and check each has a template
        const cellMap = new Map<string, boolean>();
        for (const p of allPoses) {
          const key = `${p.faceId}:${p.backgroundId}`;
          if (!cellMap.has(key)) cellMap.set(key, false);
          if (p.isTemplate) cellMap.set(key, true);
        }
        const missingTemplate = [...cellMap.entries()].filter(([, hasTemplate]) => !hasTemplate);
        if (missingTemplate.length > 0) {
          throw new AppError(
            'CONFLICT',
            409,
            `${missingTemplate.length} face×background cell(s) have no template pose — set a template pose for each cell before activating`,
          );
        }
      }

      const [updated] = await app.db
        .update(schema.garmentSubcategories)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(schema.garmentSubcategories.id, id))
        .returning({ id: schema.garmentSubcategories.id });
      if (!updated) throw new AppError('NOT_FOUND', 404, 'garment type not found');
      return { ok: true };
    },
  );

  app.delete(
    '/admin/assets/garment-types/:id',
    {
      preHandler: W,
      schema: { params: uuidParam },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const [sub] = await app.db
        .select()
        .from(schema.garmentSubcategories)
        .where(eq(schema.garmentSubcategories.id, id));
      if (!sub) throw new AppError('NOT_FOUND', 404, 'garment type not found');

      const poses = await app.db
        .select()
        .from(schema.modelPoses)
        .where(eq(schema.modelPoses.subcategoryId, id));
      const poseJobRefs =
        poses.length > 0
          ? await app.db
              .select({ jobId: schema.jobInputs.jobId })
              .from(schema.jobInputs)
              .where(
                inArray(
                  schema.jobInputs.poseId,
                  poses.map((p) => p.id),
                ),
              )
              .limit(1)
          : [];
      if (poseJobRefs.length > 0)
        throw new AppError('CONFLICT', 409, 'garment type has poses referenced by existing jobs');

      const r2Keys = poses.flatMap((p) => [p.r2Key, p.thumbnailKey]);
      await Promise.allSettled(r2Keys.map((k) => app.storage.deleteObject(k)));

      await app.db.transaction(async (tx) => {
        if (poses.length > 0) {
          await tx.delete(schema.modelPoses).where(eq(schema.modelPoses.subcategoryId, id));
        }
        await tx.delete(schema.garmentSubcategories).where(eq(schema.garmentSubcategories.id, id));
      });

      return { ok: true };
    },
  );
}
