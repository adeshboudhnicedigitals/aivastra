import { randomUUID } from 'node:crypto';
import { keys } from '@aivastra/storage';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { listCatalogItems, listCatalogSubcategories } from '../merchant/catalog.routes.js';
import { IncludeDemoQuery } from '../merchant/demo-catalog-read.js';
import {
  createUploadSession,
  getUploadSession,
  UPLOAD_SESSION_TTL_SECONDS,
} from '../merchant/upload-session-store.js';

// Device twins of the owner routes the Merchant Android app reads (device-mode plan, M2). A
// shared tablet holds only its device token, never the owner's JWT, so every read the try-on
// flow needs has to accept that token. Each one calls the SAME function as its
// /v1/merchant/* twin; only the credential differs. The merchant always comes from the token.
export async function deviceTabletRoutes(app: FastifyInstance) {
  app.get(
    '/v1/device/catalog/subcategories',
    {
      preHandler: app.requireDevice,
      schema: {
        querystring: z.object({ category: z.string().optional(), includeDemo: IncludeDemoQuery }),
      },
    },
    async (req) => {
      const { category, includeDemo } = req.query as { category?: string; includeDemo: boolean };
      return listCatalogSubcategories(app, req.device!.merchantId, { category, includeDemo });
    },
  );

  app.get(
    '/v1/device/catalog',
    {
      preHandler: app.requireDevice,
      schema: {
        querystring: z.object({
          search: z.string().optional(),
          subcategoryId: z.string().optional(),
          includeDemo: IncludeDemoQuery,
        }),
      },
    },
    async (req) => {
      const q = req.query as { search?: string; subcategoryId?: string; includeDemo: boolean };
      return listCatalogItems(app, req.device!.merchantId, q);
    },
  );

  // Preview of a photo the shopper just uploaded. Same prefix rule as the owner route: a key
  // outside this merchant's input prefix is another merchant's customer photo.
  app.get(
    '/v1/device/tryon/photo-url',
    {
      preHandler: app.requireDevice,
      schema: { querystring: z.object({ r2Key: z.string().min(1) }) },
    },
    async (req) => {
      const merchantId = req.device!.merchantId;
      const { r2Key } = req.query as { r2Key: string };
      if (!r2Key.startsWith(keys.merchantInputPrefix(merchantId))) {
        throw new AppError('FORBIDDEN', 403, 'photo key does not belong to this merchant');
      }
      const { url } = await app.storage.presignGet(r2Key, 300);
      return { url };
    },
  );

  // "Upload from your phone" QR. The session is bound to the merchant, exactly as the owner
  // route binds it; the public /v1/kiosk-upload-sessions/:token routes complete it unchanged.
  app.post(
    '/v1/device/tryon/upload-sessions',
    { preHandler: app.requireDevice, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const merchantId = req.device!.merchantId;
      const r2Key = keys.merchantQrUploadInput(merchantId, randomUUID());
      const token = await createUploadSession(app, merchantId, r2Key);
      reply.code(201);
      return {
        token,
        qrUrl: `${app.env.WEB_URL}/kiosk-upload/${token}`,
        expiresIn: UPLOAD_SESSION_TTL_SECONDS,
      };
    },
  );

  app.get(
    '/v1/device/tryon/upload-sessions/:token',
    { preHandler: app.requireDevice, schema: { params: z.object({ token: z.string().min(1) }) } },
    async (req) => {
      const { token } = req.params as { token: string };
      const session = await getUploadSession(app, token);
      if (!session || session.merchantId !== req.device!.merchantId) {
        throw new AppError(
          'SESSION_EXPIRED',
          404,
          'this upload session has expired or does not exist',
        );
      }
      return {
        status: session.status,
        r2Key: session.status === 'uploaded' ? session.r2Key : null,
      };
    },
  );
}
