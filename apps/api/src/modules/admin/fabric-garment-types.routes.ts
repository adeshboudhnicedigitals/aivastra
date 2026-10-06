import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { keys } from '@aivastra/storage';
import {
  type AssetContentType,
  CreateFabricGarmentTypeBody,
  PatchFabricGarmentTypeBody,
  PresignFabricGarmentTypeThumbnailBody,
} from '@aivastra/types';
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { recordAudit } from './audit.js';
import { requirePermission } from './guard.js';

// Admin CRUD for Fabric-to-Garment garment-type presets (Shirt, Kurti,
// Anarkali, …). Each row's `prompt` is what the user-facing Fabric to
// Garment feature injects into the shared 'fabric_to_garment' workflow
// template's positive-prompt node at dispatch time — see
// apps/dispatcher/src/job/processor.ts::processFabricToGarmentJob and
// apps/api/src/modules/jobs/createFabricToGarment.ts.
export async function adminFabricGarmentTypesRoutes(app: FastifyInstance) {
  const RW = requirePermission('fabricGarmentTypes.write');
  const D = requirePermission('fabricGarmentTypes.delete');
  const uuidParam = z.object({ id: z.string().uuid() });

  app.get(
    '/admin/assets/fabric-garment-types',
    { preHandler: requirePermission('fabricGarmentTypes.read') },
    async () => {
      const rows = await app.db
        .select()
        .from(schema.fabricGarmentTypes)
        .orderBy(asc(schema.fabricGarmentTypes.sortOrder), asc(schema.fabricGarmentTypes.label));
      return {
        items: rows.map((r) => ({
          ...r,
          thumbnailUrl: r.thumbnailKey ? app.storage.publicUrl(r.thumbnailKey) : null,
        })),
      };
    },
  );

  app.post(
    '/admin/assets/fabric-garment-types/presign',
    { preHandler: RW, schema: { body: PresignFabricGarmentTypeThumbnailBody } },
    async (req) => {
      const { contentType } = req.body as { contentType: z.infer<typeof AssetContentType> };
      const r2Key = keys.fabricGarmentTypeThumb(randomUUID());
      const presign = await app.storage.presignPut(r2Key, contentType, 5_000_000, 300);
      return { r2Key, uploadUrl: presign.url };
    },
  );

  app.post(
    '/admin/assets/fabric-garment-types',
    { preHandler: RW, schema: { body: CreateFabricGarmentTypeBody } },
    async (req, reply) => {
      const body = req.body as z.infer<typeof CreateFabricGarmentTypeBody>;

      const [existing] = await app.db
        .select({ id: schema.fabricGarmentTypes.id })
        .from(schema.fabricGarmentTypes)
        .where(
          and(
            eq(schema.fabricGarmentTypes.slug, body.slug),
            eq(schema.fabricGarmentTypes.genderSlug, body.genderSlug),
          ),
        );
      if (existing) {
        throw new AppError(
          'CONFLICT',
          409,
          `Fabric garment type with slug "${body.slug}" already exists for ${body.genderSlug}`,
        );
      }

      const inserted = await app.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(schema.fabricGarmentTypes)
          .values({
            slug: body.slug,
            genderSlug: body.genderSlug,
            label: body.label,
            thumbnailKey: body.thumbnailKey ?? null,
            prompt: body.prompt,
            negativePrompt: body.negativePrompt ?? null,
            sortOrder: body.sortOrder ?? 0,
            isActive: body.isActive ?? true,
          })
          .returning();
        await recordAudit(tx, {
          // biome-ignore lint/style/noNonNullAssertion: set by the requirePermission preHandler (guard.ts) before any handler runs
          actor: { userId: req.userId, role: req.adminRole! },
          action: 'fabric_garment_type.create',
          resourceType: 'fabric_garment_type',
          resourceId: row.id,
          after: { id: row.id, label: row.label, slug: row.slug, genderSlug: row.genderSlug },
          request: req,
        });
        return row;
      });
      reply.code(201);
      return inserted;
    },
  );

  app.patch(
    '/admin/assets/fabric-garment-types/:id',
    { preHandler: RW, schema: { params: uuidParam, body: PatchFabricGarmentTypeBody } },
    async (req) => {
      const { id } = req.params as { id: string };
      const body = req.body as z.infer<typeof PatchFabricGarmentTypeBody>;

      if ('thumbnailKey' in body) {
        const [current] = await app.db
          .select({ thumbnailKey: schema.fabricGarmentTypes.thumbnailKey })
          .from(schema.fabricGarmentTypes)
          .where(eq(schema.fabricGarmentTypes.id, id));
        if (current?.thumbnailKey) {
          await app.storage.deleteObject(current.thumbnailKey).catch(() => {});
        }
      }

      const updated = await app.db.transaction(async (tx) => {
        const [before] = await tx
          .select()
          .from(schema.fabricGarmentTypes)
          .where(eq(schema.fabricGarmentTypes.id, id))
          .for('update');
        if (!before) throw new AppError('NOT_FOUND', 404, 'fabric garment type not found');
        const [row] = await tx
          .update(schema.fabricGarmentTypes)
          .set({ ...body, updatedAt: new Date() })
          .where(eq(schema.fabricGarmentTypes.id, id))
          .returning();
        await recordAudit(tx, {
          // biome-ignore lint/style/noNonNullAssertion: set by the requirePermission preHandler (guard.ts) before any handler runs
          actor: { userId: req.userId, role: req.adminRole! },
          action: 'fabric_garment_type.update',
          resourceType: 'fabric_garment_type',
          resourceId: id,
          before,
          after: row,
          request: req,
        });
        return row;
      });
      return updated;
    },
  );

  app.delete(
    '/admin/assets/fabric-garment-types/:id',
    { preHandler: D, schema: { params: uuidParam } },
    async (req) => {
      const { id } = req.params as { id: string };
      await app.db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(schema.fabricGarmentTypes)
          .where(eq(schema.fabricGarmentTypes.id, id))
          .for('update');
        if (!row) throw new AppError('NOT_FOUND', 404, 'fabric garment type not found');
        if (row.thumbnailKey) {
          await app.storage.deleteObject(row.thumbnailKey).catch(() => {});
        }
        await tx.delete(schema.fabricGarmentTypes).where(eq(schema.fabricGarmentTypes.id, id));
        await recordAudit(tx, {
          // biome-ignore lint/style/noNonNullAssertion: set by the requirePermission preHandler (guard.ts) before any handler runs
          actor: { userId: req.userId, role: req.adminRole! },
          action: 'fabric_garment_type.delete',
          resourceType: 'fabric_garment_type',
          resourceId: id,
          before: { id: row.id, label: row.label, slug: row.slug },
          request: req,
        });
      });
      return { ok: true };
    },
  );
}
