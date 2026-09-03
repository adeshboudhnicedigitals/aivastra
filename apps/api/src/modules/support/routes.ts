import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { keys } from '@aivastra/storage';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { sendReportReceivedEmail } from '../../lib/mailer.js';
import { reopenResolvedTicket, setSubjectFromFirstMessage } from '../../lib/tickets.js';

const CONTENT_TYPE_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

// `support/<uuid>.<ext>` — the only key shape keys.supportAttachment produces, with
// the extension set CONTENT_TYPE_TO_EXT above allows. Kept in sync with that map.
const SUPPORT_ATTACHMENT_KEY = /^support\/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$/i;

export async function supportRoutes(app: FastifyInstance) {
  // POST /v1/support/presign — get a presigned URL for an optional attachment
  app.post(
    '/v1/support/presign',
    {
      preHandler: app.requireUser,
      schema: {
        body: z.object({
          contentType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
        }),
      },
    },
    async (req) => {
      const { contentType } = req.body as { contentType: string };
      const ext = CONTENT_TYPE_TO_EXT[contentType] ?? 'bin';
      const id = randomUUID();
      const attachmentKey = keys.supportAttachment(id, ext);
      const { url } = await app.storage.presignPut(attachmentKey, contentType, 0, 900);
      return { uploadUrl: url, attachmentKey };
    },
  );

  // POST /v1/support — submit to (or continue) the caller's active ticket
  app.post(
    '/v1/support',
    {
      preHandler: app.requireUser,
      schema: {
        body: z.object({
          message: z.string().min(1).max(3000),
          attachmentKey: z.string().optional(),
          attachmentType: z.string().max(100).optional(),
        }),
      },
    },
    async (req) => {
      const { message, attachmentKey, attachmentType } = req.body as {
        message: string;
        attachmentKey?: string;
        attachmentType?: string;
      };

      // Same counter and window the chatbot WS `message` frame handler uses
      // (apps/chatbot/src/ws/gateway.ts) — deliberately the same Redis key, so a
      // user can't outrun the WS limit by switching to the form.
      const rlKey = `chatbot:rl:${req.userId}`;
      const n = await app.redis.incr(rlKey);
      if (n === 1) await app.redis.expire(rlKey, 30);
      if (n > 10) throw new AppError('RATE_LIMITED', 429, 'slow down');

      const [existing] = await app.db
        .select()
        .from(schema.chatbotConversations)
        .where(
          and(
            eq(schema.chatbotConversations.userId, req.userId),
            sql`${schema.chatbotConversations.status} <> 'CLOSED'`,
          ),
        );
      let convId: string;
      let isNew = false;
      if (existing) {
        convId = existing.id;
        if (existing.status === 'RESOLVED') {
          await reopenResolvedTicket(app, convId);
        }
      } else {
        const [created] = await app.db
          .insert(schema.chatbotConversations)
          .values({ userId: req.userId, source: 'support_modal' })
          .onConflictDoNothing()
          .returning();
        if (created) {
          convId = created.id;
          isNew = true;
        } else {
          const [winner] = await app.db
            .select()
            .from(schema.chatbotConversations)
            .where(
              and(
                eq(schema.chatbotConversations.userId, req.userId),
                sql`${schema.chatbotConversations.status} <> 'CLOSED'`,
              ),
            );
          convId = winner.id;
        }
      }

      await setSubjectFromFirstMessage(app, convId, message);
      const [msgRow] = await app.db
        .insert(schema.chatbotMessages)
        .values({
          conversationId: convId,
          role: 'user',
          senderId: req.userId,
          content: message,
          attachmentKey: attachmentKey ?? null,
          attachmentType: attachmentType ?? null,
        })
        .returning();
      await app.db
        .update(schema.chatbotConversations)
        .set({ lastMessageAt: new Date() })
        .where(eq(schema.chatbotConversations.id, convId));

      await app.redis.publish(
        `chatbot:conv:${convId}`,
        JSON.stringify({
          type: 'message',
          message: {
            id: msgRow.id,
            conversationId: convId,
            role: 'user',
            senderId: req.userId,
            content: message,
            attachmentKey: msgRow.attachmentKey,
            attachmentType: msgRow.attachmentType,
            createdAt: msgRow.createdAt.toISOString(),
          },
        }),
      );
      if (isNew) {
        await app.redis.publish('chatbot:queue', JSON.stringify({ type: 'queue_update' }));
      }

      const [user] = await app.db
        .select({ email: schema.users.email })
        .from(schema.users)
        .where(eq(schema.users.id, req.userId))
        .limit(1);
      const email = user?.email ?? '';
      if (email) {
        try {
          await sendReportReceivedEmail(app.env.RESEND_API_KEY, app.env.EMAIL_FROM, email);
        } catch (err) {
          app.log.error({ err }, 'Failed to send report-received acknowledgment email');
        }
      }

      return { ticketId: convId };
    },
  );

  // GET /v1/support/attachment?key=<attachment key> — redirect to a short-lived presigned GET.
  // No auth: an <img> tag can't carry a bearer header, and this codebase forbids putting
  // auth tokens in query strings. Trust model instead: the key itself (a randomUUID()-derived
  // support/ path from POST /v1/support/presign) is the capability — unguessable, and scoped
  // to the support/ prefix only so this can never be used to fetch any other object in the bucket.
  app.get(
    '/v1/support/attachment',
    {
      schema: { querystring: z.object({ key: z.string().min(1) }) },
    },
    async (req, reply) => {
      const { key } = req.query as { key: string };
      // Exactly the shape keys.supportAttachment mints — a UUID plus one of the
      // extensions CONTENT_TYPE_TO_EXT above can produce. A bare prefix check would
      // have accepted anything under support/, including a traversal-shaped key.
      if (!SUPPORT_ATTACHMENT_KEY.test(key)) {
        throw new AppError('NOT_FOUND', 404, 'attachment not found');
      }
      const { url } = await app.storage.presignGet(key, 300);
      return reply.redirect(url);
    },
  );
}
