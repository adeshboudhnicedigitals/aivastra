import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { keys } from '@aivastra/storage';
import {
  MerchantCatalogCreateBody,
  MerchantCatalogImportBody,
  MerchantCatalogPresignBody,
  MerchantCatalogUpdateBody,
} from '@aivastra/types';
import { and, desc, eq, ilike, inArray } from 'drizzle-orm';
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
    imageUrl,
    thumbnailUrl,
    sourceKind: item.sourceJobId ? ('imported' as const) : ('uploaded' as const),
  };
}

async function assertMerchantUploadKey(
  app: FastifyInstance,
  widgetClientId: string,
  key: string,
  label: string,
) {
  if (!key.startsWith(`merchant-catalog/${widgetClientId}/`)) {
    throw new AppError('FORBIDDEN', 403, `${label} key does not belong to this merchant`);
  }

  const owner = await app.redis.get(`upload:owner:${key}`);
  if (owner !== widgetClientId) {
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

export async function merchantCatalogRoutes(app: FastifyInstance) {
  app.post(
    '/v1/merchant/catalog/presign',
    { preHandler: app.requireMerchant, schema: { body: MerchantCatalogPresignBody } },
    async (req) => {
      const widgetClientId = req.merchantClientId;
      if (!widgetClientId) throw new AppError('UNAUTH', 401, 'missing merchant');

      const {
        assetId = randomUUID(),
        kind,
        contentLength,
        contentType,
      } = req.body as z.infer<typeof MerchantCatalogPresignBody>;
      const key =
        kind === 'thumbnail'
          ? keys.merchantCatalogItemThumb(widgetClientId, assetId)
          : keys.merchantCatalogItem(widgetClientId, assetId);

      const { url, expiresIn } = await app.storage.presignPut(key, contentType, contentLength, 600);
      await app.redis.set(`upload:owner:${key}`, widgetClientId, 'EX', 600);

      return { assetId, uploadUrl: url, r2Key: key, expiresIn };
    },
  );

  app.get('/v1/merchant/catalog', { preHandler: app.requireMerchant }, async (req) => {
    const widgetClientId = req.merchantClientId;
    if (!widgetClientId) throw new AppError('UNAUTH', 401, 'missing merchant');

    const search = ((req.query as { search?: string }).search ?? '').trim();
    const where = search
      ? and(
          eq(schema.merchantCatalogItems.widgetClientId, widgetClientId),
          ilike(schema.merchantCatalogItems.label, `%${search}%`),
        )
      : eq(schema.merchantCatalogItems.widgetClientId, widgetClientId);

    const items = await app.db
      .select()
      .from(schema.merchantCatalogItems)
      .where(where)
      .orderBy(schema.merchantCatalogItems.sortOrder, desc(schema.merchantCatalogItems.createdAt));

    return { items: await Promise.all(items.map((item) => serializeCatalogItem(app, item))) };
  });

  app.post(
    '/v1/merchant/catalog',
    { preHandler: app.requireMerchant, schema: { body: MerchantCatalogCreateBody } },
    async (req, reply) => {
      const widgetClientId = req.merchantClientId;
      if (!widgetClientId) throw new AppError('UNAUTH', 401, 'missing merchant');

      const body = req.body as z.infer<typeof MerchantCatalogCreateBody>;
      await Promise.all([
        assertMerchantUploadKey(app, widgetClientId, body.r2Key, 'image'),
        assertMerchantUploadKey(app, widgetClientId, body.thumbnailKey, 'thumbnail'),
      ]);

      const [item] = await app.db
        .insert(schema.merchantCatalogItems)
        .values({
          widgetClientId,
          label: body.label,
          sku: body.sku?.trim() || null,
          gender: body.gender ?? null,
          category: body.category?.trim() || null,
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
      const widgetClientId = req.merchantClientId;
      if (!widgetClientId) throw new AppError('UNAUTH', 401, 'missing merchant');

      const { id } = req.params as { id: string };
      const body = req.body as z.infer<typeof MerchantCatalogUpdateBody>;
      const [updated] = await app.db
        .update(schema.merchantCatalogItems)
        .set({
          ...(body.label !== undefined ? { label: body.label } : {}),
          ...(body.sku !== undefined ? { sku: body.sku?.trim() || null } : {}),
          ...(body.gender !== undefined ? { gender: body.gender ?? null } : {}),
          ...(body.category !== undefined ? { category: body.category?.trim() || null } : {}),
          ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
          ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.merchantCatalogItems.id, id),
            eq(schema.merchantCatalogItems.widgetClientId, widgetClientId),
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
      const widgetClientId = req.merchantClientId;
      if (!widgetClientId) throw new AppError('UNAUTH', 401, 'missing merchant');

      const { id } = req.params as { id: string };
      const [deleted] = await app.db
        .delete(schema.merchantCatalogItems)
        .where(
          and(
            eq(schema.merchantCatalogItems.id, id),
            eq(schema.merchantCatalogItems.widgetClientId, widgetClientId),
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
    const widgetClientId = req.merchantClientId;
    if (!widgetClientId) throw new AppError('UNAUTH', 401, 'missing merchant');

    const [client] = await app.db
      .select({ userId: schema.widgetClients.userId })
      .from(schema.widgetClients)
      .where(eq(schema.widgetClients.id, widgetClientId))
      .limit(1);
    if (!client?.userId) return { catalogues: [] };

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
          eq(schema.merchantCatalogItems.widgetClientId, widgetClientId),
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
      const widgetClientId = req.merchantClientId;
      if (!widgetClientId) throw new AppError('UNAUTH', 401, 'missing merchant');

      const { jobId } = req.body as z.infer<typeof MerchantCatalogImportBody>;
      const [client] = await app.db
        .select({ userId: schema.widgetClients.userId })
        .from(schema.widgetClients)
        .where(eq(schema.widgetClients.id, widgetClientId))
        .limit(1);
      if (!client?.userId) {
        throw new AppError('FORBIDDEN', 403, 'merchant is not linked to a studio user');
      }

      const [job] = await app.db
        .select({
          id: schema.jobs.id,
          userId: schema.jobs.userId,
          catalogueId: schema.jobs.catalogueId,
          status: schema.jobs.status,
          createdAt: schema.jobs.createdAt,
          upperGarmentKey: schema.jobInputs.upperGarmentKey,
          thumbnailKey: schema.jobOutputs.thumbnailKey,
        })
        .from(schema.jobs)
        .innerJoin(schema.jobInputs, eq(schema.jobInputs.jobId, schema.jobs.id))
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

      const sourceThumbKey = job.thumbnailKey ?? keys.output(job.id);
      const [imageHead, thumbHead, imageBody, thumbBody] = await Promise.all([
        app.storage.headObject(job.upperGarmentKey),
        app.storage.headObject(sourceThumbKey),
        app.storage.getObject(job.upperGarmentKey),
        app.storage.getObject(sourceThumbKey),
      ]).catch(() => {
        throw new AppError('BAD_UPLOAD', 400, 'source assets are missing');
      });

      const assetId = randomUUID();
      const imageKey = keys.merchantCatalogItem(widgetClientId, assetId);
      const thumbKey = keys.merchantCatalogItemThumb(widgetClientId, assetId);
      await Promise.all([
        app.storage.putObject(imageKey, imageBody, imageHead.contentType ?? 'image/jpeg'),
        app.storage.putObject(thumbKey, thumbBody, thumbHead.contentType ?? 'image/jpeg'),
      ]);

      try {
        const [item] = await app.db
          .insert(schema.merchantCatalogItems)
          .values({
            id: assetId,
            widgetClientId,
            label: catalogueLabel(job.catalogueId, job.id),
            r2Key: imageKey,
            thumbnailKey: thumbKey,
            sourceJobId: job.id,
          })
          .returning();

        reply.code(201);
        return await serializeCatalogItem(app, item);
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
    },
  );
}
