import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { listSenders, readTimeline } from '../messaging/trace.js';
import { requirePermission } from './guard.js';

// WhatsApp → Conversations tab: a read-only view of the Redis conversation trace
// (messaging/trace.ts). Same permission as the Requests tab — it is inspection of
// the bot's traffic, not a billing action. Full numbers are returned on purpose:
// admins look up a specific seller, and the data expires after 4 days.

const Params = z.object({ waId: z.string().regex(/^\d{6,16}$/) });

export async function adminWhatsappConversationsRoutes(app: FastifyInstance) {
  const R = requirePermission('jobs.read');

  app.get('/admin/whatsapp/conversations', { preHandler: R }, async () => ({
    items: await listSenders(app),
  }));

  app.get(
    '/admin/whatsapp/conversations/:waId',
    { preHandler: R, schema: { params: Params } },
    async (req) => {
      const { waId } = req.params as z.infer<typeof Params>;
      return { entries: await readTimeline(app, waId) };
    },
  );
}
