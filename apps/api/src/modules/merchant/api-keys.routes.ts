import { schema } from '@aivastra/db';
import { ApiKeyCreateBody } from '@aivastra/types';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { generateApiKey } from '../dev/keys.js';

const IdParams = z.object({ id: z.string().uuid() });

/**
 * Developer API key management. Authed by the merchant's session JWT
 * (requireMerchant), NEVER by an API key — a leaked key must not be able to mint
 * more keys or enumerate its siblings.
 */
export async function merchantApiKeysRoutes(app: FastifyInstance) {
  // Fastify's default JSON parser throws FST_ERR_CTP_EMPTY_JSON_BODY for any
  // body-capable method (including DELETE) when content-type: application/json
  // is set but no body is sent — exactly what a bodyless DELETE from a fetch
  // client that always attaches that header does. Scoped to this plugin's own
  // encapsulation context only, so it can't affect any other route's parsing.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const str = body as string;
    if (str === '') {
      done(null, undefined);
      return;
    }
    try {
      done(null, JSON.parse(str));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  app.get('/v1/merchant/api-keys', { preHandler: app.requireMerchant }, async (req) => {
    const rows = await app.db
      .select({
        id: schema.apiKeys.id,
        label: schema.apiKeys.label,
        keyPrefix: schema.apiKeys.keyPrefix,
        lastUsedAt: schema.apiKeys.lastUsedAt,
        createdAt: schema.apiKeys.createdAt,
      })
      .from(schema.apiKeys)
      .where(
        and(
          eq(schema.apiKeys.merchantId, req.merchantClientId as string),
          isNull(schema.apiKeys.revokedAt),
        ),
      )
      .orderBy(desc(schema.apiKeys.createdAt));
    return {
      keys: rows.map((r) => ({
        ...r,
        lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  });

  app.post(
    '/v1/merchant/api-keys',
    // Body shape is validated manually inside the handler, AFTER preHandler,
    // rather than declared via Fastify's route `schema` — Fastify runs schema
    // validation before preHandler, so an unauthenticated bodyless request would
    // otherwise 400 on validation before requireMerchant ever got a chance to
    // 401 it. Auth must win that race.
    { preHandler: app.requireMerchant },
    async (req, reply) => {
      const parsed = ApiKeyCreateBody.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError('VALIDATION', 400, parsed.error.issues[0]?.message ?? 'invalid body');
      }
      const { label } = parsed.data;
      const { key, keyHash, keyPrefix } = generateApiKey();
      const [row] = await app.db
        .insert(schema.apiKeys)
        .values({ merchantId: req.merchantClientId as string, label, keyHash, keyPrefix })
        .returning();
      if (!row) throw new AppError('INTERNAL', 500, 'failed to create key');

      // The ONLY place the plaintext key is ever returned. It is not stored and
      // cannot be recovered — the dashboard must tell the user so.
      return reply.code(201).send({
        id: row.id,
        label: row.label,
        key,
        keyPrefix: row.keyPrefix,
        createdAt: row.createdAt.toISOString(),
      });
    },
  );

  app.delete(
    '/v1/merchant/api-keys/:id',
    { preHandler: app.requireMerchant, schema: { params: IdParams } },
    async (req, reply) => {
      const { id } = req.params as z.infer<typeof IdParams>;
      // merchantId in the WHERE clause is the ownership check: another merchant's
      // key id simply matches nothing → 404.
      const revoked = await app.db
        .update(schema.apiKeys)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(schema.apiKeys.id, id),
            eq(schema.apiKeys.merchantId, req.merchantClientId as string),
            isNull(schema.apiKeys.revokedAt),
          ),
        )
        .returning({ id: schema.apiKeys.id });
      if (!revoked.length) throw new AppError('NOT_FOUND', 404, 'key not found');
      return reply.code(204).send();
    },
  );

  app.get('/v1/merchant/api-usage', { preHandler: app.requireMerchant }, async (req) => {
    const rows = await app.db
      .select({
        jobId: schema.jobs.id,
        status: schema.jobs.status,
        creditsCharged: schema.jobs.creditsCharged,
        createdAt: schema.jobs.createdAt,
        keyLabel: schema.apiKeys.label,
        keyPrefix: schema.apiKeys.keyPrefix,
      })
      .from(schema.jobs)
      .innerJoin(schema.apiKeys, eq(schema.apiKeys.id, schema.jobs.apiKeyId))
      .where(
        and(
          eq(schema.jobs.merchantId, req.merchantClientId as string),
          eq(schema.jobs.source, 'api'),
        ),
      )
      .orderBy(desc(schema.jobs.createdAt))
      .limit(50);
    return {
      usage: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    };
  });
}
