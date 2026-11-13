import { type DbTransaction, schema } from '@aivastra/db';
import {
  type DeviceVariantsResponse,
  GarmentTypeSizeSetBody,
  type MerchantVariantsResponse,
  SizeSetBody,
  StockPutBody,
  VariantCreateBody,
  VariantUpdateBody,
} from '@aivastra/types';
import { and, asc, eq, inArray, isNull, ne } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import type { MerchantMember } from '../../plugins/portal-auth.js';
import { recordAudit } from '../admin/audit.js';
import { requirePermission } from '../admin/guard.js';

// CRM phase 3, slice 3a (spec §6.2). Variants are brand-wide catalogue data, so any merchant
// team member edits them (HLD decision 7). Stock is per branch: staff change their OWN branch
// only, the merchant admin any branch. A stock row owned by a feed refuses manual edits (P5).
// Every write is audited.

const V = schema.merchantCatalogVariants;
const S = schema.variantBranchStock;

const actorOf = (m: MerchantMember) => ({
  userId: m.userId,
  role: m.role === 'admin' ? 'MERCHANT_ADMIN' : 'MERCHANT_STAFF',
});

/** The item, if it is this merchant's live catalogue item, with its garment type's size set. */
async function ownItem(app: FastifyInstance, merchantId: string, itemId: string) {
  const [row] = await app.db
    .select({
      id: schema.merchantCatalogItems.id,
      offerPricePaise: schema.merchantCatalogItems.offerPricePaise,
      sizeSetName: schema.sizeSets.name,
      sizes: schema.sizeSets.sizes,
      sizeSetActive: schema.sizeSets.isActive,
    })
    .from(schema.merchantCatalogItems)
    .leftJoin(
      schema.merchantCatalogSubcategories,
      eq(schema.merchantCatalogSubcategories.id, schema.merchantCatalogItems.subcategoryId),
    )
    .leftJoin(
      schema.garmentSubcategories,
      eq(schema.garmentSubcategories.id, schema.merchantCatalogSubcategories.garmentSubcategoryId),
    )
    .leftJoin(schema.sizeSets, eq(schema.sizeSets.id, schema.garmentSubcategories.sizeSetId))
    .where(
      and(
        eq(schema.merchantCatalogItems.id, itemId),
        eq(schema.merchantCatalogItems.merchantId, merchantId),
        isNull(schema.merchantCatalogItems.deletedAt),
      ),
    )
    .limit(1);
  if (!row) throw new AppError('NOT_FOUND', 404, 'catalogue item not found');
  const sizeSet =
    row.sizes && row.sizeSetActive ? { name: row.sizeSetName ?? '', sizes: row.sizes } : null;
  return { id: row.id, offerPricePaise: row.offerPricePaise, sizeSet };
}

async function ownVariant(app: FastifyInstance, merchantId: string, variantId: string) {
  const [v] = await app.db
    .select()
    .from(V)
    .where(and(eq(V.id, variantId), eq(V.merchantId, merchantId)))
    .limit(1);
  if (!v) throw new AppError('NOT_FOUND', 404, 'variant not found');
  return v;
}

const toVariant = (v: typeof V.$inferSelect) => ({
  id: v.id,
  size: v.size,
  isCustom: v.isCustom,
  standardSize: v.standardSize,
  colour: v.colour,
  sku: v.sku,
  barcode: v.barcode,
  priceOverridePaise: v.priceOverridePaise,
  isActive: v.isActive,
  sortOrder: v.sortOrder,
});

const pgUnique = (err: unknown) =>
  (err as { code?: string })?.code === '23505' ||
  (err as { cause?: { code?: string } })?.cause?.code === '23505';

