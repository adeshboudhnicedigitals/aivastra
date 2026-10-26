import { type DbTransaction, schema } from '@aivastra/db';
import {
  CreateWhatsAppBasketBody,
  PatchWhatsAppBasketBody,
  WHATSAPP_GENDERS,
} from '@aivastra/types';
import { and, asc, eq, inArray, notInArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { whatsappIneligibleReason } from '../messaging/baskets.js';
import { recordAudit } from './audit.js';
import { requirePermission } from './guard.js';

// Admin WhatsApp page → Baskets tab. A basket groups one gender's garment types
// that run the same workflow; the bot confirms the basket and runs it as its
// representative type (apps/api/src/modules/messaging/baskets.ts). Membership
// lives on garment_subcategories.whatsapp_basket_id, so a type is in at most
// one basket. Same permission as editing garment types themselves.

const GenderQuery = z.object({ gender: z.enum(WHATSAPP_GENDERS) });
const IdParam = z.object({ id: z.string().uuid() });

export async function adminWhatsAppBasketsRoutes(app: FastifyInstance) {
  const RW = requirePermission('subcategories.write');
  const gs = schema.garmentSubcategories;
  const wb = schema.whatsappBaskets;

  async function snapshot(tx: DbTransaction, id: string) {
    const [basket] = await tx.select().from(wb).where(eq(wb.id, id));
    if (!basket) return null;
    const members = await tx
      .select({ id: gs.id })
      .from(gs)
      .where(eq(gs.whatsappBasketId, id))
      .orderBy(asc(gs.sortOrder), asc(gs.label));
    return { ...basket, memberIds: members.map((m) => m.id) };
  }

  /**
   * Every member must be the basket's gender and offerable on WhatsApp (one
   * garment photo), and the representative must be a member. Checked here,
   * not only in the picker, so a stale form cannot slip a two-image type in.
   */
  async function checkMembers(
    tx: DbTransaction,
    gender: string,
    memberIds: string[],
    representativeId: string | null | undefined,
  ) {
    if (representativeId && !memberIds.includes(representativeId)) {
      throw new AppError('VALIDATION', 400, 'The representative type must be one of the members');
    }
    if (memberIds.length === 0) return;
    const rows = await tx.select().from(gs).where(inArray(gs.id, memberIds));
    if (rows.length !== new Set(memberIds).size) {
      throw new AppError('VALIDATION', 400, 'Unknown garment type in members');
    }
    for (const r of rows) {
      if (r.genderSlug !== gender) {
        throw new AppError(
          'VALIDATION',
          400,
          `${r.label} is a ${r.genderSlug} type, not ${gender}`,
        );
      }
      const reason = whatsappIneligibleReason(r);
      if (reason) {
        throw new AppError(
          'VALIDATION',
          400,
          `${r.label} needs more than one image (${reason}), so it is not offered on WhatsApp`,
        );
      }
    }
  }

  /** Makes `memberIds` exactly the basket's members; a type moves out of any other basket. */
  async function setMembers(tx: DbTransaction, basketId: string, memberIds: string[]) {
    const now = new Date();
    await tx
      .update(gs)
      .set({ whatsappBasketId: null, updatedAt: now })
      .where(
        memberIds.length > 0
          ? and(eq(gs.whatsappBasketId, basketId), notInArray(gs.id, memberIds))
          : eq(gs.whatsappBasketId, basketId),
      );
    if (memberIds.length > 0) {
      await tx
        .update(gs)
        .set({ whatsappBasketId: basketId, updatedAt: now })
        .where(inArray(gs.id, memberIds));
    }
  }

  app.get(
    '/admin/whatsapp/baskets',
    { preHandler: RW, schema: { querystring: GenderQuery } },
    async (req) => {
      const { gender } = req.query as z.infer<typeof GenderQuery>;
      const [baskets, types] = await Promise.all([
        app.db
          .select()
          .from(wb)
          .where(eq(wb.genderSlug, gender))
          .orderBy(asc(wb.sortOrder), asc(wb.name)),
        app.db
          .select()
          .from(gs)
          .where(eq(gs.genderSlug, gender))
          .orderBy(asc(gs.sortOrder), asc(gs.label)),
      ]);
      return {
        baskets: baskets.map((b) => ({
          id: b.id,
          genderSlug: b.genderSlug,
          name: b.name,
          representativeSubcategoryId: b.representativeSubcategoryId,
          sortOrder: b.sortOrder,
          isActive: b.isActive,
          memberIds: types.filter((t) => t.whatsappBasketId === b.id).map((t) => t.id),
        })),
        types: types.map((t) => ({
          id: t.id,
          label: t.label,
          sortOrder: t.sortOrder,
          isActive: t.isActive,
          // The classifier answers with this; a type without one is never guessed.
          publicApiSlug: t.publicApiSlug,
          basketId: t.whatsappBasketId,
          ineligibleReason: whatsappIneligibleReason(t),
        })),
      };
    },
  );

  app.post(
    '/admin/whatsapp/baskets',
    { preHandler: RW, schema: { body: CreateWhatsAppBasketBody } },
    async (req, reply) => {
      const body = req.body as z.infer<typeof CreateWhatsAppBasketBody>;
      const created = await app.db.transaction(async (tx) => {
        await checkMembers(tx, body.genderSlug, body.memberIds, body.representativeSubcategoryId);
        const [row] = await tx
          .insert(wb)
          .values({
            genderSlug: body.genderSlug,
            name: body.name,
            representativeSubcategoryId: body.representativeSubcategoryId ?? null,
            sortOrder: body.sortOrder ?? 0,
          })
          .returning({ id: wb.id });
        const id = (row as { id: string }).id;
        await setMembers(tx, id, body.memberIds);
        const after = await snapshot(tx, id);
        await recordAudit(tx, {
          // biome-ignore lint/style/noNonNullAssertion: set by the requirePermission preHandler (guard.ts) before any handler runs
          actor: { userId: req.userId, role: req.adminRole! },
          action: 'whatsapp_baskets.create',
          resourceType: 'whatsapp_basket',
          resourceId: id,
          after,
          request: req,
        });
        return after;
      });
      return reply.status(201).send(created);
    },
  );

  app.patch(
    '/admin/whatsapp/baskets/:id',
    { preHandler: RW, schema: { params: IdParam, body: PatchWhatsAppBasketBody } },
    async (req) => {
      const { id } = req.params as z.infer<typeof IdParam>;
      const body = req.body as z.infer<typeof PatchWhatsAppBasketBody>;
      return app.db.transaction(async (tx) => {
        const before = await snapshot(tx, id);
        if (!before) throw new AppError('NOT_FOUND', 404, 'basket not found');
        const memberIds = body.memberIds ?? before.memberIds;
        const representativeId =
          body.representativeSubcategoryId !== undefined
            ? body.representativeSubcategoryId
            : // Members changed without naming a new representative: keep the old
              // one only while it is still a member, else fall back to the default.
              before.representativeSubcategoryId &&
                memberIds.includes(before.representativeSubcategoryId)
              ? before.representativeSubcategoryId
              : null;
        if (body.memberIds) await checkMembers(tx, before.genderSlug, memberIds, representativeId);
        else if (representativeId && !memberIds.includes(representativeId)) {
          throw new AppError(
            'VALIDATION',
            400,
            'The representative type must be one of the members',
          );
        }
        await tx
          .update(wb)
          .set({
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
            ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
            representativeSubcategoryId: representativeId,
            updatedAt: new Date(),
          })
          .where(eq(wb.id, id));
        if (body.memberIds) await setMembers(tx, id, memberIds);
        const after = await snapshot(tx, id);
        await recordAudit(tx, {
          // biome-ignore lint/style/noNonNullAssertion: set by the requirePermission preHandler (guard.ts) before any handler runs
          actor: { userId: req.userId, role: req.adminRole! },
          action: 'whatsapp_baskets.update',
          resourceType: 'whatsapp_basket',
          resourceId: id,
          before,
          after,
          request: req,
        });
        return after;
      });
    },
  );

  // Soft delete: the row and its members stay, the bot ignores it and treats
  // its members as baskets of their own. Reversible with isActive: true.
  app.delete(
    '/admin/whatsapp/baskets/:id',
    { preHandler: RW, schema: { params: IdParam } },
    async (req) => {
      const { id } = req.params as z.infer<typeof IdParam>;
      return app.db.transaction(async (tx) => {
        const before = await snapshot(tx, id);
        if (!before) throw new AppError('NOT_FOUND', 404, 'basket not found');
        await tx.update(wb).set({ isActive: false, updatedAt: new Date() }).where(eq(wb.id, id));
        await recordAudit(tx, {
          // biome-ignore lint/style/noNonNullAssertion: set by the requirePermission preHandler (guard.ts) before any handler runs
          actor: { userId: req.userId, role: req.adminRole! },
          action: 'whatsapp_baskets.deactivate',
          resourceType: 'whatsapp_basket',
          resourceId: id,
          before,
          after: { ...before, isActive: false },
          request: req,
        });
        return { ok: true };
      });
    },
  );
}
