import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { keys } from '@aivastra/storage';
import {
  CreateCatalogueTemplateBody,
  PatchCatalogueTemplateBody,
  PresignCatalogueTemplateThumbnailBody,
  PutCatalogueTemplateLooksBody,
} from '@aivastra/types';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { requireAdmin } from './guard.js';

export async function adminCatalogueTemplatesRoutes(app: FastifyInstance) {
  const RW = requireAdmin(['SUPER_ADMIN', 'MODERATOR', 'ADMIN']);
  const D = requireAdmin(['SUPER_ADMIN', 'MODERATOR']);
  const uuidParam = z.object({ id: z.string().uuid() });

  app.get('/admin/assets/catalogue-templates', { preHandler: RW }, async () => {
    const templates = await app.db
      .select()
      .from(schema.catalogueTemplates)
      .where(isNull(schema.catalogueTemplates.deletedAt))
      .orderBy(asc(schema.catalogueTemplates.sortOrder));
    const looks = await app.db.select().from(schema.catalogueTemplateLooks);
    const lookCountByTemplate = new Map<string, number>();
    for (const l of looks) {
      lookCountByTemplate.set(l.templateId, (lookCountByTemplate.get(l.templateId) ?? 0) + 1);
    }
    return {
      items: templates.map((t) => ({
        ...t,
        thumbnailUrl: t.thumbnailKey ? app.storage.publicUrl(t.thumbnailKey) : null,
        lookCount: lookCountByTemplate.get(t.id) ?? 0,
      })),
    };
  });

  app.post(
    '/admin/assets/catalogue-templates/thumbnail/presign',
    { preHandler: RW, schema: { body: PresignCatalogueTemplateThumbnailBody } },
    async (_req) => {
      const newId = randomUUID();
      const thumbnailKey = keys.catalogueTemplateThumb(newId);
      const { url } = await app.storage.presignPut(thumbnailKey, 'image/jpeg', 5_000_000, 300);
      return { uploadUrl: url, thumbnailKey };
    },
  );

  app.post(
    '/admin/assets/catalogue-templates',
    { preHandler: RW, schema: { body: CreateCatalogueTemplateBody } },
    async (req) => {
      const body = req.body as z.infer<typeof CreateCatalogueTemplateBody>;
      const [row] = await app.db
        .insert(schema.catalogueTemplates)
        .values({
          genderSlug: body.genderSlug,
          label: body.label,
          thumbnailKey: body.thumbnailKey ?? null,
          sortOrder: body.sortOrder,
        })
        .returning();
      return row;
    },
  );

  app.patch(
    '/admin/assets/catalogue-templates/:id',
    { preHandler: RW, schema: { params: uuidParam, body: PatchCatalogueTemplateBody } },
    async (req) => {
      const { id } = req.params as { id: string };
      const body = req.body as Record<string, unknown>;
      if ('thumbnailKey' in body) {
        const [current] = await app.db
          .select({ thumbnailKey: schema.catalogueTemplates.thumbnailKey })
          .from(schema.catalogueTemplates)
          .where(eq(schema.catalogueTemplates.id, id));
        if (current?.thumbnailKey) {
          await app.storage.deleteObject(current.thumbnailKey).catch(() => {});
        }
      }
      const [updated] = await app.db
        .update(schema.catalogueTemplates)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(schema.catalogueTemplates.id, id))
        .returning({ id: schema.catalogueTemplates.id });
      if (!updated) throw new AppError('NOT_FOUND', 404, 'catalogue template not found');
      return { ok: true };
    },
  );

  app.delete(
    '/admin/assets/catalogue-templates/:id',
    { preHandler: D, schema: { params: uuidParam } },
    async (req) => {
      const { id } = req.params as { id: string };
      const [row] = await app.db
        .select()
        .from(schema.catalogueTemplates)
        .where(eq(schema.catalogueTemplates.id, id));
      if (!row) throw new AppError('NOT_FOUND', 404, 'catalogue template not found');
      await app.db
        .update(schema.catalogueTemplates)
        .set({ deletedAt: new Date() })
        .where(eq(schema.catalogueTemplates.id, id));
      return { ok: true };
    },
  );

  app.put(
    '/admin/assets/catalogue-templates/:id/looks',
    { preHandler: RW, schema: { params: uuidParam, body: PutCatalogueTemplateLooksBody } },
    async (req) => {
      const { id } = req.params as { id: string };
      const { looks } = req.body as z.infer<typeof PutCatalogueTemplateLooksBody>;

      const [template] = await app.db
        .select({ id: schema.catalogueTemplates.id })
        .from(schema.catalogueTemplates)
        .where(eq(schema.catalogueTemplates.id, id));
      if (!template) throw new AppError('NOT_FOUND', 404, 'catalogue template not found');

      const dedupeKeys = new Set(looks.map((l) => `${l.poseAssetId}::${l.backgroundId}`));
      if (dedupeKeys.size !== looks.length) {
        throw new AppError('VALIDATION', 400, 'duplicate pose+background combination');
      }

      if (looks.length > 0) {
        const poseIds = Array.from(new Set(looks.map((l) => l.poseAssetId)));
        const backgroundIds = Array.from(new Set(looks.map((l) => l.backgroundId)));
        const [poseRows, backgroundRows] = await Promise.all([
          app.db
            .select({ id: schema.modelPoseAssets.id })
            .from(schema.modelPoseAssets)
            .where(
              and(
                inArray(schema.modelPoseAssets.id, poseIds),
                eq(schema.modelPoseAssets.isActive, true),
                isNull(schema.modelPoseAssets.deletedAt),
              ),
            ),
          app.db
            .select({ id: schema.modelBackgrounds.id })
            .from(schema.modelBackgrounds)
            .where(
              and(
                inArray(schema.modelBackgrounds.id, backgroundIds),
                eq(schema.modelBackgrounds.isActive, true),
                isNull(schema.modelBackgrounds.deletedAt),
              ),
            ),
        ]);
        if (poseRows.length !== poseIds.length) {
          throw new AppError('VALIDATION', 400, 'one or more poses not found or inactive');
        }
        if (backgroundRows.length !== backgroundIds.length) {
          throw new AppError('VALIDATION', 400, 'one or more backgrounds not found or inactive');
        }
      }

      await app.db.transaction(async (tx) => {
        await tx
          .delete(schema.catalogueTemplateLooks)
          .where(eq(schema.catalogueTemplateLooks.templateId, id));
        if (looks.length > 0) {
          await tx.insert(schema.catalogueTemplateLooks).values(
            looks.map((l, i) => ({
              templateId: id,
              poseAssetId: l.poseAssetId,
              backgroundId: l.backgroundId,
              sortOrder: i,
            })),
          );
        }
      });

      return { ok: true, count: looks.length };
    },
  );
}