export async function inventoryRoutes(app: FastifyInstance) {
  const itemParams = z.object({ itemId: z.string().uuid() });
  const variantParams = z.object({ id: z.string().uuid() });

  app.get(
    '/v1/merchant/catalog/:itemId/variants',
    { preHandler: app.requireMerchantTeam, schema: { params: itemParams } },
    async (req): Promise<MerchantVariantsResponse> => {
      const m = req.merchantMember!;
      const { itemId } = req.params as { itemId: string };
      const item = await ownItem(app, m.merchantId, itemId);
      const variants = await app.db
        .select()
        .from(V)
        .where(eq(V.catalogItemId, item.id))
        .orderBy(asc(V.sortOrder), asc(V.createdAt));
      const stock = variants.length
        ? await app.db
            .select()
            .from(S)
            .where(
              inArray(
                S.variantId,
                variants.map((v) => v.id),
              ),
            )
        : [];
      return {
        sizeSet: item.sizeSet,
        variants: variants.map((v) => ({
          ...toVariant(v),
          stock: stock
            .filter((s) => s.variantId === v.id)
            .map((s) => ({
              branchId: s.branchId,
              status: s.status,
              quantity: s.quantity,
              source: s.source,
              updatedAt: s.updatedAt.toISOString(),
            })),
        })),
      };
    },
  );

  app.post(
    '/v1/merchant/catalog/:itemId/variants',
    {
      preHandler: app.requireMerchantTeam,
      schema: { params: itemParams, body: VariantCreateBody },
    },
    async (req, reply) => {
      const m = req.merchantMember!;
      const { itemId } = req.params as { itemId: string };
      const body = req.body as VariantCreateBody;
      const item = await ownItem(app, m.merchantId, itemId);
      // Derived, never trusted from the client: a size outside the garment type's standard
      // list is a custom one (spec §6.2, standard lists plus free text).
      const isCustom = !item.sizeSet?.sizes.includes(body.size);
      try {
        const row = await app.db.transaction(async (tx) => {
          const [v] = await tx
            .insert(V)
            .values({
              merchantId: m.merchantId,
              catalogItemId: item.id,
              size: body.size,
              isCustom,
              colour: body.colour,
              sku: body.sku ?? null,
              barcode: body.barcode ?? null,
              priceOverridePaise: body.priceOverridePaise ?? null,
            })
            .returning();
          await recordAudit(tx, {
            actor: actorOf(m),
            action: 'catalog_variant.create',
            resourceType: 'catalog_variant',
            resourceId: v!.id,
            after: toVariant(v!),
            request: req,
          });
          return v!;
        });
        return reply.code(201).send(toVariant(row));
      } catch (err) {
        if (pgUnique(err)) {
          throw new AppError(
            'VARIANT_EXISTS',
            409,
            'this size and colour, or this barcode, already exists',
          );
        }
        throw err;
      }
    },
  );

  app.patch(
    '/v1/merchant/variants/:id',
    {
      preHandler: app.requireMerchantTeam,
      schema: { params: variantParams, body: VariantUpdateBody },
    },
    async (req) => {
      const m = req.merchantMember!;
      const { id } = req.params as { id: string };
      const body = req.body as VariantUpdateBody;
      const before = await ownVariant(app, m.merchantId, id);
      try {
        const row = await app.db.transaction(async (tx) => {
          const [v] = await tx
            .update(V)
            .set({ ...body, updatedAt: new Date() })
            .where(eq(V.id, before.id))
            .returning();
          await recordAudit(tx, {
            actor: actorOf(m),
            action: 'catalog_variant.update',
            resourceType: 'catalog_variant',
            resourceId: id,
            before: toVariant(before),
            after: toVariant(v!),
            request: req,
          });
          return v!;
        });
        return toVariant(row);
      } catch (err) {
        if (pgUnique(err)) throw new AppError('VARIANT_EXISTS', 409, 'this barcode already exists');
        throw err;
      }
    },
  );

  app.put(
    '/v1/merchant/variants/:id/stock/:branchId',
    {
      preHandler: app.requireMerchantTeam,
      schema: {
        params: z.object({ id: z.string().uuid(), branchId: z.string().uuid() }),
        body: StockPutBody,
      },
    },
    async (req) => {
      const m = req.merchantMember!;
      const { id, branchId } = req.params as { id: string; branchId: string };
      const { status } = req.body as StockPutBody;
      if (m.role !== 'admin' && m.branchId !== branchId) {
        throw new AppError('FORBIDDEN', 403, 'staff can change stock only for their own branch');
      }
      const v = await ownVariant(app, m.merchantId, id);
      const [branch] = await app.db
        .select({ id: schema.merchantBranches.id })
        .from(schema.merchantBranches)
        .where(
          and(
            eq(schema.merchantBranches.id, branchId),
            eq(schema.merchantBranches.merchantId, m.merchantId),
          ),
        )
        .limit(1);
      if (!branch) throw new AppError('NOT_FOUND', 404, 'branch not found');

      return app.db.transaction(async (tx: DbTransaction) => {
        const [existing] = await tx
          .select()
          .from(S)
          .where(and(eq(S.variantId, v.id), eq(S.branchId, branchId)))
          .for('update');
        if (existing && existing.source !== 'manual') {
          throw new AppError(
            'STOCK_MANAGED_BY_FEED',
            409,
            `stock here is managed by ${existing.source}`,
          );
        }
        const values = {
          status,
          source: 'manual',
          quantity: null,
          updatedAt: new Date(),
          updatedByStaffId: m.staffId ?? null,
        };
        const [row] = await tx
          .insert(S)
          .values({ merchantId: m.merchantId, variantId: v.id, branchId, ...values })
          .onConflictDoUpdate({ target: [S.variantId, S.branchId], set: values })
          .returning();
        await recordAudit(tx, {
          actor: actorOf(m),
          action: 'variant_stock.set',
          resourceType: 'variant_stock',
          resourceId: row!.id,
          before: existing ? { status: existing.status } : null,
          after: { variantId: v.id, branchId, status },
          request: req,
        });
        return {
          branchId,
          status: row!.status,
          quantity: row!.quantity,
          source: row!.source,
          updatedAt: row!.updatedAt.toISOString(),
        };
      });
    },
  );

  // ── Tablet: sizes with this branch's availability ───────────────────────
  app.get(
    '/v1/device/catalog/:itemId/variants',
    { preHandler: app.requireDevice, schema: { params: itemParams } },
    async (req): Promise<DeviceVariantsResponse> => {
      const d = req.device!;
      const { itemId } = req.params as { itemId: string };
      const [merchant] = await app.db
        .select({ storeUrl: schema.merchants.storeUrl })
        .from(schema.merchants)
        .where(eq(schema.merchants.id, d.merchantId))
        .limit(1);
      const buyOnlineUrl = merchant?.storeUrl ?? null;
      // Demo items and other merchants' items have no variants here: an empty list, not a 404,
      // so the tablet simply shows no size picker.
      const [item] = await app.db
        .select({ offerPricePaise: schema.merchantCatalogItems.offerPricePaise })
        .from(schema.merchantCatalogItems)
        .where(
          and(
            eq(schema.merchantCatalogItems.id, itemId),
            eq(schema.merchantCatalogItems.merchantId, d.merchantId),
          ),
        )
        .limit(1);
      if (!item) return { variants: [], buyOnlineUrl };
      const variants = await app.db
        .select()
        .from(V)
        .where(and(eq(V.catalogItemId, itemId), eq(V.isActive, true)))
        .orderBy(asc(V.sortOrder), asc(V.createdAt));
      if (variants.length === 0) return { variants: [], buyOnlineUrl };
      const stock = await app.db
        .select({
          variantId: S.variantId,
          branchId: S.branchId,
          status: S.status,
          name: schema.merchantBranches.name,
        })
        .from(S)
        .innerJoin(
          schema.merchantBranches,
          and(
            eq(schema.merchantBranches.id, S.branchId),
            eq(schema.merchantBranches.isActive, true),
          ),
        )
        .where(
          inArray(
            S.variantId,
            variants.map((v) => v.id),
          ),
        )
        .orderBy(asc(schema.merchantBranches.name));
      return {
        buyOnlineUrl,
        variants: variants.map((v) => {
          const here = stock.find((s) => s.variantId === v.id && s.branchId === d.branchId);
          return {
            id: v.id,
            size: v.size,
            colour: v.colour,
            barcode: v.barcode,
            sku: v.sku,
            pricePaise: v.priceOverridePaise ?? item.offerPricePaise,
            status: here?.status ?? 'unknown',
            otherBranches: stock
              .filter(
                (s) =>
                  s.variantId === v.id &&
                  s.branchId !== d.branchId &&
                  (s.status === 'in_stock' || s.status === 'low'),
              )
              .map((s) => ({
                branchId: s.branchId,
                name: s.name,
                status: s.status as 'in_stock' | 'low',
              })),
          };
        }),
      };
    },
  );

  // ── AiVastra admin: standard size sets (plan P4) ────────────────────────
  const R = requirePermission('subcategories.read');
  const W = requirePermission('subcategories.write');
  const adminActor = (req: FastifyRequest) => ({ userId: req.userId, role: req.adminRole! });

  app.get('/admin/size-sets', { preHandler: R }, async () => ({
    items: await app.db.select().from(schema.sizeSets).orderBy(asc(schema.sizeSets.name)),
  }));

  app.post(
    '/admin/size-sets',
    { preHandler: W, schema: { body: SizeSetBody } },
    async (req, reply) => {
      const body = req.body as SizeSetBody;
      try {
        const row = await app.db.transaction(async (tx) => {
          const [s] = await tx.insert(schema.sizeSets).values(body).returning();
          await recordAudit(tx, {
            actor: adminActor(req),
            action: 'size_set.create',
            resourceType: 'size_set',
            resourceId: s!.id,
            after: s,
            request: req,
          });
          return s!;
        });
        return reply.code(201).send(row);
      } catch (err) {
        if (pgUnique(err)) throw new AppError('SIZE_SET_EXISTS', 409, 'slug already used');
        throw err;
      }
    },
  );

  app.patch(
    '/admin/size-sets/:id',
    { preHandler: W, schema: { params: variantParams, body: SizeSetBody.partial() } },
    async (req) => {
      const { id } = req.params as { id: string };
      const body = req.body as Partial<SizeSetBody>;
      return app.db.transaction(async (tx) => {
        const [before] = await tx.select().from(schema.sizeSets).where(eq(schema.sizeSets.id, id));
        if (!before) throw new AppError('NOT_FOUND', 404, 'size set not found');
        if (body.slug && body.slug !== before.slug) {
          const [clash] = await tx
            .select({ id: schema.sizeSets.id })
            .from(schema.sizeSets)
            .where(and(eq(schema.sizeSets.slug, body.slug), ne(schema.sizeSets.id, id)));
          if (clash) throw new AppError('SIZE_SET_EXISTS', 409, 'slug already used');
        }
        const [row] = await tx
          .update(schema.sizeSets)
          .set({ ...body, updatedAt: new Date() })
          .where(eq(schema.sizeSets.id, id))
          .returning();
        await recordAudit(tx, {
          actor: adminActor(req),
          action: 'size_set.update',
          resourceType: 'size_set',
          resourceId: id,
          before,
          after: row,
          request: req,
        });
        return row;
      });
    },
  );

  app.put(
    '/admin/assets/garment-types/:id/size-set',
    { preHandler: W, schema: { params: variantParams, body: GarmentTypeSizeSetBody } },
    async (req) => {
      const { id } = req.params as { id: string };
      const { sizeSetId } = req.body as GarmentTypeSizeSetBody;
      return app.db.transaction(async (tx) => {
        const [before] = await tx
          .select({ sizeSetId: schema.garmentSubcategories.sizeSetId })
          .from(schema.garmentSubcategories)
          .where(eq(schema.garmentSubcategories.id, id));
        if (!before) throw new AppError('NOT_FOUND', 404, 'garment type not found');
        if (sizeSetId) {
          const [set] = await tx
            .select({ id: schema.sizeSets.id })
            .from(schema.sizeSets)
            .where(eq(schema.sizeSets.id, sizeSetId));
          if (!set) throw new AppError('NOT_FOUND', 404, 'size set not found');
        }
        await tx
          .update(schema.garmentSubcategories)
          .set({ sizeSetId })
          .where(eq(schema.garmentSubcategories.id, id));
        await recordAudit(tx, {
          actor: adminActor(req),
          action: 'garment_type.size_set',
          resourceType: 'garment_type',
          resourceId: id,
          before,
          after: { sizeSetId },
          request: req,
        });
        return { id, sizeSetId };
      });
    },
  );
}
