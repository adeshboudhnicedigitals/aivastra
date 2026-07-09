import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { keys } from '@aivastra/storage';
import {
  MerchantCatalogCreateBody,
  // biome-ignore lint/correctness/noUnusedImports: wired up by Tasks 9/10 (generate + generate-bulk routes), landed now to avoid re-touching this import block.
  MerchantCatalogGenerateBody,
  MerchantCatalogGenerateBulkBody,
  MerchantCatalogImportBody,
  MerchantCatalogPresignBody,
  MerchantCatalogSubcategoryCreateBody,
  MerchantCatalogSubcategoryUpdateBody,
  MerchantCatalogUpdateBody,
} from '@aivastra/types';
import { and, count, desc, eq, ilike, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';

const MERCHANT_CATALOG_MAX_BYTES = 5 * 1024 * 1024;
const MERCHANT_CATALOG_CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

type MerchantCatalogRow = typeof schema.merchantCatalogItems.$inferSelect;

async function serializeCatalogItem(app: FastifyInstance, item: MerchantCatalogRow) {
  const [imageUrl, thumbnailUrl] = await Promise.all([
    app.storage
      .presignGet(item.r2Key, 3600)
      .then((result) => result.url)
      .catch(() => null),
    app.storage
      .presignGet(item.thumbnailKey, 3600)
      .then((result) => result.url)
      .catch(() => null),
  ]);

  return {
    ...item,
    actualPrice: Math.round(item.actualPricePaise / 100),
    offerPrice: Math.round(item.offerPricePaise / 100),
    imageUrl,
    thumbnailUrl,
  };
}

async function assertMerchantUploadKey(
  app: FastifyInstance,
  merchantId: string,
  key: string,
  label: string,
) {
  if (!key.startsWith(`merchant-catalog/${merchantId}/`)) {
    throw new AppError('FORBIDDEN', 403, `${label} key does not belong to this merchant`);
  }

  const owner = await app.redis.get(`upload:owner:${key}`);
  if (owner !== merchantId) {
    throw new AppError('FORBIDDEN', 403, `${label} upload session expired or not owned`);
  }

  let head: { contentLength: number; contentType: string | null };
  try {
    head = await app.storage.headObject(key);
  } catch {
    throw new AppError('BAD_UPLOAD', 400, `${label} not found`);
  }

  if (head.contentLength > MERCHANT_CATALOG_MAX_BYTES) {
    throw new AppError('BAD_UPLOAD', 413, `${label} exceeds 5MB limit`);
  }
  if (!head.contentType || !MERCHANT_CATALOG_CONTENT_TYPES.has(head.contentType)) {
    throw new AppError('BAD_UPLOAD', 400, `${label} must be jpeg, png, or webp`);
  }
}

function catalogueLabel(catalogueId: string | null, jobId: string): string {
  if (catalogueId) return `Catalogue ${catalogueId.slice(0, 8)}`;
  return `Job ${jobId.slice(0, 8)}`;
}

/**
 * Copies a completed job's OUTPUT (never the source garment) into a fresh
 * merchant_catalog_items row. Used by both /import (Path A — merchant hand-picks
 * an existing studio result) and the generate-completion flow (Path B — merchant
 * uploaded a flat garment and the studio pipeline generated a catalogue image).
 * The output image serves BOTH roles: kiosk display AND the ComfyUI try-on input
 * for later virtual try-on jobs — there is no separate "flat garment" stored as
 * r2Key; that would defeat guaranteeing every catalogue item is try-on-suitable.
 */
async function copyJobOutputIntoProduct(
  app: FastifyInstance,
  params: {
    merchantId: string;
    subcategoryId: string;
    job: { id: string; catalogueId: string | null };
    resultKey: string;
    thumbnailKey: string | null;
    sourceKind: 'imported' | 'generated';
    flatSourceKey?: string;
    label?: string;
  },
): Promise<MerchantCatalogRow> {
  const sourceThumbKey = params.thumbnailKey ?? params.resultKey;
  const [imageHead, thumbHead, imageBody, thumbBody] = await Promise.all([
    app.storage.headObject(params.resultKey),
    app.storage.headObject(sourceThumbKey),
    app.storage.getObject(params.resultKey),
    app.storage.getObject(sourceThumbKey),
  ]).catch(() => {
    throw new AppError('BAD_UPLOAD', 400, 'source assets are missing');
  });

  const assetId = randomUUID();
  const imageKey = keys.merchantCatalogItem(params.merchantId, assetId);
  const thumbKey = keys.merchantCatalogItemThumb(params.merchantId, assetId);
  await Promise.all([
    app.storage.putObject(imageKey, imageBody, imageHead.contentType ?? 'image/jpeg'),
    app.storage.putObject(thumbKey, thumbBody, thumbHead.contentType ?? 'image/jpeg'),
  ]);

  try {
    const [item] = await app.db
      .insert(schema.merchantCatalogItems)
      .values({
        id: assetId,
        merchantId: params.merchantId,
        subcategoryId: params.subcategoryId,
        label: params.label ?? catalogueLabel(params.job.catalogueId, params.job.id),
        actualPricePaise: 0,
        offerPricePaise: 0,
        r2Key: imageKey,
        thumbnailKey: thumbKey,
        sourceJobId: params.job.id,
        sourceKind: params.sourceKind,
        flatSourceKey: params.flatSourceKey ?? null,
      })
      .returning();
    return item;
  } catch (err) {
    await Promise.allSettled([
      app.storage.deleteObject(imageKey),
      app.storage.deleteObject(thumbKey),
    ]);
    if ((err as { code?: string }).code === '23505') {
      throw new AppError('CONFLICT', 409, 'job already imported');
    }
    throw err;
  }
}

async function serializeSubcategory(
  app: FastifyInstance,
  row: typeof schema.merchantCatalogSubcategories.$inferSelect,
) {
  const [{ n }] = await app.db
    .select({ n: count() })
    .from(schema.merchantCatalogItems)
    .where(eq(schema.merchantCatalogItems.subcategoryId, row.id));
  return { ...row, productCount: n };
}

export async function merchantCatalogRoutes(app: FastifyInstance) {
  app.get(
    '/v1/merchant/catalog/subcategories',
    { preHandler: app.requireMerchant },
    async (req) => {
      const merchantId = req.merchantClientId;
      if (!merchantId) throw new AppError('UNAUTH', 401, 'missing merchant');

      const { category } = req.query as { category?: string };
      const where = category
        ? and(
            eq(schema.merchantCatalogSubcategories.merchantId, merchantId),
            eq(schema.merchantCatalogSubcategories.category, category),
          )
        : eq(schema.merchantCatalogSubcategories.merchantId, merchantId);

      const rows = await app.db
        .select()
        .from(schema.merchantCatalogSubcategories)
        .where(where)
        .orderBy(
          schema.merchantCatalogSubcategories.sortOrder,
          desc(schema.merchantCatalogSubcategories.createdAt),
        );

      return { items: await Promise.all(rows.map((row) => serializeSubcategory(app, row))) };
    },
  );

  app.post(
    '/v1/merchant/catalog/subcategories',
    { preHandler: app.requireMerchant, schema: { body: MerchantCatalogSubcategoryCreateBody } },
    async (req, reply) => {
      const merchantId = req.merchantClientId;
      if (!merchantId) throw new AppError('UNAUTH', 401, 'missing merchant');

      const body = req.body as z.infer<typeof MerchantCatalogSubcategoryCreateBody>;
      const [garmentType] = await app.db
        .select({ id: schema.garmentSubcategories.id })
        .from(schema.garmentSubcategories)
        .where(
          and(
            eq(schema.garmentSubcategories.id, body.garmentSubcategoryId),
            eq(schema.garmentSubcategories.isActive, true),
          ),
        )
        .limit(1);
      if (!garmentType)
        throw new AppError('BAD_CATALOG', 400, 'garment type not found or inactive');

      const [row] = await app.db
        .insert(schema.merchantCatalogSubcategories)
        .values({
          merchantId,
          category: body.category,
          name: body.name,
          garmentSubcategoryId: body.garmentSubcategoryId,
        })
        .returning();

      reply.code(201);
      return await serializeSubcategory(app, row);
    },
  );

  app.patch(
    '/v1/merchant/catalog/subcategories/:id',
    {
      preHandler: app.requireMerchant,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: MerchantCatalogSubcategoryUpdateBody,
      },
    },
    async (req) => {
      const merchantId = req.merchantClientId;
      if (!merchantId) throw new AppError('UNAUTH', 401, 'missing merchant');

      const { id } = req.params as { id: string };
      const body = req.body as z.infer<typeof MerchantCatalogSubcategoryUpdateBody>;

      if (body.garmentSubcategoryId !== undefined) {
        const [garmentType] = await app.db
          .select({ id: schema.garmentSubcategories.id })
          .from(schema.garmentSubcategories)
          .where(
            and(
              eq(schema.garmentSubcategories.id, body.garmentSubcategoryId),
              eq(schema.garmentSubcategories.isActive, true),
            ),
          )
          .limit(1);
        if (!garmentType)
          throw new AppError('BAD_CATALOG', 400, 'garment type not found or inactive');
      }

      const [updated] = await app.db
        .update(schema.merchantCatalogSubcategories)
        .set({
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.garmentSubcategoryId !== undefined
            ? { garmentSubcategoryId: body.garmentSubcategoryId }
            : {}),
          ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.merchantCatalogSubcategories.id, id),
            eq(schema.merchantCatalogSubcategories.merchantId, merchantId),
          ),
        )
        .returning();

      if (!updated) throw new AppError('NOT_FOUND', 404, 'subcategory not found');
      return await serializeSubcategory(app, updated);
    },
  );

  app.delete(
    '/v1/merchant/catalog/subcategories/:id',
    {
      preHandler: app.requireMerchant,
      schema: { params: z.object({ id: z.string().uuid() }) },
    },
    async (req, reply) => {
      const merchantId = req.merchantClientId;
      if (!merchantId) throw new AppError('UNAUTH', 401, 'missing merchant');

      const { id } = req.params as { id: string };

      // Select children before the cascading delete so their R2 objects can be
      // cleaned up — the DB FK cascade removes the rows but knows nothing about R2.
      const children = await app.db
        .select({
          r2Key: schema.merchantCatalogItems.r2Key,
          thumbnailKey: schema.merchantCatalogItems.thumbnailKey,
          flatSourceKey: schema.merchantCatalogItems.flatSourceKey,
        })
        .from(schema.merchantCatalogItems)
        .where(
          and(
            eq(schema.merchantCatalogItems.subcategoryId, id),
            eq(schema.merchantCatalogItems.merchantId, merchantId),
          ),
        );

      const [deleted] = await app.db
        .delete(schema.merchantCatalogSubcategories)
        .where(
          and(
            eq(schema.merchantCatalogSubcategories.id, id),
            eq(schema.merchantCatalogSubcategories.merchantId, merchantId),
          ),
        )
        .returning();

      if (!deleted) throw new AppError('NOT_FOUND', 404, 'subcategory not found');

      await Promise.allSettled(
        children.flatMap((c) => [
          app.storage.deleteObject(c.r2Key),
          app.storage.deleteObject(c.thumbnailKey),
          ...(c.flatSourceKey ? [app.storage.deleteObject(c.flatSourceKey)] : []),
        ]),
      );

      reply.code(204);
      return reply.send();
    },
  );

  app.post(
    '/v1/merchant/catalog/presign',
    { preHandler: app.requireMerchant, schema: { body: MerchantCatalogPresignBody } },
    async (req) => {
      const merchantId = req.merchantClientId;
      if (!merchantId) throw new AppError('UNAUTH', 401, 'missing merchant');

      const {
        assetId = randomUUID(),
        kind,
        contentLength,
        contentType,
      } = req.body as z.infer<typeof MerchantCatalogPresignBody>;
      const key =
        kind === 'thumbnail'
          ? keys.merchantCatalogItemThumb(merchantId, assetId)
          : keys.merchantCatalogItem(merchantId, assetId);

      const { url, expiresIn } = await app.storage.presignPut(key, contentType, contentLength, 600);
      await app.redis.set(`upload:owner:${key}`, merchantId, 'EX', 600);

      return { assetId, uploadUrl: url, r2Key: key, expiresIn };
    },
  );

  app.get('/v1/merchant/catalog', { preHandler: app.requireMerchant }, async (req) => {
    const merchantId = req.merchantClientId;
    if (!merchantId) throw new AppError('UNAUTH', 401, 'missing merchant');

    const { search = '', subcategoryId } = req.query as { search?: string; subcategoryId?: string };
    const conditions = [eq(schema.merchantCatalogItems.merchantId, merchantId)];
    if (search.trim())
      conditions.push(ilike(schema.merchantCatalogItems.label, `%${search.trim()}%`));
    if (subcategoryId)
      conditions.push(eq(schema.merchantCatalogItems.subcategoryId, subcategoryId));

    const items = await app.db
      .select()
      .from(schema.merchantCatalogItems)
      .where(and(...conditions))
      .orderBy(schema.merchantCatalogItems.sortOrder, desc(schema.merchantCatalogItems.createdAt));

    return { items: await Promise.all(items.map((item) => serializeCatalogItem(app, item))) };
  });

  app.post(
    '/v1/merchant/catalog',
    { preHandler: app.requireMerchant, schema: { body: MerchantCatalogCreateBody } },
    async (req, reply) => {
      const merchantId = req.merchantClientId;
      if (!merchantId) throw new AppError('UNAUTH', 401, 'missing merchant');

      const body = req.body as z.infer<typeof MerchantCatalogCreateBody>;

      const [subcategory] = await app.db
        .select({ id: schema.merchantCatalogSubcategories.id })
        .from(schema.merchantCatalogSubcategories)
        .where(
          and(
            eq(schema.merchantCatalogSubcategories.id, body.subcategoryId),
            eq(schema.merchantCatalogSubcategories.merchantId, merchantId),
          ),
        )
        .limit(1);
      if (!subcategory) throw new AppError('NOT_FOUND', 404, 'subcategory not found');

      await Promise.all([
        assertMerchantUploadKey(app, merchantId, body.r2Key, 'image'),
        assertMerchantUploadKey(app, merchantId, body.thumbnailKey, 'thumbnail'),
      ]);

      const [item] = await app.db
        .insert(schema.merchantCatalogItems)
        .values({
          merchantId,
          subcategoryId: body.subcategoryId,
          label: body.label,
          sku: body.sku?.trim() || null,
          actualPricePaise: body.actualPrice * 100,
          offerPricePaise: body.offerPrice * 100,
          r2Key: body.r2Key,
          thumbnailKey: body.thumbnailKey,
        })
        .returning();

      reply.code(201);
      return await serializeCatalogItem(app, item);
    },
  );

  app.patch(
    '/v1/merchant/catalog/:id',
    {
      preHandler: app.requireMerchant,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: MerchantCatalogUpdateBody,
      },
    },
    async (req) => {
      const merchantId = req.merchantClientId;
      if (!merchantId) throw new AppError('UNAUTH', 401, 'missing merchant');

      const { id } = req.params as { id: string };
      const body = req.body as z.infer<typeof MerchantCatalogUpdateBody>;

      if (body.subcategoryId !== undefined) {
        const [subcategory] = await app.db
          .select({ id: schema.merchantCatalogSubcategories.id })
          .from(schema.merchantCatalogSubcategories)
          .where(
            and(
              eq(schema.merchantCatalogSubcategories.id, body.subcategoryId),
              eq(schema.merchantCatalogSubcategories.merchantId, merchantId),
            ),
          )
          .limit(1);
        if (!subcategory) throw new AppError('NOT_FOUND', 404, 'subcategory not found');
      }

      const [updated] = await app.db
        .update(schema.merchantCatalogItems)
        .set({
          ...(body.subcategoryId !== undefined ? { subcategoryId: body.subcategoryId } : {}),
          ...(body.label !== undefined ? { label: body.label } : {}),
          ...(body.sku !== undefined ? { sku: body.sku?.trim() || null } : {}),
          ...(body.actualPrice !== undefined ? { actualPricePaise: body.actualPrice * 100 } : {}),
          ...(body.offerPrice !== undefined ? { offerPricePaise: body.offerPrice * 100 } : {}),
          ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
          ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.merchantCatalogItems.id, id),
            eq(schema.merchantCatalogItems.merchantId, merchantId),
          ),
        )
        .returning();

      if (!updated) throw new AppError('NOT_FOUND', 404, 'catalog item not found');
      return serializeCatalogItem(app, updated);
    },
  );

  app.delete(
    '/v1/merchant/catalog/:id',
    {
      preHandler: app.requireMerchant,
      schema: { params: z.object({ id: z.string().uuid() }) },
    },
    async (req, reply) => {
      const merchantId = req.merchantClientId;
      if (!merchantId) throw new AppError('UNAUTH', 401, 'missing merchant');

      const { id } = req.params as { id: string };
      const [deleted] = await app.db
        .delete(schema.merchantCatalogItems)
        .where(
          and(
            eq(schema.merchantCatalogItems.id, id),
            eq(schema.merchantCatalogItems.merchantId, merchantId),
          ),
        )
        .returning();

      if (!deleted) throw new AppError('NOT_FOUND', 404, 'catalog item not found');

      await Promise.allSettled([
        app.storage.deleteObject(deleted.r2Key),
        app.storage.deleteObject(deleted.thumbnailKey),
      ]);

      reply.code(204);
      return reply.send();
    },
  );

  app.get('/v1/merchant/catalogues', { preHandler: app.requireMerchant }, async (req) => {
    const merchantId = req.merchantClientId;
    if (!merchantId) throw new AppError('UNAUTH', 401, 'missing merchant');

    const [client] = await app.db
      .select({ userId: schema.merchants.userId })
      .from(schema.merchants)
      .where(eq(schema.merchants.id, merchantId))
      .limit(1);
    if (!client) return { catalogues: [] };

    const rows = await app.db
      .select({
        jobId: schema.jobs.id,
        catalogueId: schema.jobs.catalogueId,
        createdAt: schema.jobs.createdAt,
        thumbnailKey: schema.jobOutputs.thumbnailKey,
      })
      .from(schema.jobs)
      .leftJoin(schema.jobOutputs, eq(schema.jobOutputs.jobId, schema.jobs.id))
      .where(and(eq(schema.jobs.userId, client.userId), eq(schema.jobs.status, 'COMPLETED')))
      .orderBy(desc(schema.jobs.createdAt));

    if (rows.length === 0) return { catalogues: [] };

    const importedRows = await app.db
      .select({ sourceJobId: schema.merchantCatalogItems.sourceJobId })
      .from(schema.merchantCatalogItems)
      .where(
        and(
          eq(schema.merchantCatalogItems.merchantId, merchantId),
          inArray(
            schema.merchantCatalogItems.sourceJobId,
            rows.map((row) => row.jobId),
          ),
        ),
      );
    const importedJobIds = new Set(
      importedRows.map((row) => row.sourceJobId).filter((value): value is string => value !== null),
    );

    const grouped = new Map<
      string,
      {
        catalogueId: string;
        label: string;
        createdAt: string;
        jobs: Array<{
          jobId: string;
          catalogueId: string;
          label: string;
          thumbnailUrl: string | null;
          createdAt: string;
          imported: boolean;
        }>;
      }
    >();

    for (const row of rows) {
      const catalogueId = row.catalogueId ?? row.jobId;
      const label = catalogueLabel(row.catalogueId, row.jobId);
      const thumbKey = row.thumbnailKey ?? keys.output(row.jobId);
      const thumbnailUrl = await app.storage
        .presignGet(thumbKey, 3600)
        .then((result) => result.url)
        .catch(() => null);

      if (!grouped.has(catalogueId)) {
        grouped.set(catalogueId, {
          catalogueId,
          label,
          createdAt: row.createdAt.toISOString(),
          jobs: [],
        });
      }

      grouped.get(catalogueId)?.jobs.push({
        jobId: row.jobId,
        catalogueId,
        label,
        thumbnailUrl,
        createdAt: row.createdAt.toISOString(),
        imported: importedJobIds.has(row.jobId),
      });
    }

    return { catalogues: Array.from(grouped.values()) };
  });

  app.post(
    '/v1/merchant/catalog/import',
    { preHandler: app.requireMerchant, schema: { body: MerchantCatalogImportBody } },
    async (req, reply) => {
      const merchantId = req.merchantClientId;
      if (!merchantId) throw new AppError('UNAUTH', 401, 'missing merchant');

      const { jobId, subcategoryId } = req.body as z.infer<typeof MerchantCatalogImportBody>;

      const [subcategory] = await app.db
        .select({ id: schema.merchantCatalogSubcategories.id })
        .from(schema.merchantCatalogSubcategories)
        .where(
          and(
            eq(schema.merchantCatalogSubcategories.id, subcategoryId),
            eq(schema.merchantCatalogSubcategories.merchantId, merchantId),
          ),
        )
        .limit(1);
      if (!subcategory) throw new AppError('NOT_FOUND', 404, 'subcategory not found');

      const [client] = await app.db
        .select({ userId: schema.merchants.userId })
        .from(schema.merchants)
        .where(eq(schema.merchants.id, merchantId))
        .limit(1);
      if (!client) throw new AppError('NOT_FOUND', 404, 'merchant not found');

      const [job] = await app.db
        .select({
          id: schema.jobs.id,
          userId: schema.jobs.userId,
          catalogueId: schema.jobs.catalogueId,
          status: schema.jobs.status,
          resultKey: schema.jobOutputs.resultKey,
          thumbnailKey: schema.jobOutputs.thumbnailKey,
        })
        .from(schema.jobs)
        .leftJoin(schema.jobOutputs, eq(schema.jobOutputs.jobId, schema.jobs.id))
        .where(eq(schema.jobs.id, jobId))
        .limit(1);

      if (!job) throw new AppError('NOT_FOUND', 404, 'job not found');
      if (job.userId !== client.userId) {
        throw new AppError('FORBIDDEN', 403, 'job does not belong to the linked studio user');
      }
      if (job.status !== 'COMPLETED') {
        throw new AppError('CONFLICT', 409, 'only completed jobs can be imported');
      }
      if (!job.resultKey) throw new AppError('BAD_UPLOAD', 400, 'job has no output');

      const item = await copyJobOutputIntoProduct(app, {
        merchantId,
        subcategoryId,
        job,
        resultKey: job.resultKey,
        thumbnailKey: job.thumbnailKey,
        sourceKind: 'imported',
      });

      reply.code(201);
      return await serializeCatalogItem(app, item);
    },
  );
}
