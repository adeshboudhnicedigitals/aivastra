import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { keys } from '@aivastra/storage';
import {
  ConfirmCatalogItemBody,
  CreateCategoryBody,
  PresignCatalogItemBody,
} from '@aivastra/types';
import { and, count, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { requireAdmin } from './guard.js';

export async function adminCatalogRoutes(app: FastifyInstance) {
  const W = requireAdmin(['SUPER_ADMIN', 'MODERATOR']);

  app.get(
    '/admin/catalog/items',
    {
      preHandler: W,
      schema: {
        querystring: z.object({ genderSlug: z.string().optional(), type: z.string().optional() }),
      },
    },
    async (req) => {
      const { genderSlug, type } = req.query as { genderSlug?: string; type?: string };
      const conditions = [];
      if (genderSlug) conditions.push(eq(schema.catalogItems.genderSlug, genderSlug));
      if (type) conditions.push(eq(schema.catalogItems.type, type));
      const rows = await app.db
        .select({
          id: schema.catalogItems.id,
          type: schema.catalogItems.type,
          genderSlug: schema.catalogItems.genderSlug,
          label: schema.catalogItems.label,
          r2Key: schema.catalogItems.r2Key,
          thumbnailKey: schema.catalogItems.thumbnailKey,
          isActive: schema.catalogItems.isActive,
          sortOrder: schema.catalogItems.sortOrder,
          createdAt: schema.catalogItems.createdAt,
          updatedAt: schema.catalogItems.updatedAt,
        })
        .from(schema.catalogItems)
        .where(conditions.length > 0 ? and(...conditions) : undefined);

      if (rows.length === 0) return rows;
      const itemIds = rows.map((r) => r.id);
      const links = await app.db
        .select()
        .from(schema.catalogItemSubcategories)
        .where(inArray(schema.catalogItemSubcategories.catalogItemId, itemIds));
      const subMap = new Map<string, string[]>();
      for (const l of links) {
        if (!subMap.has(l.catalogItemId)) subMap.set(l.catalogItemId, []);
        subMap.get(l.catalogItemId)!.push(l.subcategoryId);
      }
      return rows.map((r) => ({ ...r, subcategoryIds: subMap.get(r.id) ?? [] }));
    },
  );

  app.get('/admin/catalog/categories', { preHandler: W }, async () => {
    const rows = await app.db
      .select({
        id: schema.catalogCategories.id,
        typeId: schema.catalogCategories.typeId,
        parentId: schema.catalogCategories.parentId,
        slug: schema.catalogCategories.slug,
        label: schema.catalogCategories.label,
        genderSlug: schema.catalogCategories.genderSlug,
        sortOrder: schema.catalogCategories.sortOrder,
        isActive: schema.catalogCategories.isActive,
        typeSlug: schema.catalogTypes.slug,
      })
      .from(schema.catalogCategories)
      .innerJoin(schema.catalogTypes, eq(schema.catalogCategories.typeId, schema.catalogTypes.id))
      .orderBy(schema.catalogCategories.sortOrder);
    return rows;
  });

  app.post(
    '/admin/catalog/items/presign',
    { preHandler: W, schema: { body: PresignCatalogItemBody } },
    async (req) => {
      const { contentType, typeSlug } = req.body as any;
      const newId = randomUUID();
      const r2Key = keys.catalogItem(typeSlug, newId);
      const thumbKey = keys.catalogThumb(typeSlug, newId);
      const main = await app.storage.presignPut(r2Key, contentType, 10_000_000, 300);
      const thumb = await app.storage.presignPut(thumbKey, contentType, 1_000_000, 300);
      return { uploadUrl: main.url, r2Key, thumbnailUploadUrl: thumb.url, thumbnailKey: thumbKey };
    },
  );

  app.post(
    '/admin/catalog/items/confirm',
    { preHandler: W, schema: { body: ConfirmCatalogItemBody } },
    async (req) => {
      const { typeSlug, genderSlug, label, r2Key, thumbnailKey, sortOrder, subcategoryIds } =
        req.body as any;
      const row = await app.db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(schema.catalogItems)
          .values({
            type: typeSlug,
            genderSlug: genderSlug ?? null,
            label,
            r2Key,
            thumbnailKey,
            sortOrder,
          })
          .returning();
        if (subcategoryIds && subcategoryIds.length > 0) {
          await tx.insert(schema.catalogItemSubcategories).values(
            subcategoryIds.map((sid: string) => ({
              catalogItemId: inserted!.id,
              subcategoryId: sid,
            })),
          );
        }
        return { ...inserted!, subcategoryIds: subcategoryIds ?? [] };
      });
      return row;
    },
  );

  app.patch(
    '/admin/catalog/items/:id',
    {
      preHandler: W,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          label: z.string().max(120).optional(),
          isActive: z.boolean().optional(),
          sortOrder: z.number().int().optional(),
          genderSlug: z.enum(['men', 'women', 'boys', 'girls']).nullable().optional(),
          subcategoryIds: z.array(z.string().uuid()).optional(),
        }),
      },
    },
    async (req) => {
      const { id } = req.params as any;
      const { subcategoryIds, ...itemFields } = req.body as any;
      await app.db.transaction(async (tx) => {
        if (Object.keys(itemFields).length > 0) {
          await tx
            .update(schema.catalogItems)
            .set({ ...itemFields, updatedAt: new Date() })
            .where(eq(schema.catalogItems.id, id));
        }
        if (subcategoryIds !== undefined) {
          await tx
            .delete(schema.catalogItemSubcategories)
            .where(eq(schema.catalogItemSubcategories.catalogItemId, id));
          if (subcategoryIds.length > 0) {
            await tx
              .insert(schema.catalogItemSubcategories)
              .values(
                subcategoryIds.map((sid: string) => ({ catalogItemId: id, subcategoryId: sid })),
              );
          }
        }
      });
      return { ok: true };
    },
  );

  app.delete(
    '/admin/catalog/items/:id',
    {
      preHandler: W,
      schema: { params: z.object({ id: z.string().uuid() }) },
    },
    async (req) => {
      const { id } = req.params as any;
      const [item] = await app.db
        .select()
        .from(schema.catalogItems)
        .where(eq(schema.catalogItems.id, id));
      if (!item) throw new AppError('NOT_FOUND', 404, 'item not found');
      await app.storage.deleteObject(item.r2Key);
      await app.storage.deleteObject(item.thumbnailKey);
      await app.db.delete(schema.catalogItems).where(eq(schema.catalogItems.id, id));
      return { ok: true };
    },
  );

  app.post(
    '/admin/catalog/categories',
    { preHandler: W, schema: { body: CreateCategoryBody } },
    async (req) => {
      const [row] = await app.db
        .insert(schema.catalogCategories)
        .values(req.body as any)
        .returning();
      return row;
    },
  );

  app.delete(
    '/admin/catalog/categories/:id',
    {
      preHandler: W,
      schema: { params: z.object({ id: z.coerce.number().int() }) },
    },
    async (req) => {
      const { id } = req.params as any;
      const [{ value }] = await app.db
        .select({ value: count() })
        .from(schema.catalogItems)
        .where(and(eq(schema.catalogItems.categoryId, id), eq(schema.catalogItems.isActive, true)));
      if (value > 0) throw new AppError('IN_USE', 409, 'category has active items');
      await app.db.delete(schema.catalogCategories).where(eq(schema.catalogCategories.id, id));
      return { ok: true };
    },
  );
}
