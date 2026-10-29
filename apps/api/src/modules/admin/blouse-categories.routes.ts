import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { keys } from '@aivastra/storage';
import {
  ConfirmBlousePoseBody,
  CreateBlouseCategoryBody,
  PatchBlouseCategoryBody,
  PatchBlousePoseBody,
  PresignBlouseCategoryThumbnailBody,
  PresignBlousePoseBody,
} from '@aivastra/types';
import { and, asc, eq, ilike, isNull, ne } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { recordAudit } from './audit.js';
import { requirePermission } from './guard.js';

export async function adminBlouseCategoriesRoutes(app: FastifyInstance) {
  const RW = requirePermission('blouse_categories.write');
  const D = requirePermission('blouse_categories.delete');
  const uuidParam = z.object({ id: z.string().uuid() });
  const mappedBody = z.object({ mapped: z.boolean() });

  // ── Categories ───────────────────────────────────────────────────────────

  app.get('/admin/assets/blouse-categories', { preHandler: RW }, async () => {
    const categories = await app.db
      .select()
      .from(schema.blouseCategories)
      .orderBy(asc(schema.blouseCategories.sortOrder), asc(schema.blouseCategories.label));
    const poses = await app.db
      .select({ categoryId: schema.blousePoses.categoryId })
      .from(schema.blousePoses);
    const poseCountByCategory = new Map<string, number>();
    for (const p of poses) {
      poseCountByCategory.set(p.categoryId, (poseCountByCategory.get(p.categoryId) ?? 0) + 1);
    }
    return {
      items: await Promise.all(
        categories.map(async (c) => ({
          ...c,
          thumbnailUrl: c.thumbnailKey
            ? (await app.storage.presignGet(c.thumbnailKey, 3600)).url
            : null,
          poseCount: poseCountByCategory.get(c.id) ?? 0,
        })),
      ),
    };
  });

  app.post(
    '/admin/assets/blouse-categories/thumbnail/presign',
    { preHandler: RW, schema: { body: PresignBlouseCategoryThumbnailBody } },
    async (_req) => {
      const newId = randomUUID();
      const thumbnailKey = keys.blouseCategoryThumb(newId);
      const { url } = await app.storage.presignPut(thumbnailKey, 'image/jpeg', 5_000_000, 300);
      return { uploadUrl: url, thumbnailKey };
    },
  );

  app.post(
    '/admin/assets/blouse-categories',
    { preHandler: RW, schema: { body: CreateBlouseCategoryBody } },
    async (req) => {
      const body = req.body as z.infer<typeof CreateBlouseCategoryBody>;
      const [existingLabel] = await app.db
        .select({ id: schema.blouseCategories.id })
        .from(schema.blouseCategories)
        .where(
          and(
            ilike(schema.blouseCategories.label, body.label),
            body.genderSlug
              ? eq(schema.blouseCategories.genderSlug, body.genderSlug)
              : isNull(schema.blouseCategories.genderSlug),
          ),
        );
      if (existingLabel) {
        throw new AppError('CONFLICT', 409, `label "${body.label}" already exists`);
      }
      const row = await app.db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(schema.blouseCategories)
          .values({
            genderSlug: body.genderSlug ?? null,
            label: body.label,
            thumbnailKey: body.thumbnailKey ?? null,
            sortOrder: body.sortOrder,
          })
          .returning();
        await recordAudit(tx, {
          // biome-ignore lint/style/noNonNullAssertion: set by the requirePermission preHandler (guard.ts) before any handler runs
          actor: { userId: req.userId, role: req.adminRole! },
          action: 'blouse_category.create',
          resourceType: 'blouse_category',
          resourceId: inserted.id,
          after: { id: inserted.id, label: inserted.label, genderSlug: inserted.genderSlug },
          request: req,
        });
        return inserted;
      });
      return row;
    },
  );

  app.patch(
    '/admin/assets/blouse-categories/:id',
    { preHandler: RW, schema: { params: uuidParam, body: PatchBlouseCategoryBody } },
    async (req) => {
      const { id } = req.params as { id: string };
      const body = req.body as Record<string, unknown>;
      if (typeof body.label === 'string') {
        const [current] = await app.db
          .select({ genderSlug: schema.blouseCategories.genderSlug })
          .from(schema.blouseCategories)
          .where(eq(schema.blouseCategories.id, id));
        const [existingLabel] = await app.db
          .select({ id: schema.blouseCategories.id })
          .from(schema.blouseCategories)
          .where(
            and(
              ilike(schema.blouseCategories.label, body.label),
              ne(schema.blouseCategories.id, id),
              current?.genderSlug
                ? eq(schema.blouseCategories.genderSlug, current.genderSlug)
                : isNull(schema.blouseCategories.genderSlug),
            ),
          );
        if (existingLabel) {
          throw new AppError('CONFLICT', 409, `label "${body.label}" already exists`);
        }
      }
      if ('thumbnailKey' in body) {
        const [current] = await app.db
          .select({ thumbnailKey: schema.blouseCategories.thumbnailKey })
          .from(schema.blouseCategories)
          .where(eq(schema.blouseCategories.id, id));
        if (current?.thumbnailKey) {
          await app.storage.deleteObject(current.thumbnailKey).catch(() => {});
        }
      }
      await app.db.transaction(async (tx) => {
        const [before] = await tx
          .select()
          .from(schema.blouseCategories)
          .where(eq(schema.blouseCategories.id, id))
          .for('update');
        if (!before) throw new AppError('NOT_FOUND', 404, 'blouse category not found');

        await tx
          .update(schema.blouseCategories)
          .set({ ...body, updatedAt: new Date() })
          .where(eq(schema.blouseCategories.id, id));

        await recordAudit(tx, {
          // biome-ignore lint/style/noNonNullAssertion: set by the requirePermission preHandler (guard.ts) before any handler runs
          actor: { userId: req.userId, role: req.adminRole! },
          action: 'blouse_category.update',
          resourceType: 'blouse_category',
          resourceId: id,
          before,
          after: { ...before, ...body },
          request: req,
        });
      });
      return { ok: true };
    },
  );

  app.delete(
    '/admin/assets/blouse-categories/:id',
    { preHandler: D, schema: { params: uuidParam } },
    async (req) => {
      const { id } = req.params as { id: string };
      const [row] = await app.db
        .select()
        .from(schema.blouseCategories)
        .where(eq(schema.blouseCategories.id, id));
      if (!row) throw new AppError('NOT_FOUND', 404, 'blouse category not found');
      // Cascades blouse_poses and blouse_category_subcategories (FK ON DELETE CASCADE) —
      // any job_inputs.blouse_pose_id referencing a deleted pose is set null, never
      // cascaded, since job_inputs is a billing/history record (see jobs.ts comment).
      await app.db.transaction(async (tx) => {
        await tx.delete(schema.blouseCategories).where(eq(schema.blouseCategories.id, id));
        await recordAudit(tx, {
          // biome-ignore lint/style/noNonNullAssertion: set by the requirePermission preHandler (guard.ts) before any handler runs
          actor: { userId: req.userId, role: req.adminRole! },
          action: 'blouse_category.delete',
          resourceType: 'blouse_category',
          resourceId: id,
          before: { id: row.id, label: row.label },
          request: req,
        });
      });
      return { ok: true };
    },
  );

  // ── Poses (per category) ────────────────────────────────────────────────

  app.get(
    '/admin/assets/blouse-categories/:id/poses',
    { preHandler: RW, schema: { params: uuidParam } },
    async (req) => {
      const { id } = req.params as { id: string };
      const rows = await app.db
        .select()
        .from(schema.blousePoses)
        .where(eq(schema.blousePoses.categoryId, id))
        .orderBy(asc(schema.blousePoses.sortOrder), asc(schema.blousePoses.label));
      return {
        items: await Promise.all(
          rows.map(async (r) => ({
            ...r,
            r2Url: (await app.storage.presignGet(r.r2Key, 3600)).url,
            thumbnailUrl: r.thumbnailKey
              ? (await app.storage.presignGet(r.thumbnailKey, 3600)).url
              : null,
          })),
        ),
      };
    },
  );

  app.post(
    '/admin/assets/blouse-categories/:id/poses/presign',
    { preHandler: RW, schema: { params: uuidParam, body: PresignBlousePoseBody } },
    async (req) => {
      const { contentType } = req.body as z.infer<typeof PresignBlousePoseBody>;
      const newId = randomUUID();
      const r2Key = keys.blousePose(newId);
      const thumbnailKey = keys.blousePoseThumb(newId);
      const main = await app.storage.presignPut(r2Key, contentType, 10_000_000, 300);
      const thumb = await app.storage.presignPut(thumbnailKey, 'image/jpeg', 1_000_000, 300);
      return { uploadUrl: main.url, r2Key, thumbnailUploadUrl: thumb.url, thumbnailKey };
    },
  );

  app.post(
    '/admin/assets/blouse-categories/:id/poses/confirm',
    { preHandler: RW, schema: { params: uuidParam, body: ConfirmBlousePoseBody } },
    async (req) => {
      const { id } = req.params as { id: string };
      const body = req.body as z.infer<typeof ConfirmBlousePoseBody>;
      if (body.categoryId !== id) {
        throw new AppError('VALIDATION', 400, 'categoryId must match the route param');
      }
      const [category] = await app.db
        .select({ id: schema.blouseCategories.id })
        .from(schema.blouseCategories)
        .where(eq(schema.blouseCategories.id, id));
      if (!category) throw new AppError('NOT_FOUND', 404, 'blouse category not found');

      const row = await app.db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(schema.blousePoses)
          .values({
            categoryId: id,
            label: body.label,
            r2Key: body.r2Key,
            thumbnailKey: body.thumbnailKey,
            sortOrder: body.sortOrder,
          })
          .returning();
        await recordAudit(tx, {
          // biome-ignore lint/style/noNonNullAssertion: set by the requirePermission preHandler (guard.ts) before any handler runs
          actor: { userId: req.userId, role: req.adminRole! },
          action: 'blouse_pose.create',
          resourceType: 'blouse_pose',
          resourceId: inserted.id,
          after: { id: inserted.id, label: inserted.label, categoryId: inserted.categoryId },
          request: req,
        });
        return inserted;
      });
      return row;
    },
  );

  app.patch(
    '/admin/assets/blouse-poses/:id',
    { preHandler: RW, schema: { params: uuidParam, body: PatchBlousePoseBody } },
    async (req) => {
      const { id } = req.params as { id: string };
      const body = req.body as Record<string, unknown>;
      await app.db.transaction(async (tx) => {
        const [before] = await tx
          .select()
          .from(schema.blousePoses)
          .where(eq(schema.blousePoses.id, id))
          .for('update');
        if (!before) throw new AppError('NOT_FOUND', 404, 'blouse pose not found');

        await tx
          .update(schema.blousePoses)
          .set({ ...body, updatedAt: new Date() })
          .where(eq(schema.blousePoses.id, id));

        await recordAudit(tx, {
          // biome-ignore lint/style/noNonNullAssertion: set by the requirePermission preHandler (guard.ts) before any handler runs
          actor: { userId: req.userId, role: req.adminRole! },
          action: 'blouse_pose.update',
          resourceType: 'blouse_pose',
          resourceId: id,
          before,
          after: { ...before, ...body },
          request: req,
        });
      });
      return { ok: true };
    },
  );

  app.delete(
    '/admin/assets/blouse-poses/:id',
    { preHandler: D, schema: { params: uuidParam } },
    async (req) => {
      const { id } = req.params as { id: string };
      const [row] = await app.db
        .select()
        .from(schema.blousePoses)
        .where(eq(schema.blousePoses.id, id));
      if (!row) throw new AppError('NOT_FOUND', 404, 'blouse pose not found');
      await app.db.transaction(async (tx) => {
        await tx.delete(schema.blousePoses).where(eq(schema.blousePoses.id, id));
        await recordAudit(tx, {
          // biome-ignore lint/style/noNonNullAssertion: set by the requirePermission preHandler (guard.ts) before any handler runs
          actor: { userId: req.userId, role: req.adminRole! },
          action: 'blouse_pose.delete',
          resourceType: 'blouse_pose',
          resourceId: id,
          before: { id: row.id, label: row.label },
          request: req,
        });
      });
      return { ok: true };
    },
  );

  // ── Category -> garment type mapping ────────────────────────────────────
  // Unlike body types / catalogue templates, there is no opt-out "no explicit
  // rows = show everyone" fallback here: an unmapped category never appears
  // for any garment type, since blouse is only relevant to garment types that
  // explicitly opt in (Saree and similar), not a general-purpose default.

  app.get(
    '/admin/assets/garment-types/:id/blouse-categories',
    { preHandler: RW, schema: { params: uuidParam } },
    async (req) => {
      const { id } = req.params as { id: string };
      const [sub] = await app.db
        .select({ genderSlug: schema.garmentSubcategories.genderSlug })
        .from(schema.garmentSubcategories)
        .where(eq(schema.garmentSubcategories.id, id));
      if (!sub) throw new AppError('NOT_FOUND', 404, 'garment type not found');

      const categories = await app.db
        .select()
        .from(schema.blouseCategories)
        .where(
          sub.genderSlug
            ? eq(schema.blouseCategories.genderSlug, sub.genderSlug)
            : isNull(schema.blouseCategories.genderSlug),
        )
        .orderBy(asc(schema.blouseCategories.sortOrder), asc(schema.blouseCategories.label));

      const mappedRows = await app.db
        .select({ categoryId: schema.blouseCategorySubcategories.categoryId })
        .from(schema.blouseCategorySubcategories)
        .where(eq(schema.blouseCategorySubcategories.subcategoryId, id));
      const mappedIds = new Set(mappedRows.map((r) => r.categoryId));

      return {
        items: await Promise.all(
          categories.map(async (c) => ({
            id: c.id,
            label: c.label,
            thumbnailUrl: c.thumbnailKey
              ? (await app.storage.presignGet(c.thumbnailKey, 3600)).url
              : null,
            mapped: mappedIds.has(c.id),
          })),
        ),
      };
    },
  );

  app.patch(
    '/admin/assets/garment-types/:id/blouse-categories/:categoryId',
    {
      preHandler: RW,
      schema: {
        params: z.object({ id: z.string().uuid(), categoryId: z.string().uuid() }),
        body: mappedBody,
      },
    },
    async (req) => {
      const { id, categoryId } = req.params as { id: string; categoryId: string };
      const { mapped } = req.body as { mapped: boolean };

      const [sub] = await app.db
        .select({ id: schema.garmentSubcategories.id })
        .from(schema.garmentSubcategories)
        .where(eq(schema.garmentSubcategories.id, id));
      if (!sub) throw new AppError('NOT_FOUND', 404, 'garment type not found');

      const [category] = await app.db
        .select({ id: schema.blouseCategories.id })
        .from(schema.blouseCategories)
        .where(eq(schema.blouseCategories.id, categoryId));
      if (!category) throw new AppError('NOT_FOUND', 404, 'blouse category not found');

      if (mapped) {
        await app.db
          .insert(schema.blouseCategorySubcategories)
          .values({ categoryId, subcategoryId: id })
          .onConflictDoNothing();
      } else {
        await app.db
          .delete(schema.blouseCategorySubcategories)
          .where(
            and(
              eq(schema.blouseCategorySubcategories.categoryId, categoryId),
              eq(schema.blouseCategorySubcategories.subcategoryId, id),
            ),
          );
      }

      return { ok: true, mapped };
    },
  );
}
