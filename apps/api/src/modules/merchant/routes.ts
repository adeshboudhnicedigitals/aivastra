import { schema } from '@aivastra/db';
import { WidgetClientLogin, WidgetClientSignup } from '@aivastra/types';
import { desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../../lib/errors.js';
import { hashPassword, signAccess, verifyPassword } from '../auth/service.js';

export async function merchantRoutes(app: FastifyInstance) {
  const secret = new TextEncoder().encode(app.env.JWT_SECRET);

  app.post('/v1/merchant/signup', { schema: { body: WidgetClientSignup } }, async (req, reply) => {
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

    return reply.code(201).send({
      id: client?.id,
      email: body.email,
      companyName: body.companyName,
      widgetKey: client?.widgetKey,
    });
  });

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

    const accessToken = await signAccess(
      secret,
      client.id,
      { email: client.email },
      '30d',
      'merchant',
    );

    const isProd = app.env.NODE_ENV === 'production';
    reply.setCookie('merchant_access_token', accessToken, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 24 * 60 * 60,
      secure: isProd,
    });

    return { accessToken };
  });

  app.post('/v1/merchant/logout', async (_req, reply) => {
    const isProd = app.env.NODE_ENV === 'production';
    reply.setCookie('merchant_access_token', '', {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
      secure: isProd,
    });
    return reply.code(204).send();
  });

  app.get('/v1/merchant/me', { preHandler: app.requireMerchant }, async (req) => {
    const clientId = (req as any).merchantClientId as string;

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

  app.get('/v1/merchant/jobs', { preHandler: app.requireMerchant }, async (req) => {
    const clientId = (req as any).merchantClientId as string;

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
