import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { keys } from '@aivastra/storage';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sendReportReceivedEmail } from '../../lib/mailer.js';

const CONTENT_TYPE_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

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
        }),
      },
    },
    async (req) => {
      const { message, attachmentKey } = req.body as { message: string; attachmentKey?: string };

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
          await app.db
            .update(schema.chatbotConversations)
            .set({ status: 'OPEN', assignedAgentId: null })
            .where(eq(schema.chatbotConversations.id, convId));
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

      const [msgRow] = await app.db
        .insert(schema.chatbotMessages)
        .values({
          conversationId: convId,
          role: 'user',
          senderId: req.userId,
          content: message,
          attachmentKey: attachmentKey ?? null,
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
  // Query param, not a path segment/wildcard: attachment keys contain slashes
  // (e.g. `support/abc.jpg`), which a wildcard route would have to re-decode.
  app.get(
    '/v1/support/attachment',
    {
      preHandler: app.requireUser,
      schema: { querystring: z.object({ key: z.string().min(1) }) },
    },
    async (req, reply) => {
      const { key } = req.query as { key: string };
      const { url } = await app.storage.presignGet(key, 300);
      return reply.redirect(url);
    },
  );
}
