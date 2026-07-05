import { schema } from '@aivastra/db';
import { WidgetClientSignup } from '@aivastra/types';
import { and, count, desc, eq, ilike, or as orOp } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { hashPassword } from '../auth/service.js';
import { createKioskDevice } from '../kiosk/provisioning.js';
import { widgetAdminGrant } from '../widget/ledger.js';
import { requireAdmin } from './guard.js';

const AdminCreateClient = WidgetClientSignup.extend({
  initialCredits: z.number().int().min(0).optional(),
});

const AdminCreditBody = z.object({
  amount: z.number().int().positive(),
  reason: z.string().min(1),
});

const AdminKioskDeviceBody = z.object({ label: z.string().min(1).max(120) });
const AdminPatchKioskDeviceBody = z
  .object({
    label: z.string().min(1).max(120).optional(),
    status: z.literal('revoked').optional(),
  })
  .refine((body) => body.label !== undefined || body.status !== undefined, {
    message: 'label or status is required',
  });

function publicKioskDevice(device: typeof schema.kioskDevices.$inferSelect) {
  const { pairingCodeHash: _pairingCodeHash, ...rest } = device;
  return rest;
}

// Save-time shape check for merchant webhook URLs. This rejects the obvious cases
// (non-https, hostnames that are literal private/loopback IPs) so an admin gets an
// immediate error instead of a silent drop. The authoritative SSRF guard — full DNS
// resolution against private ranges — runs at send-time in the dispatcher, since DNS
// can be repointed after save.
function assertWebhookUrlShape(urlStr: string): void {
  let u: URL;
  try {
    u = new URL(urlStr);
  } catch {
    throw new AppError('VALIDATION', 400, 'webhookUrl must be a valid URL');
  }
  if (u.protocol !== 'https:') {
    throw new AppError('VALIDATION', 400, 'webhookUrl must use https');
  }
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    host === 'localhost' ||
    host === '::1' ||
    host.startsWith('127.') ||
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    host.startsWith('169.254.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host.startsWith('fc') ||
    host.startsWith('fd') ||
    host.startsWith('fe80')
  ) {
    throw new AppError(
      'VALIDATION',
      400,
      'webhookUrl must not point to a private or loopback address',
    );
  }
}

