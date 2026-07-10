import { schema } from '@aivastra/db';
import {
  MerchantLogin,
  MerchantProfileUpdate,
  MerchantRefreshBody,
  MerchantSignup,
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
import { findOrCreateUserForMerchant } from './user-link.js';

async function createMerchantSessionTokens(app: FastifyInstance, merchantId: string) {
  const secret = new TextEncoder().encode(app.env.JWT_SECRET);
  const accessToken = await signAccess(secret, merchantId, {}, app.env.JWT_EXPIRY, 'merchant');
  const refresh = newRefreshToken();
  await app.db.insert(schema.refreshTokens).values({
    merchantId,
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
      schema: { body: MerchantSignup },
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

      const client = await app.db.transaction(async (tx) => {
        const { user, created } = await findOrCreateUserForMerchant(tx, {
          email: body.email,
          password: body.password,
          displayName: body.contactName,
          phone: body.phone,
        });
        // Existing account: prove ownership with the submitted password instead of
        // silently attaching a merchant profile to someone else's login.
        if (!created && !(await verifyPassword(user.passwordHash ?? '', body.password))) {
          throw new AppError('CONFLICT', 409, 'Email already registered');
        }

        const [alreadyMerchant] = await tx
          .select({ id: schema.merchants.id })
          .from(schema.merchants)
          .where(eq(schema.merchants.userId, user.id))
          .limit(1);
        if (alreadyMerchant) {
          throw new AppError('CONFLICT', 409, 'This account is already registered as a merchant');
        }

        const [created_] = await tx
          .insert(schema.merchants)
          .values({
            companyName: body.companyName,
            contactName: body.contactName,
            phone: body.phone,
            websiteUrl: body.websiteUrl,
            companySize: body.companySize,
            purpose: body.purpose,
            businessAddress: body.businessAddress,
            userId: user.id,
          })
          .returning();

        await tx.insert(schema.merchantCredits).values({
          merchantId: created_.id,
          balance: 0,
        });
        return created_;
      });

      // isActive stays false until an admin approves the account
      return reply.code(201).send({
        id: client.id,
        email: body.email,
        companyName: body.companyName,
        message: 'Account pending approval. You will be notified when your account is activated.',
      });
    },
  );

  app.post('/v1/merchant/login', { schema: { body: MerchantLogin } }, async (req, reply) => {
    const { email, password } = req.body as { email: string; password: string };
    const dummyHash = await hashPassword('__timing_dummy__');

    const [row] = await app.db
      .select({ passwordHash: schema.users.passwordHash, client: schema.merchants })
      .from(schema.users)
      .innerJoin(schema.merchants, eq(schema.merchants.userId, schema.users.id))
      .where(eq(schema.users.email, email))
      .limit(1);

    if (!row?.passwordHash) {
      await verifyPassword(dummyHash, password); // constant-time: prevent user enumeration via timing
      throw new AppError('UNAUTH', 401, 'Invalid email or password');
    }
    if (!(await verifyPassword(row.passwordHash, password))) {
      throw new AppError('UNAUTH', 401, 'Invalid email or password');
    }

    const client = row.client;
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
        merchantId: schema.refreshTokens.merchantId,
        portal: schema.refreshTokens.portal,
      })
      .from(schema.refreshTokens)
      .where(eq(schema.refreshTokens.tokenHash, tokenHash))
      .limit(1);
    if (
      !refreshRow?.merchantId ||
      refreshRow.userId ||
      refreshRow.kioskDeviceId ||
      refreshRow.portal !== 'merchant'
    ) {
      throw new AppError('INVALID_REFRESH', 401, 'refresh invalid');
    }

    const result = await rotateTokenFamily(app, refreshToken, 'merchant');
    if (result.kind === 'invalid' || result.ownerType !== 'merchant') {
      throw new AppError('INVALID_REFRESH', 401, 'refresh invalid');
    }

    const [client] = await app.db
      .select({ id: schema.merchants.id, isActive: schema.merchants.isActive })
      .from(schema.merchants)
      .where(eq(schema.merchants.id, result.ownerId))
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
          merchantId: schema.refreshTokens.merchantId,
          portal: schema.refreshTokens.portal,
        })
        .from(schema.refreshTokens)
        .where(eq(schema.refreshTokens.tokenHash, tokenHash))
        .limit(1);
      if (row?.portal === 'merchant' && row.merchantId) {
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
        id: schema.merchants.id,
        companyName: schema.merchants.companyName,
        contactName: schema.merchants.contactName,
        email: schema.users.email,
        phone: schema.merchants.phone,
        websiteUrl: schema.merchants.websiteUrl,
        isActive: schema.merchants.isActive,
        kioskEnabled: schema.merchants.kioskEnabled,
        maxKioskDevices: schema.merchants.maxKioskDevices,
        userId: schema.merchants.userId,
        createdAt: schema.merchants.createdAt,
        creditBalance: schema.merchantCredits.balance,
      })
      .from(schema.merchants)
      .innerJoin(schema.users, eq(schema.merchants.userId, schema.users.id))
      .leftJoin(schema.merchantCredits, eq(schema.merchants.id, schema.merchantCredits.merchantId))
      .where(eq(schema.merchants.id, clientId))
      .limit(1);

    if (!client) throw new AppError('NOT_FOUND', 404, 'Merchant not found');
    return client;
  });

  app.patch(
    '/v1/merchant/me',
    { preHandler: app.requireMerchant, schema: { body: MerchantProfileUpdate } },
    async (req) => {
      const clientId = (req as FastifyRequest & { merchantClientId: string }).merchantClientId;
      const body = req.body as MerchantProfileUpdate;

      const [updated] = await app.db
        .update(schema.merchants)
        .set({
          contactName: body.contactName,
          phone: body.phone,
          companyName: body.companyName,
          websiteUrl: body.websiteUrl,
          updatedAt: new Date(),
        })
        .where(eq(schema.merchants.id, clientId))
        .returning({
          id: schema.merchants.id,
          companyName: schema.merchants.companyName,
          contactName: schema.merchants.contactName,
          phone: schema.merchants.phone,
          websiteUrl: schema.merchants.websiteUrl,
        });

      if (!updated) throw new AppError('NOT_FOUND', 404, 'Merchant not found');
      return updated;
    },
  );

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
      .where(eq(schema.jobs.merchantId, clientId))
      .orderBy(desc(schema.jobs.createdAt))
      .limit(50);

    return { jobs };
  });
}
