import { schema } from '@aivastra/db';
import {
  MerchantRefreshBody,
  WidgetClientLogin,
  WidgetClientProfileUpdate,
  WidgetClientSignup,
  WidgetSettingsUpdate,
} from '@aivastra/types';
import { desc, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError } from '../../lib/errors.js';
import { rotateTokenFamily } from '../auth/routes.js';
import {
  hashPassword,
  hashRefresh,
  newRefreshToken,
  signAccess,
  verifyPassword,
} from '../auth/service.js';
import { parseDuration } from '../auth/tokens.js';

async function createMerchantSessionTokens(app: FastifyInstance, widgetClientId: string) {
  const secret = new TextEncoder().encode(app.env.JWT_SECRET);
  const accessToken = await signAccess(secret, widgetClientId, {}, app.env.JWT_EXPIRY, 'merchant');
  const refresh = newRefreshToken();
  await app.db.insert(schema.refreshTokens).values({
    widgetClientId,
    familyId: crypto.randomUUID(),
    generation: 1,
    tokenHash: refresh.hash,
    expiresAt: new Date(Date.now() + parseDuration(app.env.REFRESH_TOKEN_EXPIRY)),
    portal: 'merchant',
  });
  return { accessToken, refreshToken: refresh.plain };
}

export async function merchantRoutes(app: FastifyInstance) {
  const secret = new TextEncoder().encode(app.env.JWT_SECRET);

  app.post(
    '/v1/merchant/signup',
    {
      schema: { body: WidgetClientSignup },
      config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
    },
    async (req, reply) => {
      const body = req.body as {
        companyName: string;
        contactName: string;
        email: string;
        phone: string;
        websiteUrl: string;
        companySize: string;
        purpose: string;
        businessAddress: string;
        password: string;
      };

      const existing = await app.db
        .select()
        .from(schema.widgetClients)
        .where(eq(schema.widgetClients.email, body.email))
        .limit(1);
      if (existing.length) {
        throw new AppError('CONFLICT', 409, 'Email already registered');
      }

      const passwordHash = await hashPassword(body.password);

      const [client] = await app.db
        .insert(schema.widgetClients)
        .values({
          companyName: body.companyName,
          contactName: body.contactName,
          email: body.email,
          phone: body.phone,
          websiteUrl: body.websiteUrl,
          companySize: body.companySize,
          purpose: body.purpose,
          businessAddress: body.businessAddress,
          passwordHash,
        })
        .returning();

      await app.db.insert(schema.widgetClientCredits).values({
        widgetClientId: client?.id,
        balance: 0,
      });

      // widgetKey withheld until account is approved by admin (isActive: false by default)
      return reply.code(201).send({
        id: client?.id,
        email: body.email,
        companyName: body.companyName,
        message: 'Account pending approval. You will be notified when your account is activated.',
      });
    },
  );

  app.post('/v1/merchant/login', { schema: { body: WidgetClientLogin } }, async (req, reply) => {
    const { email, password } = req.body as { email: string; password: string };

    const [client] = await app.db
      .select()
      .from(schema.widgetClients)
      .where(eq(schema.widgetClients.email, email))
      .limit(1);

    if (!client || !(await verifyPassword(client.passwordHash, password))) {
      throw new AppError('UNAUTH', 401, 'Invalid email or password');
    }

    if (!client.isActive) {
      throw new AppError('FORBIDDEN', 403, 'Account inactive');
    }

    const { accessToken, refreshToken } = await createMerchantSessionTokens(app, client.id);

    const isProd = app.env.NODE_ENV === 'production';
    reply.setCookie('merchant_access_token', accessToken, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/v1/merchant',
      maxAge: parseDuration(app.env.JWT_EXPIRY) / 1000,
      secure: isProd,
    });

    return { accessToken, refreshToken };
  });

  app.post('/v1/merchant/refresh', { schema: { body: MerchantRefreshBody } }, async (req) => {
    const { refreshToken } = req.body as { refreshToken: string };
    const tokenHash = hashRefresh(refreshToken);
    const [refreshRow] = await app.db
      .select({
        userId: schema.refreshTokens.userId,
        kioskDeviceId: schema.refreshTokens.kioskDeviceId,
        widgetClientId: schema.refreshTokens.widgetClientId,
        portal: schema.refreshTokens.portal,
      })
      .from(schema.refreshTokens)
      .where(eq(schema.refreshTokens.tokenHash, tokenHash))
      .limit(1);
    if (
      !refreshRow?.widgetClientId ||
      refreshRow.userId ||
      refreshRow.kioskDeviceId ||
      refreshRow.portal !== 'merchant'
    ) {
      throw new AppError('INVALID_REFRESH', 401, 'refresh invalid');
    }

    const result = await rotateTokenFamily(app, refreshToken, 'merchant');
    if (result.kind === 'invalid' || result.ownerType !== 'widgetClient') {
      throw new AppError('INVALID_REFRESH', 401, 'refresh invalid');
    }

    const [client] = await app.db
      .select({ id: schema.widgetClients.id, isActive: schema.widgetClients.isActive })
      .from(schema.widgetClients)
      .where(eq(schema.widgetClients.id, result.ownerId))
      .limit(1);
    if (!client?.isActive) throw new AppError('INVALID_REFRESH', 401, 'refresh invalid');

    return {
      accessToken: await signAccess(secret, result.ownerId, {}, app.env.JWT_EXPIRY, 'merchant'),
      refreshToken: result.kind === 'rotated' ? result.refreshPlain : null,
    };
  });

  app.post('/v1/merchant/logout', async (req, reply) => {
    const refreshToken =
      ((req.body as { refreshToken?: string } | undefined)?.refreshToken ?? null) ||
      (req.headers.authorization?.startsWith('Bearer ')
        ? req.headers.authorization.slice(7)
        : null);
    if (refreshToken) {
      const tokenHash = hashRefresh(refreshToken);
      const [row] = await app.db
        .select({
          familyId: schema.refreshTokens.familyId,
          widgetClientId: schema.refreshTokens.widgetClientId,
          portal: schema.refreshTokens.portal,
        })
        .from(schema.refreshTokens)
        .where(eq(schema.refreshTokens.tokenHash, tokenHash))
        .limit(1);
      if (row?.portal === 'merchant' && row.widgetClientId) {
        await app.db
          .update(schema.refreshTokens)
          .set({ revokedAt: new Date() })
          .where(eq(schema.refreshTokens.familyId, row.familyId));
      }
    }
    const isProd = app.env.NODE_ENV === 'production';
    reply.setCookie('merchant_access_token', '', {
      httpOnly: true,
      sameSite: 'lax',
      path: '/v1/merchant',
      maxAge: 0,
      secure: isProd,
    });
    return reply.code(204).send();
  });

  app.get('/v1/merchant/me', { preHandler: app.requireMerchant }, async (req) => {
    const clientId = (req as FastifyRequest & { merchantClientId: string }).merchantClientId;

    const [client] = await app.db
      .select({
        id: schema.widgetClients.id,
        companyName: schema.widgetClients.companyName,
        contactName: schema.widgetClients.contactName,
        email: schema.widgetClients.email,
        phone: schema.widgetClients.phone,
        websiteUrl: schema.widgetClients.websiteUrl,
        widgetKey: schema.widgetClients.widgetKey,
        isActive: schema.widgetClients.isActive,
        kioskEnabled: schema.widgetClients.kioskEnabled,
        maxKioskDevices: schema.widgetClients.maxKioskDevices,
        userId: schema.widgetClients.userId,
        allowedOrigins: schema.widgetClients.allowedOrigins,
        settings: schema.widgetClients.settings,
        createdAt: schema.widgetClients.createdAt,
        creditBalance: schema.widgetClientCredits.balance,
      })
      .from(schema.widgetClients)
      .leftJoin(
        schema.widgetClientCredits,
        eq(schema.widgetClients.id, schema.widgetClientCredits.widgetClientId),
      )
      .where(eq(schema.widgetClients.id, clientId))
      .limit(1);

    if (!client) throw new AppError('NOT_FOUND', 404, 'Merchant not found');
    return client;
  });

  app.patch(
    '/v1/merchant/me',
    { preHandler: app.requireMerchant, schema: { body: WidgetClientProfileUpdate } },
    async (req) => {
      const clientId = (req as FastifyRequest & { merchantClientId: string }).merchantClientId;
      const body = req.body as WidgetClientProfileUpdate;

      const [updated] = await app.db
        .update(schema.widgetClients)
        .set({
          contactName: body.contactName,
          phone: body.phone,
          companyName: body.companyName,
          websiteUrl: body.websiteUrl,
          updatedAt: new Date(),
        })
        .where(eq(schema.widgetClients.id, clientId))
        .returning({
          id: schema.widgetClients.id,
          companyName: schema.widgetClients.companyName,
          contactName: schema.widgetClients.contactName,
          phone: schema.widgetClients.phone,
          websiteUrl: schema.widgetClients.websiteUrl,
        });

      if (!updated) throw new AppError('NOT_FOUND', 404, 'Merchant not found');
      return updated;
    },
  );

  app.patch(
    '/v1/merchant/settings',
    { preHandler: app.requireMerchant, schema: { body: WidgetSettingsUpdate } },
    async (req) => {
      const clientId = (req as FastifyRequest & { merchantClientId: string }).merchantClientId;
      const body = req.body as WidgetSettingsUpdate;

      const updates: {
        settings?: typeof schema.widgetClients.$inferInsert.settings;
        allowedOrigins?: string[];
        updatedAt: Date;
      } = { updatedAt: new Date() };
      if (body.settings !== undefined) updates.settings = body.settings;
      if (body.allowedOrigins !== undefined) updates.allowedOrigins = body.allowedOrigins;

      const [updated] = await app.db
        .update(schema.widgetClients)
        .set(updates)
        .where(eq(schema.widgetClients.id, clientId))
        .returning({
          settings: schema.widgetClients.settings,
          allowedOrigins: schema.widgetClients.allowedOrigins,
        });

      if (!updated) throw new AppError('NOT_FOUND', 404, 'Merchant not found');
      return updated;
    },
  );

  app.post('/v1/merchant/api-keys/regenerate', { preHandler: app.requireMerchant }, async (req) => {
    const clientId = (req as FastifyRequest & { merchantClientId: string }).merchantClientId;
    const newKey = crypto.randomUUID();

    const [updated] = await app.db
      .update(schema.widgetClients)
      .set({ widgetKey: newKey, updatedAt: new Date() })
      .where(eq(schema.widgetClients.id, clientId))
      .returning({ widgetKey: schema.widgetClients.widgetKey });

    if (!updated) throw new AppError('NOT_FOUND', 404, 'Merchant not found');
    return updated;
  });

  app.get('/v1/merchant/jobs', { preHandler: app.requireMerchant }, async (req) => {
    const clientId = (req as FastifyRequest & { merchantClientId: string }).merchantClientId;

    const jobs = await app.db
      .select({
        id: schema.jobs.id,
        status: schema.jobs.status,
        creditsCharged: schema.jobs.creditsCharged,
        createdAt: schema.jobs.createdAt,
        completedAt: schema.jobs.completedAt,
      })
      .from(schema.jobs)
      .where(eq(schema.jobs.widgetClientId, clientId))
      .orderBy(desc(schema.jobs.createdAt))
      .limit(50);

    return { jobs };
  });
}
