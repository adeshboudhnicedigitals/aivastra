import { schema } from '@aivastra/db';
import { and, desc, eq, lt, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { requirePermission } from './guard.js';

// WhatsApp garment recognition records (plan 5 Task 4b, D54): the
// dispatcher's classify lane writes one row per request; admin gets a
// read-only list with the photo plus a detail view. Same permission as the
// admin Jobs list — recognition never costs the seller anything, so this is
// inspection, not billing.

const Outcome = z.enum(['answered', 'no_worker', 'failed', 'expired']);

const ListQuery = z.object({
  outcome: Outcome.optional(),
  // Keyset cursor: the id of the last row on the previous page. Rows sort
  // newest first, so the next page is everything older than it.
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export async function adminGarmentRecognitionsRoutes(app: FastifyInstance) {
  // Same permission as the admin Jobs list.
  const R = requirePermission('jobs.read');

  app.get(
    '/admin/garment-recognitions',
    { preHandler: R, schema: { querystring: ListQuery } },
    async (req) => {
      const { outcome, cursor, limit } = req.query as z.infer<typeof ListQuery>;
      const t = schema.garmentRecognitions;

      const conditions: ReturnType<typeof eq>[] = [];
      if (outcome) conditions.push(eq(t.outcome, outcome));
      if (cursor) {
        const [cursorRow] = await app.db
          .select({ createdAt: t.createdAt })
          .from(t)
          .where(eq(t.id, cursor));
        if (!cursorRow) throw new AppError('VALIDATION', 400, 'unknown cursor');
        conditions.push(
          or(
            lt(t.createdAt, cursorRow.createdAt),
            and(eq(t.createdAt, cursorRow.createdAt), lt(t.id, cursor)),
          ) as ReturnType<typeof eq>,
        );
      }
      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const items = await app.db
        .select({
          id: t.id,
          createdAt: t.createdAt,
          gender: t.gender,
          outcome: t.outcome,
          answer: t.answer,
          ms: t.ms,
        })
        .from(t)
        .where(where)
        .orderBy(desc(t.createdAt), desc(t.id))
        .limit(limit);

      return { items, nextCursor: items.length === limit ? (items.at(-1)?.id ?? null) : null };
    },
  );

  app.get(
    '/admin/garment-recognitions/:id',
    { preHandler: R, schema: { params: z.object({ id: z.string().uuid() }) } },
    async (req) => {
      // biome-ignore lint/suspicious/noExplicitAny: Fastify typed-provider workaround
      const { id } = req.params as any;
      const t = schema.garmentRecognitions;
      const [row] = await app.db.select().from(t).where(eq(t.id, id));
      if (!row) throw new AppError('NOT_FOUND', 404, 'recognition not found');
      const { url: photoUrl } = await app.storage.presignGet(row.garmentKey, 3600);
      return { ...row, photoUrl };
    },
  );
}