export async function adminWidgetClientsRoutes(app: FastifyInstance) {
  app.get(
    '/v1/admin/widget-clients',
    { preHandler: requireAdmin(['SUPER_ADMIN', 'ADMIN']) },
    async (req) => {
      const {
        page = '1',
        limit = '20',
        search = '',
      } = req.query as {
        page?: string;
        limit?: string;
        search?: string;
      };
      const p = Math.max(1, parseInt(page, 10) || 1);
      const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
      const offset = (p - 1) * l;

      const where = search
        ? orOp(
            ilike(schema.widgetClients.email, `%${search}%`),
            ilike(schema.widgetClients.companyName, `%${search}%`),
          )
        : undefined;

      const [totalRow] = await app.db
        .select({ n: count() })
        .from(schema.widgetClients)
        // biome-ignore lint/suspicious/noExplicitAny: drizzle where-clause union type
        .where(where as any);

      const clients = await app.db
        .select({
          id: schema.widgetClients.id,
          companyName: schema.widgetClients.companyName,
          contactName: schema.widgetClients.contactName,
          email: schema.widgetClients.email,
          phone: schema.widgetClients.phone,
          websiteUrl: schema.widgetClients.websiteUrl,
          companySize: schema.widgetClients.companySize,
          purpose: schema.widgetClients.purpose,
          businessAddress: schema.widgetClients.businessAddress,
          widgetKey: schema.widgetClients.widgetKey,
          isActive: schema.widgetClients.isActive,
          allowedOrigins: schema.widgetClients.allowedOrigins,
          createdAt: schema.widgetClients.createdAt,
          updatedAt: schema.widgetClients.updatedAt,
          creditBalance: schema.widgetClientCredits.balance,
        })
        .from(schema.widgetClients)
        .leftJoin(
          schema.widgetClientCredits,
          eq(schema.widgetClients.id, schema.widgetClientCredits.widgetClientId),
        )
        // biome-ignore lint/suspicious/noExplicitAny: drizzle where-clause union type
        .where(where as any)
        .orderBy(desc(schema.widgetClients.createdAt))
        .limit(l)
        .offset(offset);

      return {
        clients,
        total: totalRow?.n ?? 0,
        page: p,
        limit: l,
      };
    },
  );

  app.post(
    '/v1/admin/widget-clients',
    {
      preHandler: requireAdmin(['SUPER_ADMIN']),
      schema: { body: AdminCreateClient },
    },
    async (req, reply) => {
      const body = req.body as z.infer<typeof AdminCreateClient>;

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

      if (body.initialCredits && body.initialCredits > 0) {
        await widgetAdminGrant(
          // biome-ignore lint/suspicious/noExplicitAny: DB type narrowing
          app.db as any,
          client?.id,
          body.initialCredits,
          'Initial grant',
          req.userId,
        );
      }

      return reply.code(201).send({ id: client?.id, widgetKey: client?.widgetKey });
    },
  );

  app.get(
    '/v1/admin/widget-clients/:id',
    { preHandler: requireAdmin(['SUPER_ADMIN', 'ADMIN']) },
    async (req) => {
      const { id } = req.params as { id: string };

      const [client] = await app.db
        .select({
          id: schema.widgetClients.id,
          companyName: schema.widgetClients.companyName,
          contactName: schema.widgetClients.contactName,
          email: schema.widgetClients.email,
          phone: schema.widgetClients.phone,
          websiteUrl: schema.widgetClients.websiteUrl,
          companySize: schema.widgetClients.companySize,
          purpose: schema.widgetClients.purpose,
          businessAddress: schema.widgetClients.businessAddress,
          widgetKey: schema.widgetClients.widgetKey,
          isActive: schema.widgetClients.isActive,
          allowedOrigins: schema.widgetClients.allowedOrigins,
          webhookUrl: schema.widgetClients.webhookUrl,
          webhookSecret: schema.widgetClients.webhookSecret,
          createdAt: schema.widgetClients.createdAt,
          updatedAt: schema.widgetClients.updatedAt,
          creditBalance: schema.widgetClientCredits.balance,
        })
        .from(schema.widgetClients)
        .leftJoin(
          schema.widgetClientCredits,
          eq(schema.widgetClients.id, schema.widgetClientCredits.widgetClientId),
        )
        .where(eq(schema.widgetClients.id, id))
        .limit(1);

      if (!client) throw new AppError('NOT_FOUND', 404, 'Widget client not found');

      const ledger = await app.db
        .select()
        .from(schema.widgetCreditLedger)
        .where(eq(schema.widgetCreditLedger.widgetClientId, id))
        .orderBy(desc(schema.widgetCreditLedger.createdAt))
        .limit(20);

      const recentJobs = await app.db
        .select({
          id: schema.jobs.id,
          status: schema.jobs.status,
          creditsCharged: schema.jobs.creditsCharged,
          createdAt: schema.jobs.createdAt,
          completedAt: schema.jobs.completedAt,
        })
        .from(schema.jobs)
        .where(eq(schema.jobs.widgetClientId, id))
        .orderBy(desc(schema.jobs.createdAt))
        .limit(20);

      return { ...client, ledger, recentJobs };
    },
  );

  app.patch(
    '/v1/admin/widget-clients/:id',
    { preHandler: requireAdmin(['SUPER_ADMIN']) },
    async (req) => {
      const { id } = req.params as { id: string };
      const body = req.body as {
        isActive?: boolean;
        companyName?: string;
        allowedOrigins?: string[];
        webhookUrl?: string | null;
        webhookSecret?: string | null;
      };

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (body.isActive !== undefined) updates.isActive = body.isActive;
      if (body.companyName !== undefined) updates.companyName = body.companyName;
      if (body.allowedOrigins !== undefined) updates.allowedOrigins = body.allowedOrigins;
      if (body.webhookUrl !== undefined) {
        if (body.webhookUrl) assertWebhookUrlShape(body.webhookUrl);
        updates.webhookUrl = body.webhookUrl || null;
      }
      if (body.webhookSecret !== undefined) {
        updates.webhookSecret = body.webhookSecret || null;
      }

      const [updated] = await app.db
        .update(schema.widgetClients)
        .set(updates)
        .where(eq(schema.widgetClients.id, id))
        .returning();

      if (!updated) throw new AppError('NOT_FOUND', 404, 'Widget client not found');
      return updated;
    },
  );

  app.post(
    '/v1/admin/widget-clients/:id/credits',
    {
      preHandler: requireAdmin(['SUPER_ADMIN']),
      schema: { body: AdminCreditBody },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const { amount, reason } = req.body as z.infer<typeof AdminCreditBody>;

      await widgetAdminGrant(
        // biome-ignore lint/suspicious/noExplicitAny: DB type narrowing
        app.db as any,
        id,
        amount,
        reason,
        req.userId,
      );

      const [credits] = await app.db
        .select({ balance: schema.widgetClientCredits.balance })
        .from(schema.widgetClientCredits)
        .where(eq(schema.widgetClientCredits.widgetClientId, id))
        .limit(1);

      return { newBalance: credits?.balance ?? amount };
    },
  );
  app.post(
    '/v1/admin/widget-clients/:id/kiosk-devices',
    {
      preHandler: requireAdmin(['SUPER_ADMIN']),
      schema: { body: AdminKioskDeviceBody },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { label } = req.body as z.infer<typeof AdminKioskDeviceBody>;
      const [client] = await app.db
        .select({ id: schema.widgetClients.id })
        .from(schema.widgetClients)
        .where(eq(schema.widgetClients.id, id))
        .limit(1);
      if (!client) throw new AppError('NOT_FOUND', 404, 'Widget client not found');

      const { device, pairingCode } = await createKioskDevice(app, id, label);
      reply.code(201);
      return { device: publicKioskDevice(device), pairingCode };
    },
  );

  app.patch(
    '/v1/admin/widget-clients/:id/kiosk-devices/:deviceId',
    {
      preHandler: requireAdmin(['SUPER_ADMIN']),
      schema: { body: AdminPatchKioskDeviceBody },
    },
    async (req) => {
      const { id, deviceId } = req.params as { id: string; deviceId: string };
      const body = req.body as z.infer<typeof AdminPatchKioskDeviceBody>;
      const now = new Date();
      const [updated] = await app.db
        .update(schema.kioskDevices)
        .set({
          ...(body.label !== undefined ? { label: body.label } : {}),
          ...(body.status === 'revoked' ? { status: 'revoked', revokedAt: now } : {}),
          updatedAt: now,
        })
        .where(
          and(eq(schema.kioskDevices.id, deviceId), eq(schema.kioskDevices.widgetClientId, id)),
        )
        .returning();
      if (!updated) throw new AppError('NOT_FOUND', 404, 'kiosk device not found');
      return publicKioskDevice(updated);
    },
  );
}
