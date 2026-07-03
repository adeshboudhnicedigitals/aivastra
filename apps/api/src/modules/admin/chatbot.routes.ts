import { schema } from '@aivastra/db';
import { QnaUpsert } from '@aivastra/types';
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { requireAdmin } from './guard.js';

export async function adminChatbotRoutes(app: FastifyInstance) {
  const QNA = requireAdmin(['SUPER_ADMIN', 'ADMIN']);

  app.get('/admin/chatbot/qna', { preHandler: QNA }, async (req) => {
    const { active = 'all', q = '' } = req.query as Record<string, string>;
    const conds = [];
    if (active === 'true') conds.push(eq(schema.chatbotQna.isActive, true));
    if (active === 'false') conds.push(eq(schema.chatbotQna.isActive, false));
    if (q)
      conds.push(
        or(ilike(schema.chatbotQna.question, `%${q}%`), ilike(schema.chatbotQna.answer, `%${q}%`)),
      );
    const where = conds.length ? and(...conds) : undefined;
    const [rows, [countRow]] = await Promise.all([
      app.db
        .select()
        .from(schema.chatbotQna)
        .where(where)
        .orderBy(desc(schema.chatbotQna.updatedAt))
        .limit(500),
      app.db.select({ total: sql<number>`count(*)::int` }).from(schema.chatbotQna).where(where),
    ]);
    return { rows, total: countRow?.total ?? 0 };
  });

  app.post('/admin/chatbot/qna', { preHandler: QNA, schema: { body: QnaUpsert } }, async (req) => {
    const body = req.body as z.infer<typeof QnaUpsert>;
    const [row] = await app.db.insert(schema.chatbotQna).values(body).returning();
    return row;
  });

  app.patch(
    '/admin/chatbot/qna/:id',
    {
      preHandler: QNA,
      schema: { params: z.object({ id: z.string().uuid() }), body: QnaUpsert.partial() },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const [row] = await app.db
        .update(schema.chatbotQna)
        .set({ ...(req.body as object), updatedAt: new Date() })
        .where(eq(schema.chatbotQna.id, id))
        .returning();
      if (!row) throw new AppError('NOT_FOUND', 404, 'qna not found');
      return row;
    },
  );

  app.delete(
    '/admin/chatbot/qna/:id',
    { preHandler: QNA, schema: { params: z.object({ id: z.string().uuid() }) } },
    async (req) => {
      const { id } = req.params as { id: string };
      const [row] = await app.db
        .delete(schema.chatbotQna)
        .where(eq(schema.chatbotQna.id, id))
        .returning();
      if (!row) throw new AppError('NOT_FOUND', 404, 'qna not found');
      return { ok: true };
    },
  );

  app.post('/admin/chatbot/ingest', { preHandler: QNA }, async () => {
    if (!app.env.CHATBOT_URL || !app.env.CHATBOT_SERVICE_TOKEN)
      throw new AppError('CHATBOT_UNCONFIGURED', 503, 'chatbot service not configured');
    const res = await fetch(`${app.env.CHATBOT_URL}/ingest`, {
      method: 'POST',
      headers: { 'x-service-token': app.env.CHATBOT_SERVICE_TOKEN },
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new AppError('INGEST_FAILED', res.status === 409 ? 409 : 502, text.slice(0, 300));
    }
    return res.json();
  });

  app.get('/admin/chatbot/status', { preHandler: QNA }, async () => {
    const [activeRow] = await app.db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.chatbotQna)
      .where(eq(schema.chatbotQna.isActive, true));
    let embedded = 0;
    if (app.env.CHATBOT_URL) {
      try {
        const res = await fetch(`${app.env.CHATBOT_URL}/health`, {
          signal: AbortSignal.timeout(5_000),
        });
        if (res.ok) embedded = ((await res.json()) as { embedded: number }).embedded;
      } catch {
        /* chatbot down — show 0 */
      }
    }
    return { activeQna: activeRow?.n ?? 0, embedded };
  });
}
