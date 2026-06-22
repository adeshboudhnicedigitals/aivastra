import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import fp from 'fastify-plugin';
import { AppError } from '../lib/errors.js';
import { verifyAccess } from '../modules/auth/service.js';

export const widgetAuthPlugin = fp(async (app) => {
  const secret = new TextEncoder().encode(app.env.JWT_SECRET);

  app.decorate('requireWidgetClient', async (req, _reply) => {
    const key = req.headers['x-widget-key'];
    if (!key || typeof key !== 'string') {
      throw new AppError('UNAUTHORIZED', 401, 'Missing X-Widget-Key header');
    }
    const [client] = await app.db
      .select()
      .from(schema.widgetClients)
      .where(eq(schema.widgetClients.widgetKey, key))
      .limit(1);
    if (!client?.isActive) {
      throw new AppError('UNAUTHORIZED', 401, 'Invalid or inactive widget key');
    }
    req.widgetClientId = client.id;
    req.widgetClient = client;
  });

  app.decorate('requireMerchant', async (req, _reply) => {
    let token: string | undefined;

    const cookieHeader = req.headers.cookie;
    if (cookieHeader) {
      const cookies = Object.fromEntries(
        cookieHeader.split(';').map((c) => {
          const eq = c.indexOf('=');
          if (eq === -1) return [c.trim(), ''];
          return [c.slice(0, eq).trim(), c.slice(eq + 1).trim()];
        }),
      );
      token = cookies.merchant_access_token;
    }

    if (!token) {
      const h = req.headers.authorization;
      token = h?.startsWith('Bearer ') ? h.slice(7) : undefined;
    }

    if (!token) throw new AppError('UNAUTH', 401, 'missing authentication');

    let payload: Awaited<ReturnType<typeof verifyAccess>>;
    try {
      payload = await verifyAccess(secret, token);
      const aud = payload.aud;
      const isMerchant = Array.isArray(aud) ? aud.includes('merchant') : aud === 'merchant';
      if (!isMerchant) throw new AppError('UNAUTH', 401, 'invalid token');
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError('UNAUTH', 401, 'invalid token');
    }

    const clientId = String(payload.sub);
    const [client] = await app.db
      .select({ isActive: schema.widgetClients.isActive })
      .from(schema.widgetClients)
      .where(eq(schema.widgetClients.id, clientId))
      .limit(1);
    if (!client) throw new AppError('UNAUTH', 401, 'merchant not found');
    if (!client.isActive) throw new AppError('FORBIDDEN', 403, 'merchant account inactive');

    req.merchantClientId = clientId;
  });
});

import type { InferSelectModel } from 'drizzle-orm';

declare module 'fastify' {
  interface FastifyRequest {
    widgetClientId?: string;
    widgetClient?: InferSelectModel<typeof schema.widgetClients>;
    merchantClientId?: string;
  }
  interface FastifyInstance {
    requireWidgetClient: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireMerchant: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
