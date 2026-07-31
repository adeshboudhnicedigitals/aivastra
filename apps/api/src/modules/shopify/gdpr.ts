import { schema } from '@aivastra/db';
import { and, eq, inArray, isNotNull, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { normalizeEmail } from './shopper.js';

export interface ShopperMatch {
  shopifyCustomerId?: number | null;
  email?: string | null;
  /** shop_redact: every shopper for the store, ignoring the other fields. */
  matchAll?: boolean;
}

/** Match on customer id first, then email: a shopper may have supplied an
 *  email without ever logging in, and the webhook payload carries both.
 *  Returns null when nothing identifies a subject, so an empty payload can
 *  never be read as "match everything". */
function matchFilter(storeId: string, match: ShopperMatch) {
  const storeScope = eq(schema.shopifyShoppers.storeId, storeId);
  if (match.matchAll) return storeScope;

  const email = normalizeEmail(match.email);
  const clauses = [];
  if (match.shopifyCustomerId != null) {
    clauses.push(eq(schema.shopifyShoppers.shopifyCustomerId, match.shopifyCustomerId));
  }
  if (email) clauses.push(eq(schema.shopifyShoppers.email, email));
  if (clauses.length === 0) return null;
  return and(storeScope, or(...clauses));
}

/** Rows and stored R2 keys for a data-subject access request. */
export async function collectShopperData(
  app: FastifyInstance,
  storeId: string,
  match: ShopperMatch,
): Promise<{ shopperIds: string[]; emails: string[] }> {
  const filter = matchFilter(storeId, match);
  if (!filter) return { shopperIds: [], emails: [] };
  const rows = await app.db
    .select({ id: schema.shopifyShoppers.id, email: schema.shopifyShoppers.email })
    .from(schema.shopifyShoppers)
    .where(filter);
  return {
    shopperIds: rows.map((r) => r.id),
    emails: rows.map((r) => r.email).filter((e): e is string => !!e),
  };
}

/**
 * Erase a shopper: their R2 photos and results, then the row itself.
 *
 * jobs.shopify_shopper_id is ON DELETE SET NULL, so the billing rows survive
 * with the link severed. Returns the number of shopper rows removed.
 *
 * Retry-safe by construction: a database reference to an R2 object (a job's
 * customerPhotoKey, a jobOutputs row's resultKey/thumbnailKey) is only
 * cleared once its own delete actually succeeded (or the key was already
 * absent) — never as an all-or-nothing pair. And a shopifyShoppers row is
 * only deleted once every object-delete attempt for that shopper's jobs
 * succeeded; if any failed, the row (and whichever keys are still non-null)
 * is left in place so a future retry can find and finish the job.
 */
export async function redactShopperData(
  app: FastifyInstance,
  storeId: string,
  match: ShopperMatch,
): Promise<number> {
  const filter = matchFilter(storeId, match);
  if (!filter) return 0;

  const shoppers = await app.db
    .select({ id: schema.shopifyShoppers.id })
    .from(schema.shopifyShoppers)
    .where(filter);
  if (shoppers.length === 0) return 0;
  const ids = shoppers.map((s) => s.id);

  // Per-shopper "every object delete succeeded (or had nothing to delete)"
  // flag. Only shoppers that stay true across their whole job set are
  // eligible for row deletion below.
  const shopperClean = new Map<string, boolean>();
  for (const id of ids) shopperClean.set(id, true);

  for (const shopperId of ids) {
    const jobRows = await app.db
      .select({ id: schema.jobs.id, photoKey: schema.jobs.customerPhotoKey })
      .from(schema.jobs)
      .where(and(eq(schema.jobs.shopifyShopperId, shopperId), isNotNull(schema.jobs.id)));

    for (const job of jobRows) {
      if (job.photoKey) {
        let photoDeleted = false;
        try {
          await app.storage.deleteObject(job.photoKey);
          photoDeleted = true;
        } catch (err) {
          app.log.warn({ err, jobId: job.id }, 'gdpr redact: photo delete failed');
        }
        if (photoDeleted) {
          await app.db
            .update(schema.jobs)
            .set({ customerPhotoKey: null })
            .where(eq(schema.jobs.id, job.id));
        } else {
          shopperClean.set(shopperId, false);
        }
      }

      const [out] = await app.db
        .select()
        .from(schema.jobOutputs)
        .where(eq(schema.jobOutputs.jobId, job.id));
      if (out) {
        const patch: { resultKey?: null; thumbnailKey?: null } = {};
        if (out.resultKey) {
          try {
            await app.storage.deleteObject(out.resultKey);
            patch.resultKey = null;
          } catch (err) {
            app.log.warn({ err, jobId: job.id }, 'gdpr redact: result delete failed');
            shopperClean.set(shopperId, false);
          }
        }
        if (out.thumbnailKey) {
          try {
            await app.storage.deleteObject(out.thumbnailKey);
            patch.thumbnailKey = null;
          } catch (err) {
            app.log.warn({ err, jobId: job.id }, 'gdpr redact: result delete failed');
            shopperClean.set(shopperId, false);
          }
        }
        if (Object.keys(patch).length > 0) {
          await app.db
            .update(schema.jobOutputs)
            .set(patch)
            .where(eq(schema.jobOutputs.jobId, job.id));
        }
      }
    }
  }

  const removableIds = ids.filter((id) => shopperClean.get(id));
  if (removableIds.length > 0) {
    await app.db
      .delete(schema.shopifyShoppers)
      .where(inArray(schema.shopifyShoppers.id, removableIds));
  }
  return removableIds.length;
}
