import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import fp from 'fastify-plugin';
import { AppError } from '../lib/errors.js';
import { verifyAccess, verifyKioskAccess } from '../modules/auth/service.js';

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
    if (client.allowedOrigins.length > 0) {
      const origin = req.headers.origin ?? '';
      if (!client.allowedOrigins.includes(origin)) {
        throw new AppError('FORBIDDEN', 403, 'Origin not allowed');
      }
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

  app.decorate('requireKioskDevice', async (req, _reply) => {
    const h = req.headers.authorization;
    const token = h?.startsWith('Bearer ') ? h.slice(7) : undefined;
    if (!token) throw new AppError('UNAUTH', 401, 'missing bearer');

    let deviceId: string;
    try {
      const payload = await verifyKioskAccess(secret, token);
      if ((payload as Record<string, unknown>).kind !== 'access') {
        throw new AppError('UNAUTH', 401, 'invalid token');
      }
      deviceId = String(payload.sub);
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError('UNAUTH', 401, 'invalid token');
    }

    const [device] = await app.db
      .select({
        widgetClientId: schema.kioskDevices.widgetClientId,
        status: schema.kioskDevices.status,
      })
      .from(schema.kioskDevices)
      .where(eq(schema.kioskDevices.id, deviceId))
      .limit(1);
    if (!device) throw new AppError('UNAUTH', 401, 'kiosk device not found');
    if (device.status !== 'active') throw new AppError('UNAUTH', 401, 'kiosk device inactive');

    req.kioskDeviceId = deviceId;
    req.merchantClientId = device.widgetClientId;
  });
});

import type { InferSelectModel } from 'drizzle-orm';

declare module 'fastify' {
  interface FastifyRequest {
    widgetClientId?: string;
    widgetClient?: InferSelectModel<typeof schema.widgetClients>;
    merchantClientId?: string;
    kioskDeviceId?: string;
  }
  interface FastifyInstance {
    requireWidgetClient: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireMerchant: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireKioskDevice: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
